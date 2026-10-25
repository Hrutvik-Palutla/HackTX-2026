// Local end-to-end run of the real agent over real iMessage, before the deployed worker exists.
//   pnpm exec tsx --env-file=.env packages/integrations/messaging/live-agent.ts
// Real Claw Messenger + Part 2's real conversation agent/planner (Muse) + discovery (Part 4's SerpApi adapter when
// SERPAPI_API_KEY is set, otherwise FIXTURE-labeled data) + Part 3's send/poll handlers, on an in-memory database.
// Team accounts come from `.env.team.json` (git-ignored by the `.env.*` rule), all mutually connected friends:
//   [{ "name": "Sid", "phone": "+15125550100" }, { "name": "Mark", "phone": "+15125550101" }]
// State resets when the script stops. Not used by the deployed app.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, migrationsFolder, friendships, user, type Db } from '@hacktx/db';
import { InboundMessage, type ActorContext, type CalendarPort, type DiscoveryPort } from '@hacktx/contracts';
import { configureFulfillment, createMuse, fixtureDiscovery, fulfillmentJobHandlers, loadSelectedPlan } from '@hacktx/agent';
import { CLAW_PROVIDER, startClawMessenger } from './claw-adapter.ts';
import { linkVerifiedPhone } from './otp.ts';
import { GoogleCalendar, googleConfig } from '../google-calendar.ts';
import { agentHandlers, runOne } from './agent-runtime.ts';

const probe = InboundMessage.safeParse({
  provider: CLAW_PROVIDER, eventId: 'p', messageId: 'p', conversationExternalId: 'p', conversationKind: 'private',
  senderHandle: '+15125550100', senderKind: 'phone', text: 'p', occurredAt: new Date().toISOString(), replyToMessageId: null,
});
if (!probe.success) {
  console.error(`Part 2's InboundMessage.provider does not accept '${CLAW_PROVIDER}' yet, so the agent would reject every message.
Needs the one-line contract change in packages/contracts/src/index.ts: z.enum(['linq', 'telegram', '${CLAW_PROVIDER}']).`);
  process.exit(1);
}

const team = JSON.parse(readFileSync('.env.team.json', 'utf8')) as { name: string; phone: string }[];
const austin = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
const db = drizzle(new PGlite(), { schema }) as unknown as Db;
await migrate(db as never, { migrationsFolder });
const ids = team.map((t) => ({ ...t, id: `u_${t.name.toLowerCase().replace(/\W+/g, '_')}` }));
for (const t of ids) {
  await db.insert(user).values({ id: t.id, name: t.name, email: `${t.id}@users.invalid`, city: austin, phoneNumber: t.phone, phoneNumberVerified: true, onboardingCompleted: true });
  await linkVerifiedPhone(db, t.id, t.phone);
}
for (const a of ids) for (const b of ids) {
  if (a.id < b.id) await db.insert(friendships).values({ userLow: a.id, userHigh: b.id, requestedBy: a.id, status: 'accepted', acceptedAt: new Date() });
}
console.log(`[live] ${ids.length} connected accounts: ${ids.map((t) => `${t.name} (…${t.phone.slice(-4)})`).join(', ')}`);

// Variable specifier keeps Part 4's differently-configured sources out of this package's strict typecheck.
const part4Discovery = '../../discovery/src/index.ts';
const discovery: DiscoveryPort = process.env.SERPAPI_API_KEY
  ? ((await import(part4Discovery)) as { createSerpApiDiscovery(o: { apiKey: string }): DiscoveryPort }).createSerpApiDiscovery({ apiKey: process.env.SERPAPI_API_KEY })
  : fixtureDiscovery;
console.log(`[live] discovery: ${process.env.SERPAPI_API_KEY ? 'LIVE SerpApi' : 'FIXTURE (labeled; set SERPAPI_API_KEY for real showtimes)'}`);

