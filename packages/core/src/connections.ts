// Messaging and web use the same invitation rows and account encryption format.
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { encryptPhone, phoneDigest as accountPhoneDigest, tokenDigest } from '@muse/accounts';
import { friendInvites, friendships, planParticipants, plans, user, type Db } from '@hacktx/db';
import type { ActorContext, PlanStatus } from '@hacktx/contracts';
import { AppError, forbidden, invalid, notFound } from './errors';
import { enqueueMessage } from './jobs';
import { bumpRevision, missingConnections, resumeWaitingPlans, updateParticipants } from './plans';

const INVITE_TTL_MS = 7 * 24 * 3600_000;
const REOPENABLE: PlanStatus[] = ['waiting_connections', 'planning', 'clarifying', 'voting', 'selected'];
const pair = (a: string, b: string) => (a < b ? [a, b] as const : [b, a] as const);
export const appBaseUrl = () => (process.env.APP_BASE_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, '');

export function normalizePhone(raw: string): string | null {
  const s = raw.trim(), digits = s.replace(/\D/g, '');
  const e164 = s.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : null;
  return e164 && /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}
export function phoneDigest(e164: string) {
  const key = process.env.PHONE_LOOKUP_HMAC_KEY;
  if (!key) throw new Error('PHONE_LOOKUP_HMAC_KEY is not set');
  return accountPhoneDigest(e164, key);
}
async function nameOf(db: Db, userId: string) {
  return (await db.select({ name: user.name }).from(user).where(eq(user.id, userId)))[0]?.name ?? 'A friend';
}
async function verifiedPhone(db: Db, userId: string) {
  const [account] = await db.select({ phone: user.phoneNumber, verified: user.phoneNumberVerified }).from(user).where(eq(user.id, userId));
  return account?.verified ? account.phone : null;
}

/** Queue one private connection invitation; no account existence information is returned. */
export async function inviteByPhone(db: Db, actor: ActorContext, input: { name: string; phone: string; context?: string | null; planId?: string | null }) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw invalid('Phone number must include a country code, e.g. +15125550123');
  const [existing] = await db.select({ id: user.id }).from(user).where(and(eq(user.phoneNumber, phone), eq(user.phoneNumberVerified, true)));
  if (existing?.id === actor.userId) throw invalid('That is your own number');
  return db.transaction(async tx => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.userId)).for('update');
    const [plan] = input.planId ? await tx.select().from(plans).where(eq(plans.id, input.planId)).for('update') : [];
    if (input.planId && (!plan || plan.organizerUserId !== actor.userId || !REOPENABLE.includes(plan.status as PlanStatus))) throw forbidden('Only the organizer can invite people before booking');
    const connected = existing && !(await missingConnections(tx, actor.userId, [existing.id])).length;
    if (connected) {
      if (plan) {
        const [seat] = await tx.select().from(planParticipants).where(and(eq(planParticipants.planId, plan.id), eq(planParticipants.userId, existing.id)));
        if (!seat) await updateParticipants(tx, actor, { planId: plan.id, add: [existing.id], remove: [], expectedRevision: plan.inputRevision });
      }
      return { sent: false as const, alreadyConnected: true as const, addedToPlan: !!plan };
    }
    const digest = phoneDigest(phone);
    const [live] = await tx.select().from(friendInvites).where(and(eq(friendInvites.inviterUserId, actor.userId), eq(friendInvites.recipientPhoneDigest, digest), eq(friendInvites.state, 'pending'), gt(friendInvites.expiresAt, new Date())));
    let invitationId = live?.id;
    if (!invitationId) {
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(friendInvites).where(and(eq(friendInvites.inviterUserId, actor.userId), gt(friendInvites.createdAt, new Date(Date.now() - 3600_000))));
      if ((count?.n ?? 0) >= 20) throw new AppError('QUOTA_LIMIT', 'Too many invitations this hour; try again later');
      invitationId = randomUUID();
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      await tx.insert(friendInvites).values({ id: invitationId, inviterUserId: actor.userId, recipientPhoneEnc: encryptPhone(phone, Buffer.from(process.env.APP_ENCRYPTION_KEY ?? '', 'base64')), recipientPhoneDigest: digest, tokenHash: tokenDigest(token), state: 'pending', expiresAt, createdAt: new Date() });
      const context = (input.context?.trim() || plan?.request || 'outings with friends').replace(/\s+/g, ' ').slice(0, 120);
      await enqueueMessage(tx, {
        recipient: { kind: 'invite', invitationId },
        text: `Hi ${input.name.trim().slice(0, 80) || 'friend'}! ${await nameOf(tx, actor.userId)} invited you to SideQuest to plan: ${context}. Sign in and accept here: ${appBaseUrl()}/invite/${token} . If your account is already set up, reply YES to accept or NO to decline.`,
        effectKey: `invite:${invitationId}`, expiresAt, planId: plan?.id ?? null,
      });
    }
    if (plan) {
      const [seat] = await tx.select().from(planParticipants).where(and(eq(planParticipants.planId, plan.id), eq(planParticipants.inviteId, invitationId)));
      if (!seat) {
        await tx.insert(planParticipants).values({ planId: plan.id, userId: null, inviteId: invitationId, requestedName: input.name.trim().slice(0, 80) || 'Friend' });
        await bumpRevision(tx, plan.id, plan.inputRevision, { status: 'waiting_connections' });
        await tx.update(plans).set({ selectedOptionId: null }).where(eq(plans.id, plan.id));
      }
    }
    return { sent: true as const, addedToPlan: !!plan };
  });
}

