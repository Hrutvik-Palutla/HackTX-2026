import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversations, workerHeartbeats } from '@hacktx/db';
import { claim, enqueue, recordWorkerHeartbeat, workerReadiness } from '@hacktx/core';
import { testDb } from '../../../packages/core/test/helpers';
import { processOneJob } from '../src/runner';
import type { JobHandler } from '../src/registry';
import type { JobKind } from '@hacktx/contracts';

it('delivers messages and handles another chat while research blocks one chat, preserving its order', async () => {
  const db = await testDb();
  const [a, b] = await db.insert(conversations).values(['a', 'b'].map(id => ({ provider: 'web', sendingLine: 'web', externalChatId: id, kind: 'group' }))).returning();
  await enqueue(db, { kind: 'process_inbound', conversationId: a!.id, dedupeKey: 'a1', runAfter: new Date(0) });
  for (let index = 2; index <= 20; index++) await enqueue(db, { kind: 'process_inbound', conversationId: a!.id, dedupeKey: `a${index}`, runAfter: new Date(index) });
  await enqueue(db, { kind: 'process_inbound', conversationId: b!.id, dedupeKey: 'b1', runAfter: new Date(21) });
  await enqueue(db, { kind: 'send_outbox', dedupeKey: 'send', runAfter: new Date(22) });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const seen: string[] = [];
  const handlers = new Map<JobKind, JobHandler>([
    ['process_inbound', async ({ job }) => { seen.push(job.dedupeKey); if (job.dedupeKey === 'a1') { entered(); await blocked; } }],
    ['send_outbox', async () => { seen.push('delivered'); }],
  ]);
  const running = processOneJob(db, 'work-1', ['process_inbound'], handlers);
  await started;
  expect(await processOneJob(db, 'delivery', ['send_outbox'], handlers)).toBe(true);
  expect(await processOneJob(db, 'work-2', ['process_inbound'], handlers)).toBe(true);
  expect(seen).toEqual(['a1', 'delivered', 'b1']);
  expect(await claim(db, 'work-3', 90_000, ['process_inbound'])).toBeNull();
  release(); await running;
  expect(await processOneJob(db, 'work-2', ['process_inbound'], handlers)).toBe(true);
  expect(seen.at(-1)).toBe('a2');
});

it('does not let a retrying earlier message get overtaken in its chat', async () => {
  const db = await testDb();
  const [conv] = await db.insert(conversations).values({ provider: 'web', sendingLine: 'web', externalChatId: 'retry-order', kind: 'group' }).returning();
  await enqueue(db, { kind: 'process_inbound', conversationId: conv!.id, dedupeKey: 'earlier', runAfter: new Date(Date.now() + 60_000) });
  await enqueue(db, { kind: 'process_inbound', conversationId: conv!.id, dedupeKey: 'later', runAfter: new Date(0) });
  expect(await claim(db, 'worker')).toBeNull();
  expect(await claim(db, 'disabled-delivery', 1000, [])).toBeNull();
});

it('rejects missing, stale, disconnected, or old-release worker heartbeats', async () => {
  const db = await testDb();
  expect((await workerReadiness(db, 'current')).ready).toBe(false);
  await recordWorkerHeartbeat(db, { id: 'work', role: 'work', revision: 'current', connected: true });
  await recordWorkerHeartbeat(db, { id: 'delivery', role: 'delivery', revision: 'old', connected: true });
  expect((await workerReadiness(db, 'current')).ready).toBe(false);
  await recordWorkerHeartbeat(db, { id: 'delivery', role: 'delivery', revision: 'current', connected: false });
  expect((await workerReadiness(db, 'current')).ready).toBe(false);
  await recordWorkerHeartbeat(db, { id: 'delivery', role: 'delivery', revision: 'current', connected: true });
  expect((await workerReadiness(db, 'current')).ready).toBe(true);
  await db.update(workerHeartbeats).set({ updatedAt: new Date(Date.now() - 60_000) }).where(eq(workerHeartbeats.id, 'work'));
  expect((await workerReadiness(db, 'current')).ready).toBe(false);
});
