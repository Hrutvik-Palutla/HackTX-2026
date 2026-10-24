# Four-Person Implementation Plan

Use [ARCHITECTURE.md](ARCHITECTURE.md) and [CONTRACTS.md](CONTRACTS.md) as the build baseline. Times below are durations from technical kickoff, not a replacement for the event schedule. Feature and submission cutoffs in IDEA.md still apply. No provider account has been tested by this research alone.

## 1. First 45 minutes: resolve access while building

| Owner | Concrete task | Evidence required | If unavailable |
|---|---|---|---|
| You: integrations | Activate Linq Pro trial and test two team phones: DM, existing group inbound/outbound, new group, native poll, vote webhook, private OTP delivery | Actual provider IDs and a received signed webhook, with secrets/phone values redacted | Switch once to Telegram; document manual group creation and start-link onboarding. Do not buy a $260/month plan. |
| Planner/backend | Test supplied Muse key/model, tool call and schema output; provision Tiger trial and run a transaction | Parsed model result; create/read/rollback in shared DB; actual credit/model entitlement | Configurable accessible Muse Spark version; local/VM Postgres with the same migrations. |
| Frontend/design | Scaffold Node 24/pnpm/Next + Better Auth and supporting views against contracts | Signup page + private/public plan views using clearly marked fixtures | Keep fixtures typed; no duplicate API/schema design. |
| Discovery/platform | Test SerpApi current movie/city/date, Extract on merchant page, and a theater checkout to the seat/quote stage | Real showtime payload/source URLs and explicit price/booking limitations | Change to a currently showing movie/theater with usable data. Keep real search + merchant handoff if automation fails. |

You also start a Vultr deployment with a health endpoint and two Google test users. Discovery/platform verifies Link test-mode onboarding and the single buyer path after the showtime spike; integrations helps with OAuth/provider callback configuration. Do not spend all four people on account setup.

The transport decision is made once at 45 minutes. Group creation can be an account-limited capability while DMs/existing GC still work. No unsupported native behavior is silently simulated. Spending within the $40 infrastructure allocation is possible only at the actual account's available prices; a failed free offer is not a reason to accept a larger recurring subscription.

## 2. Work packages

Each package has one owner, allowed files, a contract, and an observable acceptance check. Shared schema changes go through planner/backend and integration lead.

| Package | Owner and allowed paths | Output / acceptance | Depends on |
|---|---|---|---|
| A: environment and transport | You; `infra/**`, `packages/integrations/messaging/**`, web webhook routes | Public HTTPS health; validated events persisted once; DM/group send; identity linkage; OTP delivered privately | Transport spike, agreed normalized events |
| B: account and friend flow | Frontend; `apps/web/**` auth/friends/settings views; auth integration coordinated with you | Phone/name/city/interests signup; optional Calendar action; friend request acceptance; established friends receive proposals without a participation gate | A, backend repositories/contracts |
| C: core persistence and lifecycle | Planner; `packages/db/**`, `packages/core/**`, `packages/contracts/**` | Transactional inbox/jobs/outbox; accepted-friend gate; immutable versions/votes/decisions; exact shares; actor checks | DB spike |
| D: sourced candidates | Discovery; `packages/integrations/serpapi.ts`, discovery normalizer/fixtures | Current movie screening candidates; broad outing candidates; fetched sources; absent prices/times stay unknown | SerpApi spike |
| E: agent loop | Planner; `packages/agent/**`, `packages/templates/**`, `apps/worker/**` | Text request -> source-backed structured options; tool limits; private/public context separation; graceful question or failure | C + D; use typed fixtures until D lands |
| F: Calendar | You; Google adapter + OAuth routes/settings integration | Separate test-user grants; true free/busy intersection; own-event/ICS output | B, public URL |
| G: compare and decide | Frontend + you for native transport; planner owns core selection | Three explained options; native poll/DM fallback; acceptable/favorite votes; clear group decision with a silent holdout | A + C + E |
| H: quote and purchase | Discovery; `apps/booking-worker/**`, wallet/booking adapters; you configure callback secrets | Rehearsed seat/price quote; buyer-specific Link test approval; quote binding; merchant-confirmed/test/handoff outcomes distinct | D, C; start the access spike early |
| I: private repayment requests | Planner implements share service; frontend buyer/share views; you delivery | Shares sum exactly; nonbuyer receives own amount link; buyer manually confirms receipt; no fake paid webhook | C + H confirmation |
| J: reusable runner evidence | Discovery after H; Studio UI by frontend | Two templates, same runner, visible redacted real runs and failures | E and a complete journey |

Planner/backend's first deliverable is contracts + repositories against a local DB. UI and transport work against these instead of waiting for model behavior. Discovery's first deliverable is normalized real candidates; it does not need to own the agent's conversation loop.

