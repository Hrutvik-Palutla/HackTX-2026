import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { availabilitySnapshots, conversations, planConversations, plans } from '@hacktx/db';
import type { BusyResult, CalendarPort, Interval } from '@hacktx/contracts';
import { createPlan } from '@hacktx/core';
import { fixtureDiscovery, runPlanJob, type ChatMessage, type Muse } from '@hacktx/agent';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

const W = { startAt: '2026-10-31T00:00:00.000Z', endAt: '2026-11-03T00:00:00.000Z' };
const usage = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.0001 };
const intent = { kind: 'movie', movieTitle: 'Dune', searchQuery: 'Dune showtimes', durationMinutes: null };
const pick = (candidateId: string) => ({ candidateId, startAt: null, publicExplanation: `why ${candidateId}` });
// Overlaps FIXTURE fx-m1 (window +26h, with the arrival buffer), not fx-m2 (+29h).
const MARK_BUSY = { startAt: '2026-11-01T01:00:00.000Z', endAt: '2026-11-01T04:00:00.000Z' };

function fakeMuse(structured: unknown[]): Muse & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    model: 'fake-muse',
    seen,
    async structured<T>({ messages, schema }: { messages: ChatMessage[]; schema: z.ZodType<T> }) {
      seen.push(messages);
      return { value: schema.parse(structured.shift()), usage };
    },
    async chat() { throw new Error('not used'); },
  };
}

/** Fake CalendarPort: per-user result, or throw for users mapped to 'throw'. */
function fakeCalendar(byUser: Record<string, Omit<BusyResult, 'fetchedAt'> | 'throw'>): CalendarPort & { calls: [string, Interval][] } {
  const calls: [string, Interval][] = [];
  return {
    calls,
    async getBusy(userId, window) {
      calls.push([userId, window]);
      const r = byUser[userId] ?? { busy: [], status: 'disconnected' };
      if (r === 'throw') throw new Error('google down');
      return { ...r, fetchedAt: new Date().toISOString() };
    },
    async upsertOwnEvent() { throw new Error('not used'); },
  };
}

async function setup() {
  const db = await testDb();
  const u = await seedUsers(db, ['Alex', 'Mark']);
  await befriend(db, u.Alex!, u.Mark!);
  const { plan } = await createPlan(db, web(u.Alex!), { request: 'Me and Mark want to watch Dune this weekend', templateId: 'movie-night', city: austin, window: W, participantUserIds: [u.Mark!] });
  const [conv] = await db.insert(conversations).values({ provider: 'linq', sendingLine: '+15125550000', externalChatId: 'chat1', kind: 'group', activePlanId: plan.id }).returning();
  await db.insert(planConversations).values({ planId: plan.id, conversationId: conv!.id, audience: 'group' });
  const [p] = await db.select().from(plans).where(eq(plans.id, plan.id));
  return { db, u, plan: p! };
}

describe('planner calendar free/busy', () => {
  it('refreshes calendars for the plan window and skips a candidate that conflicts with a busy interval', async () => {
    const { db, u, plan } = await setup();
    const calendar = fakeCalendar({ [u.Alex!]: { busy: [], status: 'ok' }, [u.Mark!]: { busy: [MARK_BUSY], status: 'ok' } });
    const muse = fakeMuse([intent, { options: [pick('fx-m1'), pick('fx-m2')] }]);
    const r = await runPlanJob({ db, muse, discovery: fixtureDiscovery, calendar }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(r.status).toBe('published');
    if (r.status !== 'published') return;
    expect(r.options.map((o) => o.candidateIds[0])).toEqual(['fx-m2']);
    expect(r.options[0]!.fit).toBe('fits_known_constraints'); // both calendars cover the window
    expect(calendar.calls.map(([, w]) => w)).toEqual([W, W]);
    const snaps = await db.select().from(availabilitySnapshots).where(eq(availabilitySnapshots.planId, plan.id));
    expect(snaps.map((s) => s.status).sort()).toEqual(['ok', 'ok']);
    // busy times stay in code: the model never saw them or the conflicting candidate
    const prompt = JSON.stringify(muse.seen[1]);
    expect(prompt).not.toContain('01:00:00');
    expect(prompt).not.toContain('fx-m1');
  });

  it('records failed calendars as unknown, never free, and still plans', async () => {
    const { db, u, plan } = await setup();
    // An 'error' result's busy list is ignored; a throwing port is recorded as 'error' too.
    const calendar = fakeCalendar({ [u.Alex!]: 'throw', [u.Mark!]: { busy: [MARK_BUSY], status: 'error' } });
    const muse = fakeMuse([intent, { options: [pick('fx-m1'), pick('fx-m2')] }]);
    const r = await runPlanJob({ db, muse, discovery: fixtureDiscovery, calendar }, { planId: plan.id, inputRevision: plan.inputRevision });
    expect(r.status).toBe('published');
    if (r.status !== 'published') return;
    expect(r.options.map((o) => o.candidateIds[0])).toEqual(['fx-m1', 'fx-m2']);
    expect(r.options.every((o) => o.fit === 'needs_clarification')).toBe(true);
    const snaps = await db.select().from(availabilitySnapshots).where(eq(availabilitySnapshots.planId, plan.id));
    expect(snaps.map((s) => [s.status, s.busy.length])).toEqual([['error', 0], ['error', 0]]);
  });
});
