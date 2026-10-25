// Friend connections started over messaging or the web: invite by phone, accept/decline by reply, accept an
// invite link after signup. Every route ends in the same `friendships` row; a friendship exists only once accepted.
// Phones are stored only sealed ('phone') plus a keyed lookup digest; results never say whether a phone has an account.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { friendInvites, friendships, planParticipants, plans, user, type Db } from '@hacktx/db';
import type { ActorContext, PlanStatus } from '@hacktx/contracts';
import { AppError, forbidden, invalid, notFound } from './errors';
import { seal } from './crypto';
import { enqueueMessage } from './jobs';
import { bumpRevision, missingConnections, resumeWaitingPlans, updateParticipants } from './plans';

const INVITE_TTL_MS = 7 * 24 * 3600_000;
const INVITES_PER_HOUR = 20;
// A new invitee pulls an unbooked plan back to waiting_connections.
const REOPENABLE: PlanStatus[] = ['waiting_connections', 'planning', 'clarifying', 'voting', 'selected'];

const pair = (a: string, b: string) => (a < b ? [a, b] as const : [b, a] as const);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
export const appBaseUrl = () => (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** E.164, or null. A bare US number (10 digits, or 11 starting with 1) becomes +1. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  const digits = s.replace(/\D/g, '');
  const e164 = s.startsWith('+') ? `+${digits}`
    : digits.length === 10 ? `+1${digits}`
    : digits.length === 11 && digits.startsWith('1') ? `+${digits}`
    : null;
  return e164 && /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

/** Keyed lookup digest for a phone (HMAC-SHA256 hex), so invites can be matched without storing the number. */
export function phoneDigest(e164: string) {
  const k = process.env.PHONE_LOOKUP_HMAC_KEY;
  if (!k) throw new Error('PHONE_LOOKUP_HMAC_KEY is not set');
  return createHmac('sha256', k).update(e164).digest('hex');
}

async function nameOf(db: Db, userId: string) {
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  return u?.name ?? 'A friend';
}

async function assertUnderRateLimit(db: Db, inviterId: string) {
  const since = new Date(Date.now() - 3600_000);
  const [inv] = await db.select({ n: sql<number>`count(*)::int` }).from(friendInvites)
    .where(and(eq(friendInvites.inviterUserId, inviterId), gt(friendInvites.createdAt, since)));
  const [req] = await db.select({ n: sql<number>`count(*)::int` }).from(friendships)
    .where(and(eq(friendships.requestedBy, inviterId), gt(friendships.createdAt, since)));
  if ((inv?.n ?? 0) + (req?.n ?? 0) >= INVITES_PER_HOUR) throw new AppError('QUOTA_LIMIT', 'Too many invitations this hour; try again later');
}

/** Organizer's active plan, if the invite should join it; null for anyone else or a plan past booking. */
async function invitablePlan(db: Db, actor: ActorContext, planId: string | null | undefined) {
  if (!planId) return null;
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan || plan.organizerUserId !== actor.userId || !REOPENABLE.includes(plan.status as PlanStatus)) return null;
  return plan;
}

/** Roster grew by someone not yet connected: new revision, back to waiting_connections, no stale selection. */
async function waitOnConnections(db: Db, plan: typeof plans.$inferSelect) {
  await bumpRevision(db, plan.id, plan.inputRevision, { status: 'waiting_connections' });
  await db.update(plans).set({ selectedOptionId: null }).where(eq(plans.id, plan.id));
}

/**
 * The actor invites someone by phone. A verified account gets a pending friendship and a private request;
 * anyone else gets a sealed invite and a text with a signup link. With an organizer's active plan, the invitee
 * joins the roster and the plan waits for the connection. The return value is identical either way.
 */
