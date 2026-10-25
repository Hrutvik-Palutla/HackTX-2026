import { decryptPhone } from '@muse/accounts';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { friendInvites, friendships, jobs, outbox, planParticipants, plans, user, type Db } from '@hacktx/db';
import {
  acceptInviteForUser, createPlan, inviteByPhone, normalizePhone, open, phoneDigest, respondToFriendRequest,
} from '@hacktx/core';
import { austin, befriend, seedUsers, testDb, web } from './helpers';

process.env.PHONE_LOOKUP_HMAC_KEY ??= 'test-phone-key-at-least-32-characters';
process.env.APP_BASE_URL ??= 'https://sidequest.test';

const NEW_PHONE = '+15125550199';
let db: Db;
let ids: Record<string, string>;

beforeEach(async () => {
  db = await testDb();
  ids = await seedUsers(db, ['Alex', 'Mark', 'Mel']);
  await db.update(user).set({ phoneNumber: '+15125550101', phoneNumberVerified: true }).where(eq(user.id, ids.Mark!));
});

const plan = async (participants: string[] = []) =>
  (await createPlan(db, web(ids.Alex!), { request: 'watch Avengers this weekend', templateId: 'movie-night', city: austin, window: null, participantUserIds: participants })).plan;
const statusOf = async (id: string) => (await db.select().from(plans).where(eq(plans.id, id)))[0]!.status;
const planJobs = async (id: string) => db.select().from(jobs).where(and(eq(jobs.kind, 'plan'), eq(jobs.planId, id)));
const outboxText = (r: typeof outbox.$inferSelect) => open('outbox', r.bodyEnc!);

describe('normalizePhone', () => {
  it('accepts E.164 and US 10-digit numbers', () => {
    expect(normalizePhone('(512) 555-0199')).toBe(NEW_PHONE);
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('555-0199')).toBeNull();
  });
});

