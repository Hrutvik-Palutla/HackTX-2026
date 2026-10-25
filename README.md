# SideQuest · App & Accounts

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
