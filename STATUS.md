# Status and handoffs

Each owner keeps their own section current: status, files, what actually works + the check run, blockers, next action.

## Part 2 — Agent & Backend — in progress (branch `part2/backend-foundation`)

**Works (verified by `pnpm test`, 16 tests on real Postgres via PGlite; `pnpm typecheck` clean):**
- `packages/contracts`: Zod schemas/types for everything in CONTRACTS.md, plus port interfaces.
- `packages/db`: Drizzle schema for every CONTRACTS.md §4 table (Better Auth tables included); migration `drizzle/0000_*.sql`.
- `packages/core`: Postgres job queue (dedupe, `SKIP LOCKED` leases, retry/backoff, per-plan serialization), encrypted outbox, external-effect reservation, plan creation with friend-connection gate, revision CAS, immutable versions, votes and tally, decisions (chat decisions must cite messages), owner-only encrypted private facts, deterministic `[start,end)` availability.
- `packages/agent`: Muse client (OpenAI SDK pointed at `api.meta.ai/v1`), plan/repair job (discovery, then code feasibility, then Muse picks/explains, then code validation, then CAS publish, then group or DM-fallback messages), conversation handler (verified sender only, bounded tool loop), Studio run records with per-step timing, tokens, and cost.
- `packages/templates`: `movie-night` and `local-outing` on the same runner.
- `apps/worker`: job host. It only claims kinds that have a registered handler.

**Not yet verified:** live Muse calls (no key yet; run `pnpm muse:smoke` once `MODEL_API_KEY` is set), Tiger Postgres (no `DATABASE_URL` yet), `/api/plans/**` route handlers (waiting on Part 1's Next scaffold and session helper).

**Integration points for other parts:**
- **Part 1:** the root `package.json` / `pnpm-workspace.yaml` were created minimally so packages could build. Extend them; don't replace them. Check that the `user`/`session`/`account`/`verification` tables in `packages/db/src/schema.ts` match `npx @better-auth/cli generate` for your config. Tell Part 2 about any diff; don't add a second user table. Use `drizzleAdapter(db, { provider: 'pg', schema })` from `@hacktx/db`.
- **Part 3:** the webhook stores `inbound_events`, then `enqueue(db, { kind: 'process_inbound', dedupeKey: 'linq:'+eventId, payload: { sendingLine, message: InboundMessage } })`. Register a `send_outbox` handler in `apps/worker/src/registry.ts`. Outbox rows have `recipient` (group/private/invite) and `body` (group) or `bodyEnc` (decrypt with `open('outbox', …)`). Private recipients may omit `conversationId`; resolve by `userId`. Poll publishing after a new version is still to be wired: call `publishPoll` and insert a `polls` row. Calendar busy intervals go in `availability_snapshots` (no titles).
- **Part 4:** implement `DiscoveryPort` from `@hacktx/contracts` and pass it to `runPlanJob`. Until then the worker refuses plan jobs unless `DISCOVERY=fixture`, which labels every option `FIXTURE:`. Candidate `id`s must be stable within a run. Fulfillment tables already exist in the schema; ask Part 2 for column changes.

**Env used by Part 2:** `DATABASE_URL`, `MODEL_API_KEY`, `MUSE_MODEL`, `APP_ENCRYPTION_KEY` (32 random bytes, base64), optional `DISCOVERY=fixture`.
