// Durable worker: claims Postgres jobs with leases, runs registered handlers, retries with backoff.
import { createDb } from '@hacktx/db';
import { resumeWaitingPlans, recordWorkerHeartbeat, AppError, open } from '@hacktx/core';
import { conversations, jobs, messages } from '@hacktx/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { configureFulfillment, createMuse, fixtureDiscovery, fulfillmentJobHandlers, handleInbound, runPlanJob, runPollReminder, type InboundJob } from '@hacktx/agent';
import type { CalendarPort, DiscoveryPort, JobKind, ResearchPort } from '@hacktx/contracts';
import { createSerpApiDiscovery } from '../../../packages/discovery/src/index.ts';
import { startClawMessenger } from '@hacktx/integrations/messaging/claw';
import { GoogleCalendar, googleConfig } from '@hacktx/integrations/google-calendar';
import { createSyncCalendarHandler } from '@hacktx/integrations/calendar-jobs';
import { createSharedFulfillment, synchronizeFulfillment } from '@hacktx/integrations/fulfillment';
import { createFulfillmentJobHandlers } from '../../../packages/fulfillment/src/jobs.ts';
import { handlers, register, type JobHandler } from './registry';
import { processOneJob } from './runner';

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
// Scope queued messages from before the migration before enabling concurrent lanes.
for (const job of await db.select().from(jobs).where(and(eq(jobs.kind, 'process_inbound'), isNull(jobs.conversationId), inArray(jobs.state, ['queued', 'running'])))) {
  const raw = job.payload as InboundJob;
  const payload = 'encryptedInbound' in raw ? JSON.parse(open('inbound', raw.encryptedInbound)) as InboundJob : raw;
  let conversationId: string | undefined;
  if ('web' in payload) {
    conversationId = (await db.select().from(messages).where(eq(messages.id, payload.web.messageId)))[0]?.conversationId;
  } else if ('message' in payload) {
    await db.insert(conversations).values({ provider: payload.message.provider, sendingLine: payload.sendingLine,
      externalChatId: payload.message.conversationExternalId, kind: payload.message.conversationKind }).onConflictDoNothing();
    conversationId = (await db.select().from(conversations).where(and(eq(conversations.provider, payload.message.provider),
      eq(conversations.sendingLine, payload.sendingLine), eq(conversations.externalChatId, payload.message.conversationExternalId))))[0]?.id;
  }
  if (conversationId) {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    await db.update(jobs).set({ conversationId, planId: job.planId ?? conversation?.activePlanId ?? null }).where(eq(jobs.id, job.id));
  }
}

const deliveryKinds: JobKind[] = ['send_outbox', 'publish_poll'];
const workKinds = kinds.filter(kind => !deliveryKinds.includes(kind));
async function lane(role: 'work' | 'delivery', index: number) {
  const id = `${workerId}:${role}:${index}`;
  const pulse = () => recordWorkerHeartbeat(db, { id, role, revision: process.env.SOURCE_REVISION ?? 'local',
    connected: !!claw?.client.connected || !process.env.CLAW_MESSENGER_API_KEY });
  await pulse();
  const timer = setInterval(() => { pulse().catch(() => console.error('[worker] heartbeat failed')); }, 10_000);
  try {
    while (!stopping) {
      if (role === 'work' && index === 0) {
        try { await synchronizeFulfillment(db, part4.service); }
        catch { console.error('[worker] Fulfillment projection pending; will retry.'); }
      }
      if (!await processOneJob(db, id, role === 'delivery' ? kinds.filter(kind => deliveryKinds.includes(kind)) : workKinds, handlers)) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } finally { clearInterval(timer); }
}
await Promise.all([lane('delivery', 0), lane('work', 0), lane('work', 1)]);
claw?.stop();
await pool.end();
