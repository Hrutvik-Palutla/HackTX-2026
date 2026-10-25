// Zod schemas + inferred types for CONTRACTS.md (contract v1).
// Change here only together with CONTRACTS.md; Part 2 owns both.
import { z } from 'zod';

export const CONTRACT_VERSION = 1;

// ---------- primitives ----------
export const Id = z.string().min(1);
export const Instant = z.iso.datetime(); // UTC, `Z` suffix
export const Mode = z.enum(['live', 'test']);
export const Money = z.object({ amountMinor: z.number().int(), currency: z.literal('USD') });
export const Interval = z
  .object({ startAt: Instant, endAt: Instant })
  .refine((i) => Date.parse(i.startAt) < Date.parse(i.endAt), 'startAt must be before endAt');

export type Id = z.infer<typeof Id>;
export type Instant = z.infer<typeof Instant>;
export type Mode = z.infer<typeof Mode>;
export type Money = z.infer<typeof Money>;
export type Interval = z.infer<typeof Interval>;

// Resolved by trusted middleware/worker; never parsed from a model or JSON body.
export type ActorContext = {
  userId: Id;
  source: 'web' | 'group_message' | 'private_message' | 'provider_event';
  conversationId?: Id;
  sourceMessageId?: Id;
};

export const City = z.object({
  label: z.string(),
  countryCode: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timeZone: z.string(),
});
export type City = z.infer<typeof City>;

export const PublicPerson = z.object({ id: Id, name: z.string(), avatarUrl: z.string().nullable() });
export type PublicPerson = z.infer<typeof PublicPerson>;
export const OwnProfile = PublicPerson.extend({
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/),
  phoneVerified: z.boolean(),
  city: City,
  interests: z.array(z.string()),
  calendarConnected: z.boolean(),
});
export type OwnProfile = z.infer<typeof OwnProfile>;

// ---------- discovery ----------
export const Source = z.object({
  id: Id,
  url: z.url(),
  title: z.string(),
  fetchedAt: Instant,
  provider: z.enum(['serpapi_google', 'serpapi_maps', 'serpapi_events', 'serpapi_extract', 'merchant']),
  providerSearchId: z.string().nullable(),
});
export type Source = z.infer<typeof Source>;

export const Evidence = z.object({
  field: z.string(),
  origin: z.enum(['source', 'user', 'computed', 'estimate']),
  sourceId: Id.nullable(),
  sourceMessageId: Id.nullable(),
});
export type Evidence = z.infer<typeof Evidence>;

export const PriceKind = z.enum(['quoted', 'listed', 'estimated', 'unknown']);
export const Candidate = z.object({
  id: Id,
  kind: z.enum(['movie_screening', 'event', 'venue']),
  title: z.string(),
  venueName: z.string(),
  address: z.string().nullable(),
  timeZone: z.string(),
  startAt: Instant.nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  format: z.string().nullable(),
  price: Money.nullable(),
  rawPriceText: z.string().nullable(),
  rawCurrency: z.string().nullable(),
  priceKind: PriceKind,
  bookingUrl: z.url().nullable(),
  sourceIds: z.array(Id),
  evidence: z.array(Evidence),
});
export type Candidate = z.infer<typeof Candidate>;

// ---------- plans ----------
export const OptionLabel = z.enum(['A', 'B', 'C']);
export const PlanOption = z.object({
  id: Id,
  versionId: Id,
  label: OptionLabel,
  title: z.string(),
  candidateIds: z.array(Id).min(1),
  startAt: Instant,
  endAt: Instant,
  timeZone: z.string(),
  timeline: z.array(z.object({ title: z.string(), startAt: Instant, endAt: Instant, candidateId: Id })),
  estimatedPerPerson: Money.nullable(),
  priceKind: PriceKind,
  fit: z.enum(['fits_known_constraints', 'needs_clarification']),
  uncertainties: z.array(z.string()),
  publicExplanation: z.string(),
  sourceIds: z.array(Id),
});
export type PlanOption = z.infer<typeof PlanOption>;

