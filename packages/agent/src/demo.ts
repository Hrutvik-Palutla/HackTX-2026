// `pnpm agent:demo`: full Part 2 journey with REAL Muse on an in-process Postgres (PGlite), so it runs even where
// the network blocks the Tiger port. Discovery is Part 4's live SerpApi adapter when SERPAPI_API_KEY is set (in .env.local),
// otherwise the FIXTURE-labeled port. Flow: request -> options -> group vote via chat -> availability change -> repaired
// options -> Studio trace. Override with DEMO_REQUEST and DEMO_TEMPLATE (movie-night | local-outing).
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, migrationsFolder, user, friendships, conversations, planConversations, messagingIdentities, outbox, agentRuns, runSteps, plans, type Db } from '@hacktx/db';
import { createPlan, savePrivateFact, activeTally, open } from '@hacktx/core';
import { createMuse } from './muse';
import { runPlanJob } from './planner';
import { handleInbound } from './discuss';
import { fixtureDiscovery } from './fixtures';
import type { DiscoveryPort } from '@hacktx/contracts';

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
const db = drizzle(new PGlite(), { schema }) as unknown as Db;
await migrate(db as never, { migrationsFolder });
const muse = createMuse();
// Variable specifier keeps Part 4's differently-configured sources out of this package's strict typecheck.
const part4Discovery = '../../discovery/src/index.ts';
const discovery: DiscoveryPort = process.env.SERPAPI_API_KEY
  ? ((await import(part4Discovery)) as { createSerpApiDiscovery(o: { apiKey: string }): DiscoveryPort }).createSerpApiDiscovery({ apiKey: process.env.SERPAPI_API_KEY })
  : fixtureDiscovery;
console.log(`discovery: ${process.env.SERPAPI_API_KEY ? 'LIVE SerpApi (Part 4 adapter)' : 'FIXTURE'}`);

const city = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };
const ids = { alex: 'u_alex', mark: 'u_mark', mel: 'u_mel' };
for (const [k, id] of Object.entries(ids)) await db.insert(user).values({ id, name: k[0]!.toUpperCase() + k.slice(1), email: `${id}@users.invalid`, emailVerified: false, city: JSON.stringify(city) });
for (const f of [ids.mark, ids.mel]) await db.insert(friendships).values({ userLow: ids.alex < f ? ids.alex : f, userHigh: ids.alex < f ? f : ids.alex, requestedBy: ids.alex, status: 'accepted', acceptedAt: new Date() });
for (const [i, id] of Object.values(ids).entries()) await db.insert(messagingIdentities).values({ userId: id, provider: 'linq', handle: `+1512555010${i}`, kind: 'phone', verifiedAt: new Date() });

const start = new Date(Date.now() + 86_400_000); start.setUTCHours(14, 0, 0, 0);
const window = { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3 * 86_400_000).toISOString() };
const { plan } = await createPlan(db, { userId: ids.alex, source: 'web' }, {
  request: process.env.DEMO_REQUEST ?? (process.env.SERPAPI_API_KEY ? 'Me, Mark and Mel want to do something fun in Austin this weekend' : 'Me, Mark and Mel want to watch Dune this weekend'),
  templateId: (process.env.DEMO_TEMPLATE ?? (process.env.SERPAPI_API_KEY ? 'local-outing' : 'movie-night')) as 'movie-night' | 'local-outing',
  city, window, participantUserIds: [ids.mark, ids.mel],
});
const [conv] = await db.insert(conversations).values({ provider: 'linq', sendingLine: 'demo', externalChatId: 'gc1', kind: 'group', activePlanId: plan.id }).returning();
await db.insert(planConversations).values({ planId: plan.id, conversationId: conv!.id, audience: 'group' });

const rev = async () => (await db.select().from(plans).where(eq(plans.id, plan.id)))[0]!.inputRevision;
const printOutbox = async (since: Date) => {
  for (const o of await db.select().from(outbox)) if (o.createdAt >= since) console.log(`\n--- to ${JSON.stringify(o.recipient)} ---\n${o.body ?? open('outbox', o.bodyEnc!)}`);
};

console.log('== 1. plan');
let t = new Date();
console.log(await runPlanJob({ db, muse, discovery }, { planId: plan.id, inputRevision: await rev() }).then((r) => r.status));
await printOutbox(t);

console.log('\n== 2. Mark votes in the group chat');
t = new Date();
const msg = (id: string, from: number, text: string) => ({ sendingLine: 'demo', message: {
  provider: 'linq' as const, eventId: id, messageId: id, conversationExternalId: 'gc1', conversationKind: 'group' as const,
  senderHandle: `+1512555010${from}`, senderKind: 'phone' as const, text, occurredAt: new Date().toISOString(), replyToMessageId: null,
} });
console.log(await handleInbound({ db, muse }, msg('m1', 1, 'A or B both work for me, B is my favorite')));
await printOutbox(t);
console.log('tally:', JSON.stringify((await activeTally(db, plan.id))?.options));

console.log('\n== 3. Mel privately becomes busy for the first evening -> repair');
t = new Date();
await savePrivateFact(db, { userId: ids.mel, source: 'web' }, { planId: plan.id, fact: { kind: 'availability', value: {
  window, available: null, unavailable: [{ startAt: window.startAt, endAt: new Date(start.getTime() + 20 * 3_600_000).toISOString() }], certainty: 'explicit',
} } });
console.log(await runPlanJob({ db, muse, discovery }, { planId: plan.id, inputRevision: await rev(), reason: "a participant's constraints changed" }).then((r) => r.status));
await printOutbox(t);

console.log('\n== Studio trace');
for (const r of await db.select().from(agentRuns)) {
  console.log(`run ${r.task} ${r.status} tokens=${r.inputTokens}/${r.outputTokens} ~$${Number(r.estimatedCostUsd).toFixed(4)}`);
  for (const s of (await db.select().from(runSteps).where(eq(runSteps.runId, r.id))).sort((a, b) => a.index - b.index)) {
    console.log(`  ${s.index} ${s.kind}:${s.name} ${s.outcome} ${s.durationMs}ms ${s.redactedSummary}`);
  }
}
