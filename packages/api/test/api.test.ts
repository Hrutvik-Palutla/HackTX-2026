import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentRuns, conversations, jobs, messagingIdentities, outbox, plans, voteStates } from '@hacktx/db';
import { applyPollVote, createPlan, publishVersion, registerPoll, requestRepair, resumeWaitingPlans, updateParticipants, AppError } from '@hacktx/core';
import { configureApi, getPlan, putVote, putPrivateFact, getPrivate, getStudioRuns, createPlanRoute } from '@hacktx/api';
import { runPollReminder } from '@hacktx/agent';
import { friendships } from '@hacktx/db';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

const W = { startAt: '2026-10-31T15:00:00.000Z', endAt: '2026-11-01T05:00:00.000Z' };
const ORIGIN = 'https://app.example.test';
const opt = (label: 'A' | 'B') => ({ label, title: label, candidateIds: ['c'], startAt: '2026-10-31T19:00:00.000Z', endAt: '2026-10-31T21:00:00.000Z', timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown' as const, fit: 'fits_known_constraints' as const, uncertainties: [], publicExplanation: '', sourceIds: [] });

async function setup() {
  const db = await testDb();
  const u = await seedUsers(db, ['Alex', 'Mark', 'Eve']);
  await befriend(db, u.Alex!, u.Mark!);
  const { plan } = await createPlan(db, web(u.Alex!), { request: 'movie', templateId: 'movie-night', city: austin, window: W, participantUserIds: [u.Mark!] });
  const { version, options } = await publishVersion(db, { planId: plan.id, inputRevision: 0, runId: null, options: [opt('A'), opt('B')] });
  let as: string | null = u.Alex!;
  configureApi({ db, getUserId: async () => as, appOrigin: ORIGIN, teamUserIds: [u.Alex!] });
  return { db, u, plan, version, options, login: (id: string | null) => { as = id; } };
}

const req = (method: string, body?: unknown, origin = ORIGIN) =>
  new Request('https://app.example.test/api/x', { method, headers: { origin, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const P = (id: string) => ({ params: Promise.resolve({ id }) });
const NO_PARAMS = { params: Promise.resolve({}) };

describe('http api', () => {
  it('requires a session, hides other plans, and is no-store', async () => {
    const { plan, u, login } = await setup();
    login(null);
    expect((await getPlan(req('GET'), P(plan.id))).status).toBe(401);
    login(u.Eve!);
    expect((await getPlan(req('GET'), P(plan.id))).status).toBe(404);
    login(u.Mark!);
    const r = await getPlan(req('GET'), P(plan.id));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const j = await r.json() as { data: { options: unknown[] }; revision: number };
    expect(j.data.options).toHaveLength(2);
  });

  it('rejects cross-origin mutations and records only the caller\'s vote', async () => {
    const { db, plan, version, options, u, login } = await setup();
    login(u.Mark!);
    const vote = { versionId: version.id, acceptableOptionIds: [options[0]!.id], favoriteOptionId: options[0]!.id, noneAcceptable: false, userId: u.Alex };
    expect((await putVote(req('PUT', vote, 'https://evil.test'), P(plan.id))).status).toBe(403);
    expect((await putVote(req('PUT', vote), P(plan.id))).status).toBe(200);
    const states = await db.select().from(voteStates);
    expect(states.map((s) => s.userId)).toEqual([u.Mark]); // body userId ignored
  });

  it('manual availability is private to its owner', async () => {
    const { plan, u, login } = await setup();
    login(u.Mark!);
    const fact = { kind: 'availability', value: { window: W, available: null, unavailable: [{ startAt: '2026-10-31T18:00:00.000Z', endAt: '2026-10-31T20:00:00.000Z' }], certainty: 'explicit' } };
    expect((await putPrivateFact(req('PUT', { fact }), P(plan.id))).status).toBe(200);
    expect(((await (await getPrivate(req('GET'), P(plan.id))).json()) as { data: { facts: unknown[] } }).data.facts).toHaveLength(1);
    login(u.Alex!);
    expect(((await (await getPrivate(req('GET'), P(plan.id))).json()) as { data: { facts: unknown[] } }).data.facts).toHaveLength(0);
  });

  it('studio is team-only; bad input is a 400', async () => {
    const { u, login } = await setup();
    expect((await getStudioRuns(req('GET'), NO_PARAMS)).status).toBe(200);
    login(u.Mark!);
    expect((await getStudioRuns(req('GET'), NO_PARAMS)).status).toBe(404);
    expect((await createPlanRoute(req('POST', { request: 'x' }), NO_PARAMS)).status).toBe(400);
  });
});

describe('polls, roster, resume, reminders', () => {
  it('maps native poll votes to verified voters and ignores stale polls', async () => {
    const { db, u, plan, version, options } = await setup();
    const [conv] = await db.insert(conversations).values({ provider: 'linq', sendingLine: 'L', externalChatId: 'g1', kind: 'group', activePlanId: plan.id }).returning();
    await registerPoll(db, { versionId: version.id, conversationId: conv!.id, providerMessageId: 'poll1' });
    const ev = { provider: 'linq', sendingLine: 'L', conversationExternalId: 'g1', pollMessageId: 'poll1', selectedLabels: ['B'], eventId: 'pe1' };
    expect((await applyPollVote(db, { ...ev, voterHandle: '+1555' })).status).toBe('unknown_voter');
    await db.insert(messagingIdentities).values({ userId: u.Mark!, provider: 'linq', handle: '+1555', kind: 'phone', verifiedAt: new Date() });
    expect((await applyPollVote(db, { ...ev, voterHandle: '+1555' })).status).toBe('recorded');
    const [s] = await db.select().from(voteStates).where(eq(voteStates.userId, u.Mark!));
    expect(s!.versionId).toBe(version.id);
    void options;
    await requestRepair(db, plan.id, 0, 'changed');
    await publishVersion(db, { planId: plan.id, inputRevision: 1, runId: null, options: [opt('A')] });
    expect((await applyPollVote(db, { ...ev, voterHandle: '+1555', eventId: 'pe2' })).status).toBe('stale_poll');
  });

  it('only the organizer edits the roster, and only with accepted friends', async () => {
    const { db, u, plan } = await setup();
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AppError ? e.code : String(e)));
    expect(await code(updateParticipants(db, web(u.Mark!), { planId: plan.id, add: [], remove: [u.Alex!], expectedRevision: 0 }))).toBe('FORBIDDEN');
    expect(await code(updateParticipants(db, web(u.Alex!), { planId: plan.id, add: [u.Eve!], remove: [], expectedRevision: 0 }))).toBe('UNRESOLVED');
    await befriend(db, u.Alex!, u.Eve!);
    const row = await updateParticipants(db, web(u.Alex!), { planId: plan.id, add: [u.Eve!], remove: [], expectedRevision: 0 });
    expect(row.status).toBe('planning');
    expect((await db.select().from(jobs)).some((j) => j.kind === 'repair')).toBe(true);
  });

  it('resumes a waiting plan once the last connection is accepted', async () => {
    const db = await testDb();
    const u = await seedUsers(db, ['Alex', 'Mel']);
    await befriend(db, u.Alex!, u.Mel!, 'pending');
    const { plan } = await createPlan(db, web(u.Alex!), { request: 'bowling', templateId: 'local-outing', city: austin, window: null, participantUserIds: [u.Mel!] });
    expect(await resumeWaitingPlans(db, u.Mel!)).toEqual([]);
    await befriend(db, u.Alex!, u.Mel!); // invitation accepted -> friendship row appears
    expect(await resumeWaitingPlans(db, u.Mel!)).toEqual([plan.id]);
    expect((await db.select().from(plans))[0]!.status).toBe('planning');
    expect((await db.select().from(jobs)).filter((j) => j.kind === 'plan')).toHaveLength(1);
  });

  it('reminder fires once for the current version and is a no-op when obsolete', async () => {
    const { db, plan, version } = await setup();
    expect((await runPollReminder(db, { planId: plan.id, versionId: version.id })).sent).toBe(true);
    await requestRepair(db, plan.id, 0, 'changed');
    expect((await runPollReminder(db, { planId: plan.id, versionId: version.id })).sent).toBe(false);
  });
});

describe('web chat + budget', () => {
  it('web messages reach the agent as the session user; private threads stay private', async () => {
    const { db, plan, u, login } = await setup();
    const { postMessage, getMessages } = await import('@hacktx/api');
    const { handleInbound } = await import('@hacktx/agent');
    login(u.Mark!);
    const r = await postMessage(req('POST', { text: 'only free after 7pm, keep it quiet', scope: 'private' }), P(plan.id));
    expect(r.status).toBe(200);
    const job = (await db.select().from(jobs)).find((j) => j.kind === 'process_inbound')!;
    const seen: string[] = [];
    const muse = {
      model: 'fake',
      async chat({ messages }: { messages: { content?: unknown }[] }) {
        seen.push(JSON.stringify(messages));
        return { message: { role: 'assistant', content: 'Noted privately.', refusal: null } as never, usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } };
      },
      async structured() { throw new Error('unused'); },
    };
    expect(await handleInbound({ db, muse: muse as never }, job.payload as never)).toEqual({ status: 'ok', replied: true });
    expect(seen[0]).toContain('only free after 7pm');

    const mine = ((await (await getMessages(req('GET'), P(plan.id))).json()) as { data: { from: unknown; text: string; scope: string }[] }).data;
    expect(mine.map((m) => [m.scope, m.text])).toEqual([['private', 'only free after 7pm, keep it quiet'], ['private', 'Noted privately.']]);
    login(u.Alex!);
    const theirs = ((await (await getMessages(req('GET'), P(plan.id))).json()) as { data: unknown[] }).data;
    expect(JSON.stringify(theirs)).not.toContain('7pm');
    expect((await db.select().from(outbox)).some((o) => o.effectKey.startsWith('reply:'))).toBe(false); // web delivery needs no outbox
  });

  it('refuses new runs past the Muse budget', async () => {
    const { db, plan } = await setup();
    const { RunRecorder } = await import('@hacktx/agent');
    const { templates } = await import('@hacktx/templates');
    process.env.MUSE_BUDGET_USD = '0.01';
    try {
      await db.insert(agentRuns).values({ planId: plan.id, task: 'plan', templateId: 'movie-night', templateVersion: 1, model: 'm', inputRevision: 0, status: 'ok', estimatedCostUsd: '0.02' });
      const e = await RunRecorder.start(db, { planId: plan.id, task: 'plan', template: templates['movie-night'], model: 'm', inputRevision: 0 }).catch((x) => x);
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('BUDGET_LIMIT');
    } finally {
      delete process.env.MUSE_BUDGET_USD;
    }
  });
});
