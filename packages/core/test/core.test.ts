import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, messages, outbox, plans, votes } from '@hacktx/db';
import {
  AppError, checkSlot, statementToBusy, enqueue, claim, complete, enqueueMessage, reserveEffect, createPlan, publishVersion,
  requestRepair, recordVote, tally, recordDecision, publicPlan, savePrivateFact, listOwnFacts, loadMemberAvailability, open,
  webConversation,
  type OptionDraft,
} from '@hacktx/core';
import { testDb, seedUsers, befriend, austin, web } from './helpers';

const W = { startAt: '2026-10-31T15:00:00.000Z', endAt: '2026-11-01T05:00:00.000Z' };
const draft = (label: 'A' | 'B' | 'C', startAt: string, endAt: string): OptionDraft => ({
  label, title: `Option ${label}`, candidateIds: [`c${label}`], startAt, endAt, timeZone: 'America/Chicago',
  timeline: [], estimatedPerPerson: null, priceKind: 'unknown', fit: 'fits_known_constraints', uncertainties: [],
  publicExplanation: 'x', sourceIds: [],
});
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof AppError ? e.code : String(e); } };

async function votingPlan() {
  const db = await testDb();
  const u = await seedUsers(db, ['Alex', 'Mark', 'Mel', 'Eve']);
  await befriend(db, u.Alex!, u.Mark!);
  await befriend(db, u.Alex!, u.Mel!);
  const { plan } = await createPlan(db, web(u.Alex!), { request: 'movie', templateId: 'movie-night', city: austin, window: W, participantUserIds: [u.Mark!, u.Mel!] });
  const pub = await publishVersion(db, { planId: plan.id, inputRevision: 0, runId: null, options: [
    draft('A', '2026-10-31T19:00:00.000Z', '2026-10-31T21:00:00.000Z'),
    draft('B', '2026-10-31T23:00:00.000Z', '2026-11-01T01:00:00.000Z'),
  ] });
  return { db, u, plan, ...pub };
}

describe('availability', () => {
  const slot = { startAt: '2026-10-31T19:00:00.000Z', endAt: '2026-10-31T21:00:00.000Z' };
  it('treats [start,end) touching intervals as no conflict', () => {
    const r = checkSlot(slot, [{ userId: 'a', sources: [{ status: 'known', window: W, busy: [{ startAt: '2026-10-31T17:00:00.000Z', endAt: slot.startAt }] }] }]);
    expect(r.fit).toBe('fits_known_constraints');
  });
  it('flags overlap as conflict and missing data as unknown (never free)', () => {
    const r = checkSlot(slot, [
      { userId: 'busy', sources: [{ status: 'known', window: W, busy: [{ startAt: '2026-10-31T20:59:00.000Z', endAt: '2026-10-31T22:00:00.000Z' }] }] },
      { userId: 'nodata', sources: [] },
    ]);
    expect(r.conflicts).toEqual(['busy']);
    expect(r.unknown).toEqual(['nodata']);
    expect(r.fit).toBe('conflict');
  });
  it('turns "only free 6-9pm" into busy time outside it', () => {
    const k = statementToBusy(W, [{ startAt: '2026-10-31T23:00:00.000Z', endAt: '2026-11-01T02:00:00.000Z' }], []);
    expect(checkSlot(slot, [{ userId: 'x', sources: [k] }]).fit).toBe('conflict');
    expect(checkSlot({ startAt: '2026-10-31T23:30:00.000Z', endAt: '2026-11-01T01:30:00.000Z' }, [{ userId: 'x', sources: [k] }]).fit).toBe('fits_known_constraints');
  });
});

