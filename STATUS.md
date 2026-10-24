# Status and handoffs

Each owner keeps their own section current: status, files, what actually works + the check run, blockers, next action.

## Account setup — database initialized; Meta key blocked (October 24, 2026)

- Generated `APP_ENCRYPTION_KEY` (32 random bytes, base64) in root `.env`; validated its decoded length and verified `.env` is Git-ignored. Do not rotate this key after storing encrypted data.
- Created free shared Tiger Data development service `sidequest` in AWS us-east-1. Saved `DATABASE_URL` with `sslmode=require` to root `.env`; no credentials are recorded in this status file.
- Ran `npx --yes pnpm@10.34.8 db:migrate` with `.env` loaded. Direct Postgres connections from this machine timed out; TCP checks against all six resolved service addresses also timed out. TLS verification was not weakened.
- Applied the unchanged `packages/db/drizzle/0000_fat_thor.sql` through Tiger's working web SQL editor inside a transaction, with the migration's exact SHA-256 and journal timestamp recorded in `drizzle.__drizzle_migrations`. Readback verified **38 public base tables**, **1 matching migration record**, and the `user` and `plans` tables. The CLI itself has not completed successfully from this machine.
- Finished Meta Model API account onboarding and submitted the HackTX campus-credit intake with team ID `1781219873178506`; the form confirmed “Your response has been recorded.”
- **Blocked:** Meta's Create API key button is disabled; dashboard says no payment method on file. `MODEL_API_KEY` is not configured and the live Muse smoke test has not run. Campus credits are not confirmed active.
- **Next action:** ask the Meta event team to activate/check credits for that Team ID, or have the account owner configure billing. Once key creation is enabled, create/save `MODEL_API_KEY` and run `pnpm muse:smoke`. Runtime database access also needs a network/host that can reach the service's Postgres port; schema initialization is already complete.

## Part 2 — Agent & Backend — in progress (branch `part2/backend-foundation`)

**Works (verified by `pnpm test`: 24 tests on real Postgres via PGlite; `pnpm typecheck` clean):**
- `packages/contracts`: Zod schemas/types for everything in CONTRACTS.md, plus port interfaces.
- `packages/db`: Drizzle schema for every CONTRACTS.md §4 table (Better Auth tables included); migration `drizzle/0000_*.sql`, already applied to Tiger.
- `packages/core`: job queue (dedupe, `SKIP LOCKED` leases, retry/backoff, per-plan serialization), encrypted outbox, external-effect reservation, friend-connection gate and `resumeWaitingPlans`, revision CAS, immutable versions, votes/tally, native-poll mapping (`registerPoll`/`applyPollVote`), decisions (chat decisions must cite messages), organizer roster edits and close, owner-only encrypted private facts, deterministic `[start,end)` availability.
- `packages/agent`: Muse client; plan/repair job (discovery, then code feasibility, then Muse picks/explains, then code validation, then CAS publish, then group or DM-fallback messages, a `publish_poll` job, and one 30-minute `poll_reminder`); conversation handler (verified sender only, bounded tool loop); Studio run records.
- `packages/api`: web-standard handlers for `/api/plans/**` and `/api/studio/**`: session required, same-origin check on mutations, `no-store`, generic 404s, team allowlist for Studio.
- `packages/templates`: `movie-night` and `local-outing` on the same runner. `apps/worker`: job host; Muse is created lazily, so non-AI jobs run without a key.

**Not yet verified:** live Muse (the key is blocked at Meta). `pnpm agent:demo` runs the whole journey (request, options, chat vote, availability change, repaired options, Studio trace) on PGlite with real Muse once `MODEL_API_KEY` is set. With a dummy key it reaches `api.meta.ai` and gets `authentication_error`, so the network path works. The runtime connection to Tiger is blocked from venue Wi-Fi (see below).

**Network finding (affects Part 3):** venue Wi-Fi allows outbound TCP 80/443/8080 only. Tiger's port, 5432 and **SSH 22 time out** (checked against portquiz.net). Use a phone hotspot for DB/SSH work, or the Vultr web console. The deployed VM is unaffected.

**Integration points for other parts:**
- **Part 1:** root `package.json` / `pnpm-workspace.yaml` are minimal; extend them, don't replace them. Check the Better Auth tables in `packages/db/src/schema.ts` against `npx @better-auth/cli generate`, and use `drizzleAdapter(db, { provider: 'pg', schema })` from `@hacktx/db`. Call `configureApi({ db, getUserId })` once; route files are then one-liners, e.g. `export { getPlan as GET } from '@hacktx/api'`. Exports: `createPlanRoute`, `listPlansRoute`, `getPlan`, `putVote`, `postDecision`, `patchParticipants`, `postClose`, `getPrivate`, `putPrivateFact`, `getStudioTemplates`, `getStudioRuns`. After a friend request is accepted, call `resumeWaitingPlans(db, userId)` from `@hacktx/core`.
- **Part 3:** the webhook stores `inbound_events`, then `enqueue(db, { kind: 'process_inbound', dedupeKey: 'linq:'+eventId, payload: { sendingLine, message: InboundMessage } })`. Register handlers in `apps/worker/src/registry.ts`:
  - `send_outbox`: recipient is group, private or invite. The body is `body`, or `open('outbox', bodyEnc)` for private ones. Private recipients may omit `conversationId`, so resolve by `userId`.
  - `publish_poll`: payload is `{planId, versionId, conversationId, labels}`. Post the poll, then call `registerPoll`.
  
  Poll events go to `applyPollVote` with the voter's current full selection. Calendar busy intervals go in `availability_snapshots`, with no event titles.
- **Part 4:** implement `DiscoveryPort` and pass it to `runPlanJob`; the worker currently accepts only the labeled `DISCOVERY=fixture`. Candidate `id`s must be stable within a run. Fulfillment tables exist; ask Part 2 for column changes.

**Pending CONTRACTS.md additions (awaiting OK):** job kind `publish_poll`; `vote_states` table; `plans.template_id`; `agent_runs.task`; error codes `PROVIDER`/`INTERNAL`; `PUT /plans/:id/private` (manual availability/limits fallback). Not built yet: `POST /plans/:id/messages` (web chat).

**Env used by Part 2:** `DATABASE_URL`, `MODEL_API_KEY`, `MUSE_MODEL`, `APP_ENCRYPTION_KEY`, `APP_BASE_URL`, `TEAM_ADMIN_USER_IDS`, optional `DISCOVERY=fixture`.
