# Part 4: Discovery, Booking & Payments

Branch: `feat/part4-discovery-booking-payments`.

This package and the neighboring discovery/integration/booking-worker files implement our assigned part independently of the other branches. No root app scaffold, shared auth system, or shared database schema is replaced.

## Run locally

Requires Node 22.18+ (the team architecture uses Node 24). From the repo root:

```sh
npm install --prefix packages/fulfillment
npm install --prefix apps/booking-worker
apps/booking-worker/node_modules/.bin/playwright install chromium
npm --prefix packages/fulfillment run typecheck
npm --prefix packages/fulfillment test
npm --prefix packages/fulfillment run demo:check
npm --prefix packages/fulfillment run demo
```

Open `http://127.0.0.1:4444` for the developer test console. It uses fake accounts and a simulated wallet approval, then runs real Chromium against our owned fake-money checkout. It does not reserve theater seats or spend funds. The CLI `demo:check` exercises the same HTTP handler layer through the whole flow and verifies a duplicate request creates only one browser submission.

In the Codex environment, Chromium was downloaded to `/private/tmp/hacktx-part4-browsers`; set `PLAYWRIGHT_BROWSERS_PATH` to that path for these commands. Outside Codex, the ordinary Playwright install above uses its normal cache. A restricted macOS sandbox can prevent Chromium from launching; that environment failure is separate from the checkout tests.

The console is loopback-only and must never be deployed as the production app. Its fake bearer identities and `/api/demo/approve` action exist only for local testing. Production routes use the real session/CSRF callbacks from Part 1.

## Live discovery

The ignored repo-root `.env.local` holds `SERPAPI_API_KEY`. Never paste it into source, screenshots, commits, or chat. Set these non-secret values for the smoke command:

```dotenv
DISCOVERY_CITY=Austin, Texas, United States
DISCOVERY_TIME_ZONE=America/Chicago
DISCOVERY_START_AT=2026-10-24T00:00:00Z
DISCOVERY_END_AT=2026-10-27T06:00:00Z
DISCOVERY_SMOKE_MODE=outing
DISCOVERY_QUERY=things to do in Austin this weekend
```

```sh
npm --prefix packages/fulfillment run smoke:discovery
```

For a movie request, use `DISCOVERY_SMOKE_MODE=movie` and `DISCOVERY_MOVIE_TITLE` for a currently showing movie. Update the window for the actual request.

Live checks on October 24 returned 30 Austin outing candidates from Maps and Events. A specific movie lookup succeeded at the provider but returned no structured showtimes. That result produces zero invented screenings, a `NO_STRUCTURED_SHOWTIMES` diagnostic, and organic theater/showtime sources for further extraction or checkout handoff. Availability of Google's showtimes block is not guaranteed by SerpApi access.

Part 2 imports `SerpApiDiscovery` from `packages/integrations/serpapi.ts` or `packages/discovery/src/index.ts`. It implements the shared `DiscoveryPort`:

```ts
const discovery = new SerpApiDiscovery({ apiKey: process.env.SERPAPI_API_KEY });
const candidates = await discovery.searchOutings({ query, city, window });
const movieEvidence = await discovery.searchMovieEvidence({ title, city, window });
const sources = discovery.getSources();
const diagnostics = discovery.getDiagnostics();
```

Candidate IDs, source URLs, fetched timestamps, unknown fields, and diagnostics are explicit. Request limits/timeouts/cache and partial-engine failure behavior are built in. Public-page extraction is delegated to SerpApi; the app does not fetch an arbitrary submitted URL directly.

## Integration handoff

### Part 1: app/auth

1. Add this package as a workspace dependency of the web app and configure transpilation of local TypeScript packages as needed. Its name is `@hacktx/fulfillment`; route handlers import `@hacktx/fulfillment/http`.
2. Supply `authenticate(Request)` from the verified server session and `authorizeMutation(Request, actor)` from the app's cookie/CSRF checks. No user ID is trusted from JSON or a caller-selected header.
3. Initialize Part 4 once per server process and call `installPart4Runtime(part4.runtime)` from server startup/instrumentation. The route adapters otherwise return `503 PART4_NOT_CONFIGURED` rather than using test identities.
4. Use payment projections from `GET /api/plans/:id/payment`. A buyer can see their quote/approval/ledger; other members receive only their own share and public booking status.

The supplied files under `apps/web/app/api` cover wallet connection/status/approval, quotes/bookings, private payment views, repayment acknowledgment, handoff, reconciliation, and post-booking changes. They are thin standard Request/Response adapters, typechecked separately with Next's bundler-style module resolution. A full Next build awaits Part 1's actual app configuration.

### Part 2: plans/database/worker