export async function inviteByPhone(
  db: Db,
  actor: ActorContext,
  input: { name: string; phone: string; context?: string | null; planId?: string | null },
) {
  const e164 = normalizePhone(input.phone);
  if (!e164) throw invalid('Phone number must be E.164, e.g. +15125550123');
  const requestedName = input.name.trim().slice(0, 80) || 'Friend';
  const plan = await invitablePlan(db, actor, input.planId);
  const context = (input.context?.trim() || plan?.request || 'outings with friends').replace(/\s+/g, ' ').slice(0, 120);
  const inviter = await nameOf(db, actor.userId);

  const [existing] = await db.select({ id: user.id }).from(user).where(and(eq(user.phoneNumber, e164), eq(user.phoneNumberVerified, true)));
  if (existing?.id === actor.userId) throw invalid('That is your own number');

  if (existing) {
    const [lo, hi] = pair(actor.userId, existing.id);
    const [f] = await db.select().from(friendships).where(and(eq(friendships.userLow, lo), eq(friendships.userHigh, hi)));
    if (f?.status === 'pending' && f.requestedBy === existing.id) {
      // They already asked the actor: inviting back is acceptance.
      await acceptFriendship(db, actor, existing.id);
    } else if (f?.status !== 'accepted') {
      if (!f || f.status === 'declined') await assertUnderRateLimit(db, actor.userId);
      if (!f) await db.insert(friendships).values({ userLow: lo, userHigh: hi, requestedBy: actor.userId, status: 'pending' });
      else if (f.status === 'declined') {
        await db.update(friendships).set({ status: 'pending', requestedBy: actor.userId, acceptedAt: null })
          .where(and(eq(friendships.userLow, lo), eq(friendships.userHigh, hi)));
      }
      await enqueueMessage(db, {
        recipient: { kind: 'private', userId: existing.id },
        text: `${inviter} wants to connect on SideQuest to plan: ${context}. Reply YES to accept or NO to decline.`,
        effectKey: `friendreq:${lo}:${hi}:${today()}`, // at most one nudge per pair per day
      });
    }
    const connected = !(await missingConnections(db, actor.userId, [existing.id])).length;
    if (plan) {
      const [seat] = await db.select({ id: planParticipants.id }).from(planParticipants)
        .where(and(eq(planParticipants.planId, plan.id), eq(planParticipants.userId, existing.id)));
      // Already friends: an ordinary roster change (re-plans if options were out).
      if (!seat && connected) await updateParticipants(db, actor, { planId: plan.id, add: [existing.id], remove: [], expectedRevision: plan.inputRevision });
      else if (!seat) {
        await db.insert(planParticipants).values({ planId: plan.id, userId: existing.id, requestedName });
        await waitOnConnections(db, plan);
      }
    }
    // Only an existing friend is reported as such: the actor already knows that much.
    if (connected) return { sent: false as const, alreadyConnected: true as const, addedToPlan: !!plan };
    return { sent: true as const, addedToPlan: !!plan };
  }

  // No account: reuse a live invite from this inviter to this phone rather than texting again.
  const digest = phoneDigest(e164);
  const [live] = await db.select().from(friendInvites).where(and(
    eq(friendInvites.inviterUserId, actor.userId), eq(friendInvites.recipientPhoneDigest, digest),
    eq(friendInvites.state, 'pending'), gt(friendInvites.expiresAt, new Date()),
  ));
  let inviteId = live?.id;
  if (!inviteId) {
    await assertUnderRateLimit(db, actor.userId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const [inv] = await db.insert(friendInvites).values({
      inviterUserId: actor.userId, recipientPhoneEnc: seal('phone', e164), recipientPhoneDigest: digest,
      tokenHash: sha256(token), state: 'pending', expiresAt,
    }).returning();
    inviteId = inv!.id;
    await enqueueMessage(db, {
      recipient: { kind: 'invite', invitationId: inviteId },
      text: `Hi ${requestedName}! ${inviter} invited you to SideQuest to plan: ${context}. `
        + `Set up your account and accept their invite here: ${appBaseUrl()}/invite/${token}`,
      effectKey: `invite:${inviteId}`,
      expiresAt, // the link is the only copy of the token: wipe the body once sent
      planId: plan?.id ?? null,
    });
  }
  if (plan) {
    const [already] = await db.select({ id: planParticipants.id }).from(planParticipants)
      .where(and(eq(planParticipants.planId, plan.id), eq(planParticipants.inviteId, inviteId)));
    if (!already) {
      await db.insert(planParticipants).values({ planId: plan.id, userId: null, inviteId, requestedName });
      await waitOnConnections(db, plan);
    }
  }
  return { sent: true as const, addedToPlan: !!plan };
}

/** Pending requests waiting on `userId`'s answer (someone else asked). */
export async function pendingRequestsFor(db: Db, userId: string) {
  const rows = await db.select({ low: friendships.userLow, high: friendships.userHigh, requestedBy: friendships.requestedBy }).from(friendships)
    .where(and(eq(friendships.status, 'pending'), or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId))));
  const fromIds = rows.filter((r) => r.requestedBy !== userId).map((r) => r.requestedBy);
  if (!fromIds.length) return [];
  return db.select({ userId: user.id, name: user.name }).from(user).where(or(...fromIds.map((id) => eq(user.id, id))));
}

