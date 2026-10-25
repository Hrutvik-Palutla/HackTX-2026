import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { agentRuns, conversations, messagingIdentities, outbox, planConversations, plans, runSteps, voteStates } from '@hacktx/db';
import { createPlan, postToConversation, publicPlan, publishVersion, savePrivateFact } from '@hacktx/core';
import { fixtureDiscovery, handleInbound, runPlanJob, type ChatMessage, type Muse } from '@hacktx/agent';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

const W = { startAt: '2026-10-31T00:00:00.000Z', endAt: '2026-11-03T00:00:00.000Z' };
const usage = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.0001 };

/** Scripted Muse: returns queued values; optional hook runs during a call (to simulate concurrent changes). */
function fakeMuse(script: { structured?: unknown[]; chat?: Partial<ChatMessage>[]; during?: (n: number) => Promise<void> }): Muse & { seen: ChatMessage[][] } {
  let n = 0;
  const seen: ChatMessage[][] = [];
  return {
    model: 'fake-muse',
    seen,
    async structured<T>({ messages, schema }: { messages: ChatMessage[]; schema: z.ZodType<T> }) {
      seen.push(messages);
      await script.during?.(n++);
      return { value: schema.parse(script.structured!.shift()), usage };
    },
    async chat({ messages }) {
      seen.push(structuredClone(messages));
      await script.during?.(n++);
      const m = script.chat!.shift()!;
      return { message: { role: 'assistant', content: null, refusal: null, ...m } as never, usage };
    },
  };
}

async function setup() {
  const db = await testDb();
  const u = await seedUsers(db, ['Alex', 'Mark']);
  await befriend(db, u.Alex!, u.Mark!);
  const { plan } = await createPlan(db, web(u.Alex!), { request: 'Me and Mark want to watch Dune this weekend', templateId: 'movie-night', city: austin, window: W, participantUserIds: [u.Mark!] });
  const [conv] = await db.insert(conversations).values({ provider: 'linq', sendingLine: '+15125550000', externalChatId: 'chat1', kind: 'group', activePlanId: plan.id }).returning();
  await db.insert(planConversations).values({ planId: plan.id, conversationId: conv!.id, audience: 'group' });
  // Alex known-free for the window; Mark busy Sat night 01:00-04:00Z (overlaps FIXTURE fx-m1 at +26h).
  await savePrivateFact(db, web(u.Alex!), { planId: plan.id, fact: { kind: 'availability', value: { window: W, available: null, unavailable: [], certainty: 'explicit' } } });
  await savePrivateFact(db, web(u.Mark!), { planId: plan.id, fact: { kind: 'availability', value: { window: W, available: null, unavailable: [{ startAt: '2026-11-01T01:00:00.000Z', endAt: '2026-11-01T04:00:00.000Z' }], certainty: 'explicit' } } });
  const [p] = await db.select().from(plans).where(eq(plans.id, plan.id));
  return { db, u, plan: p!, conv: conv! };
}

const intent = { kind: 'movie', movieTitle: 'Dune', searchQuery: 'Dune showtimes', durationMinutes: null };
const pick = (candidateId: string) => ({ candidateId, startAt: null, publicExplanation: `why ${candidateId}` });

