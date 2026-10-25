// Shared setup for booking/payment bridge tests: a voted plan with one option backed by a stored candidate.
import { eq } from 'drizzle-orm';
import { candidates, conversations, jobs, messages, outbox, planConversations, plans, type Db } from '@hacktx/db';
import type { ActorContext, Candidate, JobKind, OutboundRecipient } from '@hacktx/contracts';
import { createPlan, open, publishVersion } from '@hacktx/core';
import { TOOLS, type ToolCtx } from '@hacktx/agent';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

export const CANDIDATE: Candidate = {
  id: 'cand-dune-1', kind: 'movie_screening', title: 'Dune: Part Two', venueName: 'Owned Test Cinema', address: null,
  timeZone: 'America/Chicago', startAt: '2026-11-01T00:30:00.000Z', durationMinutes: 166, format: 'Standard',
  price: { amountMinor: 1500, currency: 'USD' }, rawPriceText: '$15.00', rawCurrency: 'USD', priceKind: 'listed',
  bookingUrl: 'https://fixture.booking.test/checkout', sourceIds: [], evidence: [],
};

export async function votedPlan() {
  const db = await testDb();
  const u = await seedUsers(db, ['Alex', 'Mark', 'Mel']);
  await befriend(db, u.Alex!, u.Mark!);
  await befriend(db, u.Alex!, u.Mel!);
  const { plan } = await createPlan(db, web(u.Alex!), {
    request: 'Dune with Mark and Mel', templateId: 'movie-night', city: austin,
    window: { startAt: '2026-10-31T00:00:00.000Z', endAt: '2026-11-03T00:00:00.000Z' }, participantUserIds: [u.Mark!, u.Mel!],
  });
  const [conv] = await db.insert(conversations).values({ provider: 'claw', sendingLine: '+15125550000', externalChatId: 'grp1', kind: 'group', activePlanId: plan.id }).returning();
  await db.insert(planConversations).values({ planId: plan.id, conversationId: conv!.id, audience: 'group' });
  await db.insert(candidates).values({ id: CANDIDATE.id, kind: CANDIDATE.kind, payload: CANDIDATE, cacheKey: '', fetchedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) });
  const { version } = await publishVersion(db, {
    planId: plan.id, inputRevision: 0, runId: null, options: [{
      label: 'A', title: 'Dune: Part Two at Owned Test Cinema', candidateIds: [CANDIDATE.id],
      startAt: CANDIDATE.startAt!, endAt: '2026-11-01T03:16:00.000Z', timeZone: 'America/Chicago', timeline: [],
      estimatedPerPerson: CANDIDATE.price, priceKind: 'listed', fit: 'fits_known_constraints', uncertainties: [], publicExplanation: 'Test option', sourceIds: [],
    }],
  });
  let n = 0;
  /** Store a group message from `userId` and return a tool context for it (verified sender). */
  const say = async (userId: string, body: string): Promise<ToolCtx> => {
    const [m] = await db.insert(messages).values({ conversationId: conv!.id, providerMessageId: `pm${++n}`, senderUserId: userId, senderHandle: userId, isPrivate: false, body, occurredAt: new Date() }).returning();
    const actor: ActorContext = { userId, source: 'group_message', conversationId: conv!.id, sourceMessageId: m!.id };
    return { db, actor, planId: plan.id, conversation: { id: conv!.id, kind: 'group' }, messageId: m!.id, providerMessageId: m!.providerMessageId };
  };
  return { db, u, planId: plan.id, versionId: version.id, conv: conv!, say };
}

export async function callTool(ctx: ToolCtx, name: string, args: unknown) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.run(ctx, t.args.parse(args)) as Promise<Record<string, unknown>>;
}

export async function jobsOf(db: Db, kind: JobKind) {
  return db.select().from(jobs).where(eq(jobs.kind, kind));
}

/** Every outbox message, decrypted, with its recipient. */
export async function sent(db: Db) {
  const rows = await db.select().from(outbox);
  return rows.map((r) => ({ recipient: r.recipient as OutboundRecipient, text: r.body ?? open('outbox', r.bodyEnc!), effectKey: r.effectKey }));
}

export const privateTo = (all: Awaited<ReturnType<typeof sent>>, userId: string) =>
  all.filter((m) => m.recipient.kind === 'private' && m.recipient.userId === userId).map((m) => m.text);
export const groupTexts = (all: Awaited<ReturnType<typeof sent>>) => all.filter((m) => m.recipient.kind === 'group').map((m) => m.text);

export async function planStatus(db: Db, planId: string) {
  const [p] = await db.select({ status: plans.status }).from(plans).where(eq(plans.id, planId));
  return p?.status;
}
