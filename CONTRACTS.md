# Shared Technical Contracts

## Standout integration addendum — October 25

- `GET /api/demo` is a read-only public fixture, not an authentication bypass: only a selected test-mode plan from `sidequest_demo_alex` qualifies; every member must have a `sidequest_demo_` ID, `@demo.sidequest.invalid` email and no phone. No arbitrary plan ID is accepted. The UI labels synthetic people, recorded provider results and simulated completions. Tests reject real phones or email addresses in that fixture.
- `POST /api/plans/:id/buyer` lets a verified member volunteer only themselves for the current decision, with `expectedRevision`. A different existing buyer cannot be replaced through this endpoint. Part 4 uses the same verified session/membership and current selected plan, with a Postgres repository. Direct wallet purchasing is disabled; sourced merchant handoff is explicit and does not claim a reservation.
- Browser voice uploads decode/resample to mono PCM16 WAV at 16 kHz. The server validates RIFF chunks, PCM16, mono, 16/24 kHz, duration <=120 seconds and <=8 MB before the Meta request. Text is the fallback. Image/voice provider costs are explicitly unknown and excluded from Spark cost estimates.

- Template IDs now include `drop-extraction`, `common-ground`, and `quest`. The existing `agent_templates` table persists full versioned configurations. Server code validates tool allowlists and bounded limits; planner, conversation, extraction, matching, and quest runs load the current saved recipe. Existing runs retain the recipe version used.
- `GET/POST /api/drops`; `PATCH/DELETE /api/drops/:id`: authenticated owner only, same-origin mutations. Extraction receives the submitted note/link text, never an implicitly fetched page. Evidence is checked against the submitted text. Chips start unconfirmed and unshared; edits preserve evidence and IDs, and sharing requires confirmation.
- `POST /api/common-ground` takes connected `friendIds`. Only confirmed shared chips are sent to Muse. Every cited chip must exist, with at least two distinct owners. Names and quotes are joined by code, not invented by the model. `POST /api/plans` optionally takes `commonGroundId`; member IDs and current sharing are rechecked, then the exact grounded query reaches SerpApi. `GET /api/plans/:id/common-ground` is membership protected and suppresses revoked evidence.
- `GET/POST/PATCH /api/plans/:id/quest`: membership required. The quest belongs to the selected option and version; changed or removed selections invalidate it. Generation uses a fixed three-photo/two-riddle format, current shared interests, and the selected sourced option. Progress updates lock the plan row; completions carry an authenticated user ID and timestamp. Only the completing user can undo their completion. A recap displays their current group-visible name.
- `GET/PUT /api/studio/templates/:id`: team allowlist enforced on the server. PUT carries `expectedVersion`, instructions, allowed tools, and limits; concurrent saves reject stale versions. `TEAM_ADMIN_PHONES` may designate teammates, but only after a verified session proves phone ownership.
- Optional media: `POST /api/drops/photo` accepts an inline PNG/JPEG/WebP under 1 MB; no remote URL is fetched. `POST /api/drops/voice` accepts a WAV under 8 MB. Both return a private draft for owner review, not automatically shared facts. `POST /api/plans/:id/quest/art` generates and caches a PNG card for the current quest. Each account has eight optional media requests in this hackathon build. Voice/Image costs unavailable from those endpoints are explicitly labeled and excluded from the Spark estimate.
- Storage reuses encrypted `private_facts` with internal kinds `interest_drop`, `common_ground`, `quest`, and `media_usage`. These internal records never enter the existing private-constraint parser or another user's private API response. No new database service or schema migration is needed.
- Plan selection now requires **all current participants** to have an acceptable vote for the same option/version. It cannot silently drop a participant. Vote updates and decisions lock the plan row to serialize competing decisions and approval changes. Explicit roster edits remain the existing organizer action.
- Calendar writes check membership and current selected version, recheck the caller's current busy intervals, and reject conflicts or unavailable verification. Retrying an already-synced version returns its existing event ID. ICS remains the manual-review fallback; creation never implies a reservation.
- Deployment includes the Node 24 worker under Compose's `live` profile, encrypted GitHub runtime settings, preserved server environment/certificate volumes, and revision-bearing `/health/live` plus database `/health/ready` checks. Secrets remain outside source control.

