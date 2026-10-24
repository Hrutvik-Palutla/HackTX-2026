# Pick One of Four Parts

Each person picks one part and owns it through integration and demo readiness. Names are unassigned. Use [ARCHITECTURE.md](ARCHITECTURE.md) for the design and [CONTRACTS.md](CONTRACTS.md) for interfaces. This file is the authority for file ownership and handoffs. The event cutoffs in IDEA.md still apply.

| Part | Main responsibility | What you deliver |
|---|---|---|
| **1. App & Accounts** | Web UI, authentication, profiles, and friend connections | People can sign up, connect friends, view/vote on plans, and see their private/payment details. |
| **2. Agent & Backend** | Muse, database/contracts, worker, plan state, discussion, voting, and repair | A request becomes three options; discussion/votes select one; a new constraint repairs the plan. |
| **3. Messaging, Calendar & Deployment** | Linq, group/private conversations, native polls, Google Calendar, and hosting | Real phones communicate with the deployed agent, and calendars supply busy intervals/events. |
| **4. Discovery, Booking & Payments** | SerpApi, sourced candidates, seats/quotes, Link, booking, and bill splitting | Real places/showtimes lead to buyer approval, booking/test/handoff, and private repayment requests. |

Pick by the work you prefer: Part 1 is frontend/product UI, Part 2 is backend/AI, Part 3 is API integrations/infrastructure, and Part 4 is external data/browser automation/payments. Each part owns its feature's server handlers too; Part 2 does not implement everyone else's APIs.

## Part 1 — App & Accounts

**Owner: unassigned.** Build the supporting app and the complete account/friend experience.

**Responsibilities**

- Scaffold the Next.js/TypeScript/pnpm workspace and implement the mobile-friendly screens.
- Configure Better Auth, phone OTP signup/login, sessions, and profile fields: phone, name, city, interests. Part 3 supplies private OTP delivery and Calendar OAuth handlers.
- Build friend-list/request/accept/decline flows and their account/friend services/API handlers.
- Build all web views: settings, invitations, plan comparison, voting, own private details, payment/share view, buyer ledger, and Studio presentation.
- Connect the UI to typed endpoints from the other parts. Own visual polish and pitch presentation after the live journey works.

**Owned files**

