import { describe, expect, it } from 'vitest';
import type { ResearchPort } from '@hacktx/contracts';
import type { ChatMessage, Muse } from '../src/muse';
import { runResearch } from '../src/research';

const usage = { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 };
function scriptedMuse(script: Partial<ChatMessage>[]): Muse {
  return {
    model: 'test',
    async structured() { throw new Error('not used'); },
    async chat({ messages }) {
      const next = script.shift();
      if (!next) throw new Error('unexpected model call');
      return { message: { role: 'assistant', content: null, refusal: null, ...next } as never, usage };
    },
  };
}

describe('runResearch', () => {
  it('lets Muse search, read a page, and returns source-linked evidence', async () => {
    const calls: string[] = [];
    const research: ResearchPort = {
      async search(input) { calls.push(`search:${input.engine}:${input.query}`); return { sourceId: 's1', url: 'https://search.test', fetchedAt: '2026-10-25T12:00:00.000Z', engine: input.engine ?? 'google', query: input.query, text: 'Example Club hosts a show on Nov 1 at 8 PM.', results: {} }; },
      async read(input) { calls.push(`read:${input.url}:${input.render}`); return { sourceId: 's2', url: input.url, fetchedAt: '2026-10-25T12:01:00.000Z', text: 'The headliner is Ada Example. Doors open at 7 PM; show starts at 8 PM.', title: 'Show listing', links: [], structuredDataText: [] }; },
    };
    const muse = scriptedMuse([
      { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_public_web', arguments: JSON.stringify({ query: 'Ada Example Austin Nov 1', engine: 'google_events' }) } }] },
      { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read_public_page', arguments: JSON.stringify({ url: 'https://club.test/event', render: true }) } }] },
      { content: 'Example Club lists Ada Example for Nov 1 at 8 PM [s2].' },
    ]);
    const result = await runResearch({ muse, research, question: 'Find the show details', maxSteps: 4 });
    expect(calls).toEqual(['search:google_events:Ada Example Austin Nov 1', 'read:https://club.test/event:true']);
    expect(result.answer).toContain('https://club.test/event');
    expect(result.evidence.map(item => item.fetchedAt)).toEqual(['2026-10-25T12:00:00.000Z', '2026-10-25T12:01:00.000Z']);
    expect(result.steps).toBe(3);
  });

  it('caps tool reasoning and avoids repeating identical searches', async () => {
    const research: ResearchPort = {
      async search(input) { return { sourceId: 's1', url: 'https://search.test', fetchedAt: '2026-10-25T12:00:00.000Z', engine: input.engine ?? 'google', query: input.query, text: 'No dated event facts.', results: {} }; },
      async read(input) { return { sourceId: 's2', url: input.url, fetchedAt: '2026-10-25T12:00:00.000Z', text: '', title: null, links: [], structuredDataText: [] }; },
    };
    const muse = scriptedMuse([
      { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_public_web', arguments: '{"query":"Austin comedy"}' } }] },
      { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'search_public_web', arguments: '{"query":"Austin comedy"}' } }] },
      { content: 'I could not confirm a dated show.' },
    ]);
    const result = await runResearch({ muse, research, question: 'Find a comedy show', maxSteps: 2 });
    expect(result.steps).toBe(2);
    expect(result.evidence).toHaveLength(1);
    expect(result.answer).toContain('s1');
  });
});
