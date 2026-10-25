// Shared job loop for local agent runs (live-agent.ts over real iMessage, flow-sim.ts with a fake client).
// Same handlers the deployed worker registers; kept here so both local tools exercise identical code.
import { claim, complete, configurePlanGroupCreator, fail, AppError, type Job } from '@hacktx/core';
import type { CalendarPort, DiscoveryPort, JobKind } from '@hacktx/contracts';
import type { Db } from '@hacktx/db';
import { handleInbound, runPlanJob, runPollReminder, type InboundJob } from '@hacktx/agent';
import { createSyncCalendarHandler } from '../calendar-jobs.ts';
import { createClawGroupCreator, createPublishPollHandler, createSendOutboxHandler } from './claw-adapter.ts';
import type { ClawMessengerClient } from './claw-messenger.ts';

type Muse = Parameters<typeof handleInbound>[0]['muse'];
type H = (job: Job) => Promise<unknown>;

export function agentHandlers(o: {
  db: Db; muse: Muse; discovery: DiscoveryPort; calendar?: CalendarPort; client: Pick<ClawMessengerClient, 'send'>; sendingLine: string;
  fulfillment?: Record<string, (ctx: { db: Db; job: Job }) => Promise<unknown>>;
}) {
  const { db, muse, discovery, calendar } = o;
  configurePlanGroupCreator(createClawGroupCreator(o.client, o.sendingLine));
  const send = createSendOutboxHandler(o.client);
  const poll = createPublishPollHandler();
  return new Map<JobKind, H>([
    ['process_inbound', (job) => handleInbound({ db, muse }, job.payload as InboundJob)],
    ['plan', (job) => runPlanJob({ db, muse, discovery, calendar }, job.payload as { planId: string; inputRevision: number })],
    ['repair', (job) => runPlanJob({ db, muse, discovery, calendar }, job.payload as { planId: string; inputRevision: number; reason?: string })],
    ['poll_reminder', (job) => runPollReminder(db, job.payload as { planId: string; versionId: string })],
    ['send_outbox', (job) => send({ db, job })],
    ['publish_poll', (job) => poll({ db, job })],
    ...(o.calendar ? [['sync_calendar', (job: Job) => createSyncCalendarHandler(o.calendar!)({ db, job })] as const] : []),
    // Part 4's fulfillment jobs (quote_booking, submit_booking, ...), when payments are configured.
    ...Object.entries(o.fulfillment ?? {}).map(([kind, h]) => [kind as JobKind, (job: Job) => h({ db, job })] as const),
  ]);
}

/** Run one claimable job; returns false when the queue is idle. */
export async function runOne(db: Db, handlers: Map<JobKind, H>, log: (m: string) => void = console.log) {
  const job = await claim(db, 'local-agent', 120_000, [...handlers.keys()]);
  if (!job) return false;
  const t0 = Date.now();
  try {
    const r = await handlers.get(job.kind as JobKind)!(job);
    await complete(db, job);
    const status = (r as { status?: string } | undefined)?.status;
    log(`[job] ${job.kind} done in ${Date.now() - t0}ms${status ? ` (${status})` : ''}`);
  } catch (e) {
    log(`[job] ${job.kind} failed: ${e instanceof Error ? e.message : e}`);
    await fail(db, job, e, !(e instanceof AppError) || e.retryable);
  }
  return true;
}

/** Drain the queue (jobs scheduled in the future, like the 30-minute reminder, are left alone). */
export async function drain(db: Db, handlers: Map<JobKind, H>, log?: (m: string) => void) {
  while (await runOne(db, handlers, log)) { /* keep going */ }
}
