import { claim, complete, fail, heartbeat, AppError } from '@hacktx/core';
import type { Db } from '@hacktx/db';
import type { JobKind } from '@hacktx/contracts';
import type { JobHandler } from './registry';

export async function processOneJob(db: Db, workerId: string, kinds: JobKind[], handlers: Map<JobKind, JobHandler>): Promise<boolean> {
  const job = await claim(db, workerId, 90_000, kinds);
  if (!job) return false;
  const beat = setInterval(() => { heartbeat(db, job).catch(() => {}); }, 30_000);
  const started = Date.now();
  try {
    await handlers.get(job.kind as JobKind)!({ db, job, heartbeat: () => heartbeat(db, job) });
    await complete(db, job);
    console.log(`[worker] ${job.kind} ${job.id} done in ${Date.now() - started}ms`);
  } catch (error) {
    console.error(`[worker] ${job.kind} ${job.id} failed:`, error instanceof Error ? error.message : 'Job failed');
    await fail(db, job, error, !(error instanceof AppError) || error.retryable);
  } finally { clearInterval(beat); }
  return true;
}