Proposed v1 contract for the architecture in [ARCHITECTURE.md](ARCHITECTURE.md). Part 2 (Agent & Backend) owns this file, `packages/contracts`, and shared database migrations; other parts supply their feature requirements. Cross-part schema changes are reviewed with affected owners. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the four selectable parts and route ownership. The declarations below describe our application, not vendor SDK methods. Implement them as Zod schemas and inferred TypeScript types. Dependency versions and actual vendor payload fixtures are pinned during the access spikes.

## 1. Representation and invariants

- IDs are opaque strings. User IDs follow Better Auth's generated schema; application entity IDs are server-generated UUIDs. Never derive identity from a display name.
- Time instants are ISO 8601 UTC strings; every outing also has an IANA time zone. Intervals are `[start,end)`. Phone numbers are E.164.
- Money is integer minor units. Initial automated purchases/splits use USD cents. Other currencies can be displayed as sourced but use checkout handoff until their arithmetic/provider path is supported; no implicit currency conversion.
- `null` means unknown, not zero, free, or available. A source quote, an estimate, and a computed value have different provenance.
- Every mutation takes an authenticated actor. Plan-affecting mutations carry `expectedRevision`; option/vote/quote operations additionally bind the immutable version ID.
- Friend connections gate initial proposal generation; individual participation approval is not an additional gate. Known objections/constraints and payment permissions remain enforceable.
- Each option, vote, selection, quote, buyer approval, and booking is attached to a specific version. An accepted friend or native-chat member does not automatically authorize payment.
- Provider responses and callbacks are untrusted until authenticated, schema-checked, and associated with the correct account/plan. Raw source text cannot authorize a tool action.

## 2. Core types