describe('inviteByPhone', () => {
  it('invites an unknown phone with a sealed invite and an invite text; the plan waits', async () => {
    const p = await plan();
    expect(await statusOf(p.id)).toBe('planning');
    const r = await inviteByPhone(db, web(ids.Alex!), { name: 'Sam', phone: '512-555-0199', context: null, planId: p.id });
    expect(r).toEqual({ sent: true, addedToPlan: true });

    const [inv] = await db.select().from(friendInvites);
    expect(inv!.recipientPhoneEnc).not.toContain('555');
    expect(decryptPhone(inv!.recipientPhoneEnc, Buffer.from(process.env.APP_ENCRYPTION_KEY!, 'base64'))).toBe(NEW_PHONE);
    expect(inv!.recipientPhoneDigest).toBe(phoneDigest(NEW_PHONE));
    expect(inv!.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 3600_000);

    const [msg] = await db.select().from(outbox);
    expect(msg!.recipient).toEqual({ kind: 'invite', invitationId: inv!.id });
    expect(msg!.body).toBeNull();
    expect(outboxText(msg!)).toMatch(/Alex invited you.*watch Avengers.*https:\/\/sidequest\.test\/invite\/\S+/);

    const seats = await db.select().from(planParticipants).where(eq(planParticipants.planId, p.id));
    expect(seats.find((s) => s.inviteId === inv!.id)).toMatchObject({ userId: null, requestedName: 'Sam' });
    expect(await statusOf(p.id)).toBe('waiting_connections');

    // Inviting the same phone again reuses the invite: no second text.
    await inviteByPhone(db, web(ids.Alex!), { name: 'Sam', phone: NEW_PHONE, planId: p.id });
    expect(await db.select().from(friendInvites)).toHaveLength(1);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it('sends an existing user a pending request and a private message, with the same result shape', async () => {
    const r = await inviteByPhone(db, web(ids.Alex!), { name: 'Mark', phone: '+15125550101', context: 'see a movie' });
    expect(r).toEqual({ sent: true, addedToPlan: false });
    expect(await db.select().from(friendships)).toHaveLength(0);
    expect(await db.select().from(friendInvites)).toHaveLength(1);
    const [msg] = await db.select().from(outbox);
    expect(msg!.recipient).toMatchObject({ kind: 'invite' });
    expect(outboxText(msg!)).toContain('Alex invited you');
    expect(outboxText(msg!)).toContain('reply YES to accept or NO to decline');
  });

  it('reports an existing friend as already connected', async () => {
    await befriend(db, ids.Alex!, ids.Mark!);
    expect(await inviteByPhone(db, web(ids.Alex!), { name: 'Mark', phone: '+15125550101' })).toMatchObject({ alreadyConnected: true });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it('rate-limits invites per inviter', async () => {
    for (let i = 0; i < 20; i++) await inviteByPhone(db, web(ids.Alex!), { name: `P${i}`, phone: `+1512555${String(1000 + i)}` });
    await expect(inviteByPhone(db, web(ids.Alex!), { name: 'Late', phone: '+15125552000' })).rejects.toMatchObject({ code: 'QUOTA_LIMIT' });
  });
});

describe('respondToFriendRequest', () => {
  it('only the recipient can accept; accepting resumes the waiting plan', async () => {
    const p = await plan();
    await inviteByPhone(db, web(ids.Alex!), { name: 'Mark', phone: '+15125550101', planId: p.id });
    expect(await statusOf(p.id)).toBe('waiting_connections');
    expect(await planJobs(p.id)).toHaveLength(1); // the original plan job from creation (now stale)

    await expect(respondToFriendRequest(db, web(ids.Alex!), ids.Mark!, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(respondToFriendRequest(db, web(ids.Mel!), ids.Alex!, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const r = await respondToFriendRequest(db, web(ids.Mark!), ids.Alex!, true);
    expect(r).toEqual({ status: 'accepted', resumedPlanIds: [p.id] });
    const [f] = await db.select().from(friendships);
    expect(f!.status).toBe('accepted');
    expect(f!.acceptedAt).toBeInstanceOf(Date);
    expect(await statusOf(p.id)).toBe('planning');
    expect(await planJobs(p.id)).toHaveLength(2);
  });

  it('declining leaves the plan waiting', async () => {
    const p = await plan();
    await inviteByPhone(db, web(ids.Alex!), { name: 'Mark', phone: '+15125550101', planId: p.id });
    expect(await respondToFriendRequest(db, web(ids.Mark!), ids.Alex!, false)).toMatchObject({ status: 'declined' });
    expect(await statusOf(p.id)).toBe('waiting_connections');
  });
});

describe('acceptInviteForUser', () => {
  async function inviteToken(planId: string) {
    await inviteByPhone(db, web(ids.Alex!), { name: 'Sam', phone: NEW_PHONE, planId });
    const [msg] = await db.select().from(outbox);
    return outboxText(msg!).match(/\/invite\/([\w-]+)/)![1]!;
  }

  it('rejects a user whose verified phone is not the invited one', async () => {
    const p = await plan();
    const token = await inviteToken(p.id);
    await expect(acceptInviteForUser(db, ids.Mark!, token)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(acceptInviteForUser(db, ids.Mel!, token)).rejects.toMatchObject({ code: 'FORBIDDEN' }); // no phone at all
    await expect(acceptInviteForUser(db, ids.Mark!, 'not-a-token')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await statusOf(p.id)).toBe('waiting_connections');
  });

  it('binds the new user to the plan seat, connects them, and resumes the plan', async () => {
    const p = await plan();
    const token = await inviteToken(p.id);
    await db.insert(user).values({ id: 'u_sam', name: 'Sam', email: 'u_sam@users.invalid', city: JSON.stringify(austin), emailVerified: false, phoneNumber: NEW_PHONE, phoneNumberVerified: true });
    const r = await acceptInviteForUser(db, 'u_sam', token);
    expect(r).toEqual({ inviterUserId: ids.Alex, resumedPlanIds: [p.id] });
    expect((await db.select().from(friendships))[0]).toMatchObject({ status: 'accepted', requestedBy: ids.Alex });
    const seats = await db.select().from(planParticipants).where(eq(planParticipants.planId, p.id));
    expect(seats.map((s) => s.userId).sort()).toEqual([ids.Alex, 'u_sam'].sort());
    expect(await statusOf(p.id)).toBe('planning');
    expect((await db.select().from(friendInvites))[0]!.state).toBe('accepted');
    await expect(acceptInviteForUser(db, 'u_sam', token)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // single use
  });
});
