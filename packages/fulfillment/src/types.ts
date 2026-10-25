/** Part 4's structural implementation of CONTRACTS.md. No shared-schema ownership. */
export type Id = string;
export type Instant = string;
export type Mode = 'live' | 'test';
export type Money = { amountMinor: number; currency: 'USD' };
export type Interval = { startAt: Instant; endAt: Instant };
export type City = {
  label: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  timeZone: string;
};
export type ActorContext = {
  userId: Id;
  source: 'web' | 'group_message' | 'private_message' | 'provider_event';
  conversationId?: Id;
  sourceMessageId?: Id;
};
export type Source = {
  id: Id;
  url: string;
  title: string;
  fetchedAt: Instant;
  provider: string;
  providerSearchId: string | null;
};
export type Evidence = {
  field: string;
  origin: 'source' | 'user' | 'computed' | 'estimate';
  sourceId: Id | null;
  sourceMessageId: Id | null;
};
export type Candidate = {
  id: Id;
  kind: 'movie_screening' | 'event' | 'venue';
  title: string;
  venueName: string;
  address: string | null;
  timeZone: string;
  startAt: Instant | null;
  durationMinutes: number | null;
  format: string | null;
  price: Money | null;
  rawPriceText: string | null;
  rawCurrency: string | null;
  priceKind: 'quoted' | 'listed' | 'estimated' | 'unknown';
  bookingUrl: string | null;
  sourceIds: Id[];
  evidence: Evidence[];
};
export type Selection = {
  versionId: Id;
  optionId: Id;
  attendeeUserIds: Id[];
  evidenceMessageIds: Id[];
  buyerUserId: Id | null;
};
export type BookingQuote = {
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
export type BuyerAuthorization = {
  id: Id;
  quoteId: Id;
  buyerUserId: Id;
  walletRequestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled';
  approvedBindingHash: string | null;
  checkedAt: Instant;
  mode: Mode;
};
export type BookingResult = {
  id: Id;
  planId: Id;
  versionId: Id;
  quoteId: Id | null;
  authorizationId: Id | null;
  status: 'submitting' | 'merchant_confirmed' | 'failed' | 'outcome_unknown'
    | 'handoff_required' | 'buyer_reported' | 'test_confirmed';
  merchantOrderRef: string | null;
  confirmationUrl: string | null;
  actualTotal: Money | null;
  mode: Mode;
};
export type Reimbursement = {
  id: Id;
  bookingId: Id;
  payerUserId: Id;
  recipientUserId: Id;
  amount: Money;
  paymentUrl: string | null;
  status: 'draft' | 'requested' | 'payer_reported_sent' | 'buyer_confirmed_received' | 'voided';
  confirmationSource: 'none' | 'manual_buyer';
  mode: Mode;
};
export interface DiscoveryPort {
  searchMovie(input: { title: string; city: City; window: Interval }): Promise<Candidate[]>;
  searchOutings(input: { query: string; city: City; window: Interval }): Promise<Candidate[]>;
  extractPublicPage(url: string): Promise<{ source: Source; facts: unknown }>;
}
export interface WalletPort {
  startConnect(userId: Id): Promise<{ url: string; phrase?: string; connectionId: Id }>;
  checkConnection(userId: Id): Promise<'pending' | 'connected' | 'not_connected'>;
  requestPurchaseApproval(quoteId: Id): Promise<{ authorizationId: Id; approvalUrl: string }>;
  refreshAuthorization(authorizationId: Id): Promise<BuyerAuthorization>;
}
export interface BookingPort {
  quote(input: { selection: Selection; seatPreference?: string }): Promise<BookingQuote>;
  submit(quoteId: Id, authorizationId: Id): Promise<BookingResult>;
  reconcile(bookingId: Id): Promise<BookingResult>;
}
