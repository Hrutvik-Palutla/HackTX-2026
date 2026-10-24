// Durable worker: claims Postgres jobs with leases, runs registered handlers, retries with backoff.
import { createDb } from '@hacktx/db';
import { claim, complete, fail, heartbeat, AppError } from '@hacktx/core';
import { createMuse, fixtureDiscovery, handleInbound, runPlanJob, runPollReminder, type InboundJob } from '@hacktx/agent';
import type { DiscoveryPort, JobKind } from '@hacktx/contracts';
import { handlers, register, type JobHandler } from './registry';

const { db, pool } = createDb();
// Lazy: non-AI jobs (reminders, Part 3/4 handlers) still run before MODEL_API_KEY exists.
let museClient: ReturnType<typeof createMuse> | null = null;
const muse = () => (museClient ??= createMuse());
const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// Part 4 replaces this with the SerpApi DiscoveryPort. Fixtures are opt-in and labeled FIXTURE everywhere.
let discovery: DiscoveryPort | null = null;
if (process.env.DISCOVERY === 'fixture') {
  console.warn('[worker] DISCOVERY=fixture: options will be labeled FIXTURE data, not real venues');
  discovery = fixtureDiscovery;
}

const planHandler: JobHandler = async ({ job }) => {
  if (!discovery) throw new AppError('UNRESOLVED', 'No DiscoveryPort configured (DISCOVERY=fixture or Part 4 adapter)', true);
  await runPlanJob({ db, muse: muse(), discovery }, job.payload as { planId: string; inputRevision: number; reason?: string });
};
register('plan', planHandler);
register('repair', planHandler);
register('poll_reminder', async ({ job }) => { await runPollReminder(db, job.payload as { planId: string; versionId: string }); });
register('process_inbound', async ({ job }) => { await handleInbound({ db, muse: muse() }, job.payload as InboundJob); });

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; });

const kinds = [...handlers.keys()] as JobKind[];
console.log(`[worker] ${workerId} handling: ${kinds.join(', ')}`);
while (!stopping) {
  const job = await claim(db, workerId, 90_000, kinds);
  if (!job) { await new Promise((r) => setTimeout(r, 1000)); continue; }
  const beat = setInterval(() => { heartbeat(db, job).catch(() => {}); }, 30_000);
  const t0 = Date.now();
  try {
    await handlers.get(job.kind as JobKind)!({ db, job, heartbeat: () => heartbeat(db, job) });
    await complete(db, job);
    console.log(`[worker] ${job.kind} ${job.id} done in ${Date.now() - t0}ms`);
  } catch (e) {
    const retryable = !(e instanceof AppError) || e.retryable;
    console.error(`[worker] ${job.kind} ${job.id} failed (attempt ${job.attempts}):`, e instanceof Error ? e.message : e);
    await fail(db, job, e, retryable);
  } finally {
    clearInterval(beat);
  }
}
await pool.end();