```ts
type Id = string;
type Instant = string;
type Mode = 'live' | 'test';
type Money = { amountMinor: number; currency: 'USD' };
type Interval = { startAt: Instant; endAt: Instant };

type ActorContext = {
  userId: Id;
  source: 'web' | 'group_message' | 'private_message' | 'provider_event';
  conversationId?: Id;
  sourceMessageId?: Id;
  // Resolved by trusted middleware/worker; never accepted from a model/JSON body.
};

type City = {
  label: string;                // e.g. Austin, Texas, United States
  countryCode: string;
  latitude: number | null;      // city centroid only
  longitude: number | null;
  timeZone: string;
};

type PublicPerson = { id: Id; name: string; avatarUrl: string | null };
type OwnProfile = PublicPerson & {
  phoneE164: string;
  phoneVerified: boolean;
  city: City;
  interests: string[];
  calendarConnected: boolean;
};

type Source = {
  id: Id;
  url: string;
  title: string;
  fetchedAt: Instant;
  provider: 'serpapi_google' | 'serpapi_maps' | 'serpapi_events'
    | 'serpapi_extract' | 'merchant';
  providerSearchId: string | null;
};

type Evidence = {
  field: string;
  origin: 'source' | 'user' | 'computed' | 'estimate';
  sourceId: Id | null;
  sourceMessageId: Id | null;
};

type Candidate = {
  id: Id;
  kind: 'movie_screening' | 'event' | 'venue';
  title: string;
  venueName: string;
  address: string | null;       // venue address, never a home address
  timeZone: string;
  startAt: Instant | null;      // required for a confirmed screening/event time
  durationMinutes: number | null;
  format: string | null;
  price: Money | null;          // only a supported USD amount; see raw currency
  rawPriceText: string | null;
  rawCurrency: string | null;
  priceKind: 'quoted' | 'listed' | 'estimated' | 'unknown';
  bookingUrl: string | null;    // validated merchant URL; not a SERP link
  sourceIds: Id[];
  evidence: Evidence[];
};

type PlanOption = {
  id: Id;
  versionId: Id;
  label: 'A' | 'B' | 'C';
  title: string;
  candidateIds: Id[];
  startAt: Instant;
  endAt: Instant;
  timeZone: string;
  timeline: { title: string; startAt: Instant; endAt: Instant; candidateId: Id }[];
  estimatedPerPerson: Money | null;
  priceKind: Candidate['priceKind'];
  fit: 'fits_known_constraints' | 'needs_clarification';
  uncertainties: string[];      // sanitized for group display
  publicExplanation: string;   // no personal/private attribution
  sourceIds: Id[];
};

type PrivateFactBase = {
  id: Id;
  ownerUserId: Id;
  planId: Id | null;
  sourceMessageId: Id | null;
  updatedAt: Instant;
  supersededBy: Id | null;
};
type PrivateFact = PrivateFactBase & (
  | {kind: 'availability'; value: {
      window: Interval; available: Interval[] | null; unavailable: Interval[];
      certainty: 'explicit' | 'tentative';
    }}
  | {kind: 'spending_limit'; value: {maximumShare: Money}}
  | {kind: 'preference'; value: {key: string; value: string | string[]; strength: 'soft' | 'hard'}}
  | {kind: 'requirement'; value: {key: string; value: string; supportedCheck: string | null}}
);

type Vote = {
  userId: Id;
  versionId: Id;
  acceptableOptionIds: Id[];
  favoriteOptionId: Id | null;
  noneAcceptable: boolean;
  source: 'native_poll' | 'message' | 'web';
  sourceEventId: string;
};

type PlanStatus = 'waiting_connections' | 'planning' | 'clarifying' | 'voting'
  | 'selected' | 'quoting' | 'awaiting_payment_approval' | 'booking'
  | 'booked' | 'needs_handoff' | 'change_requested' | 'closed';

type Selection = {
  versionId: Id;
  optionId: Id;
  attendeeUserIds: Id[];
  evidenceMessageIds: Id[];     // author/context establishing proceed/headcount
  buyerUserId: Id | null;
};
```

`favoriteOptionId` must be among acceptable choices. `noneAcceptable` excludes other choices. A native poll update affects acceptable choices; it does not erase an independently supplied favorite unless that favorite is no longer acceptable. Participant-added native poll options require candidate validation and a new plan version before becoming bookable.

## 3. Fulfillment types

```ts
type BookingQuote = {
  id: Id;
  planId: Id;
  versionId: Id;
  optionId: Id;
  attendeeUserIds: Id[];
  buyerUserId: Id;
  merchantHost: string;
  merchantUrl: string;
  performanceRef: string | null;
  seatRefs: string[];
  lineItems: { attendeeUserId: Id; label: string; amount: Money }[];
  sharedFees: Money;
  sharedDiscount: Money;
  total: Money;
  expiresAt: Instant;
  bindingHash: string;
  mode: Mode;
};

type BuyerAuthorization = {
  id: Id;
  quoteId: Id;
  buyerUserId: Id;
  walletRequestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled';
  approvedBindingHash: string | null;
  checkedAt: Instant;
  mode: Mode;
};

type BookingResult = {
  id: Id;
  planId: Id;
  versionId: Id;
  quoteId: Id | null;          // may be absent for external checkout handoff
  authorizationId: Id | null;  // required for our agent-executed purchase
  status: 'submitting' | 'merchant_confirmed' | 'failed' | 'outcome_unknown'
    | 'handoff_required' | 'buyer_reported' | 'test_confirmed';
  merchantOrderRef: string | null;
  confirmationUrl: string | null;
  actualTotal: Money | null;
  mode: Mode;
};

type Reimbursement = {
  id: Id;
  bookingId: Id;
  payerUserId: Id;              // person repaying their share
  recipientUserId: Id;          // original group buyer
  amount: Money;
  paymentUrl: string | null;
  status: 'draft' | 'requested' | 'payer_reported_sent'
    | 'buyer_confirmed_received' | 'voided';
  confirmationSource: 'none' | 'manual_buyer';
  mode: Mode;
};
```

