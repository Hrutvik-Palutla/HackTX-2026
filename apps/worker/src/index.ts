// Durable worker: claims Postgres jobs with leases, runs registered handlers, retries with backoff.
import { createDb } from '@hacktx/db';
import { claim, complete, fail, heartbeat, resumeWaitingPlans, AppError } from '@hacktx/core';
import { configureFulfillment, createMuse, fixtureDiscovery, fulfillmentJobHandlers, handleInbound, runPlanJob, runPollReminder, type InboundJob } from '@hacktx/agent';
import type { CalendarPort, DiscoveryPort, JobKind, ResearchPort } from '@hacktx/contracts';
import { createSerpApiDiscovery } from '../../../packages/discovery/src/index.ts';
import { startClawMessenger } from '@hacktx/integrations/messaging/claw';
import { GoogleCalendar, googleConfig } from '@hacktx/integrations/google-calendar';
import { createSyncCalendarHandler } from '@hacktx/integrations/calendar-jobs';
import { createSharedFulfillment, synchronizeFulfillment } from '@hacktx/integrations/fulfillment';
import { createFulfillmentJobHandlers } from '../../../packages/fulfillment/src/jobs.ts';
import { handlers, register, type JobHandler } from './registry';

const { db, pool } = createDb();
// Lazy: non-AI jobs (reminders, Part 3/4 handlers) still run before MODEL_API_KEY exists.
let museClient: ReturnType<typeof createMuse> | null = null;
const muse = () => (museClient ??= createMuse());
const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
// Real discovery = Part 4's SerpApi adapter (bounded requests, cache, honest unknowns, source metadata).
// DISCOVERY=fixture is an explicit, FIXTURE-labeled local fallback only.
let discovery: (DiscoveryPort & { research?: ResearchPort; newSession?: () => DiscoveryPort & { research?: ResearchPort } }) | null = null;
if (process.env.DISCOVERY === 'fixture') {
  console.warn('[worker] DISCOVERY=fixture: options will be labeled FIXTURE data, not real venues');
  discovery = fixtureDiscovery;
} else if (process.env.SERPAPI_API_KEY) {
  const configuredMax = Number(process.env.MAX_SERPAPI_REQUESTS);
  const maxRequests = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.min(120, Math.floor(configuredMax)) : 120;
  discovery = createSerpApiDiscovery({ apiKey: process.env.SERPAPI_API_KEY, maxRequests });
}
// Quotas belong to one user message/planning job, never the worker's lifetime.
const discoverySession = () => discovery?.newSession?.() ?? discovery;

// Part 3: Claw Messenger iMessage (inbound -> process_inbound; outbox + polls out). Null when unconfigured.
const claw = await startClawMessenger({ db });
if (claw) {
  register('send_outbox', claw.handlers.send_outbox);
  register('publish_poll', claw.handlers.publish_poll);
} else {
  console.warn('[worker] Claw listener disabled or unconfigured; only the designated production worker should set CLAW_LISTENER_ENABLED=true');
}

// Part 3: Google Calendar free/busy for planning and own-calendar event writes.
let calendar: CalendarPort | undefined;
try {
  calendar = new GoogleCalendar(db, googleConfig());
  register('sync_calendar', createSyncCalendarHandler(calendar));
} catch (e) {
  console.warn(`[worker] calendar disabled: ${e instanceof Error ? e.message : e}`);
}

// The web and worker share selection, private limits, wallet configuration and durable outcomes.
const part4 = createSharedFulfillment({ db, pool });
configureFulfillment(part4.service);
for (const [kind, handler] of Object.entries(fulfillmentJobHandlers(createFulfillmentJobHandlers(part4.service)))) {
  register(kind as JobKind, handler);
}

const planHandler: JobHandler = async ({ job }) => {
  if (!discovery) throw new AppError('UNRESOLVED', 'No discovery configured: set SERPAPI_API_KEY (or DISCOVERY=fixture for labeled local data)', true);
  const session = discoverySession()!;
  await runPlanJob({ db, muse: muse(), discovery: session, research: session.research, calendar }, job.payload as { planId: string; inputRevision: number; reason?: string });
};
register('plan', planHandler);
register('repair', planHandler);
// Enqueued by the web app inside Part 1's friend-acceptance transaction (apps/web/lib/part2.ts).
register('resume_connections', async ({ job }) => {
  for (const userId of (job.payload as { userIds: string[] }).userIds) await resumeWaitingPlans(db, userId);
});
register('poll_reminder', async ({ job }) => { await runPollReminder(db, job.payload as { planId: string; versionId: string }); });
register('process_inbound', async ({ job }) => { await handleInbound({ db, muse: muse(), research: discoverySession()?.research }, job.payload as InboundJob); });

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; });

const kinds = [...handlers.keys()] as JobKind[];
console.log(`[worker] ${workerId} handling: ${kinds.join(', ')}`);
while (!stopping) {
  try { await synchronizeFulfillment(db, part4.service); }
  catch { console.error('[worker] Fulfillment projection pending; will retry.'); }

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
claw?.stop();
await pool.end();
