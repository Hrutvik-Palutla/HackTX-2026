# Part 1 · App & Accounts handoff

## Shipped scope

The live UI is session-aware. A signed-out visitor sees phone sign-in; a verified account without a completed profile sees onboarding. Settings save to `/api/me`; friends use real account endpoints. Profile data and live views are never populated with preview identities. `/plans?preview=1` is an explicitly separate sample UI.

All routes in the Part 1 screen list exist: `/signup`, `/login`, `/friends`, `/invite/:token`, `/settings`, `/plans`, `/plans/:id`, `/plans/:id/private`, `/plans/:id/payment`, `/studio`. Pages are dynamic. Account responses use `Cache-Control: private, no-store`.

UI for other parts uses their contracted endpoints, including create plan, compare options, acceptable options and favorite, none acceptable, group/private messages, own repayment acknowledgment, buyer receipt acknowledgment and quote approval, Calendar connection, and Studio templates/redacted runs. A stale vote/message (409) refreshes the plan and asks the user to review. Private/payment views are fetched only for their routes and reject a mismatched viewer. Buyer ledger rendering requires the viewer to be the nominated buyer. Studio relies on Part 2's API allowlist enforcement.

These are UI clients, not implementations of the other parts' services. Missing services show an error/unavailable state. There are no fake live payment confirmations, sourced venues or run records.

## Part 2: schema and database

`packages/accounts/src/postgres.ts` implements `AccountRepository` against PostgreSQL. `apps/web/lib/auth/runtime.ts` lazily creates a small pg pool and Better Auth instance. There is no second user store and no production auto-migration. SQL is parameterized. The schema must use the column names below, or Part 2 must map its canonical columns in this repository during integration.

Generate Better Auth's tables from the pinned `createAccountAuth` configuration, including phone-number fields, `city` string, `interests` JSON, `onboardingComplete`, and the database rate-limit table. To print the missing auth DDL without applying it:

```sh
DATABASE_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... pnpm accounts:schema
```

This read-only command uses Better Auth's migration compiler. Part 2 folds the output into its migrations. `city` is a JSON-encoded string containing the resolved City object; `interests` is the generated JSON column, not a PostgreSQL text array. IDs are server-generated UUID strings. Auth fields use Better Auth's generated camelCase names (`phoneNumber`, `phoneNumberVerified`, `updatedAt`, `onboardingComplete`).

The following are **schema requirements**, not independently applied migrations:

```sql
CREATE TABLE friendships (
  user_low_id text NOT NULL REFERENCES "user"(id),
  user_high_id text NOT NULL REFERENCES "user"(id),
  requested_by text NOT NULL REFERENCES "user"(id),
  status text NOT NULL CHECK (status IN ('accepted')),
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);
CREATE TABLE friend_invites (
  id uuid PRIMARY KEY,
  inviter_id text NOT NULL REFERENCES "user"(id),
  recipient_phone_encrypted text NOT NULL,
  recipient_phone_digest text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('pending','accepted','declined')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX friend_invites_recipient ON friend_invites(recipient_phone_digest,state);
CREATE INDEX friend_invites_inviter ON friend_invites(inviter_id,created_at);
CREATE INDEX friendships_high ON friendships(user_high_id);
```

Invites expire after seven days. Acceptance updates a pending, unexpired row for the authenticated verified recipient and creates one canonical friendship in the same transaction. Concurrent acceptance permits one transition. A copied invitation token cannot substitute for the recipient's verified phone. Unknown and expired requests return the same generic 404. Phones use AES-256-GCM with random nonces and domain-specific AAD; lookups use a separate HMAC key. Token plaintext is returned once to the inviter as a private share link and never appears in request lists. Invitation creation is serialized per inviter and capped at 20/hour across app processes. The response does not reveal whether the recipient has an account.