The quote hash covers version, option, exact named attendee set, buyer, host/performance, seats, currency, line items, and total. Any material change invalidates the binding. A provider approval must belong to that buyer's linked wallet and that quote; the model cannot mark it approved. The browser worker receives a short-lived internal credential handle, never a card serialized in these DTOs. `test_confirmed` can never set live plan status to `booked`. `buyer_reported` records a buyer-supplied receipt/reference and total after handoff; the UI distinguishes it from merchant confirmation, while allowing shares/calendar follow-through. Handoff-only records may have a null authorization ID because our wallet did not execute the purchase.

## 4. Database model

Use foreign keys and timestamps throughout. Sensitive values are encrypted with authenticated encryption; use separate domain keys/associated data for OAuth, wallet auth, and private facts. Application DB access is server-only.

| Table | Key data and constraints |
|---|---|
| Better Auth tables | Generate `user`, session/account/verification tables from the pinned config. Add phone verified, city, interests, onboarding completion through supported schema extensions. No separate competing user table. |
| `messaging_identities` | `user_id`, provider, external handle, kind, verified_at; unique `(provider,handle)`. |
| `friendships` | Canonical low/high user IDs, requested_by, status, accepted_at; unique pair; no self edge. |
| `friend_invites` | Inviter, encrypted recipient phone + keyed lookup digest, token hash, state, expires_at; acceptance binds the authenticated recipient. |
| `conversations` | Provider, external chat ID, sending line, kind, active_plan_id; unique provider/line/chat. |
| `conversation_members` | Conversation, messaging identity or unresolved handle, current membership. Never used alone as friendship proof. |
| `plans` | Organizer, request, template_id (`movie-night`/`local-outing`), city/zone/date window, status, input_revision, active_version_id, selected_option_id, mode. |
| `plan_participants` | Plan, user nullable while invited, invite reference, requested name, attendance state; unique `(plan,user)` when resolved. All resolve before proposals. |
| `plan_conversations` | Plan, conversation, audience/owner; one group or several private conversations can point to the same plan. |
| `messages` | Provider message ID, conversation, sender, timestamp, encrypted private body or public body, reply reference; unique provider/line/message. Store only received context needed for the plan. |
| `private_facts` | Owner, optional plan, kind, encrypted structured value, provenance, superseded_by. Owner/server feasibility layer access only. |
| `calendar_connections` | User, encrypted refresh token, granted scopes, primary-only setting, status; unique user. |
| `availability_snapshots` | User/plan, normalized intervals, source type, fetched_at, validity/errors; never calendar titles. |
| `sources`, `candidates` | Normalized source metadata and candidate facts/evidence; search/extract cache keys and expiry. Raw payloads redacted and size bounded. |
| `plan_versions`, `plan_options` | Immutable version number + input revision + options; unique `(plan,version_number)` and `(version,label)`. |
| `polls`, `votes`, `vote_states` | Poll message ID to version mapping; superseded poll flag. `votes`: one row per acceptable option, unique `(version,user,option)`. `vote_states`: favorite, noneAcceptable, and objection per `(version,user)`. |
| `plan_decisions` | Selection, named attendees, author/evidence message IDs, version, recorded_at. |
| `booking_quotes`, `buyer_authorizations`, `bookings` | Types above; unique submitted authorization/effect binding; actual merchant status separate from wallet status. |
| `wallet_connections` | User, provider, encrypted auth context, status; no card number/CVC. |
| `reimbursements` | One nonbuyer share per booking/payer; unique `(booking,payer)`; receipt source explicit. |
| `calendar_events` | Plan/user, provider event ID or ICS UID, version, sync status; unique `(plan,user)`. |
| `inbound_events` | Provider event ID, authenticated envelope hash/payload, state; unique `(provider,event_id)`. |
| `jobs` | Kind, plan, dedupe_key, payload, run_after, lease_until, attempts, state; unique dedupe_key. Index runnable jobs. |
| `outbox` | Typed recipient, plan/version, effect key, encrypted private body, provider message ID, delivery status. OTP bodies expire and are removed after delivery/expiry. |
| `external_effects` | Unique operation key, kind, plan/quote, reserved/inflight/confirmed/unknown, provider request ID, reconciliation data. |
| `agent_templates`, `agent_runs`, `run_steps` | Template configuration/version, model, run task (`plan`/`repair`/`discuss`), input revision, redacted outcomes, token/search/cost counters. No raw private prompts. |
| `usage_reservations` | Provider, run, reserved/actual cost or quota units; prevents concurrent runs overspending local envelopes. |

