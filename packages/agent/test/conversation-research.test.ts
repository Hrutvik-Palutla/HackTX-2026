import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { agentRuns, conversations, messagingIdentities, outbox, planConversations, plans, runSteps, sources } from '@hacktx/db';
import type { Candidate, DiscoveryPort, ResearchPort, Source } from '@hacktx/contracts';
import { createPlan, publicPlan, savePrivateFact } from '@hacktx/core';
import { handleInbound, runPlanJob, type ChatMessage, type Muse } from '@hacktx/agent';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

const originalWindow = { startAt: '2026-10-31T00:00:00.000Z', endAt: '2026-11-03T00:00:00.000Z' };
const nextWeekWindow = { startAt: '2026-11-02T00:00:00-06:00', endAt: '2026-11-09T00:00:00-06:00' };
const usage = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.0001 };

function conversationMuse(script: Partial<ChatMessage>[]): Muse & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    model: 'fake-muse', seen,
    async structured() { throw new Error('not used in conversation test'); },
    async chat({ messages }) {
      seen.push(structuredClone(messages));
      const next = script.shift();
      if (!next) throw new Error('unexpected chat call');
      return { message: { role: 'assistant', content: null, refusal: null, ...next } as never, usage };
    },
  };
}

function plannerMuse(script: unknown[]): Muse & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    model: 'fake-muse', seen,
    async structured<T>({ messages, schema }: { messages: ChatMessage[]; schema: z.ZodType<T> }) {
      seen.push(messages);
      return { value: schema.parse(script.shift()), usage };
    },
    async chat() { throw new Error('not used by this planner fixture'); },
  };
}