const PrivateFactBase = z.object({
  id: Id,
  ownerUserId: Id,
  planId: Id.nullable(),
  sourceMessageId: Id.nullable(),
  updatedAt: Instant,
  supersededBy: Id.nullable(),
});
export const PrivateFactValue = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('availability'),
    value: z.object({
      window: Interval,
      available: z.array(Interval).nullable(),
      unavailable: z.array(Interval),
      certainty: z.enum(['explicit', 'tentative']),
    }),
  }),
  z.object({ kind: z.literal('spending_limit'), value: z.object({ maximumShare: Money }) }),
  z.object({
    kind: z.literal('preference'),
    value: z.object({ key: z.string(), value: z.union([z.string(), z.array(z.string())]), strength: z.enum(['soft', 'hard']) }),
  }),
  z.object({
    kind: z.literal('requirement'),
    value: z.object({ key: z.string(), value: z.string(), supportedCheck: z.string().nullable() }),
  }),
]);
export type PrivateFactValue = z.infer<typeof PrivateFactValue>;
export const PrivateFact = z.intersection(PrivateFactBase, PrivateFactValue);
export type PrivateFact = z.infer<typeof PrivateFact>;

export const Vote = z
  .object({
    userId: Id,
    versionId: Id,
    acceptableOptionIds: z.array(Id),
    favoriteOptionId: Id.nullable(),
    noneAcceptable: z.boolean(),
    source: z.enum(['native_poll', 'message', 'web']),
    sourceEventId: z.string(),
  })
  .refine((v) => !v.noneAcceptable || (v.acceptableOptionIds.length === 0 && v.favoriteOptionId === null), 'noneAcceptable excludes other choices')
  .refine((v) => v.favoriteOptionId === null || v.acceptableOptionIds.includes(v.favoriteOptionId), 'favorite must be acceptable');
export type Vote = z.infer<typeof Vote>;

export const PlanStatus = z.enum([
  'waiting_connections', 'planning', 'clarifying', 'voting', 'selected', 'quoting',
  'awaiting_payment_approval', 'booking', 'booked', 'needs_handoff', 'change_requested', 'closed',
]);
export type PlanStatus = z.infer<typeof PlanStatus>;

export const Selection = z.object({
  versionId: Id,
  optionId: Id,
  attendeeUserIds: z.array(Id).min(1),
  evidenceMessageIds: z.array(Id),
  buyerUserId: Id.nullable(),
});
export type Selection = z.infer<typeof Selection>;

// ---------- fulfillment (Part 4 implements; shapes shared) ----------
const LineItem = z.object({ attendeeUserId: Id, label: z.string(), amount: Money });
export const BookingQuote = z.object({
  id: Id, planId: Id, versionId: Id, optionId: Id,
  attendeeUserIds: z.array(Id), buyerUserId: Id,
  merchantHost: z.string(), merchantUrl: z.url(), performanceRef: z.string().nullable(),
  seatRefs: z.array(z.string()), lineItems: z.array(LineItem),
  sharedFees: Money, sharedDiscount: Money, total: Money,
  expiresAt: Instant, bindingHash: z.string(), mode: Mode,
});
export type BookingQuote = z.infer<typeof BookingQuote>;

export const BuyerAuthorization = z.object({
  id: Id, quoteId: Id, buyerUserId: Id, walletRequestId: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'canceled']),
  approvedBindingHash: z.string().nullable(), checkedAt: Instant, mode: Mode,
});
export type BuyerAuthorization = z.infer<typeof BuyerAuthorization>;

export const BookingResult = z.object({
  id: Id, planId: Id, versionId: Id, quoteId: Id.nullable(), authorizationId: Id.nullable(),
  status: z.enum(['submitting', 'merchant_confirmed', 'failed', 'outcome_unknown', 'handoff_required', 'buyer_reported', 'test_confirmed']),
  merchantOrderRef: z.string().nullable(), confirmationUrl: z.string().nullable(),
  actualTotal: Money.nullable(), mode: Mode,
});
export type BookingResult = z.infer<typeof BookingResult>;

export const Reimbursement = z.object({
  id: Id, bookingId: Id, payerUserId: Id, recipientUserId: Id, amount: Money,
  paymentUrl: z.string().nullable(),
  status: z.enum(['draft', 'requested', 'payer_reported_sent', 'buyer_confirmed_received', 'voided']),
  confirmationSource: z.enum(['none', 'manual_buyer']), mode: Mode,
});
export type Reimbursement = z.infer<typeof Reimbursement>;

// ---------- messaging / ports ----------
export const InboundMessage = z.object({
  provider: z.enum(['linq', 'telegram', 'claw_messenger']),
  eventId: z.string(),
  messageId: z.string(),
  conversationExternalId: z.string(),
  conversationKind: z.enum(['group', 'private']),
  senderHandle: z.string(),
  senderKind: z.enum(['phone', 'email', 'telegram_id']),
  text: z.string(),
  occurredAt: Instant,
  replyToMessageId: z.string().nullable(),
});
export type InboundMessage = z.infer<typeof InboundMessage>;