One relational store is intentional. Use JSONB for evolving provider payloads/typed fact values, not for relationships that need membership checks or uniqueness. Restrict app-side repositories by actor and return projection-specific DTOs. Do not expose a generic SQL tool to Muse.

## 5. Public, private, and buyer projections

`GET /plans/:id` returns participant names/IDs, public request, options, current votes, selection/headcount, public booking status, and sources. It excludes phone numbers, profile interests, private facts/messages, calendars, credentials, and individual payment details.

`GET /plans/:id/private` returns only the session owner's facts, questions, and own availability settings. `GET /plans/:id/payment` returns their own reimbursement or buyer authorization. The original buyer can see the purchase and all reimbursement amounts/statuses for that purchase. Other participants cannot see the buyer's wallet or someone else's payment request.

Team-only run inspector returns redacted execution metadata. Access is controlled by a server-side allowlist of team account IDs; never a query parameter or a client-only hidden route.

## 6. HTTP API

All routes below are `/api` paths except health. Use `{data,revision?}` for success and `{error:{code,message,retryable},requestId}` for errors. Auth endpoints are the generated Better Auth routes, not a custom implementation of its protocol.

| Method/path | Body or result | Authorization |
|---|---|---|
| `ALL /auth/[...all]` | Better Auth phone OTP/session handlers | Library validation and rate limits |
| `GET /me`, `PATCH /me` | OwnProfile/profile fields | Own session; interests private |
| `GET /friends` | Accepted friends/pending requests | Own session |
| `POST /friend-requests` | `{phoneE164,displayName?}` -> request ID | Inviter; generic result avoids account enumeration |
| `POST /friend-requests/:id/accept` | Invite token or recipient request ID | Verified intended recipient |
| `POST /friend-requests/:id/decline` | No plan mutation to unrelated accounts | Intended recipient |
| `GET /calendar/connect` | Google consent redirect | Own session + one-time state |
| `GET /calendar/callback` | Code/state exchange; redirect to settings | State/session binding |
| `DELETE /calendar/connection` | Disconnect and delete token | Own session |
| `POST /plans` | `{request,participantUserIds?,participantNames?,conversationId?,mode}` -> plan/job | Requester; core resolves friends before planning |
| `GET /plans`, `GET /plans/:id` | Membership-filtered public projections | Plan member/organizer |
| `POST /plans/:id/messages` | `{text,scope:'group'\|'private'}` -> message ID; agent replies asynchronously in the same web thread | Member; private scope belongs to actor |
| `GET /plans/:id/messages` | Plan's web group thread + caller's own private thread | Member; never another member's private thread |
| `PUT /plans/:id/vote` | Version + acceptable IDs/favorite/none | Actor's own vote only |
| `POST /plans/:id/decision` | Version, option, named attendees, evidence IDs | Member; core verifies group context; no financial authority implied |
| `PATCH /plans/:id/participants` | Added/removed users + expectedRevision | Organizer before booking; new users must connect |
| `POST /plans/:id/close` | expectedRevision | Organizer for unbooked plan |
| `GET /plans/:id/private` | Own private projection | Actor only |
| `PUT /plans/:id/private` | `{fact: PrivateFactValue, expectedRevision?}`: manual availability, limit, or preference (no-calendar fallback); re-plans if options exist | Actor only; owner is always the session user |
| `GET /plans/:id/payment` | Own share/buyer view | Projection-specific |
| `POST /plans/:id/quotes` | `{versionId,optionId,buyerUserId,seatPreference?,expectedRevision}` -> job | Member; buyer confirms their role |
| `POST /wallet/connect` | Start provider user-link flow | Buyer account + session-bound nonce |
| `GET /wallet/callback` | Resume/check actual connection state | Nonce; callback alone is not proof |
| `POST /quotes/:id/approval` | `{expectedRevision}` -> approval URL/status | Nominated buyer only |
| `POST /quotes/:id/book` | Authorization ID + binding hash -> job | Core checks buyer/provider approval and current quote |
| `POST /bookings/:id/report-completed` | Buyer-supplied total and order reference after handoff | Nominated buyer only; records buyer-reported evidence, not merchant verification |
| `POST /reimbursements/:id/report-sent` | Manual payer statement | That payer only |
| `POST /reimbursements/:id/confirm-received` | Manual receipt confirmation | Original buyer only |
| `POST /plans/:id/calendar` | Own write request or ICS result | Actor's own calendar grant |
| `GET /plans/:id/calendar.ics` | Own authenticated ICS download | Plan member |
| `POST /plans/:id/change-requests` | `{text,expectedRevision}` -> conversation/job | Member; extra charge requires buyer |
| `POST /webhooks/linq` | Provider raw payload | Valid signature, timestamp, event dedupe |
| `POST /webhooks/telegram` | Enabled fallback only | Secret header + update dedupe |
| `GET /studio/templates`, `GET /studio/runs` | Redacted data | Team allowlist |
| `GET /health/live`, `GET /health/ready` | Minimal health result | Public, no private configuration |

