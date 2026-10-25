# SideQuest

**Make plans. Keep the group chat.**

Ask Sid in your friends’ group chat. SideQuest finds sourced options, checks known availability and collects everyone’s votes. The website is the board for those plans, messages and optional activities. Claw Messenger carries the Messages conversation; Sid is the agent. The backend uses Meta Muse, SerpApi, Tiger Postgres and versioned agent settings.

Production: **https://getsidequest.tech**. This branch, **`design/chat-first-preview`**, is a draft based on `eae4bac`; it has **not been deployed**. Its public `/try` is an interactive browser-only example with fictional friends, no account and no API calls. `/demo` and old `?preview=1` links lead there. The older recorded provider outputs remain an internal test fixture at `/api/demo`, rather than a second user journey. Real private groups still require verified identity.

The proposed visual theme exists **only as [an image](docs/design/sidequest-concept-v1.png)**, pending approval. This branch changes wording, entry flow and chat behavior while retaining the existing theme. See the [walkthrough, decisions and sponsor review](docs/design/CHAT_FIRST_REVIEW.md) and [image prompt/provenance](docs/design/CONCEPT_PROMPT.md).

Before running this branch against a real database, apply its additive migration `0001_simple_shooting_star.sql` with `pnpm db:migrate` using the same verified-TLS configuration. It adds nullable message-level plan scope and an index; it intentionally does not publish historical chat. **This migration has not been applied to production.** The readiness endpoint checks that the new column exists.

## Standout flow

1. Add a note or link in **Your interests**. Optional photo descriptions (Spark) and WAV voice transcription (Muse Voice) fill a private draft for review.
2. Confirm the suggested interests and explicitly choose which quotes can be used by connected friends in group plans. Nothing is shared by default.
3. Select connected friends and click **Find ideas**. The suggestions cite confirmed shared interests from at least two people. Revoked or changed evidence cannot be reused.
4. Create the plan. SerpApi searches the grounded theme, options retain source links and honest unknowns, and the worker refreshes connected calendars. Each current member must approve the same option and version.
5. After choosing an outing, open **Photo challenges and riddles** if the group wants activities. Shared progress records who completed each one; a changed selection needs new activities. Muse Image can add an illustration.
6. In **/studio**, authorized teammates edit instructions, allowed tools, and limits. Saving creates a new recipe version; subsequent runs load it, and traces retain their actual version, model calls, timing, tokens, and available cost estimates.

Text notes, manual availability, web chat, and ICS calendar downloads remain available without optional media or Google consent. Calendar event creation does not reserve a venue. Booking/payment integrations keep their explicit handoff and configuration boundaries.

## Run locally

Use Node **24.22.1** and pnpm **10.34.8**. Copy the privately supplied `.env.team` to `.env`, or fill the placeholders in `.env.example`. Real keys and the team file are Git-ignored.
Web dev/start and the worker automatically load the root `.env` and optional `.env.local`; externally supplied environment variables retain precedence.

```sh
pnpm install --frozen-lockfile
pnpm dev
# Separate terminal, same environment:
pnpm worker
```

The web app is at `http://localhost:3000`; match `APP_BASE_URL`, `BETTER_AUTH_URL`, and your Google OAuth redirect URI to that origin. Production uses **https://getsidequest.tech**. Register `https://getsidequest.tech/api/calendar/callback` in the Google OAuth web client before using Calendar there. Only the user grants Calendar consent; event titles never enter planning prompts.

`TEAM_ADMIN_PHONES` is a comma-separated list of approved E.164 numbers. Studio access is granted only after Better Auth verifies ownership of that phone. `TEAM_ADMIN_USER_IDS` also supports an explicit user-ID allowlist.

The shared Tiger service uses `sslmode=verify-full`. Its baseline is already initialized; never point the new baseline at the old service with the superseded schema. The worker uses the same encryption key and database as the web process.

## Checks and demo data

```sh
pnpm typecheck
pnpm typecheck:web
pnpm test
pnpm test:part3
pnpm test:accounts
pnpm test:part4
pnpm build
pnpm test:e2e
```

`DEMO_SEED=1 node --env-file=.env --env-file-if-exists=.env.local --import=tsx packages/agent/src/standout-demo.ts --verify-live` creates three clearly labeled synthetic accounts with no phone numbers, then exercises Common Ground → live SerpApi/Muse options → unanimous votes → quest → shared completion. It writes test plans to the configured database and consumes a small number of real provider calls. It sends no external messages or calendar events and makes no purchase. Do not treat this harness as a real phone-login test.

[Standout implementation checklist](docs/STANDOUT_IMPLEMENTATION.md) · [Technical contracts](CONTRACTS.md) · [Current status](STATUS.md) · [Deployment](docs/DEPLOYMENT.md)

---

## Original app and account implementation notes

Part 1 of the HackTX implementation plan. Includes phone sign-in, account onboarding/settings, friend invitations, and web views for plans, voting, private notes, payments and team Studio. The UI keeps the compact SideQuest design.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000/try to use the public example. Private pages require a verified session and a completed profile. Old preview links redirect to `/try`; the example never authenticates as another person.

## What works in this part

- Better Auth six-digit phone OTP, sessions, resend and attempt limits, signup and sign-out.
- PostgreSQL-backed own profiles, canonical Austin city/time zone, private interests, onboarding state.
- Encrypted invitation recipients, hashed invitation tokens, expiration, recipient-bound accept/decline, canonical friendship creation, request lists and invitation rate limits.
- Session-aware UI with loading/error/empty states, plan creation/comparison, acceptable votes and favorite, stale-plan handling, group/private messages, own-share view, buyer ledger, Calendar links, and team Studio views.

## External handoffs

Part 2 owns the shared database schema/migrations and plan/Studio APIs. Part 3 supplies private OTP delivery and Calendar handlers. Part 4 supplies quote, payment, wallet, booking and reimbursement APIs. This part calls those APIs and never substitutes fake live results when they are unavailable.

Accounts automatically initialize when `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ENCRYPTION_KEY` (32 bytes, base64), and `PHONE_LOOKUP_HMAC_KEY` (at least 32 characters) are set. Part 2 must apply the generated auth schema and the [account table requirements](docs/APP_ACCOUNTS_HANDOFF.md). Part 3 registers its private OTP sender through `configurePrivateOtpSender`. Credentials and migrations are not provisioned by this part.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
TEST_DATABASE_URL=postgresql://.../isolated_test_db pnpm test:integration
```

The browser suite covers account, voting, privacy, agent settings, interests, chat and the public example on desktop and mobile. Private journeys use controlled API responses; these are UI checks, not proof of live provider delivery. Playwright starts the built app automatically when no local server is running.

The integration test creates a randomly named schema, generates Better Auth tables inside it, and removes that schema afterward. It exercises real Better Auth sessions and real PostgreSQL persistence without contacting a messaging provider. It is skipped unless `TEST_DATABASE_URL` is set. Never point test commands at a production database.

[Integration handoff and remaining dependencies](docs/APP_ACCOUNTS_HANDOFF.md).

[Vultr deployment instructions](docs/DEPLOYMENT.md) cover Docker Compose, Caddy, SSH access, environment setup, and the distinction between the public preview and integrated live accounts.

[CI/CD](docs/CICD.md): pull requests run checks; successful pushes to `main` automatically deploy to the existing Vultr instance with health checks and rollback.
