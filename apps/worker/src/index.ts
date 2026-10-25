// Durable worker: claims Postgres jobs with leases, runs registered handlers, retries with backoff.
import { createDb } from '@hacktx/db';
import { claim, complete, fail, heartbeat, AppError } from '@hacktx/core';
import { configureFulfillment, createMuse, fixtureDiscovery, fulfillmentJobHandlers, handleInbound, loadSelectedPlan, runPlanJob, runPollReminder, type InboundJob } from '@hacktx/agent';
import type { CalendarPort, DiscoveryPort, JobKind } from '@hacktx/contracts';
import { createSerpApiDiscovery } from '../../../packages/discovery/src/index.ts';
import { startClawMessenger } from '../../../packages/integrations/messaging/claw-adapter.ts';
import { GoogleCalendar, googleConfig } from '../../../packages/integrations/google-calendar.ts';
import { createSyncCalendarHandler } from '../../../packages/integrations/calendar-jobs.ts';
import { PostgresRepository, createFulfillmentJobHandlers, createProductionPart4 } from '../../../packages/fulfillment/src/index.ts';
import { handlers, register, type JobHandler } from './registry';

const { db, pool } = createDb();
// Lazy: non-AI jobs (reminders, Part 3/4 handlers) still run before MODEL_API_KEY exists.
let museClient: ReturnType<typeof createMuse> | null = null;
const muse = () => (museClient ??= createMuse());
const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// Real discovery = Part 4's SerpApi adapter (bounded requests, cache, honest unknowns, source metadata).
// DISCOVERY=fixture is an explicit, FIXTURE-labeled local fallback only.
let discovery: DiscoveryPort | null = null;
if (process.env.DISCOVERY === 'fixture') {
  console.warn('[worker] DISCOVERY=fixture: options will be labeled FIXTURE data, not real venues');
  discovery = fixtureDiscovery;
} else if (process.env.SERPAPI_API_KEY) {
  const max = Number(process.env.MAX_SERPAPI_REQUESTS); // unset -> adapter default cap
  discovery = createSerpApiDiscovery({ apiKey: process.env.SERPAPI_API_KEY, ...(max > 0 ? { maxRequests: max } : {}) });
}

// Part 3: Claw Messenger iMessage (inbound -> process_inbound; outbox + polls out). Null when unconfigured.
const claw = await startClawMessenger({ db });
if (claw) {
  register('send_outbox', claw.handlers.send_outbox);
  register('publish_poll', claw.handlers.publish_poll);
} else {
  console.warn('[worker] messaging disabled: set CLAW_MESSENGER_API_KEY and CLAW_MESSENGER_FROM_PHONE');
}

// Part 3: Google Calendar free/busy for planning and own-calendar event writes.
let calendar: CalendarPort | undefined;
try {
  calendar = new GoogleCalendar(db, googleConfig());
  register('sync_calendar', createSyncCalendarHandler(calendar));
} catch (e) {
  console.warn(`[worker] calendar disabled: ${e instanceof Error ? e.message : e}`);
}

// Part 4: booking, buyer wallet approval, reimbursements. Chat tools reach it through configureFulfillment; its job
// kinds run Part 4's validated handlers, then the bridge posts outcomes (group status, private shares, calendar sync).
// Defaults to test mode. Without a quote provider/driver every quote becomes an honest checkout handoff.
const merchantHosts = (process.env.BOOKING_MERCHANT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
if (merchantHosts.length) {
  try {
    const part4 = createProductionPart4({
      repository: new PostgresRepository(pool),
      loadPlan: (actor, planId) => loadSelectedPlan(db, actor, planId),
      // HTTP routes are not served by the worker; chat tools pass the verified sender directly.
      authenticate: async () => null,
      authorizeMutation: async () => false,
      allowedMerchantHosts: new Set(merchantHosts),
    });
    configureFulfillment(part4.service);
    const bridged = fulfillmentJobHandlers(createFulfillmentJobHandlers(part4.service));
    for (const [kind, h] of Object.entries(bridged)) register(kind as JobKind, h);
    console.log(`[worker] payments enabled (${part4.mode} mode) for ${merchantHosts.join(', ')}`);
  } catch (e) {
    console.warn(`[worker] payments disabled: ${e instanceof Error ? e.message : e}`);
  }
} else {
  console.warn('[worker] payments disabled: set BOOKING_MERCHANT_HOSTS, LINK_CLI_PATH, LINK_AUTH_DIRECTORY, LINK_AUTH_ENCRYPTION_KEY');
}

const planHandler: JobHandler = async ({ job }) => {
  if (!discovery) throw new AppError('UNRESOLVED', 'No discovery configured: set SERPAPI_API_KEY (or DISCOVERY=fixture for labeled local data)', true);
  await runPlanJob({ db, muse: muse(), discovery, calendar }, job.payload as { planId: string; inputRevision: number; reason?: string });
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
await claw?.stop();
await pool.end();