describe('jobs, outbox, effects', () => {
  it('dedupes enqueue, leases one job at a time, and completes', async () => {
    const db = await testDb();
    expect(await enqueue(db, { kind: 'process_inbound', dedupeKey: 'linq:evt1' })).toBe(true);
    expect(await enqueue(db, { kind: 'process_inbound', dedupeKey: 'linq:evt1' })).toBe(false); // duplicate webhook
    const j = await claim(db, 'w1');
    expect(j?.dedupeKey).toBe('linq:evt1');
    expect(await claim(db, 'w2')).toBeNull();
    await complete(db, j!);
    expect((await db.select().from(jobs))[0]!.state).toBe('done');
  });
  it('only claims requested kinds', async () => {
    const db = await testDb();
    await enqueue(db, { kind: 'send_outbox', dedupeKey: 's1' });
    expect(await claim(db, 'w', 1000, ['plan'])).toBeNull();
    expect((await claim(db, 'w', 1000, ['send_outbox']))?.kind).toBe('send_outbox');
  });
  it('encrypts private outbox bodies, keeps one row per effect key', async () => {
    const db = await testDb();
    await enqueueMessage(db, { recipient: { kind: 'private', userId: 'u1' }, text: 'secret budget question', effectKey: 'k1' });
    await enqueueMessage(db, { recipient: { kind: 'private', userId: 'u1' }, text: 'secret budget question', effectKey: 'k1' });
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBeNull();
    expect(rows[0]!.bodyEnc).not.toContain('secret');
    expect(open('outbox', rows[0]!.bodyEnc!)).toBe('secret budget question');
    expect((await db.select().from(jobs)).filter((j) => j.kind === 'send_outbox')).toHaveLength(1);
  });
  it('reserves an external effect once', async () => {
    const db = await testDb();
    expect((await reserveEffect(db, { operationKey: 'book:q1', kind: 'booking' })).fresh).toBe(true);
    expect((await reserveEffect(db, { operationKey: 'book:q1', kind: 'booking' })).fresh).toBe(false);
  });
});

