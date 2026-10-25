import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTemplate } from '@hacktx/templates';
import { LimitError, RunRecorder } from '../src/recorder';
import { testDb } from '../../core/test/helpers';

afterEach(() => vi.unstubAllEnvs());

describe('RunRecorder per-run limits', () => {
  it('aborts an in-flight model call at the run deadline instead of waiting for the next turn', async () => {
    vi.stubEnv('MUSE_RUN_DEADLINE_MS', '30');
    const db = await testDb();
    const rec = await RunRecorder.start(db, { planId: null, task: 'discuss', template: getTemplate('local-outing'), model: 'm', inputRevision: 0 });
    let signal: AbortSignal | undefined;
    const muse = rec.bindMuse({ model: 'fixture', structured: async () => { throw Error('unused'); }, chat: input => { signal = input.signal; return new Promise(() => {}); } });
    await expect(rec.step('model', 'chat', () => muse.chat({ messages: [] }))).rejects.toBeInstanceOf(LimitError);
    expect(signal?.aborted).toBe(true);
    await rec.finish('limit');
  });
  it('stops the next model turn once one run has spent its cost cap', async () => {
    vi.stubEnv('MUSE_RUN_BUDGET_USD', '0.10');
    const db = await testDb();
    const rec = await RunRecorder.start(db, { planId: null, task: 'discuss', template: getTemplate('local-outing'), model: 'm', inputRevision: 0 });
    rec.charge('turn');
    await rec.step('model', 'chat', async () => 'ok', () => ({ summary: 'reply', usage: { inputTokens: 80_000, outputTokens: 0, estimatedCostUsd: 0.1 } }));
    expect(() => rec.charge('turn')).toThrow(LimitError);
  });

  it('stops the next model turn once the run is past its time limit', async () => {
    vi.stubEnv('MUSE_RUN_DEADLINE_MS', '0');
    const db = await testDb();
    const rec = await RunRecorder.start(db, { planId: null, task: 'discuss', template: getTemplate('local-outing'), model: 'm', inputRevision: 0 });
    expect(() => rec.charge('turn')).toThrow(/time limit/);
  });

  it('keeps chat templates to chat-sized limits', () => {
    for (const id of ['movie-night', 'local-outing'] as const) expect(getTemplate(id).limits.maxTurns).toBeLessThanOrEqual(16);
  });
});
