# SideQuest

**Turning “we should hang out” into plans that fit everyone’s interests and schedules.**

SideQuest connects confirmed shared interests to real outings, helps the whole group agree on a time, and turns the chosen outing into a cooperative quest. The application uses Meta Muse, SerpApi, Tiger Postgres, and a reusable, versioned agent runner with Studio monitoring.

Production: **https://getsidequest.tech**. The public **[/demo](https://getsidequest.tech/demo)** is a read-only recorded journey with synthetic friends and real provider outputs. Private group interactions require verified phone sign-in. `/plans?preview=1` remains a separate UI sample, not a live backend test.

## Standout flow

1. Add a note or link in **What are you into?** Optional photo descriptions (Spark) and WAV voice transcription (Muse Voice) fill a private draft for review.
2. Confirm the suggested interests and explicitly choose which quotes can be used by connected friends in group plans. Nothing is shared by default.
3. Select connected friends and click **Find our thing**. Common Ground cites actual shared chips from at least two people. Revoked or changed evidence cannot be reused.
4. Create the plan. SerpApi searches the grounded theme, options retain source links and honest unknowns, and the worker refreshes connected calendars. Each current member must approve the same option and version.
5. Create a cooperative quest: three photo challenges and two riddles. Shared progress records who completed each challenge; a changed selection needs a new quest. Muse Image can generate a quest card.
6. In **/studio**, authorized teammates edit instructions, allowed tools, and limits. Saving creates a new recipe version; subsequent runs load it, and traces retain their actual version, model calls, timing, tokens, and available cost estimates.

Text notes, manual availability, web chat, and ICS calendar downloads remain available without optional media or Google consent. Calendar event creation does not reserve a venue. Booking/payment integrations keep their explicit handoff and configuration boundaries.

## Run locally

Use Node **24.22.1** and pnpm **10.34.8**. Copy the privately supplied `.env.team` to `.env`, or fill the placeholders in `.env.example`. Real keys and the team file are Git-ignored.
Web dev/start and the worker automatically load the root `.env` and optional `.env.local`; externally supplied environment variables retain precedence. Local workers do not open the production Claw listener. The hosted worker is the sole production listener. For a real local iMessage run, `live-agent.ts` requires a separate Claw account, `CLAW_DEV_MESSENGER_API_KEY`, `CLAW_DEV_MESSENGER_FROM_PHONE`, and `LIVE_AGENT_ALLOW_CLAW_LISTENER=true`; another API key in the production Claw account is not isolated.

```sh
pnpm install --frozen-lockfile
pnpm dev
# Separate terminal, same environment. Claw listening stays disabled locally by default:
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

Open http://localhost:3000. Live pages require a verified session and a completed profile. The sample workspace is explicitly separate at http://localhost:3000/plans?preview=1; it never authenticates a demo account.

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

The browser suite runs six journeys on desktop and mobile with controlled API responses; it tests the UI independently of provider services. Playwright starts the built app automatically when no local server is running.

The integration test creates a randomly named schema, generates Better Auth tables inside it, and removes that schema afterward. It exercises real Better Auth sessions and real PostgreSQL persistence without contacting a messaging provider. It is skipped unless `TEST_DATABASE_URL` is set. Never point test commands at a production database.

[Integration handoff and remaining dependencies](docs/APP_ACCOUNTS_HANDOFF.md).

[Vultr deployment instructions](docs/DEPLOYMENT.md) cover Docker Compose, Caddy, SSH access, environment setup, and the distinction between the public preview and integrated live accounts.

[CI/CD](docs/CICD.md): pull requests run checks; successful pushes to `main` automatically deploy to the existing Vultr instance with health checks and rollback.
