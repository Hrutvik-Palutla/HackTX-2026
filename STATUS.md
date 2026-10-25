# Status and handoffs

Each owner keeps their own section current: status, files, what actually works + the check run, blockers, next action.

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