async function acceptFriendship(db: Db, actor: ActorContext, otherUserId: string) {
  const [lo, hi] = pair(actor.userId, otherUserId);
  await db.update(friendships).set({ status: 'accepted', acceptedAt: new Date() })
    .where(and(eq(friendships.userLow, lo), eq(friendships.userHigh, hi)));
  const resumed = [...await resumeWaitingPlans(db, actor.userId), ...await resumeWaitingPlans(db, otherUserId)];
  await enqueueMessage(db, {
    recipient: { kind: 'private', userId: otherUserId },
    text: `${await nameOf(db, actor.userId)} accepted your SideQuest connection.`,
    effectKey: `friendaccept:${lo}:${hi}`,
  });
  return [...new Set(resumed)];
}

/** Only the recipient of a pending request may answer it. Accepting resumes plans that were waiting on it. */
export async function respondToFriendRequest(db: Db, actor: ActorContext, otherUserId: string, accept: boolean) {
  if (otherUserId === actor.userId) throw invalid('Cannot answer your own request');
  const [lo, hi] = pair(actor.userId, otherUserId);
  const [f] = await db.select().from(friendships).where(and(eq(friendships.userLow, lo), eq(friendships.userHigh, hi)));
  if (!f || f.status !== 'pending') throw notFound();
  if (f.requestedBy !== otherUserId) throw forbidden('Only the person who was asked can answer this request');
  if (!accept) {
    await db.update(friendships).set({ status: 'declined' }).where(and(eq(friendships.userLow, lo), eq(friendships.userHigh, hi)));
    return { status: 'declined' as const, resumedPlanIds: [] };
  }
  return { status: 'accepted' as const, resumedPlanIds: await acceptFriendship(db, actor, otherUserId) };
}

/**
 * Web invite page (/invite/:token) after signup: the signed-in user's verified phone must be the invited one.
 * Creates the accepted friendship, binds the user to any plan seats held by the invite, and resumes those plans.
 */
export async function acceptInviteForUser(db: Db, userId: string, token: string) {
  const [inv] = await db.select().from(friendInvites).where(eq(friendInvites.tokenHash, sha256(token)));
  if (!inv || inv.state !== 'pending') throw notFound();
  if (inv.expiresAt < new Date()) {
    await db.update(friendInvites).set({ state: 'expired' }).where(eq(friendInvites.id, inv.id));
    throw new AppError('UNRESOLVED', 'This invite has expired; ask for a new one');
  }
  if (inv.inviterUserId === userId) throw invalid('That is your own invite');
  const [u] = await db.select({ phone: user.phoneNumber, verified: user.phoneNumberVerified }).from(user).where(eq(user.id, userId));
  if (!u?.phone || !u.verified || phoneDigest(u.phone) !== inv.recipientPhoneDigest) throw forbidden('This invite was sent to a different phone number');

  const [lo, hi] = pair(userId, inv.inviterUserId);
  await db.transaction(async (tx) => {
    await tx.update(friendInvites).set({ state: 'accepted', acceptedByUserId: userId }).where(eq(friendInvites.id, inv.id));
    await tx.insert(friendships).values({ userLow: lo, userHigh: hi, requestedBy: inv.inviterUserId, status: 'accepted', acceptedAt: new Date() })
      .onConflictDoUpdate({ target: [friendships.userLow, friendships.userHigh], set: { status: 'accepted', acceptedAt: new Date() } });
    const seats = await tx.select().from(planParticipants).where(eq(planParticipants.inviteId, inv.id));
    for (const s of seats) {
      const [dup] = await tx.select({ id: planParticipants.id }).from(planParticipants)
        .where(and(eq(planParticipants.planId, s.planId), eq(planParticipants.userId, userId)));
      if (dup) await tx.delete(planParticipants).where(eq(planParticipants.id, s.id));
      else await tx.update(planParticipants).set({ userId }).where(eq(planParticipants.id, s.id));
    }
  });
  const resumed = [...await resumeWaitingPlans(db, userId), ...await resumeWaitingPlans(db, inv.inviterUserId)];
  return { inviterUserId: inv.inviterUserId, resumedPlanIds: [...new Set(resumed)] };
}