Conflict rules: stale revision/version returns `409 STALE_PLAN`; unauthorized actor is `403`; invalid fields `400`; unresolved prerequisites `422`; local spend/quota ceiling `429 BUDGET_LIMIT` or `429 QUOTA_LIMIT`; upstream provider failure `502 PROVIDER`; unexpected server error `500 INTERNAL`. A private resource not visible to the caller returns a generic `404`. Phone signup/login responses are generic. External provider errors are mapped to redacted retryable/nonretryable errors.

## 7. Normalized events and adapter ports

```ts
type InboundMessage = {
  provider: 'linq' | 'telegram';
  eventId: string;
  messageId: string;
  conversationExternalId: string;
  conversationKind: 'group' | 'private';
  senderHandle: string;
  senderKind: 'phone' | 'email' | 'telegram_id';
  text: string;
  occurredAt: Instant;
  replyToMessageId: string | null;
};

type OutboundRecipient =
  | { kind: 'group'; conversationId: Id }
  | { kind: 'private'; userId: Id; conversationId?: Id }
  | { kind: 'invite'; invitationId: Id }; // only connection/onboarding content

interface MessagingPort {
  capabilities: {
    createGroup: boolean; coldInvite: boolean; nativePoll: boolean;
    identifiedVotes: boolean; contextualGroupMessages: boolean;
  };
  sendText(recipient: OutboundRecipient, text: string, effectKey: string): Promise<{messageId: string}>;
  createGroup(memberHandles: string[], introText: string, effectKey: string): Promise<{chatId: string}>;
  publishPoll(chatId: string, versionId: Id, labels: string[], effectKey: string): Promise<{messageId: string}>;
  readPoll(messageId: string): Promise<unknown>; // normalize to actual voter IDs
}

interface DiscoveryPort {
  searchMovie(input: {title: string; city: City; window: Interval}): Promise<Candidate[]>;
  searchOutings(input: {query: string; city: City; window: Interval}): Promise<Candidate[]>;
  extractPublicPage(url: string): Promise<{source: Source; facts: unknown}>;
}

interface CalendarPort {
  getBusy(userId: Id, window: Interval): Promise<{
    busy: Interval[]; fetchedAt: Instant; status: 'ok'|'disconnected'|'error';
  }>;
  upsertOwnEvent(userId: Id, planId: Id, versionId: Id): Promise<{eventId: string}>;
}

interface WalletPort {
  startConnect(userId: Id): Promise<{url: string; phrase?: string; connectionId: Id}>;
  checkConnection(userId: Id): Promise<'pending'|'connected'|'revoked'>;
  requestPurchaseApproval(quoteId: Id): Promise<{authorizationId: Id; approvalUrl: string}>;
  refreshAuthorization(authorizationId: Id): Promise<BuyerAuthorization>;
  // Credential retrieval is a separate trusted internal routine, not an LLM tool.
}

interface BookingPort {
  quote(input: {selection: Selection; seatPreference?: string}): Promise<BookingQuote>;
  submit(quoteId: Id, authorizationId: Id): Promise<BookingResult>;
  reconcile(bookingId: Id): Promise<BookingResult>;
}
```