describe('plan lifecycle', () => {
  it('waits for friend connections before planning', async () => {
    const db = await testDb();
    const u = await seedUsers(db, ['Alex', 'Mark']);
    await befriend(db, u.Alex!, u.Mark!, 'pending');
    const r = await createPlan(db, web(u.Alex!), { request: 'bowling', templateId: 'local-outing', city: austin, window: null, participantUserIds: [u.Mark!] });
    expect(r.plan.status).toBe('waiting_connections');
    expect(r.missingConnections).toEqual([u.Mark]);
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it('refuses to publish a draft computed from an old revision', async () => {
    const { db, plan, version } = await votingPlan();
    await requestRepair(db, plan.id, 0, 'time changed');
    expect(await code(publishVersion(db, { planId: plan.id, inputRevision: 0, runId: null, options: [draft('A', W.startAt, W.endAt)] }))).toBe('STALE_PLAN');
    const next = await publishVersion(db, { planId: plan.id, inputRevision: 1, runId: null, options: [draft('A', W.startAt, W.endAt)] });
    expect(next.version.versionNumber).toBe(version.versionNumber + 1);
  });

  it('persists an updated request and template when repairing a plan', async () => {
    const { db, plan } = await votingPlan();
    const repaired = await requestRepair(db, plan.id, 0, 'activity changed', { request: 'Watch Dune this weekend in Austin', templateId: 'movie-night' });
    expect(repaired).toMatchObject({ request: 'Watch Dune this weekend in Austin', templateId: 'movie-night', inputRevision: 1, selectedOptionId: null });
    const [stored] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(stored).toMatchObject({ request: 'Watch Dune this weekend in Austin', templateId: 'movie-night' });
  });

  it('updates the planning window atomically and rejects stale or invalid window changes', async () => {
    const { db, plan } = await votingPlan();
    const startAt = '2026-11-07T00:00:00.000Z';
    const endAt = '2026-11-15T00:00:00.000Z';
    const repaired = await requestRepair(db, plan.id, 0, 'new dates', {
      request: 'See Tron or Clayface in Austin next week', window: { startAt, endAt },
    });
    expect(repaired).toMatchObject({ request: 'See Tron or Clayface in Austin next week', windowStart: new Date(startAt), windowEnd: new Date(endAt), inputRevision: 1 });
    expect(await code(requestRepair(db, plan.id, 0, 'stale', { window: { startAt, endAt } }))).toBe('STALE_PLAN');
    expect(await code(requestRepair(db, plan.id, 1, 'invalid', { window: { startAt: endAt, endAt: startAt } }))).toBe('INVALID');
    const unchanged = await requestRepair(db, plan.id, 1, 'same dates');
    expect(unchanged).toMatchObject({ windowStart: new Date(startAt), windowEnd: new Date(endAt), inputRevision: 2 });
  });

  it('records own votes, rejects stale-version votes, reports ties', async () => {
    const { db, u, plan, version, options } = await votingPlan();
    const [A, B] = options;
    await recordVote(db, web(u.Mark!), { planId: plan.id, versionId: version.id, acceptableOptionIds: [A!.id, B!.id], favoriteOptionId: B!.id, noneAcceptable: false, source: 'web', sourceEventId: 'e1' });
    await recordVote(db, web(u.Mel!), { planId: plan.id, versionId: version.id, acceptableOptionIds: [A!.id], favoriteOptionId: A!.id, noneAcceptable: false, source: 'web', sourceEventId: 'e2' });
    let t = await tally(db, version.id);
    expect(t.leader).toBe(A!.id);

    // native poll toggle keeps a still-acceptable favorite
    await recordVote(db, web(u.Mark!), { planId: plan.id, versionId: version.id, acceptableOptionIds: [A!.id, B!.id], favoriteOptionId: null, noneAcceptable: false, source: 'native_poll', sourceEventId: 'e3' });
    t = await tally(db, version.id);
    expect(t.options.find((o) => o.optionId === B!.id)!.favorite).toBe(1);

    // favorite must be acceptable
    expect(await code(recordVote(db, web(u.Mel!), { planId: plan.id, versionId: version.id, acceptableOptionIds: [A!.id], favoriteOptionId: B!.id, noneAcceptable: false, source: 'web', sourceEventId: 'e4' }))).not.toBe('ok');
    // outsider cannot vote
    expect(await code(recordVote(db, web(u.Eve!), { planId: plan.id, versionId: version.id, acceptableOptionIds: [A!.id], favoriteOptionId: null, noneAcceptable: false, source: 'web', sourceEventId: 'e5' }))).toBe('NOT_FOUND');

    await requestRepair(db, plan.id, 0, 'changed');
    expect(await code(recordVote(db, web(u.Mel!), { planId: plan.id, versionId: version.id, acceptableOptionIds: [A!.id], favoriteOptionId: null, noneAcceptable: false, source: 'native_poll', sourceEventId: 'e6' }))).toBe('STALE_PLAN');
  });

  it('records an explicit attendee list from chat evidence while allowing silent holdouts', async () => {
    const { db, u, plan, version, options } = await votingPlan();
    const conversation = await webConversation(db, plan.id, 'group', u.Alex!);
    const [evidence] = await db.insert(messages).values({
      conversationId: conversation.id, providerMessageId: 'agreement-1', senderUserId: u.Alex!, senderHandle: 'Alex',
      isPrivate: false, body: 'Let’s go with A. Mark and I are in; Mel can sit this one out.', occurredAt: new Date(),
    }).returning();
    const input = { planId: plan.id, versionId: version.id, optionId: options[0]!.id, attendeeUserIds: [u.Alex!, u.Mark!], evidenceMessageIds: [evidence!.id], expectedRevision: 0 };
    expect(await code(recordDecision(db, web(u.Alex!), { ...input, attendeeUserIds: [u.Alex!, u.Eve!] }))).toBe('INVALID');
    expect(await code(recordDecision(db, { userId: u.Alex!, source: 'group_message' }, { ...input, evidenceMessageIds: [] }))).toBe('INVALID');
    expect(await db.select().from(votes)).toHaveLength(0);
    const r = await recordDecision(db, { userId: u.Alex!, source: 'group_message' }, input);
    expect(r.notAttending).toContain(u.Mel);
    expect(r.notAttending).not.toContain(u.Mark);
    expect(await db.select().from(messages).where(eq(messages.id, evidence!.id))).toHaveLength(1);
    expect((await db.select().from(plans).where(eq(plans.id, plan.id)))[0]!.status).toBe('selected');
  });
});

describe('privacy', () => {
  it('private facts are owner-only, encrypted, absent from the public projection, and trigger repair', async () => {
    const { db, u, plan } = await votingPlan();
    await savePrivateFact(db, web(u.Mark!), { planId: plan.id, fact: { kind: 'spending_limit', value: { maximumShare: { amountMinor: 1337, currency: 'USD' } } } });
    await savePrivateFact(db, web(u.Mark!), { planId: plan.id, fact: { kind: 'availability', value: { window: W, available: null, unavailable: [{ startAt: '2026-10-31T18:00:00.000Z', endAt: '2026-10-31T20:00:00.000Z' }], certainty: 'explicit' } } });

    expect(JSON.stringify(await publicPlan(db, web(u.Mel!), plan.id))).not.toContain('1337');
    expect(await listOwnFacts(db, web(u.Mel!), plan.id)).toHaveLength(0);
    expect((await listOwnFacts(db, web(u.Mark!), plan.id)).map((f) => f.kind).sort()).toEqual(['availability', 'spending_limit']);
    expect(await code(publicPlan(db, web(u.Eve!), plan.id))).toBe('NOT_FOUND');

    const [p] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(p!.status).toBe('planning'); // material change re-plans and clears the old poll
    expect(p!.inputRevision).toBe(2); // each fact is a material change

    const avail = await loadMemberAvailability(db, plan.id, [u.Mark!, u.Mel!], W);
    expect(checkSlot({ startAt: '2026-10-31T19:00:00.000Z', endAt: '2026-10-31T21:00:00.000Z' }, avail).conflicts).toEqual([u.Mark]);
  });
});