export async function pendingRequestsFor(db: Db, userId: string) {
  const phone = await verifiedPhone(db, userId);
  if (!phone) return [];
  const rows = await db.select({ userId: user.id, name: user.name }).from(friendInvites).innerJoin(user, eq(user.id, friendInvites.inviterUserId)).where(and(eq(friendInvites.recipientPhoneDigest, phoneDigest(phone)), eq(friendInvites.state, 'pending'), gt(friendInvites.expiresAt, new Date())));
  return [...new Map(rows.map(row => [row.userId, row])).values()];
}

async function resolveInvite(db: Db, actor: ActorContext, invitationId: string, accept: boolean) {
  const result = await db.transaction(async tx => {
    const [invite] = await tx.select().from(friendInvites).where(eq(friendInvites.id, invitationId)).for('update');
    if (!invite || invite.state !== 'pending' || invite.expiresAt <= new Date()) throw notFound();
    const phone = await verifiedPhone(tx, actor.userId);
    if (!phone || phoneDigest(phone) !== invite.recipientPhoneDigest) throw forbidden('This invite was sent to a different phone number');
    if (actor.userId === invite.inviterUserId) throw forbidden('Cannot answer your own request');
    await tx.update(friendInvites).set({ state: accept ? 'accepted' : 'declined' }).where(eq(friendInvites.id, invite.id));
    let resumedPlanIds: string[] = [];
    if (accept) {
      const [low, high] = pair(actor.userId, invite.inviterUserId);
      await tx.insert(friendships).values({ userLow: low, userHigh: high, requestedBy: invite.inviterUserId, status: 'accepted', acceptedAt: new Date() }).onConflictDoNothing();
      for (const seat of await tx.select().from(planParticipants).where(eq(planParticipants.inviteId, invite.id))) {
        const [duplicate] = await tx.select().from(planParticipants).where(and(eq(planParticipants.planId, seat.planId), eq(planParticipants.userId, actor.userId)));
        if (duplicate) await tx.delete(planParticipants).where(eq(planParticipants.id, seat.id));
        else await tx.update(planParticipants).set({ userId: actor.userId }).where(eq(planParticipants.id, seat.id));
      }
      resumedPlanIds = [...new Set([...await resumeWaitingPlans(tx, actor.userId), ...await resumeWaitingPlans(tx, invite.inviterUserId)])];
      await enqueueMessage(tx, { recipient: { kind: 'private', userId: invite.inviterUserId }, text: `${await nameOf(tx, actor.userId)} accepted your SideQuest connection.`, effectKey: `friendaccept:${invite.id}` });
    }
    return { inviterId: invite.inviterUserId, resumedPlanIds };
  });
  return result;
}
export async function respondToFriendRequest(db: Db, actor: ActorContext, otherUserId: string, accept: boolean) {
  const phone = await verifiedPhone(db, actor.userId);
  if (!phone) throw notFound();
  const [invite] = await db.select().from(friendInvites).where(and(eq(friendInvites.inviterUserId, otherUserId), eq(friendInvites.recipientPhoneDigest, phoneDigest(phone)), eq(friendInvites.state, 'pending'), gt(friendInvites.expiresAt, new Date())));
  if (!invite) throw notFound();
  const result = await resolveInvite(db, actor, invite.id, accept);
  return { status: accept ? 'accepted' as const : 'declined' as const, resumedPlanIds: result.resumedPlanIds };
}
export async function acceptInviteForUser(db: Db, userId: string, token: string) {
  const [invite] = await db.select().from(friendInvites).where(eq(friendInvites.tokenHash, tokenDigest(token)));
  if (!invite) throw notFound();
  const result = await resolveInvite(db, { userId, source: 'web' }, invite.id, true);
  return { inviterUserId: result.inviterId, resumedPlanIds: result.resumedPlanIds };
}