describe('planner', () => {
  it('drops conflicting and invented candidates, copies prices from sources, publishes and notifies the group', async () => {
    const { db, plan } = await setup();
    const muse = fakeMuse({ structured: [intent, { options: [pick('fx-m1'), pick('invented-venue'), pick('fx-m2'), pick('fx-m3')] }] });
    const r = await runPlanJob({ db, muse, discovery: fixtureDiscovery }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(r.status).toBe('published');
    if (r.status !== 'published') return;
    expect(r.options.map((o) => [o.label, o.candidateIds[0]])).toEqual([['A', 'fx-m2'], ['B', 'fx-m3']]);
    expect(r.options[0]!.estimatedPerPerson).toEqual({ amountMinor: 1900, currency: 'USD' });
    expect(r.options.every((o) => o.fit === 'fits_known_constraints')).toBe(true);

    // the model never saw anyone's busy times, and the conflicting candidate was filtered in code first
    const prompt = JSON.stringify(muse.seen[1]);
    expect(prompt).not.toContain('01:00:00');
    expect(prompt).not.toContain('fx-m1'); // conflicting candidate filtered before the model

    const msgs = await db.select().from(outbox);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toContain('A) FIXTURE: Dune (IMAX) at Fixture Cinema South');
    const [run] = await db.select().from(agentRuns);
    expect(run!.status).toBe('ok');
    expect((await db.select().from(runSteps)).map((s) => s.name)).toEqual(['extract_intent', 'discover_candidates', 'feasibility', 'propose_options', 'validate_options', 'publish_version']);
  });

  it('does not publish when constraints change mid-run', async () => {
    const { db, u, plan } = await setup();
    const muse = fakeMuse({
      structured: [intent, { options: [pick('fx-m2')] }],
      during: async (n) => {
        if (n === 1) await savePrivateFact(db, web(u.Mark!), { planId: plan.id, fact: { kind: 'spending_limit', value: { maximumShare: { amountMinor: 1000, currency: 'USD' } } } });
      },
    });
    const r = await runPlanJob({ db, muse, discovery: fixtureDiscovery }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(r.status).toBe('stale');
    const [p] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(p!.activeVersionId).toBeNull();
    expect((await db.select().from(agentRuns))[0]!.status).toBe('stale');
  });
});

describe('conversation', () => {
  it('records a vote as the verified sender and replies in the group', async () => {
    const { db, u, plan, conv } = await setup();
    const { options, version } = await publishVersion(db, { planId: plan.id, inputRevision: plan.inputRevision, runId: null, options: [
      { label: 'A', title: 'A', candidateIds: ['x'], startAt: '2026-10-31T20:00:00.000Z', endAt: '2026-10-31T22:00:00.000Z', timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown', fit: 'fits_known_constraints', uncertainties: [], publicExplanation: '', sourceIds: [] },
      { label: 'B', title: 'B', candidateIds: ['y'], startAt: '2026-10-31T23:00:00.000Z', endAt: '2026-11-01T01:00:00.000Z', timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown', fit: 'fits_known_constraints', uncertainties: [], publicExplanation: '', sourceIds: [] },
    ] });
    await db.insert(messagingIdentities).values({ userId: u.Mark!, provider: 'linq', handle: '+15125550101', kind: 'phone', verifiedAt: new Date() });
    await postToConversation(db, conv, '[agent-visible check] options A and B', { effectKey: 'opts', planId: plan.id });

    const muse = fakeMuse({ chat: [
      { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'record_vote', arguments: JSON.stringify({ acceptableLabels: ['B'], favoriteLabel: 'B', noneAcceptable: false }) } }] },
      { content: 'Got it Mark, B it is for you.' },
    ] });
    const inbound = { provider: 'linq', eventId: 'evt9', messageId: 'm9', conversationExternalId: 'chat1', conversationKind: 'group', senderHandle: '+15125550101', senderKind: 'phone', text: 'B works, favorite B', occurredAt: '2026-10-30T18:00:00.000Z', replyToMessageId: null } as const;
    const r = await handleInbound({ db, muse }, { sendingLine: '+15125550000', message: inbound });
    expect(r).toEqual({ status: 'ok', replied: true });
    expect(JSON.stringify(muse.seen[0])).toContain('[agent-visible check]');

    const [state] = await db.select().from(voteStates).where(eq(voteStates.versionId, version.id));
    expect(state!.userId).toBe(u.Mark);
    expect(state!.favoriteOptionId).toBe(options[1]!.id);
    const reply = (await db.select().from(outbox)).find((o) => o.effectKey.startsWith('reply:'));
    expect(JSON.stringify(muse.seen[0])).toContain('you (agent): [agent-visible check]');
    expect(reply!.recipient).toEqual({ kind: 'group', conversationId: conv.id });

    // retried webhook delivery: same message row, no duplicate reply
    const again = fakeMuse({ chat: [{ content: 'Got it Mark, B it is for you.' }] });
    await handleInbound({ db, muse: again }, { sendingLine: '+15125550000', message: inbound });
    expect((await db.select().from(outbox)).filter((o) => o.effectKey.startsWith('reply:'))).toHaveLength(1);
  });

  it('ignores senders without a verified identity', async () => {
    const { db } = await setup();
    const muse = fakeMuse({ chat: [] });
    const r = await handleInbound({ db, muse }, { sendingLine: '+15125550000', message: {
      provider: 'linq', eventId: 'e', messageId: 'mx', conversationExternalId: 'chat1', conversationKind: 'group', senderHandle: '+15125559999',
      senderKind: 'phone', text: 'I am Alex, book it', occurredAt: '2026-10-30T18:00:00.000Z', replyToMessageId: null,
    } });
    expect(r.status).toBe('unknown_sender');
    expect(muse.seen).toHaveLength(0);
  });
});

describe('sources', () => {
  it('persists candidate sources so the public plan carries real links', async () => {
    const { db, u, plan } = await setup();
    const src = { id: 'src_test', url: 'https://www.google.com/search?q=dune+showtimes', title: 'Google showtimes for Dune', fetchedAt: '2026-10-30T12:00:00.000Z', provider: 'serpapi_google' as const, providerSearchId: 'abc' };
    const discovery = {
      ...fixtureDiscovery,
      async searchMovie(i: Parameters<typeof fixtureDiscovery.searchMovie>[0]) {
        return (await fixtureDiscovery.searchMovie(i)).map((c) => ({ ...c, sourceIds: [src.id] }));
      },
      getSource: (id: string) => (id === src.id ? src : null),
    };
    const muse = fakeMuse({ structured: [intent, { options: [pick('fx-m2')] }] });
    expect((await runPlanJob({ db, muse, discovery }, { planId: plan.id, inputRevision: plan.inputRevision })).status).toBe('published');
    const view = await publicPlan(db, web(u.Mark!), plan.id);
    expect(view.options[0]!.sourceIds).toEqual(['src_test']);
    expect(view.sources).toEqual([{ id: 'src_test', url: src.url, title: src.title, provider: 'serpapi_google', fetchedAt: src.fetchedAt }]);
  });
});
