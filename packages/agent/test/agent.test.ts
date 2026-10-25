import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { agentRuns, conversations, jobs, messagingIdentities, outbox, planConversations, plans, runSteps, sources, user, voteStates } from '@hacktx/db';
import { createPlan, postToConversation, publicPlan, publishVersion, savePrivateFact } from '@hacktx/core';
import { GROUP_INTRO } from '@hacktx/agent';
import { fixtureDiscovery, handleInbound, runPlanJob, type ChatMessage, type Muse } from '@hacktx/agent';
import { toolsFor, type ToolCtx } from '../src/tools';
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
  it('extracts a source-backed dated movie time when structured showtimes are absent', async () => {
    const { db, plan } = await setup();
    const searchedAt = '2026-10-30T12:00:00.000Z';
    const base = 'src_movie_google';
    const sources = [
      { id: base, url: 'https://www.google.com/search?q=dune', title: 'Google showtimes for Dune', fetchedAt: searchedAt, provider: 'serpapi_google' as const, providerSearchId: 's1' },
      ...[1, 2, 3].map(n => ({ id: `src_org_${n}`, url: `https://cinema${n}.example.org/showtimes`, title: `Dune showtimes at Cinema ${n}`, fetchedAt: searchedAt, provider: 'serpapi_google' as const, providerSearchId: 's1' })),
    ];
    let extracted = 0;
    const discovery = {
      ...fixtureDiscovery,
      async searchMovie() { return []; },
      async searchMovieEvidence() { return { candidates: [], sources }; },
      async extractPublicPage(url: string) {
        extracted++;
        return {
          source: { ...sources[1]!, id: `src_extract_${extracted}`, url, title: 'Cinema showtime page', provider: 'serpapi_extract' as const },
          facts: { text_content: { markdown: '# Dune\nDune — November 1, 2026, 7:15 PM' } },
        };
      },
      getSource(id: string) { return sources.find(s => s.id === id) ?? null; },
    };
    const muse = fakeMuse({ structured: [intent, { options: [] }] });
    const result = await runPlanJob({ db, muse, discovery }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    expect(extracted).toBe(3);
    expect(result.options[0]).toMatchObject({ startAt: '2026-11-02T01:15:00.000Z', fit: 'needs_clarification', sourceIds: ['src_extract_1'] });
    expect((await db.select().from(outbox))[0]!.body).toContain('Cinema showtime page');
  });

  it('publishes theater source pages with unknown time and asks the group to check times', async () => {
    const { db, plan } = await setup();
    const searchedAt = '2026-10-30T12:00:00.000Z';
    const sources = [
      { id: 'src_google', url: 'https://www.google.com/search?q=dune', title: 'Google showtimes for Dune', fetchedAt: searchedAt, provider: 'serpapi_google' as const, providerSearchId: null },
      { id: 'src_theater', url: 'https://theater.example.org/dune', title: 'Cinema showtimes', fetchedAt: searchedAt, provider: 'serpapi_google' as const, providerSearchId: null },
    ];
    const discovery = {
      ...fixtureDiscovery,
      async searchMovie() { return []; },
      async searchMovieEvidence() { return { candidates: [], sources }; },
      async extractPublicPage(url: string) { return { source: { ...sources[1]!, id: 'src_extract', url, provider: 'serpapi_extract' as const }, facts: { text_content: { text: 'Showtimes are listed on this theater page' } } }; },
      getSource(id: string) { return sources.find(s => s.id === id) ?? null; },
    };
    const muse = fakeMuse({ structured: [intent, { options: [] }] });
    const result = await runPlanJob({ db, muse, discovery }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    expect(result.options[0]).toMatchObject({ startAt: null, endAt: null, fit: 'needs_clarification', sourceIds: ['src_extract'] });
    expect((await db.select().from(outbox))[0]!.body).toContain('time to confirm');
    expect((await db.select().from(outbox))[0]!.body).toContain('https://theater.example.org/dune');
    expect((await db.select().from(outbox))[0]!.body).toContain('What time works best');
  });

  it('keeps source-page theater options available when the request cap stops extraction', async () => {
    const { db, plan } = await setup();
    const searchedAt = '2026-10-30T12:00:00.000Z';
    const sources = [
      { id: 'src_google', url: 'https://www.google.com/search?q=dune', title: 'Google showtimes for Dune', fetchedAt: searchedAt, provider: 'serpapi_google' as const, providerSearchId: null },
      ...[1, 2, 3].map(n => ({ id: `src_org_${n}`, url: `https://cinema${n}.example.org/showtimes`, title: `Cinema ${n}`, fetchedAt: searchedAt, provider: 'serpapi_google' as const, providerSearchId: null })),
    ];
    let extracted = 0;
    const discovery = {
      ...fixtureDiscovery,
      async searchMovie() { return []; },
      async searchMovieEvidence() { return { candidates: [], sources }; },
      async extractPublicPage(url: string) {
        if (extracted >= 2) throw new Error('SerpApi request limit reached');
        extracted++;
        return { source: { ...sources[1]!, id: `src_empty_${extracted}`, url, provider: 'serpapi_extract' as const }, facts: { text_content: { text: 'No film schedule on this page' } } };
      },
    };
    const result = await runPlanJob({ db, muse: fakeMuse({ structured: [intent, { options: [] }] }), discovery }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(result.status).toBe('published');
    expect(extracted).toBe(2);
    if (result.status === 'published') {
      expect(result.options).toHaveLength(3);
      expect(result.options.every(option => option.startAt === null && option.fit === 'needs_clarification')).toBe(true);
    }
  });

  it('asks for another day or theater when movie evidence is empty', async () => {
    const { db, plan } = await setup();
    const discovery = {
      ...fixtureDiscovery,
      async searchMovie() { return []; },
      async searchMovieEvidence() { return { candidates: [], sources: [] }; },
    };
    const result = await runPlanJob({ db, muse: fakeMuse({ structured: [intent] }), discovery }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(result.status).toBe('no_options');
    expect((await db.select().from(outbox))[0]!.body).toContain('Dune');
    expect((await db.select().from(outbox))[0]!.body).toContain('another day or theater');
  });

  it('recovers a movie screening only when source text explicitly supports title, date and start time', async () => {
    const { db, plan } = await setup();
    const listingText = 'Dune: Part Two at Example Cinema. Sunday, November 1, 2026 at 8:00 PM.';
    const discovery = { ...fixtureDiscovery, async searchMovie() { return []; }, async searchOutings() { return []; } };
    const research = {
      async search({ query, engine = 'google' }: { query: string; engine?: 'google' | 'google_events' | 'google_maps' }) {
        return { sourceId: 'research_search_dune', url: 'https://search.example/dune', fetchedAt: '2026-10-30T12:00:00.000Z', engine, query, text: listingText, results: {} };
      },
      async read() { throw new Error('not needed'); },
    };
    const muse = fakeMuse({
      structured: [intent, { candidates: [{ sourceId: 'research_search_dune', kind: 'movie_screening', title: 'Dune: Part Two', titleQuote: 'Dune: Part Two', venue: 'Example Cinema', venueQuote: 'at Example Cinema', date: '2026-11-01', dateQuote: 'Sunday, November 1, 2026', time: '20:00', timeQuote: '8:00 PM', timeZone: 'America/Chicago', priceText: null, priceQuote: null }] }, { options: [] }],
      chat: [
        { tool_calls: [{ id: 'r1', type: 'function', function: { name: 'search_public_web', arguments: JSON.stringify({ query: 'Dune showtimes Austin November 1', engine: 'google_events' }) } }] },
        { content: 'A listing shows Dune at Example Cinema [research_search_dune].' },
      ],
    });
    const result = await runPlanJob({ db, muse, discovery, research }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(result.status).toBe('published');
    if (result.status === 'published') expect(result.options[0]).toMatchObject({ startAt: '2026-11-02T02:00:00.000Z', sourceIds: ['research_search_dune'] });
    expect(await db.select().from(sources)).toMatchObject([{ id: 'research_search_dune', fetchedAt: new Date('2026-10-30T12:00:00.000Z') }]);
  });

  it('researches three comedy venue listings and rejects Muse-invented performance times', async () => {
    const { db, plan } = await setup();
    const venues = ['venue-1', 'venue-2', 'venue-3'].map((id, i) => ({
      id, kind: 'venue' as const, title: `Comedy Club ${i + 1}`, venueName: `Comedy Club ${i + 1}`, address: null,
      timeZone: 'America/Chicago', startAt: null, durationMinutes: null, format: 'comedy', price: null,
      rawPriceText: null, rawCurrency: null, priceKind: 'unknown' as const, bookingUrl: `https://club${i + 1}.example/`,
      sourceIds: [], evidence: [],
    }));
    let searched = 0;
    const discovery = { ...fixtureDiscovery, async searchOutings() { return venues; } };
    const research = {
      async search({ query, engine = 'google' }: { query: string; engine?: 'google' | 'google_events' | 'google_maps' }) {
        searched++;
        return { sourceId: 'research_comedy', url: 'https://search.example/comedy', fetchedAt: '2026-10-30T12:00:00.000Z', engine, query, text: 'Comedy clubs near Austin. No dated performance listing shown.', results: {} };
      },
      async read() { throw new Error('not needed'); },
    };
    const muse = fakeMuse({
      structured: [
        { kind: 'outing', movieTitle: null, movieTitles: [], searchQuery: 'comedy shows', durationMinutes: null, scheduledEvent: true },
        { candidates: [] },
        { options: [{ candidateId: 'venue-1', startAt: '2026-11-01T01:00:00.000Z', publicExplanation: 'A comedy listing nearby.' }] },
      ],
      chat: [
        { tool_calls: [{ id: 'r1', type: 'function', function: { name: 'search_public_web', arguments: JSON.stringify({ query: 'Austin comedy shows this weekend', engine: 'google_events' }) } }] },
        { content: 'No dated performance time is confirmed [research_comedy].' },
      ],
    });
    const result = await runPlanJob({ db, muse, discovery, research }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(searched).toBe(1);
    expect(result.status).toBe('published');
    if (result.status === 'published') expect(result.options[0]).toMatchObject({ startAt: null, uncertainties: expect.arrayContaining(['Event time not confirmed; check source page']) });
    expect((await db.select().from(outbox))[0]!.body).toContain('time to confirm');
    expect((await db.select().from(outbox))[0]!.body).not.toContain('Nov 1');
  });

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

  it('recognizes a group sender by the phone they verified at signup', async () => {
    const { db, u } = await setup();
    await db.update(user).set({ phoneNumber: '+15125550101', phoneNumberVerified: true }).where(eq(user.id, u.Mark!));
    const muse = fakeMuse({ chat: [{ content: 'Hi Mark!' }] });
    const r = await handleInbound({ db, muse }, { sendingLine: '+15125550000', message: {
      provider: 'linq', eventId: 'v1', messageId: 'v1', conversationExternalId: 'chat1', conversationKind: 'group', senderHandle: '+15125550101',
      senderKind: 'phone', text: 'hey', occurredAt: '2026-10-30T18:00:00.000Z', replyToMessageId: null,
    } });
    expect(r).toEqual({ status: 'ok', replied: true });
    const [ident] = await db.select().from(messagingIdentities).where(eq(messagingIdentities.handle, '+15125550101'));
    expect(ident).toMatchObject({ userId: u.Mark, provider: 'linq' });
  });

  it('still answers when a reply hits its per-run limit, instead of going silent', async () => {
    const { db, u } = await setup();
    await db.insert(messagingIdentities).values({ userId: u.Mark!, provider: 'linq', handle: '+15125550101', kind: 'phone', verifiedAt: new Date() });
    process.env.MUSE_RUN_DEADLINE_MS = '0';
    try {
      const r = await handleInbound({ db, muse: fakeMuse({ chat: [] }) }, { sendingLine: '+15125550000', message: {
        provider: 'linq', eventId: 'l1', messageId: 'l1', conversationExternalId: 'chat1', conversationKind: 'group', senderHandle: '+15125550101',
        senderKind: 'phone', text: 'find every comedy show in texas this year', occurredAt: '2026-10-30T18:00:00.000Z', replyToMessageId: null,
      } });
      expect(r).toMatchObject({ status: 'limit', replied: true });
      expect((await db.select().from(outbox)).some((o) => o.effectKey.startsWith('agent-limit:') && o.body?.includes('narrow it down'))).toBe(true);
    } finally { delete process.env.MUSE_RUN_DEADLINE_MS; }
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

  it('introduces itself only when its first group message gets no reply, and dedupes retries', async () => {
    const { db, u, conv } = await setup();
    await db.insert(messagingIdentities).values({ userId: u.Mark!, provider: 'linq', handle: '+15125550101', kind: 'phone', verifiedAt: new Date() });
    const incoming = (messageId: string, text: string) => ({ provider: 'linq' as const, eventId: messageId, messageId, conversationExternalId: 'chat1', conversationKind: 'group' as const, senderHandle: '+15125550101', senderKind: 'phone' as const, text, occurredAt: '2026-10-30T18:00:00.000Z', replyToMessageId: null });
    const unrelated = fakeMuse({ chat: [{ content: 'NO_REPLY' }] });
    await handleInbound({ db, muse: unrelated }, { sendingLine: '+15125550000', message: incoming('intro1', 'random chatter'), joinedGroup: true });
    await handleInbound({ db, muse: fakeMuse({ chat: [{ content: 'NO_REPLY' }] }) }, { sendingLine: '+15125550000', message: incoming('intro1', 'random chatter'), joinedGroup: true });
    expect((await db.select().from(outbox)).filter((o) => o.effectKey === `intro:${conv.id}`).map((o) => o.body)).toEqual([GROUP_INTRO]);

    const addressed = fakeMuse({ chat: [{ content: 'Here are the options.' }] });
    await handleInbound({ db, muse: addressed }, { sendingLine: '+15125550000', message: incoming('intro2', 'What are the options?'), joinedGroup: true });
    expect((await db.select().from(outbox)).filter((o) => o.body === 'Here are the options.')).toHaveLength(1);
    expect((await db.select().from(outbox)).filter((o) => o.effectKey === `intro:${conv.id}`)).toHaveLength(1);

    const fresh = await setup();
    await fresh.db.insert(messagingIdentities).values({ userId: fresh.u.Mark!, provider: 'linq', handle: '+15125550101', kind: 'phone', verifiedAt: new Date() });
    const firstAnswer = fakeMuse({ chat: [{ content: 'Here is the plan.' }] });
    const addressedJob = { sendingLine: '+15125550000', message: incoming('addressed-first', 'What are the options?'), joinedGroup: true };
    await handleInbound({ db: fresh.db, muse: firstAnswer }, addressedJob);
    await handleInbound({ db: fresh.db, muse: fakeMuse({ chat: [{ content: 'NO_REPLY' }] }) }, addressedJob);
    expect(firstAnswer.seen).toHaveLength(1);
    expect((await fresh.db.select().from(outbox)).map((o) => o.body)).toEqual(['Here is the plan.']);
  });

  it('introduces itself for an unknown sender in a newly joined group only once', async () => {
    const { db, conv } = await setup();
    const message = { provider: 'linq' as const, eventId: 'unknown-1', messageId: 'unknown-1', conversationExternalId: 'chat1', conversationKind: 'group' as const, senderHandle: '+15125559999', senderKind: 'phone' as const, text: 'hello', occurredAt: '2026-10-30T18:00:00.000Z', replyToMessageId: null };
    const job = { sendingLine: '+15125550000', message, joinedGroup: true };
    expect((await handleInbound({ db, muse: fakeMuse({ chat: [] }) }, job)).status).toBe('unknown_sender');
    await handleInbound({ db, muse: fakeMuse({ chat: [] }) }, job);
    expect((await db.select().from(outbox)).filter((o) => o.effectKey === `intro:${conv.id}`).map((o) => o.body)).toEqual([GROUP_INTRO]);
  });

  it('allows activity edits in a group and by the private organizer only', async () => {
    const { db, u, plan, conv } = await setup();
    const replan = toolsFor(['request_replan']).byName.get('request_replan')!;
    expect(replan.args.safeParse({ reason: 'Changed dates', windowStart: '2026-10-31T00:00:00Z' }).success).toBe(false);
    expect(replan.args.safeParse({ reason: 'Changed dates', windowStart: '2026-10-31', windowEnd: '2026-11-01' }).success).toBe(false);
    const actorCtx = (userId: string, kind: 'group' | 'private', id = conv.id): ToolCtx => ({
      db, actor: { userId, source: kind === 'group' ? 'group_message' : 'private_message', conversationId: id, sourceMessageId: 'm-tool' },
      planId: plan.id, conversation: { id, kind }, messageId: 'm-tool', providerMessageId: 'm-tool',
    });
    const args = { reason: 'Changed our minds', newRequest: 'See Tron or Clayface in Austin next week', kind: 'movie-night' as const, windowStart: '2026-10-31T00:00:00.000Z', windowEnd: '2026-11-01T00:00:00.000Z' };
    await replan.run(actorCtx(u.Mark!, 'group'), args);
    expect((await db.select().from(plans).where(eq(plans.id, plan.id)))[0]).toMatchObject({ request: args.newRequest, templateId: 'movie-night', windowStart: new Date(args.windowStart), windowEnd: new Date(args.windowEnd) });

    const [privateConv] = await db.insert(conversations).values({ provider: 'linq', sendingLine: '+15125550000', externalChatId: 'private-alex', kind: 'private' }).returning();
    await replan.run(actorCtx(u.Mark!, 'private', privateConv!.id), { reason: 'private appointment', newRequest: null, kind: null, windowStart: null, windowEnd: null });
    expect((await db.select().from(plans).where(eq(plans.id, plan.id)))[0]).toMatchObject({ request: args.newRequest, templateId: 'movie-night', windowStart: new Date(args.windowStart), windowEnd: new Date(args.windowEnd) });
    const repairJobs = await db.select().from(jobs).where(eq(jobs.kind, 'repair'));
    expect((repairJobs.at(-1)!.payload as { reason: string }).reason).toBe("a participant's constraints changed");
    await expect(replan.run(actorCtx(u.Mark!, 'private', privateConv!.id), { ...args, newRequest: 'Go bowling with Mark' })).rejects.toThrow('Only the organizer');
    await replan.run(actorCtx(u.Alex!, 'private', privateConv!.id), { ...args, newRequest: 'Go bowling this weekend with Mark' });
    expect((await db.select().from(plans).where(eq(plans.id, plan.id)))[0]!.request).toBe('Go bowling this weekend with Mark');
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

describe('vote status for the agent', () => {
  const opt = (label: 'A' | 'B') => ({ label, title: `Clayface at Cinema ${label} in Austin, TX`, candidateIds: [label], startAt: '2026-10-31T20:00:00.000Z', endAt: '2026-10-31T22:00:00.000Z', timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown' as const, fit: 'fits_known_constraints' as const, uncertainties: [], publicExplanation: '', sourceIds: [] });
  const vote = (labels: string[]) => ({ tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'record_vote', arguments: JSON.stringify({ acceptableLabels: labels, favoriteLabel: null, noneAcceptable: false }) } }] });
  const msg = (id: string, from: string, text: string) => ({ provider: 'linq', eventId: id, messageId: id, conversationExternalId: 'chat1', conversationKind: 'group', senderHandle: from, senderKind: 'phone', text, occurredAt: '2026-10-30T18:00:00.000Z', replyToMessageId: null }) as const;
  const toolResult = (muse: ReturnType<typeof fakeMuse>) => JSON.parse(String((muse.seen[1]!.find((m) => m.role === 'tool') as { content: string }).content));

  async function votingGroup() {
    const t = await setup();
    await publishVersion(t.db, { planId: t.plan.id, inputRevision: t.plan.inputRevision, runId: null, options: [opt('A'), opt('B')] });
    await t.db.insert(messagingIdentities).values([
      { userId: t.u.Alex!, provider: 'linq', handle: '+15125550100', kind: 'phone', verifiedAt: new Date() },
      { userId: t.u.Mark!, provider: 'linq', handle: '+15125550101', kind: 'phone', verifiedAt: new Date() },
    ]);
    return t;
  }
  const say = async (db: Awaited<ReturnType<typeof setup>>['db'], id: string, from: string, text: string, labels: string[]) => {
    const muse = fakeMuse({ chat: [vote(labels), { content: 'ok' }] });
    await handleInbound({ db, muse }, { sendingLine: '+15125550000', message: msg(id, from, text) });
    return toolResult(muse);
  };

  it('names who it is waiting on, then reports agreement with the wrap-up details', async () => {
    const { db } = await votingGroup();
    const first = await say(db, 'v1', '+15125550101', 'A', ['A']);
    expect(first).toMatchObject({ saved: true, unchanged: false, waitingOn: ['Alex'], agreed: null });
    expect(first.next).toContain('Waiting on Alex');

    const second = await say(db, 'v2', '+15125550100', 'A works', ['A']);
    expect(second.waitingOn).toEqual([]);
    expect(second.agreed).toMatchObject({ label: 'A', title: 'Clayface at Cinema A', when: expect.stringContaining('PM') });
    expect(second.next).toContain('Everyone agrees on A');
    expect(second.next).toContain('Do not ask for another confirmation or who is paying');
  });

  it('flags a repeated identical vote so the agent does not repeat itself', async () => {
    const { db } = await votingGroup();
    await say(db, 'v1', '+15125550101', 'A', ['A']);
    const again = await say(db, 'v2', '+15125550101', 'A', ['A']);
    expect(again.unchanged).toBe(true);
    expect(again.next).toContain('same vote as before');
  });

  it('asks one question when different options work for different people', async () => {
    const { db } = await votingGroup();
    await say(db, 'v1', '+15125550101', 'A', ['A']);
    const last = await say(db, 'v2', '+15125550100', 'B', ['B']);
    expect(last.agreed).toBeNull();
    expect(last.next).toContain('No option works for everyone');
  });
});
