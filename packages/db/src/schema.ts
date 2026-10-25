// Single shared schema (Part 2 owns migrations). Other parts request columns; they don't fork tables.
// Encrypted columns (`*_enc`) hold AES-256-GCM envelopes from @hacktx/core/crypto, never plaintext.
import { sql } from 'drizzle-orm';
import {
  pgTable, text, uuid, timestamp, boolean, integer, bigint, jsonb, numeric,
  primaryKey, unique, uniqueIndex, index, check, type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () => ts('updated_at').notNull().defaultNow();
const pk = () => uuid('id').primaryKey().defaultRandom();

// ---------- Better Auth (core + phone-number plugin + database rate limit) ----------
// Mirrors the DDL printed by Part 1's `pnpm accounts:schema` (Better Auth's own migration compiler) exactly,
// including camelCase column names, because Part 1's account repository queries these columns directly.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(), // synthetic `.invalid` address; never a contact
  emailVerified: boolean('emailVerified').notNull(),
  image: text('image'),
  createdAt: ts('createdAt').notNull().defaultNow(),
  updatedAt: ts('updatedAt').notNull().defaultNow(),
  phoneNumber: text('phoneNumber').unique(), // E.164
  phoneNumberVerified: boolean('phoneNumberVerified'),
  city: text('city'), // JSON-encoded contracts City (Better Auth string field); parse with parseCity()
  interests: jsonb('interests').$type<string[]>(),
  onboardingComplete: boolean('onboardingComplete'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: ts('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: ts('createdAt').notNull().defaultNow(),
  updatedAt: ts('updatedAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (t) => [index('session_userId_idx').on(t.userId)]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: ts('accessTokenExpiresAt'),
  refreshTokenExpiresAt: ts('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: ts('createdAt').notNull().defaultNow(),
  updatedAt: ts('updatedAt').notNull(),
}, (t) => [index('account_userId_idx').on(t.userId)]);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expiresAt').notNull(),
  createdAt: ts('createdAt').notNull().defaultNow(),
  updatedAt: ts('updatedAt').notNull().defaultNow(),
}, (t) => [index('verification_identifier_idx').on(t.identifier)]);

export const rateLimit = pgTable('rateLimit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
});

const userRef = (name: string) => text(name).references(() => user.id, { onDelete: 'cascade' });

// ---------- identity / friends ----------
export const messagingIdentities = pgTable('messaging_identities', {
  id: pk(),
  userId: userRef('user_id').notNull(),
  provider: text('provider').notNull(),
  handle: text('handle').notNull(),
  kind: text('kind').notNull(), // phone | email | telegram_id
  verifiedAt: ts('verified_at'),
  createdAt: created(),
}, (t) => [uniqueIndex().on(t.provider, t.handle)]);

