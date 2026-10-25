# Status and handoffs

Each owner keeps their own section current: status, files, what actually works + the check run, blockers, next action.

## Chat-first UX and visual proposal — ready for review; not deployed (October 25)

- **Owner:** current integration agent, authorized to improve copy/flow and commit a separate review branch. Based on latest upstream `eae4bac`, preserving the teammate's Sid integration. Branch: `design/chat-first-preview`.
- **Files:** public home/example/compatibility routes, account/plan wording, shared chat panel, agent voice, scoped chat API/core/worker plumbing, `messages.plan_id` additive migration, contracts, tests and `docs/design/`.
- **Working locally:** one phone-free browser-only example with choices, friend views, same-option votes, confirmation, time conflict/approval reset, activities and labeled sample chat. Old demo/preview links converge there. Real plan chat reads scoped website/provider group messages and queues only explicitly requested linked-group posts; private threads, other plans and unscoped replay history are excluded. No arbitrary recipient or actor is accepted from the client.
- **Design:** original generated scene and full-page concept saved at `docs/design/sidequest-concept-v1.png`, with the exact prompt/provenance. The proposed pine/ivory/copper theme and hero assets are **not implemented** and await approval. The walkthrough and Snowflake/SpaceXSI capability review are in `docs/design/CHAT_FIRST_REVIEW.md`; neither sponsor addition is claimed as used.
- **Checks:** [Full Linux CI passed on code revision `b17019e`](https://github.com/Hrutvik-Palutla/HackTX-2026/actions/runs/40177165839): backend/worker TypeScript, production build, 65 backend tests, 37 messaging/calendar tests, accounts, all 75 discovery/fulfillment tests, runtime-installer checks, real Postgres account journey and all 36 desktop/mobile checks. Coverage includes phone-free entry, zero example API calls, time/vote repair, private boundaries, explicit posting destination and legacy redirects. The Postgres fixture now applies the complete shared migrations in its disposable schema and verifies the current invitation-resume payload. The deployment job was skipped; final handoff edits are documentation only.
- **Blockers / next action:** user reviews visual image and branch; integration owner coordinates the included `0001` migration plus web/worker rollout only after review. Production was not migrated or deployed. Real linked-group delivery, completed phone sign-in and personal Google consent/calendar writes remain acceptance checks. Review upstream automatic group-creation/notification and selection-triggered calendar-sync consent before live rollout, as described in the branch review. No live application messages, reservations or calendar writes were performed here.

## Standout integration and release — done; personal consent/acceptance remains (October 25)

- **Owner:** integration agent, explicitly authorized to finish, push and deploy. Older sections below are historical handoffs.
- **Files:** agent `standout.ts` / `media.ts`, API routes, web panels and recorded demo, templates, shared approval/calendar guards, Part 4 handoff wiring, Docker/Compose/CI runtime settings installer. No new schema migration; encrypted internal records reuse `private_facts`.
- **Working:** owner-confirmed interest drops, grounded common-interest queries feeding SerpApi, fixed-format cooperative quests with persistent completion/recap, editable versioned Studio recipes. Optional Muse photo understanding, real WAV speech transcription and quest image generation all passed live provider checks. Public `/demo` reads only explicitly seeded synthetic, phone-less accounts; real data stays authenticated.
- **Tiger:** new service initialized with unchanged 41-table baseline and verified TLS. A real Tiger + Muse + SerpApi walkthrough generated three sourced choices, recorded all three synthetic friends' same-version votes, selected an outing, generated five challenges and persisted all simulated completions. No external text, booking or calendar write was made by this harness.
- **Checks:** Linux CI passed root/worker typechecks, 35 backend tests, 28 Part 3 tests, 8 account tests, all 75 Part 4 tests, integration tests, both runtime-installer tests, production build, and 28 desktop/mobile browser tests. Nine POSIX assertions fail on Windows only; all passed on Linux. Private `.env.team` is complete, ignored, and never committed. It contains local origins and the shared verified-TLS database settings.
- **Release:** PR #1 merged into `main`; all four parts and Standout A–D are deployed at https://getsidequest.tech. The exact revision is reported by `/health/live` and `/health/ready`. Public database readiness passed; private plan/Studio/Drops reads return 401 without sign-in. `/api/demo` returned 3 sourced options, 3 evidence owners and 5 challenges in ~9.6 KB; its separate PNG endpoint returned a valid image. The production worker processed the authorized OTP on its first attempt, Claw accepted it, and the tester confirmed receipt. Completing the browser sign-in remains the tester's action, not a verified result yet.
- **Google:** owner confirmed Calendar API enabled, production callback saved and teammate test-user emails added. Each person still needs to sign in and grant their own Calendar consent. A real Google consent/event-write journey has not been performed; manual availability and ICS remain available.
- **Handoff:** user/teammates finish phone sign-in and connect their own calendars. No purchases, external invitations or calendar writes were performed by release verification. Local startup scripts now load the root env file automatically so the private teammate configuration is usable.

## Independent integration/demo review — ready for team handoff (October 24, 2026)

- Inspected `integration/all` at `3a5e1ca` and the local `../SIDEQUEST_STANDOUT_PLAN.md`. Re-ran all three TypeScript checks, Next production build, 28 backend/cross-part tests, 11 messaging tests, and 8 account tests successfully. Part 4's suite and real phone/OAuth journeys were not re-run in this review.
- Re-ran `packages/agent/src/demo.ts` with live Muse + SerpApi on isolated in-process PGlite: 20 candidates, 3 published options, Mark's own chat vote recorded, private availability change produced version 2, real Studio traces; roughly $0.054 estimated across the three runs. This did not send actual texts or test UI sign-in.
- Public `http://144.202.19.9/plans?preview=1` is viewable and explicitly labels sample data. Public `/api/plans`, `/api/studio/templates`, and `/api/calendar/connect` each returned 404. The integrated APIs are not deployed there. Opened the preview for the owner; screenshot `../research/setup/sidequest-public-preview.png`.
- Remaining runtime blockers: local `.env` still targets OLD service `b30joco0l9`; do not run the new squashed baseline against it. New `w3cwuqrto6` needs its own credential/configuration and baseline verification. Local auth secrets, Claw settings, and Google OAuth settings are incomplete; OTP sender is declared but not registered in app startup. Compose has no agent worker. Docker/CI still pin Node 22.22.0 + pnpm 10.18.3 while this branch declares Node >=24 + pnpm 10.34.8.
- New Calendar commit `1cbd92e` exists on `origin/part3/messaging-calendar-deploy` but is not in `integration/all`; merge its changes with the current schema, configure Calendar startup/session hooks and jobs, then test real consent/freebusy/export. Part 4 HTTP adapters exist, but no app startup call installs `installPart4Runtime`; payment/booking endpoints remain unconfigured.
- Standout proposals are not implemented: Drops/shared-evidence extraction, Common Ground, Quest/progress, and editable/persisted Studio recipes. Studio currently reads hardcoded templates and displays run records. No Gemini, Snowflake, Muse Image/Voice, Facebook Graph, or Muse connector integration found in the application sources.
- Domain / HTTPS **done**: owner completed the MLH-sponsored `getsidequest.tech` registration ($0 first year), expires Oct 25, 2027, Auto-Renew Off. Saved apex A `@ -> 144.202.19.9` and independently verified public DNS. Reused existing GitHub Actions deployment secrets through operations branch `ops/getsidequest-https`, commit `a116fcb`, successful run https://github.com/Hrutvik-Palutla/HackTX-2026/actions/runs/40157155429 . The workflow updates only the running server origin configuration, backs it up, preserves the current image/release, and rolls back on failed verification. `https://getsidequest.tech/health/live` and `/plans?preview=1` return 200 with normal certificate verification; HTTP redirects 308 to HTTPS; browser preview verified. This serves the existing labeled SAMPLE app, not the undeployed integration/all APIs. Main and the shared working branch were not changed. Proof: `../research/setup/getsidequest-tech-dns-configured.png` and `../research/setup/getsidequest-tech-https-preview.png`. The Vultr login supplied here is a different/unfunded account; no payment details, new server, or new credentials were needed.

## All four parts integrated — branch `integration/all` (October 24–25, 2026)

Merged `main` (Part 1 app + Vultr deploy), `part3/messaging-calendar-deploy` (Claw Messenger), and `integration/part2-part4` (Parts 2 + 4). Verified locally:
- **Checks:** both typechecks clean; `next build` succeeds. Tests: Part 2 + cross-part 28/28, Part 3 11/11, Part 1 accounts 8/8, Part 4 66/75 (the 9 failures are the known Windows-only `0700` permission checks).
- **Journey in a real browser and API** (local Postgres, live SerpApi + Muse): Alex creates a plan through `POST /api/plans`; the worker publishes 3 real Austin options with source links; Mark opens `/plans/:id` and sees them; Mark's vote via `PUT /api/plans/:id/vote` is recorded as his and shown as saved; Studio shows the real run to the team account and 404s for others.
- **Schema change (breaking, intentional):** Part 1's account code queries Better Auth's camelCase columns and `user_low_id`/`inviter_id`-style friend columns, so the Drizzle schema now matches the DDL printed by Part 1's `pnpm accounts:schema` and the handoff doc exactly, plus the `rateLimit` table. Migrations were squashed into one baseline, `0000_baseline.sql` (41 tables). Part 1's real repository was run against it: profile save, invite, accept, and friend list all work. **The old Tiger service (`b30joco0l9`) has the previous migrations and must not be reused; use the new service (`w3cwuqrto6`), which has a publicly signed certificate (verify-full passes).**
- **Wiring:**
  - Plan/Studio routes are one-line re-exports of `@hacktx/api`.
  - `apps/web/lib/part2.ts` connects Better Auth sessions to the API.
  - An accepted friendship enqueues a `resume_connections` job in the same transaction.
  - The worker registers Part 3's `send_outbox`/`publish_poll` when `CLAW_MESSENGER_*` is set.
- **Still missing:** a private OTP sender, so nobody can sign in through the UI yet (Part 3 owns this; register it with `configurePrivateOtpSender`). Deployed env and the new Tiger database are not yet applied.

## Tiger standard conversion — local development unblocked; certificate verification pending (October 24, 2026)

- With the owner's explicit approval, converted `sidequest` (`b30joco0l9`) from free to standard. Console shows Ready, 0.5 CPU / 2 GiB RAM, normal compute estimate $0.04/hour / $31/month, covered by the current Performance trial (about 28 days and $1,000 credits remaining). Conversion cannot be reversed to free.
- Billing shows no payment method registered. Checked Billing Details/Emails/Timeline, project settings, account settings, and Notifications; found no configurable warning before trial expiry or charges. No reminder setting was enabled, and no payment method was added.
- Support case **00045362** was submitted and verified Open. It requests an authoritative CA bundle or supported verified-TLS solution; no credentials were included.
- Full certificate verification (`sslmode=verify-full`) still fails with `SELF_SIGNED_CERT_IN_CHAIN`. After MLH suggested the workaround and the owner approved it, changed only the Git-ignored local `.env` DATABASE_URL flags to `uselibpqcompat=true&sslmode=require`. This retains TLS encryption but disables server certificate verification in the installed pg driver; it is temporary development configuration, not a certificate fix. Source code and deployment configuration were not changed.
- Live read-only queries now succeed: TLS active, 40 public base tables, 3 migration records, all hashes and journal timestamps matching migrations 0000–0002. `npx --yes pnpm@10.34.8 db:migrate` completed successfully against Tiger; the migration history was already current.
- Next: remove `uselibpqcompat` and set `sslmode=verify-full` once Tiger's signed certificate passes verification. Case 00045362 remains the escalation path. Real worker processing and the merged/deployed full-app journey still need separate validation; local env changes do not propagate to other teammates or the server.
- Local proof: `../research/setup/tiger-converted-standard.png` and `../research/setup/tiger-support-submitted.png`. Credentials were not printed or committed.
- Follow-up (Part 2): independently re-verified the schema and ledger above against live Tiger. `pnpm db:migrate` previously needed exported env vars; `drizzle.config.ts` now loads the root `.env`, and a re-run reports nothing to apply. The worker booted against Tiger and polled the queue without errors (empty queue; no job processed yet). The public certificate was re-checked every minute for 40 minutes after conversion and was still the private `ca.timescale.com` chain.
- **Help wanted:** get Tiger to serve a publicly signed certificate (or an authoritative CA bundle) so `sslmode=verify-full` works; then the deploy can drop the workaround.

## Tiger migrations 0001 + 0002 — applied (October 24, 2026)

- Applied `0001_drop_unused_fulfillment_text_source_ids.sql` and `0002_part4_fulfillment_tables.sql` from the local `integration/part2-part4` checkout through Tiger's web SQL editor. The fetched `origin/main` does not yet contain the database package.
- Confirmed migration 0000's stored checksum matches the repository. All five legacy fulfillment tables were empty, with RLS already disabled. A PGlite dry run of migrations 0000–0002 passed.
- Applied both unchanged SQL files in one transaction, with locks and guards against changed migration history, legacy-table data, or unexpected RLS. Recorded each file's exact SHA-256 and `_journal.json` timestamp in `drizzle.__drizzle_migrations`.
- Tiger readback verified **3 migration records / 3 matching hashes**, **40 public base tables**, **7 new fulfillment tables**, **0 legacy tables**, **3 converted text columns**, **8 fulfillment indexes**, and the reimbursement booking/payer unique constraint.
- Execution record: `../research/setup/tiger-migrations-0001-0002.sql`. Venue Wi-Fi still requires web SQL or a different network for direct Postgres access; no networking or TLS settings were changed.

## Account setup — database initialized; Meta key blocked (October 24, 2026)

- Generated `APP_ENCRYPTION_KEY` (32 random bytes, base64) in root `.env`; validated its decoded length and verified `.env` is Git-ignored. Do not rotate this key after storing encrypted data.
- Created free shared Tiger Data development service `sidequest` in AWS us-east-1. Saved `DATABASE_URL` with `sslmode=require` to root `.env`; no credentials are recorded in this status file.
- Ran `npx --yes pnpm@10.34.8 db:migrate` with `.env` loaded. Direct Postgres connections from this machine timed out; TCP checks against all six resolved service addresses also timed out. TLS verification was not weakened.
- Applied the unchanged `packages/db/drizzle/0000_fat_thor.sql` through Tiger's working web SQL editor inside a transaction, with the migration's exact SHA-256 and journal timestamp recorded in `drizzle.__drizzle_migrations`. Readback verified **38 public base tables**, **1 matching migration record**, and the `user` and `plans` tables. The CLI itself has not completed successfully from this machine.
- Finished Meta Model API account onboarding and submitted the HackTX campus-credit intake with team ID `1781219873178506`; the form confirmed “Your response has been recorded.”
- **Resolved:** Meta key obtained; `MODEL_API_KEY` is saved in `.env` (not committed) and `pnpm muse:smoke` passes.
- **Next action:** runtime database access needs a network/host that can reach the service's Postgres port (hotspot or the deployed VM); schema initialization is already complete.

## Part 2 — Agent & Backend — in progress (branch `part2/backend-foundation`)

**Live Muse verified (October 24, evening):** `pnpm muse:smoke` passed for `muse-spark-1.3` (tool call + structured output). `pnpm agent:demo` ran the full journey on PGlite with real Muse:
- three options published;
- Mark's chat message recorded as his own vote (A+B, favorite B);
- Mel's private availability change triggered a repair (3/4 candidates feasible) and a new version;
- Mel's private detail never appeared in the group text or in the model prompt.

Each run cost about $0.013–0.016 (estimated). Discovery is still the labeled FIXTURE port (Part 4 pending). The tool loop uses Chat Completions (stateless) rather than Responses; Meta supports both.

**Works (verified by `pnpm test`: 26 tests on real Postgres via PGlite; `pnpm typecheck` clean):**
- `packages/contracts`: Zod schemas/types for everything in CONTRACTS.md, plus port interfaces.
- `packages/db`: Drizzle schema for every CONTRACTS.md §4 table (Better Auth tables included); migration `drizzle/0000_*.sql`, already applied to Tiger.
- `packages/core`: job queue (dedupe, `SKIP LOCKED` leases, retry/backoff, per-plan serialization), encrypted outbox, external-effect reservation, friend-connection gate and `resumeWaitingPlans`, revision CAS, immutable versions, votes/tally, native-poll mapping (`registerPoll`/`applyPollVote`), decisions (chat decisions must cite messages), organizer roster edits and close, owner-only encrypted private facts, deterministic `[start,end)` availability.
- `packages/agent`: Muse client; plan/repair job (discovery, then code feasibility, then Muse picks/explains, then code validation, then CAS publish, then group or DM-fallback messages, a `publish_poll` job, and one 30-minute `poll_reminder`); conversation handler (verified sender only, bounded tool loop); Studio run records.
- `packages/api`: web-standard handlers for `/api/plans/**` and `/api/studio/**`: session required, same-origin check on mutations, `no-store`, generic 404s, team allowlist for Studio. Includes web chat (`postMessage`/`getMessages`), the fallback if Linq group access fails. The agent replies into the same web thread, and private threads stay private.
- Option titles come from source data, so the movie name and any `FIXTURE:` label are preserved. Muse writes only the one-line explanation, limited to facts in the candidate data. Warnings are code-generated.
- The agent's own messages are stored in each conversation transcript, since Linq doesn't echo bot messages.
- Global Muse budget: new runs are refused with `BUDGET_LIMIT` once recorded spend reaches `MUSE_BUDGET_USD` (default 20).
- `packages/templates`: `movie-night` and `local-outing` on the same runner. `apps/worker`: job host; Muse is created lazily, so non-AI jobs run without a key.

**Not yet verified:** the worker against Tiger (the runtime connection is blocked from venue Wi-Fi; see below); real SerpApi candidates (Part 4); real Linq delivery and polls (Part 3); Next route wiring (Part 1).

**Network finding (affects Part 3):** venue Wi-Fi allows outbound TCP 80/443/8080 only. Tiger's port, 5432 and **SSH 22 time out** (checked against portquiz.net). Use a phone hotspot for DB/SSH work, or the Vultr web console. The deployed VM is unaffected.

**Integration points for other parts:**
- **Part 1:** root `package.json` / `pnpm-workspace.yaml` are minimal; extend them, don't replace them. Check the Better Auth tables in `packages/db/src/schema.ts` against `npx @better-auth/cli generate`, and use `drizzleAdapter(db, { provider: 'pg', schema })` from `@hacktx/db`. Call `configureApi({ db, getUserId })` once; route files are then one-liners, e.g. `export { getPlan as GET } from '@hacktx/api'`. Exports: `createPlanRoute`, `listPlansRoute`, `getPlan`, `putVote`, `postDecision`, `patchParticipants`, `postClose`, `getPrivate`, `putPrivateFact`, `getStudioTemplates`, `getStudioRuns`. After a friend request is accepted, call `resumeWaitingPlans(db, userId)` from `@hacktx/core`.
- **Part 3:** the webhook stores `inbound_events`, then `enqueue(db, { kind: 'process_inbound', dedupeKey: 'linq:'+eventId, payload: { sendingLine, message: InboundMessage } })`. Register handlers in `apps/worker/src/registry.ts`:
  - `send_outbox`: recipient is group, private or invite. The body is `body`, or `open('outbox', bodyEnc)` for private ones. Private recipients may omit `conversationId`, so resolve by `userId`.
  - `publish_poll`: payload is `{planId, versionId, conversationId, labels}`. Post the poll, then call `registerPoll`.

  Poll events go to `applyPollVote` with the voter's current full selection. Calendar busy intervals go in `availability_snapshots`, with no event titles.
- **Part 4:** implement `DiscoveryPort` and pass it to `runPlanJob`; the worker currently accepts only the labeled `DISCOVERY=fixture`. Candidate `id`s must be stable within a run. Fulfillment tables exist; ask Part 2 for column changes.

**Part 2 + Part 4 integration (branch `integration/part2-part4`; merges both, no changes to Part 4's files except a `.gitignore` union):**
- The worker uses Part 4's `SerpApiDiscovery` when `SERPAPI_API_KEY` is set. It loads `.env` and `.env.local`. `DISCOVERY=fixture` remains an explicit, labeled fallback.
- `apps/worker/test/part4-discovery.test.ts` feeds Part 4's recorded SerpApi fixture through their adapter into Part 2's planner: options are published, the source link is persisted and returned, and price/runtime stay unknown.
- Schema: Part 2's unused fulfillment tables were dropped. Part 4's `fulfillment_*` tables are now in the Drizzle schema, identical to `packages/fulfillment/sql/001_part4.sql` (`IF NOT EXISTS`). **Tiger needs migrations `0001` and `0002` applied** (web SQL editor, or `pnpm db:migrate` from a network that allows the Tiger port).
- Toolchains coexist:
  - Root `pnpm typecheck` checks Part 2 strictly; the worker config also checks the Part 4 code it imports.
  - `pnpm test` is vitest for Part 2 + cross-part tests; `pnpm test:part4` is Part 4's `node --test` suite.
- On Windows, 9 of Part 4's 75 tests fail only on the POSIX `0700` auth-vault permission check (Windows can't express it); the rest pass. Expected to pass on the Linux VM.
- Part 4's live check found **no structured showtimes for a movie today**. The planner now says it found no listed showtimes and won't guess, instead of blaming schedules.
- For Part 4: `WalletPort.checkConnection` returns `'not_connected'`, while CONTRACTS.md says `'revoked'`. Pick one.

**Verified October 24, late evening:**
- Tiger migrations 0001/0002: the recorded hashes and timestamps in `drizzle.__drizzle_migrations` (from `research/setup/tiger-migrations-0001-0002.sql`) match the repo files exactly, and all 31 statements were executed verbatim. The readback screenshot shows 3/3 matching records, 40 tables, 7 fulfillment tables, 0 legacy tables, 3 text columns, 8 indexes and 1 unique constraint, which is exactly what the migrations produce.
- Live SerpApi + live Muse, full journey (`pnpm agent:demo`; key in ignored `.env.local`): 20 real Austin candidates, 15 feasible, three grounded options with source links. The chat vote was recorded as the sender, and a private availability change triggered a repaired version. About $0.015–0.019 per run.
- **Blocker: app → Tiger TLS.** The Tiger port is reachable from the current network, but the service presents a certificate chain from a private `Timescale Inc / ca.timescale.com` CA. Tiger's docs say certificates come from Google/ZeroSSL, so node-postgres rejects it (`SELF_SIGNED_CERT_IN_CHAIN`). Verification was **not** disabled. Next: get the CA certificate from the Tiger console or support through a trusted channel, then add `sslrootcert=<path>` to `DATABASE_URL`.

**CONTRACTS.md updated:** `publish_poll` job kind, `vote_states`, `plans.template_id`, `agent_runs.task`, `PROVIDER`/`INTERNAL` errors, `PUT /plans/:id/private`, `GET`/`POST /plans/:id/messages`.

**Env used by Part 2:** `DATABASE_URL`, `MODEL_API_KEY`, `MUSE_MODEL`, `MUSE_BUDGET_USD`, `APP_ENCRYPTION_KEY`, `APP_BASE_URL`, `TEAM_ADMIN_USER_IDS`, optional `DISCOVERY=fixture`.

## Part 3 — Messaging, Calendar & Deployment — in progress (branch `part3/messaging-calendar-deploy`)

**Provider decision:** iMessage via **Claw Messenger** (hosted, self-serve; agent number +1 205-369-0702). We did not use Linq (it requires a sales consultation), Sendblue/Photon (groups and cold outreach gated on free plans) or Telegram (not iMessage). Claw has **no native polls**: votes are text replies plus the web vote page. Inbound arrives over a WebSocket, not webhooks.

**Live-verified with real phones (October 24):** DM send and receive; agent-created group (send to an array of numbers); send to the group by chat ID; inbound group messages with sender and participants; all iMessage; messages sent while offline are replayed on connect. Check: `pnpm exec tsx --env-file=.env packages/integrations/messaging/claw-spike.ts dm|group <+E164…>`.

**Live-verified with a real Google account:** OAuth consent with free/busy + events.owned scopes on the localhost redirect; primary-calendar free/busy returned real busy blocks (times only). Check: `pnpm exec tsx --env-file=.env packages/integrations/calendar-spike.ts`.

**Works (27 tests, `pnpm exec vitest run --config packages/integrations/vitest.part3.config.ts`; strict typecheck clean; root `pnpm typecheck`/`pnpm test` still pass):**
- `messaging/claw-messenger.ts`: WebSocket client with keepalive, reconnect/backoff, `sync` replay, and send correlation.
- `messaging/claw-adapter.ts`:
  - Inbound goes to `inbound_events` (no text/phones) plus a deduped `process_inbound` job.
  - `send_outbox` reserves an external effect first, so an ambiguous timeout becomes `unknown` and is never resent. Provider-declined sends retry. Expired rows are dropped. Private messages go only to a verified handle or verified phone.
  - `publish_poll` posts a text poll via transcript and outbox; obsolete versions are skipped.
  - `startClawMessenger({db})` is the worker entry point.
- `messaging/otp.ts`:
  - `createOtpSender(db)` matches Part 1's `configurePrivateOtpSender` signature. Phone and code are encrypted into the outbox, and the body is wiped after send or expiry.
  - `linkVerifiedPhone(db, userId, phone)` adds the `messaging_identities` row.
- `google-calendar.ts`: signed, session- and browser-bound OAuth state; encrypted refresh token; incremental write scope; revoke on disconnect; `invalid_grant` marks the connection `revoked`; free/busy never reports unknown as free; stable-ID own-calendar event upsert; ICS.
- `calendar-jobs.ts`: `refreshPlanAvailability` (snapshots for every plan member into `availability_snapshots`) and the `sync_calendar` handler.
- `calendar-http.ts` and route files `apps/web/app/api/calendar/{connect,callback,connection}`, `api/plans/[id]/calendar`, `api/plans/[id]/calendar.ics`: session required, same-origin on mutations, generic 404 for non-members, `no-store`.

**Requests to other parts:**
- **Part 2:**
  1. Add `'claw_messenger'` to `InboundMessage.provider`. Until then `handleInbound` rejects Claw messages, which blocks live end-to-end testing.
  2. Add `{kind:'otp_phone', phoneEnc}` to `OutboundRecipient`. It is stored by `createOtpSender` and handled by our `send_outbox` today.
  3. Worker wiring:
     ```ts
     const claw = await startClawMessenger({ db });
     if (claw) { register('send_outbox', claw.handlers.send_outbox); register('publish_poll', claw.handlers.publish_poll); }
     register('sync_calendar', createSyncCalendarHandler(new GoogleCalendar(db, googleConfig())));
     ```
  4. Call `refreshPlanAvailability(db, calendar, planId, window)` before feasibility.
  5. The `process_inbound` job payload stores private message text in plaintext in `jobs`; consider encrypting it.
  6. The planner can use `createGroup` (send `to: [numbers]`) for the private-request flow, since Claw supports it.
- **Part 1:**
  - At startup: `configurePrivateOtpSender(createOtpSender(db))` and `configureCalendar({ db, getUserId })`.
  - After phone verification: `linkVerifiedPhone`.
  - The settings page should read `GET /api/calendar/connection` for `calendarConnected`, link to `/api/calendar/connect` (`?write=1` for Add to calendar), and handle `?calendar=connected|declined|invalid|failed` on return.
  - Note: `main` uses `@muse/*` packages and different friendship column names from Part 2's schema, which needs reconciling in the merge.
- **Part 4:** `packages/integrations/package.json` now has workspace dependencies (`@hacktx/db`, `core`, `contracts`) and Part 3 exports.

**Env (see `.env.example`):** `MESSAGING_PROVIDER=claw_messenger`, `CLAW_MESSENGER_API_KEY`, `CLAW_MESSENGER_URL`, `CLAW_MESSENGER_FROM_PHONE`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

**Next:**
- Deployment wiring once `main` (web + Caddy + Vultr scripts) and `integration/part2-part4` (worker) merge:
  - `compose.yaml` on `main` has no **worker** service yet, so nothing would consume jobs or hold the Claw socket. Add one, built from the same image and running `pnpm worker`, with the same env file.
  - `.env.production` needs the Claw and Google variables.
  - Google OAuth needs **HTTPS on a real domain** (the `SITE_ADDRESS=:80` IP preview can't be a redirect URI). Add `https://<domain>/api/calendar/callback` in Google Cloud and set `GOOGLE_REDIRECT_URI` to it.
- Unknown-sender signup prompt.
- Live OTP delivery check after Part 1 wires the sender.