// Free/busy only for team members who connected Google in this in-memory DB; everyone else stays unknown.
let calendar: CalendarPort | undefined;
try { calendar = new GoogleCalendar(db, googleConfig()); } catch { /* GOOGLE_* unset */ }
console.log(`[live] calendar: ${calendar ? 'Google free/busy' : 'disabled (set GOOGLE_* for free/busy)'}`);

const muse = createMuse();
const claw = await startClawMessenger({ db });
if (!claw) { console.error('Set CLAW_MESSENGER_API_KEY and CLAW_MESSENGER_FROM_PHONE in .env'); process.exit(1); }

// Payments in local runs: Part 4's real FulfillmentService with an in-memory store and its owned TEST wallet.
// Real venues have no direct-booking provider, so a quote becomes an honest checkout handoff ("Buyer reports booked").
// BOOKING_DEMO=test instead quotes fake-money tickets so the full approve -> "Test booking" path can be shown.
const part4Path = '../../fulfillment/src/index.ts';
const part4FixturePath = '../../fulfillment/src/test-fixture.ts';
const p4 = await import(part4Path) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const { TestWallet } = await import(part4FixturePath) as { TestWallet: new (quotes: Map<string, unknown>) => unknown };
const quotes = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
const testQuotes = process.env.BOOKING_DEMO === 'test';
const service = new p4.FulfillmentService({
  repository: new p4.MemoryRepository(),
  loadPlan: (actor: ActorContext, planId: string) => loadSelectedPlan(db, actor, planId),
  wallet: new TestWallet(quotes),
  quote: async (plan: any, seatPreference?: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!testQuotes) throw Object.assign(new Error('Direct booking is not configured for this venue. Use merchant checkout handoff.'), { code: 'HANDOFF_REQUIRED', status: 409 });
    const q = {
      id: randomUUID(), planId: plan.planId, versionId: plan.versionId, optionId: plan.optionId, attendeeUserIds: [...plan.attendeeUserIds], buyerUserId: plan.buyerUserId,
      merchantHost: 'fixture.booking.test', merchantUrl: 'https://fixture.booking.test/checkout', performanceRef: `screening:${seatPreference ?? 'any'}`,
      seatRefs: plan.attendeeUserIds.map((_: string, i: number) => `F${i + 7}`),
      lineItems: plan.attendeeUserIds.map((attendeeUserId: string) => ({ attendeeUserId, label: 'TEST ticket', amount: { amountMinor: 1500, currency: 'USD' } })),
      sharedFees: { amountMinor: 301, currency: 'USD' }, sharedDiscount: { amountMinor: 0, currency: 'USD' },
      total: { amountMinor: 1500 * plan.attendeeUserIds.length + 301, currency: 'USD' },
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), bindingHash: '', mode: 'test',
    };
    q.bindingHash = p4.quoteBinding(q); quotes.set(q.id, q); return q;
  },
  submit: async ({ quote, authorization }: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: randomUUID(), planId: quote.planId, versionId: quote.versionId, quoteId: quote.id, authorizationId: authorization.id,
    status: 'test_confirmed', merchantOrderRef: `TEST-${quote.id.slice(0, 6)}`, confirmationUrl: null, actualTotal: quote.total, mode: 'test',
  }),
});
configureFulfillment(service);
console.log(`[live] payments: ${testQuotes ? 'TEST quotes + test wallet (fake money)' : 'checkout handoff (no direct booking)'}`);
const fulfillment = fulfillmentJobHandlers(p4.createFulfillmentJobHandlers(service));

const handlers = agentHandlers({ fulfillment, db, muse, discovery, calendar, client: claw.client, sendingLine: process.env.CLAW_MESSENGER_FROM_PHONE! });
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
console.log('[live] agent running; text it or message a group it is in. Ctrl+C to stop.');
while (!stopping) {
  if (!(await runOne(db, handlers))) await new Promise((r) => setTimeout(r, 500));
}
await claw.stop();
process.exit(0);