// Columns per Part 1's handoff (docs/APP_ACCOUNTS_HANDOFF.md): a row exists only once accepted; pending lives in invites.
export const friendships = pgTable('friendships', {
  userLow: text('user_low_id').notNull().references(() => user.id),
  userHigh: text('user_high_id').notNull().references(() => user.id),
  requestedBy: text('requested_by').notNull().references(() => user.id),
  status: text('status').notNull(), // accepted
  acceptedAt: ts('accepted_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.userLow, t.userHigh] }),
  check('friendship_order', sql`${t.userLow} < ${t.userHigh}`),
  check('friendship_status', sql`${t.status} in ('accepted')`),
  index('friendships_high').on(t.userHigh),
]);

export const friendInvites = pgTable('friend_invites', {
  id: uuid('id').primaryKey(),
  inviterUserId: text('inviter_id').notNull().references(() => user.id),
  recipientPhoneEnc: text('recipient_phone_encrypted').notNull(),
  recipientPhoneDigest: text('recipient_phone_digest').notNull(), // HMAC(PHONE_LOOKUP_HMAC_KEY, e164)
  tokenHash: text('token_hash').notNull().unique(),
  state: text('state').notNull(), // pending | accepted | declined
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [
  check('friend_invite_state', sql`${t.state} in ('pending','accepted','declined')`),
  index('friend_invites_recipient').on(t.recipientPhoneDigest, t.state),
  index('friend_invites_inviter').on(t.inviterUserId, t.createdAt),
]);

// ---------- conversations ----------
export const conversations = pgTable('conversations', {
  id: pk(),
  provider: text('provider').notNull(),
  sendingLine: text('sending_line').notNull(),
  externalChatId: text('external_chat_id').notNull(),
  kind: text('kind').notNull(), // group | private
  activePlanId: uuid('active_plan_id').references((): AnyPgColumn => plans.id, { onDelete: 'set null' }),
  createdAt: created(),
}, (t) => [uniqueIndex().on(t.provider, t.sendingLine, t.externalChatId)]);

export const conversationMembers = pgTable('conversation_members', {
  id: pk(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  messagingIdentityId: uuid('messaging_identity_id').references(() => messagingIdentities.id),
  unresolvedHandle: text('unresolved_handle'),
  isCurrent: boolean('is_current').notNull().default(true),
});

// ---------- plans ----------
export const plans = pgTable('plans', {
  id: pk(),
  organizerUserId: userRef('organizer_user_id').notNull(),
  request: text('request').notNull(),
  templateId: text('template_id').notNull(), // movie-night | local-outing
  city: jsonb('city').notNull(),
  timeZone: text('time_zone').notNull(),
  windowStart: ts('window_start'),
  windowEnd: ts('window_end'),
  status: text('status').notNull(),
  inputRevision: integer('input_revision').notNull().default(0),
  activeVersionId: uuid('active_version_id').references((): AnyPgColumn => planVersions.id),
  selectedOptionId: uuid('selected_option_id').references((): AnyPgColumn => planOptions.id),
  mode: text('mode').notNull().default('test'),
  createdAt: created(),
  updatedAt: updated(),
});

export const planParticipants = pgTable('plan_participants', {
  id: pk(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  userId: userRef('user_id'), // null while invited
  inviteId: uuid('invite_id').references(() => friendInvites.id),
  requestedName: text('requested_name'),
  attendance: text('attendance').notNull().default('unknown'), // unknown | attending | declined | left
  createdAt: created(),
}, (t) => [uniqueIndex().on(t.planId, t.userId)]);

export const planConversations = pgTable('plan_conversations', {
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  audience: text('audience').notNull(), // group | private
  ownerUserId: userRef('owner_user_id'),
}, (t) => [primaryKey({ columns: [t.planId, t.conversationId] })]);

export const messages = pgTable('messages', {
  id: pk(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  providerMessageId: text('provider_message_id').notNull(),
  senderUserId: userRef('sender_user_id'),
  senderHandle: text('sender_handle').notNull(),
  isPrivate: boolean('is_private').notNull(),
  body: text('body'), // public conversations only
  bodyEnc: text('body_enc'), // private conversations only
  replyToProviderMessageId: text('reply_to_provider_message_id'),
  occurredAt: ts('occurred_at').notNull(),
}, (t) => [
  uniqueIndex().on(t.conversationId, t.providerMessageId),
  check('message_body_privacy', sql`(${t.isPrivate} and ${t.body} is null) or (not ${t.isPrivate} and ${t.bodyEnc} is null)`),
]);

export const privateFacts = pgTable('private_facts', {
  id: pk(),
  ownerUserId: userRef('owner_user_id').notNull(),
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  valueEnc: text('value_enc').notNull(),
  sourceMessageId: uuid('source_message_id').references(() => messages.id),
  supersededBy: uuid('superseded_by').references((): AnyPgColumn => privateFacts.id),
  updatedAt: updated(),
}, (t) => [index().on(t.ownerUserId, t.planId)]);

// ---------- calendar (Part 3 implements) ----------
export const calendarConnections = pgTable('calendar_connections', {
  userId: userRef('user_id').primaryKey(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  primaryOnly: boolean('primary_only').notNull().default(true),
  status: text('status').notNull(), // connected | revoked | error
  updatedAt: updated(),
});

export const availabilitySnapshots = pgTable('availability_snapshots', {
  id: pk(),
  userId: userRef('user_id').notNull(),
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
  busy: jsonb('busy').$type<{ startAt: string; endAt: string }[]>().notNull(), // intervals only, never titles
  windowStart: ts('window_start').notNull(),
  windowEnd: ts('window_end').notNull(),
  source: text('source').notNull(), // calendar | manual | demo
  status: text('status').notNull(), // ok | disconnected | error
  fetchedAt: ts('fetched_at').notNull(),
  validUntil: ts('valid_until'),
}, (t) => [index().on(t.userId, t.planId)]);

export const calendarEvents = pgTable('calendar_events', {
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  userId: userRef('user_id').notNull(),
  versionId: uuid('version_id').notNull().references(() => planVersions.id),
  providerEventId: text('provider_event_id'),
  icsUid: text('ics_uid').notNull(),
  syncStatus: text('sync_status').notNull(),
  updatedAt: updated(),
}, (t) => [primaryKey({ columns: [t.planId, t.userId] })]);

// ---------- discovery ----------
// Ids come from Part 4's SerpApi adapter (stable `src_…`/`cand_…` strings), so they are text, not uuid.
export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  provider: text('provider').notNull(),
  providerSearchId: text('provider_search_id'),
  fetchedAt: ts('fetched_at').notNull(),
});

export const candidates = pgTable('candidates', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(), // contracts Candidate (id mirrors this row)
  cacheKey: text('cache_key').notNull(),
  fetchedAt: ts('fetched_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [index().on(t.cacheKey)]);

// ---------- versions / options / votes ----------
export const planVersions = pgTable('plan_versions', {
  id: pk(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  inputRevision: integer('input_revision').notNull(),
  runId: uuid('run_id').references((): AnyPgColumn => agentRuns.id),
  supersededAt: ts('superseded_at'),
  createdAt: created(),
}, (t) => [uniqueIndex().on(t.planId, t.versionNumber)]);

export const planOptions = pgTable('plan_options', {
  id: pk(),
  versionId: uuid('version_id').notNull().references(() => planVersions.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  payload: jsonb('payload').notNull(), // contracts PlanOption
}, (t) => [uniqueIndex().on(t.versionId, t.label)]);

export const polls = pgTable('polls', {
  id: pk(),
  versionId: uuid('version_id').notNull().references(() => planVersions.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  providerMessageId: text('provider_message_id').notNull(),
  superseded: boolean('superseded').notNull().default(false),
  createdAt: created(),
}, (t) => [uniqueIndex().on(t.conversationId, t.providerMessageId)]);

// One row per acceptable option; favorite/none live in vote_states.
export const votes = pgTable('votes', {
  versionId: uuid('version_id').notNull().references(() => planVersions.id, { onDelete: 'cascade' }),
  userId: userRef('user_id').notNull(),
  optionId: uuid('option_id').notNull().references(() => planOptions.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  sourceEventId: text('source_event_id').notNull(),
  updatedAt: updated(),
}, (t) => [primaryKey({ columns: [t.versionId, t.userId, t.optionId] })]);

export const voteStates = pgTable('vote_states', {
  versionId: uuid('version_id').notNull().references(() => planVersions.id, { onDelete: 'cascade' }),
  userId: userRef('user_id').notNull(),
  favoriteOptionId: uuid('favorite_option_id').references(() => planOptions.id),
  noneAcceptable: boolean('none_acceptable').notNull().default(false),
  objection: text('objection'),
  sourceEventId: text('source_event_id').notNull(),
  updatedAt: updated(),
}, (t) => [primaryKey({ columns: [t.versionId, t.userId] })]);

export const planDecisions = pgTable('plan_decisions', {
  id: pk(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => planVersions.id),
  optionId: uuid('option_id').notNull().references(() => planOptions.id),
  attendeeUserIds: jsonb('attendee_user_ids').$type<string[]>().notNull(),
  evidenceMessageIds: jsonb('evidence_message_ids').$type<string[]>().notNull(),
  buyerUserId: userRef('buyer_user_id'),
  recordedBy: userRef('recorded_by').notNull(),
  recordedAt: created(),
});

// ---------- fulfillment (Part 4 owns; mirrors packages/fulfillment/sql/001_part4.sql exactly) ----------
// Text ids, JSON payloads (contracts BookingQuote/BuyerAuthorization/BookingResult/Reimbursement), and deliberately no
// foreign keys into plan/user tables. Their SQL uses IF NOT EXISTS, so either migration path can run first.
const fulfillmentTable = (name: string) => pgTable(name, {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  payload: jsonb('payload').notNull(),
}, (t) => [index(`${name}_plan_id_idx`).on(t.planId)]);

export const fulfillmentQuotes = fulfillmentTable('fulfillment_quotes');
export const fulfillmentAuthorizations = fulfillmentTable('fulfillment_authorizations');
export const fulfillmentBookings = fulfillmentTable('fulfillment_bookings');
export const fulfillmentPrivateDeliveries = fulfillmentTable('fulfillment_private_deliveries');
export const fulfillmentChanges = fulfillmentTable('fulfillment_changes');

export const fulfillmentReimbursements = pgTable('fulfillment_reimbursements', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  bookingId: text('booking_id').notNull(),
  payerUserId: text('payer_user_id').notNull(),
  payload: jsonb('payload').notNull(),
}, (t) => [
  unique('fulfillment_reimbursements_booking_payer_unique').on(t.bookingId, t.payerUserId),
  index('fulfillment_reimbursements_plan_id_idx').on(t.planId),
  index('fulfillment_reimbursements_booking_id_idx').on(t.bookingId),
]);

export const fulfillmentEffects = pgTable('fulfillment_effects', {
  effectKey: text('effect_key').primaryKey(),
  planId: text('plan_id').notNull(),
  payload: jsonb('payload').notNull(),
}, (t) => [index('fulfillment_effects_plan_id_idx').on(t.planId)]);

// ---------- durable work ----------
export const inboundEvents = pgTable('inbound_events', {
  id: pk(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  envelopeHash: text('envelope_hash').notNull(),
  payload: jsonb('payload').notNull(),
  state: text('state').notNull().default('received'),
  receivedAt: created(),
}, (t) => [uniqueIndex().on(t.provider, t.eventId)]);

export const jobs = pgTable('jobs', {
  id: pk(),
  kind: text('kind').notNull(),
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
  dedupeKey: text('dedupe_key').notNull().unique(),
  payload: jsonb('payload').notNull().default({}),
  state: text('state').notNull().default('queued'), // queued | running | done | failed
  runAfter: ts('run_after').notNull().defaultNow(),
  leaseUntil: ts('lease_until'),
  leasedBy: text('leased_by'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lastError: text('last_error'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index().on(t.state, t.runAfter)]);

export const outbox = pgTable('outbox', {
  id: pk(),
  recipient: jsonb('recipient').notNull(), // contracts OutboundRecipient
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').references(() => planVersions.id),
  effectKey: text('effect_key').notNull().unique(),
  body: text('body'), // group messages
  bodyEnc: text('body_enc'), // private / invite / OTP messages
  providerMessageId: text('provider_message_id'),
  status: text('status').notNull().default('pending'), // pending | sent | failed | unknown
  expiresAt: ts('expires_at'),
  createdAt: created(),
  updatedAt: updated(),
});

export const externalEffects = pgTable('external_effects', {
  id: pk(),
  operationKey: text('operation_key').notNull().unique(),
  kind: text('kind').notNull(),
  planId: uuid('plan_id').references(() => plans.id),
  quoteId: text('quote_id'), // Part 4 quote id (text, no FK)
  state: text('state').notNull().default('reserved'), // reserved | inflight | confirmed | unknown | failed
  providerRequestId: text('provider_request_id'),
  data: jsonb('data'),
  createdAt: created(),
  updatedAt: updated(),
});

// ---------- agent platform (Northmark) ----------
export const agentTemplates = pgTable('agent_templates', {
  id: text('id').notNull(),
  version: integer('version').notNull(),
  config: jsonb('config').notNull(), // contracts AgentTemplate
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.id, t.version] })]);

export const agentRuns = pgTable('agent_runs', {
  id: pk(),
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
  task: text('task').notNull(), // route | plan | repair | discuss
  templateId: text('template_id').notNull(),
  templateVersion: integer('template_version').notNull(),
  model: text('model').notNull(),
  inputRevision: integer('input_revision').notNull(),
  status: text('status').notNull(), // running | ok | error | stale | waiting | limit
  error: text('error'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  toolCalls: integer('tool_calls').notNull().default(0),
  searches: integer('searches').notNull().default(0),
  estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  startedAt: created(),
  finishedAt: ts('finished_at'),
});

export const runSteps = pgTable('run_steps', {
  runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  durationMs: integer('duration_ms').notNull(),
  inputRevision: integer('input_revision').notNull(),
  outcome: text('outcome').notNull(),
  sourceIds: jsonb('source_ids').$type<string[]>().notNull().default([]),
  redactedSummary: text('redacted_summary').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
}, (t) => [primaryKey({ columns: [t.runId, t.index] })]);

export const usageReservations = pgTable('usage_reservations', {
  id: pk(),
  provider: text('provider').notNull(), // muse | serpapi | ...
  runId: uuid('run_id').references(() => agentRuns.id),
  reservedUnits: integer('reserved_units').notNull(),
  actualUnits: integer('actual_units'),
  reservedCostUsd: numeric('reserved_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  actualCostUsd: numeric('actual_cost_usd', { precision: 10, scale: 6 }),
  createdAt: created(),
});