Adapters may report a capability false even when the vendor advertises it: the account must actually have the entitlement. Optional methods return an explicit unsupported result; they never pretend that a shared web link created a native group. The adapter layer translates exact pinned SDK shapes to these ports. On poll-change events, reconcile the authoritative tally before storing votes so a delayed event cannot overwrite a newer toggle.

## 8. Jobs, tool effects, and permission checks

Job kinds: `process_inbound`, `resume_connections`, `plan`, `repair`, `send_outbox`, `poll_reminder`, `refresh_wallet`, `quote_booking`, `submit_booking`, `reconcile_booking`, `sync_calendar`, `create_reimbursements`, `handle_change`, `publish_poll` (payload `{planId, versionId, conversationId, labels}`; Part 3 posts the native poll in A, B, C order and calls `registerPoll`).

For every job: claim lease -> read current context/revision -> bounded external work -> validate -> short transaction to compare revision, write state/effects, and enqueue outgoing work -> complete. Refresh the lease while active. Reclaimed jobs must tolerate repeating read work; mutations use effect keys and authoritative provider reconciliation.

An `external_effects` row with unique key is reserved before a wallet request/purchase/send. It records provider IDs as soon as available. A local unique key does not guarantee exactly-once external execution across a network crash. If the provider lacks idempotency/reconciliation for that action, mark it unknown and ask the operator/buyer rather than issuing another purchase automatically.

Model tools use the same core services as HTTP commands. A tool may propose a selection but cannot forge its evidence messages, change a different user's vote, read arbitrary private facts, approve a wallet, or set a merchant-confirmed result. The execution layer injects verified sender context and checks plan membership before loading any tool data.

## 9. Templates and run records

```ts
type AgentTemplate = {
  id: 'movie-night' | 'local-outing';
  version: number;
  model: string;
  systemInstruction: string;
  allowedTools: string[];
  limits: {maxTurns: number; maxTools: number; maxSearches: number};
  outputSchemaVersion: 1;
};
type RunStep = {
  runId: Id;
  index: number;
  kind: 'model'|'tool'|'validation'|'state_change';
  name: string;
  durationMs: number;
  inputRevision: number;
  outcome: 'ok'|'error'|'stale'|'waiting';
  sourceIds: Id[];
  redactedSummary: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
```

Use `CONTRACT_VERSION=1` on stored payloads. Contracts are validated on ingress and before persistence/publication. The run inspector shows an execution record, not hidden chain of thought or raw private model input. The templates use the same model client, tool registry, state handling, and observability path.
