// Cross-part check: Part 4's SerpApi adapter (fed its own recorded SerpApi fixture) drives Part 2's planner.
// Proves the Candidate/Source contract lines up: real ids, source links persisted, prices left unknown.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPlan, publicPlan } from '@hacktx/core';
import { runPlanJob, type Muse } from '@hacktx/agent';
import { SerpApiDiscovery } from '../../../packages/discovery/src/index.ts';
import { testDb, seedUsers, befriend, austin, web } from '../../../packages/core/test/helpers';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/discovery/test/fixtures/showtimes-movie-results.json', import.meta.url)), 'utf8'));
const window = { startAt: '2026-11-09T00:00:00.000Z', endAt: '2026-11-09T06:00:00.000Z' };

// Picks the first two candidates it is shown, like a model would, so the test doesn't hard-code adapter ids.
const pickFirstTwo: Muse = {
  model: 'fake',
  async chat() { throw new Error('unused'); },
  async structured({ messages, schema }) {
    const user = JSON.parse(String(messages[1]!.content)) as { candidates?: { id: string }[] };
    const value = user.candidates
      ? { options: user.candidates.slice(0, 2).map((c) => ({ candidateId: c.id, startAt: null, publicExplanation: 'Listed showing.' })) }
      : { kind: 'movie', movieTitle: 'Dune', searchQuery: 'Dune showtimes', durationMinutes: null };
    return { value: schema.parse(value), usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } };
  },
};

describe('Part 4 SerpApi adapter -> Part 2 planner', () => {
  it('publishes options from normalized showtimes with persisted source links and unknown prices', async () => {
    const db = await testDb();
    const u = await seedUsers(db, ['Alex', 'Mark']);
    await befriend(db, u.Alex!, u.Mark!);
    const { plan } = await createPlan(db, web(u.Alex!), { request: 'Mark and I want to see Dune', templateId: 'movie-night', city: austin, window, participantUserIds: [u.Mark!] });
    const discovery = new SerpApiDiscovery({
      apiKey: 'fixture-key',
      now: () => new Date('2026-11-09T01:00:00Z'),
      fetch: async () => new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const r = await runPlanJob({ db, muse: pickFirstTwo, discovery }, { planId: plan.id, inputRevision: 0 });
    expect(r.status).toBe('published');

    const view = await publicPlan(db, web(u.Mark!), plan.id);
    expect(view.options.map((o) => o.title)).toEqual(['Dune at Sample Cinema', 'Dune at Sample Cinema']);
    expect(view.options.every((o) => o.estimatedPerPerson === null && o.priceKind === 'unknown')).toBe(true);
    expect(view.options[0]!.uncertainties).toContain('Runtime not listed; assumed about 2 hours');
    expect(view.sources).toHaveLength(1);
    expect(view.sources[0]!.provider).toBe('serpapi_google');
    expect(view.options[0]!.sourceIds).toEqual([view.sources[0]!.id]);
  });
});