1. Supply `loadPlan(actor, planId)` returning an authoritative `SelectedPlan` with current revision/version/option, actual membership, intended attendees, nominated buyer, mode, and the selected candidate. Do not construct it from the HTTP request body. Keep private maximum shares server-side.
2. Apply `sql/001_part4.sql` alongside your migrations. It creates only `fulfillment_*` tables and does not modify shared user/plan tables.
3. Construct `new PostgresRepository(pool)` using the app's `pg.Pool`-compatible client. The implementation uses short transactions, consistent reads, advisory-locked updates, per-record JSONB, plan indexes, and booking/payer uniqueness. It has injected-SQL tests; a real deployed DB still needs the shared integration smoke check.
4. Register `createFulfillmentJobHandlers(service)` with the durable worker, or pass trusted queue envelopes to `dispatchFulfillmentJob(handlers, job)`. Typed jobs cover `quote_booking`, `refresh_wallet`, `submit_booking`, `reconcile_booking`, `handle_change`, and `create_reimbursements`. Use `fulfillmentJobOperationKey(job)` for queue deduplication; populate actor context from the verified session/message before enqueueing. Network/provider calls stay outside repository transactions. The service persists the purchase reservation before calling the merchant, so a retry returns the existing result rather than submitting again.

The supplied HTTP handlers call service operations directly. Part 2 must enqueue long-running quote/checkout work in its worker and return its job receipt from the app's orchestration layer; this package supplies the validated handlers, not a second queue deployment. Wallet refresh/reconciliation must be schedulable again after a completed poll, so scope the queue's deduplication lifetime to active jobs rather than permanently suppressing their operation keys.

The file repository is a durable single-process local/demo adapter, not a multi-process production database. The memory adapter is for tests.

### Part 3: messaging/deployment

1. Drain `service.flushPrivateDeliveries(delivery => enqueueYourPrivateOutbox(...))`. Deduplicate by `delivery.id`, use `recipientUserId`, and keep `text` private. Do not expose this drain as an anonymous endpoint. A delivered flag means the item was handed to your durable/idempotent outbox, not that a payment cleared.
2. Deploy the booking worker's Playwright browser dependencies separately from the public web process. No browser/CDP or wallet auth directory is public.
3. Provide the actual absolute `LINK_CLI_PATH`, private `LINK_AUTH_DIRECTORY`, and a 32-byte hex `LINK_AUTH_ENCRYPTION_KEY`. AuthVault persists only AES-GCM encrypted per-user session snapshots; temporary plaintext files are private and cleaned up after each CLI operation.
4. Configure exact allowed merchant hosts and real quote/checkout drivers only after rehearsing them. An absent real quote provider produces a checkout handoff. The owned fixture cannot run in live mode.

### Production factory

```ts
import { createProductionPart4, PostgresRepository, installPart4Runtime } from '@hacktx/fulfillment';

const part4 = createProductionPart4({
  repository: new PostgresRepository(pool),
  loadPlan: loadSelectedPlanFromPart2,
  authenticate: authenticateSessionFromPart1,
  authorizeMutation: verifyMutationOriginAndCsrf,
  allowedMerchantHosts: new Set(configuredHosts),
  // Set mode: 'live' only after buyer/account/merchant integration is verified.
  // quoteProvider and drivers are optional: omitting them preserves explicit handoff.
});
installPart4Runtime(part4.runtime);
```

An empty host allowlist is a deployment configuration error. The factory uses the environment for the wallet paths/key and defaults to test mode. Supply `reconcile` when the merchant has an authoritative status operation; without it an uncertain purchase stays unresolved and is never automatically retried.

## Wallet operator commands

The official Link CLI is installed in `apps/booking-worker/node_modules/.bin/link-cli`. No general shell or card values are exposed to the planning model. The local `.env.local` contains the CLI/auth paths and a locally generated encryption key; retain that key for existing encrypted sessions.

```sh
npm --prefix packages/fulfillment run wallet:connect
npm --prefix packages/fulfillment run wallet:status
```

These commands can only connect/check the local test buyer. They cannot create a quote, request a purchase credential, or move money. Complete the actual Link-hosted verification yourself when prompted. This local operator identity is separate from the app user IDs that production will pass to the wallet adapter.

## Purchase and repayment behavior

- Quotes bind the exact version, option, attendees, buyer, merchant, seats, total, expiry, and test/live mode with a SHA-256 hash. Changes invalidate approval.
- One nominated buyer authorizes the group purchase. Wallet approval, merchant confirmation, test confirmation, and a buyer's manual completion report remain different states.
- A handoff or uncertain purchase blocks another plan purchase until it is resolved. The buyer can explicitly clear an unpurchased handoff, report completion, or request provider reconciliation. An uncertain charge is never cleared merely by retrying.
- Shared fees/discounts are allocated using exact integer arithmetic and largest-remainder rounding. Totals are conserved. If the merchant's actual total differs, the purchase remains durably recorded and the buyer gets `repaymentNeedsReview` rather than silently using the old split.
- Nonbuyers receive private amount-specific repayment requests. The payer can report sending, and the original buyer can acknowledge receipt. These are manual statuses, not provider-verified settlement.
- Post-booking changes are recorded and privately handed to the buyer/provider. No automatic refunds or extra purchases are implied.

## Remaining external checks

The implementation is ready for the other parts' real session/plan/DB/message-queue hooks. Their branches are intentionally not replaced here. Real Link user approval and a real merchant purchasing driver require account/user participation; the current browser end-to-end proof uses the owned test fixture. A merchant with no supported driver uses the actual checkout handoff instead. No live tickets or payments were purchased during implementation.