export const OutboundRecipient = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), conversationId: Id }),
  z.object({ kind: z.literal('private'), userId: Id, conversationId: Id.optional() }),
  z.object({ kind: z.literal('invite'), invitationId: Id }),
  // OTP to a phone that may not have an account yet; the phone is encrypted ('phone' domain).
  z.object({ kind: z.literal('otp_phone'), phoneEnc: z.string() }),
]);
export type OutboundRecipient = z.infer<typeof OutboundRecipient>;

export interface MessagingPort {
  capabilities: {
    createGroup: boolean; coldInvite: boolean; nativePoll: boolean;
    identifiedVotes: boolean; contextualGroupMessages: boolean;
  };
  sendText(recipient: OutboundRecipient, text: string, effectKey: string): Promise<{ messageId: string }>;
  createGroup(memberHandles: string[], introText: string, effectKey: string): Promise<{ chatId: string }>;
  publishPoll(chatId: string, versionId: Id, labels: string[], effectKey: string): Promise<{ messageId: string }>;
  readPoll(messageId: string): Promise<unknown>;
}

export interface DiscoveryPort {
  searchMovie(input: { title: string; city: City; window: Interval }): Promise<Candidate[]>;
  searchOutings(input: { query: string; city: City; window: Interval }): Promise<Candidate[]>;
  extractPublicPage(url: string): Promise<{ source: Source; facts: unknown }>;
  /** Source metadata for ids referenced by returned candidates (Part 4's SerpApi adapter provides this). */
  getSource?(sourceId: Id): Source | null;
}

export type BusyResult = { busy: Interval[]; fetchedAt: Instant; status: 'ok' | 'disconnected' | 'error' };
export interface CalendarPort {
  getBusy(userId: Id, window: Interval): Promise<BusyResult>;
  upsertOwnEvent(userId: Id, planId: Id, versionId: Id): Promise<{ eventId: string }>;
}

export interface WalletPort {
  startConnect(userId: Id): Promise<{ url: string; phrase?: string; connectionId: Id }>;
  checkConnection(userId: Id): Promise<'pending' | 'connected' | 'revoked'>;
  requestPurchaseApproval(quoteId: Id): Promise<{ authorizationId: Id; approvalUrl: string }>;
  refreshAuthorization(authorizationId: Id): Promise<BuyerAuthorization>;
}

export interface BookingPort {
  quote(input: { selection: Selection; seatPreference?: string }): Promise<BookingQuote>;
  submit(quoteId: Id, authorizationId: Id): Promise<BookingResult>;
  reconcile(bookingId: Id): Promise<BookingResult>;
}

// ---------- jobs ----------
export const JobKind = z.enum([
  'process_inbound', 'resume_connections', 'plan', 'repair', 'send_outbox', 'poll_reminder',
  'refresh_wallet', 'quote_booking', 'submit_booking', 'reconcile_booking', 'sync_calendar',
  'create_reimbursements', 'handle_change', 'publish_poll',
]);
export type JobKind = z.infer<typeof JobKind>;

// ---------- templates / runs ----------
export const AgentTemplate = z.object({
  id: z.enum(['movie-night', 'local-outing']),
  version: z.number().int().positive(),
  model: z.string(),
  systemInstruction: z.string(),
  allowedTools: z.array(z.string()),
  limits: z.object({ maxTurns: z.number().int().positive(), maxTools: z.number().int().nonnegative(), maxSearches: z.number().int().nonnegative() }),
  outputSchemaVersion: z.literal(1),
});
export type AgentTemplate = z.infer<typeof AgentTemplate>;

export const RunStep = z.object({
  runId: Id,
  index: z.number().int().nonnegative(),
  kind: z.enum(['model', 'tool', 'validation', 'state_change']),
  name: z.string(),
  durationMs: z.number().int().nonnegative(),
  inputRevision: z.number().int().nonnegative(),
  outcome: z.enum(['ok', 'error', 'stale', 'waiting']),
  sourceIds: z.array(Id),
  redactedSummary: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type RunStep = z.infer<typeof RunStep>;

// ---------- HTTP envelope ----------
export const ErrorCode = z.enum([
  'STALE_PLAN', 'FORBIDDEN', 'NOT_FOUND', 'INVALID', 'UNRESOLVED', 'BUDGET_LIMIT', 'QUOTA_LIMIT', 'PROVIDER', 'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ApiOk<T> = { data: T; revision?: number };
export type ApiErr = { error: { code: ErrorCode; message: string; retryable: boolean }; requestId: string };