## 3. Integration checkpoints

| Elapsed target | Exit condition |
|---|---|
| 0–45 min | Transport selected, Muse/SerpApi calls proven, DB/deployed shell established, checkout feasibility understood. |
| 45–120 min | Signup -> accepted friendships -> either request entry -> real options in chat; public/private views backed by DB. |
| 2–4 hours | Poll/replies -> group selection; Calendar data or explicit contextual availability; private question; changed-constraint repair publishes a new version. |
| 4–6 hours | One buyer/quote -> wallet approval -> booking/test/handoff -> exact private repayment requests -> calendar action. Record the first demo. |
| After complete slice | Studio/template evidence, visual polish, retries/reset, optional Gemini/voice/image only if owners are free. |

If behind, reduce breadth: one real city/movie merchant, no second messaging adapter, no generic booking planner, no agent browsing arbitrary websites, and no automated refunds. Preserve both entry flows and the shared plan/repair experience. If booking blocks, the actual provider checkout handoff is the fallback; retain an honestly labeled test purchase demonstration separately.

## 4. Environment contract

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

## 5. Deployment sequence

1. Commit/pin the scaffold and lockfile; build the web and worker images. Use a pinned Playwright image matching its package version. Put Caddy in front of the app; expose only HTTPS and restricted administration, not Postgres or wallet processes.
2. Provision the small Vultr instance, redeem the available event credit, point the domain, and wait for HTTPS. A provider hostname is acceptable until the .TECH/student domain is active. If Azure student credit is already usable and Vultr is blocked, run the same Compose stack on an Azure Ubuntu VM; do not redesign around Functions.
3. Provision Tiger Cloud in a nearby region or the VM Postgres fallback. Check verified TLS, run migrations once, and use small shared connection pools. Do not auto-run competing migrations on each replica startup.
4. Start web/worker services with restart policies and persistent volumes for app operational data. Wallet auth is encrypted and isolated by user; short-lived credentials are kept in a private temporary location and removed promptly. No card data in backups.
5. Configure exact Google callback URLs and test-user allowlist, messaging webhook/signing secret, and provider event subscription. Prove one actual inbound event from a team device on the deployed URL.
6. Run the real-device smoke checklist, take a DB checkpoint and demo recording, then freeze the shared contract. Avoid changing webhook URLs and OAuth domains during final testing.

## 6. Focused validation

Required before recording: duplicate webhook dedupe; phone/identity and friendship authorization; private-data projection check; slot intersection/time-zone boundaries; in-flight repair revision conflict; obsolete poll ignored; exact fee/discount split; buyer/quote binding; uncertain purchase does not retry; explicit test/live state; own-calendar event/ICS dedupe. Run unit/contract tests for these and one deployed end-to-end journey per entry flow. Do not spend time on exhaustive UI snapshots or unrelated edge cases.

Use fixtures only where marked. A fake venue is never passed off as a SerpApi result; a test card is never submitted to a real theater as a purchase test. Limit live purchase tests to a buyer-authorized transaction; the API-budget permission is not authorization to buy movie tickets.

## 7. Demo script and evidence

1. Four accounts exist; one can be new for the invitation moment. Existing friends demonstrate immediate planning; the unknown friend demonstrates phone invite/signup/acceptance.
2. Private request names friends and a real currently showing movie. Agent creates a GC if entitled, or sends private options with the fallback clear. Show real sourced showtimes and three differences in timing/experience/price certainty.
3. A private availability question stays private. Participants vote on acceptable options and name a favorite.
4. Change one person's availability. The old poll becomes stale, and the agent explains the repaired options.
5. A clear group message establishes who is coming despite a silent holdout. Nominate the buyer; show seats, exact quote, and private wallet authorization.
6. Show the actual merchant confirmation, an explicitly labeled test checkout, or a live checkout handoff. Send each nonbuyer their calculated private share request and calendar details.
7. Separately start from an existing group with the agent added. The same runner and versioned state produce the plan/poll. Show Studio's actual run trace/template reuse if complete.

Record actual modes/capabilities in a small demo checklist. Submission claims follow shipped behavior. Preserve a video before attempting optional integrations.

## 8. Spend and teardown owner

Integration lead keeps the $40 cash ledger: browser option up to $20, short-lived hosting up to $5, emergency model spend up to $5, reserve $10. Check provider meters as well as our counters. Do not pay for messaging plans outside that envelope or assume all trial entitlements.

Record Linq trial expiration, Tiger trial expiration, VM/domain renewal, and any Browserbase subscription date. Preserve the demo checkpoint, then stop unneeded resources and paid subscriptions when appropriate. Keep the deployed demo only for the period the team chooses and can fund; do not silently roll an event prototype into recurring costs.