~~~text
apps/web/app/** page/layout files     # not every API Route Handler
apps/web/components/**
apps/web/lib/auth/**
apps/web/app/api/auth/**
apps/web/app/api/me/**
apps/web/app/api/friends/**
apps/web/app/api/friend-requests/**
packages/accounts/**
root workspace/package config and lockfile
~~~

**First 45 minutes:** publish the scaffold and signup/friends/plan screens against labeled fixtures. Give Part 2 the auth/schema requirements immediately; do not wait for live AI to build the UI.

**Interfaces:** give Part 2 verified-account/session and friendship services; give Part 3 the OTP callback signature. Receive plan/private/run DTOs from Part 2, Calendar links from Part 3, and payment/booking/repayment endpoints from Part 4.

**Done when:** a new person verifies their phone, completes signup, accepts a connection, and reaches the relevant plan. Existing friends skip extra enrollment. Web votes share chat state, and private/payment pages expose only the correct account's data. The flow is usable on mobile.

## Part 2 — Agent & Backend

**Owner: unassigned.** Build the shared brain and state used by both entry flows.

**Responsibilities**

- Own shared Zod/TypeScript contracts, Drizzle schema/migrations, and Tiger/Postgres provisioning. Incorporate auth and fulfillment schema requirements supplied by Parts 1 and 4.
- Implement durable inbox/jobs/outbox storage, revision/effect checks, and worker hosting/handler registration. Other parts supply their own integration job handlers.
- Build the Muse client, bounded tool loop, prompts, permissions, and separate public/private context builders.
- Own plan creation, participant resolution using Part 1's friend services, discussion/clarification, three-option generation using Part 4's candidates, and deterministic availability checks using Part 3's intervals.
- Own versions, votes/favorites/objections, group selection, silent-holdout behavior, changed-constraint repair, and plan/private-fact APIs.
- Build reusable templates and real redacted run records for Studio. Part 1 supplies the Studio UI.

**Owned files**

~~~text
packages/contracts/**
packages/db/**                       # single schema/migration owner
packages/core/plans/**
packages/core/availability/**
packages/core/jobs/**
packages/agent/**
packages/templates/**
apps/worker/**                       # host and handler registry
apps/web/app/api/plans/**            # except Part 3/4 routes below
apps/web/app/api/studio/**
CONTRACTS.md
~~~

**First 45 minutes:** publish types, DB/migrations, queue/outbox helpers, and a working Muse structured-output/tool-call example. Make plan/vote APIs callable with typed fixtures while live integrations arrive.

**Interfaces:** give everyone shared schemas, DB exports, enqueue/register helpers, revision rules, and typed errors. Receive users/friends from Part 1, normalized messages/votes and busy intervals from Part 3, and discovery/fulfillment ports from Part 4. Return plans to Part 1 and recipient-scoped actions to Parts 3 and 4.

**Done when:** both requests use one runner; missing connections pause/resume; real candidates produce three validated options; private facts stay out of public output; voting/discussion select a plan; a new constraint creates a repaired version. Duplicate events, obsolete polls, and stale in-flight drafts cannot corrupt current state.

## Part 3 — Messaging, Calendar & Deployment

**Owner: unassigned.** Make the app work on actual phones and a public URL, with real calendar access.

**Responsibilities**

- **Try Linq Hobby first.** Test DMs, existing groups, group creation, native polls/votes, and private OTP delivery. Use the free Pro trial only if a required feature is gated. Use Telegram only after an actual fallback decision; build one live adapter first.
- Implement webhook verification/normalization, sender/chat identity, private/group sends, group creation or DM fallback, native polls, and outbox delivery handlers.
- Supply private OTP delivery to Part 1. Deliver questions/options/payment requests chosen by the other parts; do not decide their contents or amounts.
- Implement Google OAuth, test-user setup, token handling, per-user free/busy, own-calendar event writes, and ICS output. Part 2 computes availability from your intervals.
- Own Vultr/Compose/Caddy deployment, HTTPS/domain, health endpoints, shared env configuration, and callback/webhook registration.
- Coordinate integration smoke checks, the cash/trial ledger, and final real-device/demo recording. Other owners still fix their own modules.

**Owned files**

~~~text
packages/integrations/messaging/**
packages/integrations/google-calendar.ts
packages/integrations/calendar-jobs.ts
apps/web/app/api/webhooks/**
apps/web/app/api/calendar/**
apps/web/app/api/plans/[id]/calendar/**
apps/web/app/api/plans/[id]/calendar.ics/**
apps/web/app/health/**
infra/**
.env.example
~~~

**First 45 minutes:** prove the selected transport with two phones and signed events, publish actual capability flags, deploy Part 1's scaffold, and start Google OAuth with two team accounts. Make the transport decision once at 45 minutes.

**Interfaces:** give Part 1 the OTP sender/identity-linking rules and Google connect URLs; give Part 2 MessagingPort, normalized messages/votes, CalendarPort, and delivery handlers. Receive durable queue/outbox helpers from Part 2 and each owner's deployable code/env requirements.

**Done when:** both request flows reach the deployed worker, real group/private replies and votes work, private messages stay private, two accounts return real free/busy, Calendar/ICS output works, and restarts preserve pending work. Document any unsupported group-creation behavior honestly.

## Part 4 — Discovery, Booking & Payments

**Owner: unassigned.** Supply real things to do and take the chosen option toward seats, an authorized purchase, and fair repayment.

**Responsibilities**

- Implement SerpApi Search/showtimes, Maps, Events, and Extract; normalize/cache candidates with sources and honest unknown fields.
- Give Part 2 real movie and broad-outing candidate payloads first. Booking work must not delay this handoff.
- Timebox a merchant checkout/Link access spike early; implement seat preferences, current quotes, totals, expiration, and quote binding for one rehearsed merchant.
- Implement buyer-specific Link auth/approval/status and the isolated Playwright booking worker, with distinct merchant-confirmed, buyer-reported, test, failed, and handoff outcomes.
- Own exact integer-cent share arithmetic, private repayment links, payer/buyer acknowledgment services, fulfillment jobs, and the bounded post-booking change path.
- Own fulfillment APIs and payment/buyer projections; Part 1 builds the views and Part 3 delivers the messages.

**Owned files**

~~~text
packages/integrations/serpapi.ts
packages/integrations/link-wallet.ts
packages/integrations/reimbursements.ts
packages/discovery/**
packages/fulfillment/**               # quotes, booking, splits, jobs, handlers
apps/booking-worker/**
apps/web/app/api/wallet/**
apps/web/app/api/quotes/**
apps/web/app/api/bookings/**
apps/web/app/api/reimbursements/**
apps/web/app/api/plans/[id]/quotes/**
apps/web/app/api/plans/[id]/payment/**
apps/web/app/api/plans/[id]/change-requests/**
~~~

**First 45 minutes:** return normalized live candidates and typed fixtures for a real movie/city/date and one broad outing search. Then prove a merchant quote and Link test authorization; choose the honest checkout handoff/test path promptly if direct booking is blocked.

**Interfaces:** give Part 2 DiscoveryPort, WalletPort, BookingPort, share calculation, and fulfillment handlers; give Part 1 payment/quote/booking/repayment endpoints. Receive selected versions/options, named attendees, actor, DB/queue helpers from Part 2, and the callback base from Part 3. Enqueue private requests through the shared outbox.

**Done when:** the planner has real sourced candidates; a selection produces a quote and authorized buyer flow; booking or its explicit fallback works; uncertain purchases cannot duplicate orders; shares sum exactly and requests are created once. Manual repayment acknowledgments are not labeled provider-verified payments.

## How the four parts connect

~~~mermaid
flowchart LR
    P1[Part 1: App and Accounts] -->|users and friend connections| P2[Part 2: Agent and Backend]
    P3[Part 3: Messaging Calendar Deployment] -->|messages votes and busy intervals| P2
    P4[Part 4: Discovery Booking Payments] -->|candidates and fulfillment| P2
    P2 -->|plan and run data| P1
    P2 -->|outgoing messages and calendar jobs| P3
    P2 -->|selected plan and authorized actions| P4
~~~

1. Part 1 publishes the scaffold; Part 2 publishes types/DB/queue helpers. Parts 3 and 4 run provider spikes independently.
2. Part 3 feeds messages to Part 2; Part 4 supplies candidates; Part 2 returns options for Part 3 to send and Part 1 to display.
3. Part 3 sends the poll and receives votes; Part 2 records the selection or repairs the plan.
4. Part 4 handles quote/approval/booking/splitting. Part 3 delivers private requests and calendar output; Part 1 shows each person's view.

## Shared file and integration rules

- Part 1 owns root scaffold/lockfile changes. Each owner manages their package manifests and coordinates root dependency updates with Part 1.
- Part 2 is the single shared schema/migration/contracts owner. Others supply tables/types they need and implement their own repositories using its DB/schema exports.
- Each owner implements their listed APIs and job handlers. Part 2 wires the worker registry; Part 3 deploys. Neither inherits all the other parts' implementation work.
- Part 2's plans API ownership excludes Part 3's Calendar routes and Part 4's quotes/payment/change routes. Part 1 owns UI pages, not every API file.
- Typed, labeled fixtures let all four work independently before upstream services are ready. Agree a cross-owner edit before changing another person's files.
- If someone finishes early, help the bottleneck by agreement. The reusable runner belongs to Part 2 and Studio UI to Part 1; Part 4 does not inherit a second platform project on top of booking.

## Shared integration checkpoints


| Elapsed target | Exit condition |
|---|---|
| 0–45 min | Hobby-first transport decision, Muse/SerpApi calls proven, DB/deployed shell established, checkout feasibility understood. |
| 45–120 min | Signup -> accepted friendships -> either request entry -> real options in chat; public/private views backed by DB. |
| 2–4 hours | Poll/replies -> group selection; Calendar data or explicit contextual availability; private question; changed-constraint repair publishes a new version. |
| 4–6 hours | One buyer/quote -> wallet approval -> booking/test/handoff -> exact private repayment requests -> calendar action. Record the first demo. |
| After complete slice | Studio/template evidence, visual polish, retries/reset, optional Gemini/voice/image only if owners are free. |

If behind, reduce breadth: one real city/movie merchant, no second messaging adapter, no generic booking planner, no agent browsing arbitrary websites, and no automated refunds. Preserve both entry flows and the shared plan/repair experience. If booking blocks, the actual provider checkout handoff is the fallback; retain an honestly labeled test purchase demonstration separately.

## Shared environment contract

Commit `.env.example` with names and placeholder values only. Actual secrets live in ignored local env files and the VM's restricted environment/secrets files. Never place a secret in a `NEXT_PUBLIC_*` variable.

```text
APP_BASE_URL
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
APP_ENCRYPTION_KEY
PHONE_LOOKUP_HMAC_KEY
MODEL_API_KEY
MUSE_MODEL=muse-spark-1.3
SERPAPI_API_KEY
MESSAGING_PROVIDER=linq
LINQ_API_KEY
LINQ_FROM_PHONE
LINQ_WEBHOOK_SECRET
LINQ_WEBHOOK_VERSION
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
TEAM_ADMIN_USER_IDS
BOOKING_MODE=test
BOOKING_ALLOWED_HOSTS
LINK_AUTH_DIRECTORY
MAX_EXTRA_SPEND_USD=40
MAX_SERPAPI_REQUESTS
```

Telegram variables replace Linq variables only if that fallback is selected. Browserbase variables are optional if the $0 VM browser path fails. Link per-user tokens are not one shared global environment variable. Values such as webhook version and quotas must match the actual provisioned account and pinned SDK; `MAX_EXTRA_SPEND_USD` is an application limit, not a provider-side guarantee.

## Deployment sequence — Part 3 coordinates

1. Commit/pin the scaffold and lockfile; build the web and worker images. Use a pinned Playwright image matching its package version. Put Caddy in front of the app; expose only HTTPS and restricted administration, not Postgres or wallet processes.
2. Provision the small Vultr instance, redeem the available event credit, point the domain, and wait for HTTPS. A provider hostname is acceptable until the .TECH/student domain is active. If Azure student credit is already usable and Vultr is blocked, run the same Compose stack on an Azure Ubuntu VM; do not redesign around Functions.
3. Provision Tiger Cloud in a nearby region or the VM Postgres fallback. Check verified TLS, run migrations once, and use small shared connection pools. Do not auto-run competing migrations on each replica startup.
4. Start web/worker services with restart policies and persistent volumes for app operational data. Wallet auth is encrypted and isolated by user; short-lived credentials are kept in a private temporary location and removed promptly. No card data in backups.
5. Configure exact Google callback URLs and test-user allowlist, messaging webhook/signing secret, and provider event subscription. Prove one actual inbound event from a team device on the deployed URL.
6. Run the real-device smoke checklist, take a DB checkpoint and demo recording, then freeze the shared contract. Avoid changing webhook URLs and OAuth domains during final testing.

## Focused validation — each part owns its checks

Required before recording: duplicate webhook dedupe; phone/identity and friendship authorization; private-data projection check; slot intersection/time-zone boundaries; in-flight repair revision conflict; obsolete poll ignored; exact fee/discount split; buyer/quote binding; uncertain purchase does not retry; explicit test/live state; own-calendar event/ICS dedupe. Run unit/contract tests for these and one deployed end-to-end journey per entry flow. Do not spend time on exhaustive UI snapshots or unrelated edge cases.

Use fixtures only where marked. A fake venue is never passed off as a SerpApi result; a test card is never submitted to a real theater as a purchase test. Limit live purchase tests to a buyer-authorized transaction; the API-budget permission is not authorization to buy movie tickets.

## Combined demo script

1. Four accounts exist; one can be new for the invitation moment. Existing friends demonstrate immediate planning; the unknown friend demonstrates phone invite/signup/acceptance.
2. Private request names friends and a real currently showing movie. Agent creates a GC if entitled, or sends private options with the fallback clear. Show real sourced showtimes and three differences in timing/experience/price certainty.
3. A private availability question stays private. Participants vote on acceptable options and name a favorite.
4. Change one person's availability. The old poll becomes stale, and the agent explains the repaired options.
5. A clear group message establishes who is coming despite a silent holdout. Nominate the buyer; show seats, exact quote, and private wallet authorization.
6. Show the actual merchant confirmation, an explicitly labeled test checkout, or a live checkout handoff. Send each nonbuyer their calculated private share request and calendar details.
7. Separately start from an existing group with the agent added. The same runner and versioned state produce the plan/poll. Show Studio's actual run trace/template reuse if complete.

Record actual modes/capabilities in a small demo checklist. Submission claims follow shipped behavior. Preserve a video before attempting optional integrations.

## Spending and teardown — Part 3

Part 3 keeps the $40 cash ledger: browser option up to $20, short-lived hosting up to $5, emergency model spend up to $5, reserve $10. Check provider meters as well as our counters. Do not pay for messaging plans outside that envelope or assume all trial entitlements.

Record Linq trial expiration, Tiger trial expiration, VM/domain renewal, and any Browserbase subscription date. Preserve the demo checkpoint, then stop unneeded resources and paid subscriptions when appropriate. Keep the deployed demo only for the period the team chooses and can fund; do not silently roll an event prototype into recurring costs.