describe('conversation research and persisted planning input', () => {
  it('researches a group follow-up, traces source/usage, then replans from the saved window after a fresh inbound call', async () => {
    const db = await testDb();
    const u = await seedUsers(db, ['Alex', 'Mark']);
    await befriend(db, u.Alex!, u.Mark!);
    const { plan } = await createPlan(db, web(u.Alex!), {
      request: 'Find a comedy show in Austin this weekend', templateId: 'local-outing', city: austin,
      window: originalWindow, participantUserIds: [u.Mark!],
    });
    const [conv] = await db.insert(conversations).values({
      provider: 'linq', sendingLine: '+15125550000', externalChatId: 'research-group', kind: 'group', activePlanId: plan.id,
    }).returning();
    await db.insert(planConversations).values({ planId: plan.id, conversationId: conv!.id, audience: 'group' });
    await savePrivateFact(db, web(u.Mark!), { planId: plan.id, fact: {
      kind: 'preference', value: { key: 'avoid', value: 'PRIVATE_SENTINEL_do_not_search', strength: 'hard' },
    } });

    const searchCalls: string[] = [];
    const readCalls: string[] = [];
    const research: ResearchPort = {
      async search(input) {
        searchCalls.push(`${input.engine}:${input.query}`);
        return { sourceId: 'src_comedy_search', url: 'https://search.example/comedy', fetchedAt: '2026-10-25T12:00:00.000Z', engine: input.engine ?? 'google', query: input.query, text: 'Example Club comedy listings', results: {} };
      },
      async read(input) {
        readCalls.push(`${input.url}:${input.render}`);
        return { sourceId: 'src_comedy_lineup', url: input.url, fetchedAt: '2026-10-25T12:01:00.000Z', title: 'Example Club lineup', text: 'Ada Example headlines the Friday show at 8 PM.' };
      },
    };
    const firstMuse = conversationMuse([
      { tool_calls: [{ id: 'research-1', type: 'function', function: { name: 'research_public', arguments: JSON.stringify({ question: 'Who are the comedians on this weekend?' }) } }] },
      { tool_calls: [{ id: 'search-1', type: 'function', function: { name: 'search_public_web', arguments: JSON.stringify({ query: 'Austin comedy lineup this weekend', engine: 'google_events' }) } }] },
      { tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_public_page', arguments: JSON.stringify({ url: 'https://club.example/events/friday', render: true }) } }] },
      { content: 'Example Club lists Ada Example for Friday at 8 PM [src_comedy_lineup].' },
      { content: 'Ada Example headlines the Friday show at 8 PM. Here is the [listing](https://club.example/events/friday).' },
    ]);
    const inbound = (messageId: string, text: string) => ({
      provider: 'linq' as const, eventId: messageId, messageId, conversationExternalId: 'research-group', conversationKind: 'group' as const,
      senderHandle: '+15125550101', senderKind: 'phone' as const, text, occurredAt: '2026-10-25T18:00:00.000Z', replyToMessageId: null,
    });
    await db.insert(messagingIdentities).values({ userId: u.Mark!, provider: 'linq', handle: '+15125550101', kind: 'phone', verifiedAt: new Date() });

    await handleInbound({ db, muse: firstMuse, research }, { sendingLine: '+15125550000', message: inbound('comedian-question', 'Who are the comedians?') });
    expect(searchCalls).toEqual(['google_events:Austin comedy lineup this weekend']);
    expect(readCalls).toEqual(['https://club.example/events/friday:true']);
    expect((await db.select().from(sources)).map(s => s.id)).toContain('src_comedy_lineup');
    expect((await db.select().from(outbox)).map(row => row.body).join('\n')).toContain('Ada Example');
    expect((await db.select().from(outbox)).map(row => row.body).join('\n')).toContain('https://club.example/events/friday');
    expect(firstMuse.seen.map(m => JSON.stringify(m)).join('\n')).not.toContain('PRIVATE_SENTINEL');
    const researchRun = (await db.select().from(agentRuns).where(eq(agentRuns.task, 'discuss')))[0]!;
    expect(researchRun).toMatchObject({ status: 'ok', inputTokens: 50, outputTokens: 25 });
    const researchStepNames = (await db.select().from(runSteps).where(eq(runSteps.runId, researchRun.id))).map(s => s.name);
    expect(researchStepNames).toEqual(expect.arrayContaining(['chat', 'research_reasoning', 'research_search', 'research_read', 'research_public']));

    // A new inbound turn and fresh model instance stand in for a worker/process restart.
    const replanMuse = conversationMuse([
      { tool_calls: [{ id: 'replan-1', type: 'function', function: { name: 'request_replan', arguments: JSON.stringify({
        reason: 'The group wants next week', newRequest: 'Find stand-up comedy shows in Austin next week', kind: 'local-outing',
        windowStart: nextWeekWindow.startAt, windowEnd: nextWeekWindow.endAt,
      }) } }] },
      { content: 'I updated the search to next week.' },
    ]);
    await handleInbound({ db, muse: replanMuse, research }, { sendingLine: '+15125550000', message: inbound('next-week-request', 'Find comedy shows next week instead.') });
    const [saved] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(saved).toMatchObject({ request: 'Find stand-up comedy shows in Austin next week', windowStart: new Date('2026-11-02T06:00:00.000Z'), windowEnd: new Date('2026-11-09T06:00:00.000Z') });

    const source = (id: string, n: number): Source => ({ id, url: `https://club.example/event-${n}`, title: `Comedy listing ${n}`, fetchedAt: '2026-10-25T12:02:00.000Z', provider: 'serpapi_events', providerSearchId: `event-search-${n}` });
    const sourcesForEvents = [source('src_event_1', 1), source('src_event_2', 2), source('src_event_3', 3)];
    const searchedWindows: { startAt: string; endAt: string }[] = [];
    const eventCandidates: Candidate[] = sourcesForEvents.map((s, i) => ({
      id: `event-${i + 1}`, kind: 'event', title: `Comedy show ${i + 1}`, venueName: `Club ${i + 1}`, address: null,
      timeZone: 'America/Chicago', startAt: `2026-11-0${3 + i}T01:00:00.000Z`, durationMinutes: 120, format: null,
      price: null, rawPriceText: null, rawCurrency: null, priceKind: 'unknown', bookingUrl: s.url, sourceIds: [s.id], evidence: [],
    }));
    const discovery: DiscoveryPort = {
      async searchMovie() { return []; },
      async searchOutings({ window }) { searchedWindows.push(window); return eventCandidates; },
      async extractPublicPage() { throw new Error('not used'); },
      getSource(id) { return sourcesForEvents.find(s => s.id === id) ?? null; },
    };
    const picks = eventCandidates.map(c => ({ candidateId: c.id, startAt: c.startAt, publicExplanation: `Source-backed option ${c.id}` }));
    const planMuse = plannerMuse([
      { kind: 'outing', movieTitle: null, movieTitles: [], searchQuery: 'Austin stand-up comedy', durationMinutes: 120 },
      { options: picks },
    ]);
    const result = await runPlanJob({ db, muse: planMuse, discovery }, { planId: plan.id, inputRevision: saved!.inputRevision, reason: 'time changed' });
    expect(result.status).toBe('published');
    expect(searchedWindows).toEqual([{ startAt: '2026-11-02T06:00:00.000Z', endAt: '2026-11-09T06:00:00.000Z' }]);
    if (result.status !== 'published') return;
    expect(result.options.every(option => option.sourceIds.length === 1)).toBe(true);
    const view = await publicPlan(db, web(u.Mark!), plan.id);
    expect(view.sources.map(s => s.id)).toEqual(expect.arrayContaining(['src_event_1', 'src_event_2', 'src_event_3']));
    expect(planMuse.seen.map(m => JSON.stringify(m)).join('\n')).not.toContain('PRIVATE_SENTINEL');
  });
});