For runner resumption, Part 2 can register `configureFriendshipAccepted(async (tx, {inviterId,recipientId}) => { ... })` from `apps/web/lib/auth/runtime.ts`. The callback runs inside the acceptance transaction; enqueue the durable resume effect through that SQL connection. A failure must roll back the acceptance. `accountService(repo).participants(actor, ids)` validates and deduplicates connected participant IDs; listFriends and connected are also available to the planner.

## Part 3: private OTP and Calendar

At server startup, register `configurePrivateOtpSender(sender)` from `apps/web/lib/auth/runtime.ts`. For example, import Part 3's sender in Next instrumentation's Node register function and register it before requests arrive. The sender signature is:

```ts
(message: {
  phoneE164: string;
  code: string;
  expiresInSeconds: number; // 300
  purpose: "account_verification";
}) => Promise<void>;
```

Durably enqueue private delivery before resolving; reject on failure. Never log the code, put it in prompts, or send it to a group. Better Auth owns generation, verification, attempts, five-minute expiry and session cookies. The UI enforces a resend cooldown in addition to the library's server limits. There is no public test-code endpoint, console-code login, or OTP bypass.

Environment values: `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 random characters), `BETTER_AUTH_URL` (canonical app origin), `APP_ENCRYPTION_KEY` (32 random bytes encoded as base64), `PHONE_LOOKUP_HMAC_KEY` (separate random key, at least 32 characters). Keep TLS verification enabled in the provisioned connection string and configure the proxy so the canonical origin reaches the app. Part 3 still owns the shared env example, deployment and provider credentials.

Calendar connect/disconnect links use Part 3's `/api/calendar/*` handlers. The default account repository currently reports `calendarConnected: false`; Part 3 must supply its actual connection state through the shared own-profile projection or a wrapped repository. No Calendar provider is implemented in this part.

## Parts 2 and 4: app projections

`apps/web/lib/views.ts` contains app-local projection types from CONTRACTS.md, **not a competing shared contracts package**. Part 2 should replace these imports with shared DTO exports when published, or map its response to them. The success envelope is `{data,revision?}`. The plan view expects `revision`, `activeVersionId`, `options`, `participants`, `votes`, `sources`, `mode`, `status`, and `request`. Vote writes use `versionId`, `acceptableOptionIds`, `favoriteOptionId`, and `noneAcceptable`.

The private view expects `{ownerUserId,facts,messages?}`. Payment expects `{viewerUserId,buyerUserId,ownShare,buyerLedger?,quote?,booking?}`. Repayment status and manual receipt labels follow CONTRACTS.md; the frontend never labels a payer report provider verified. Quote approval consumes a server-provided HTTPS approval URL. Wallet execution, quotes, share arithmetic and booking remain Part 4-owned. The UI cannot authorize a purchase by itself.

Studio reads `/api/studio/templates` and `/api/studio/runs`; those APIs must enforce the team allowlist and return redacted data. A web tab or frontend viewer check is not an authorization boundary. Plan membership, private projection, revision and financial authorization checks remain mandatory in the owning server handlers.

## Validation and limits

Eight unit tests cover normalization, verification gates, actor-only profiles, recipient-bound request resolution, generic invitations, profile validation, server-resolved city and connected participant resolution. A PostgreSQL integration test generates actual Better Auth tables in an isolated schema and checks OTP signup, real sessions, profile persistence, encrypted/hashed invitation storage, wrong-recipient denial, expiration, replay, concurrent acceptance, canonical friendships, cross-account friend isolation, own-profile responses and CSRF.

Twelve browser checks (six journeys on desktop/mobile) exercise signup/onboarding, persistent account UI, invitation actions, stale votes, private projection handling, repayment privacy, and the redacted Studio inspector with controlled API responses. They do not substitute for server integration checks.

Real phone delivery, deployed cookies, Calendar grants, live planner/vote state, live Studio access and financial provider flows require their assigned owners' integrations and have not been claimed as live-tested. Austin is the sole resolved city; arbitrary city text is rejected until a city resolver/curated list is added. Preview interactions remain local and reset on navigation.
