import { randomUUID, createHash } from 'node:crypto';
import type { ActorContext, BookingQuote, BookingResult, BuyerAuthorization, Candidate, Mode, Money, Reimbursement, WalletPort } from './types.ts';
import type { FulfillmentRepository, Effect, PrivateDelivery } from './repository.ts';
import { assert, FulfillmentError } from './errors.ts';
import { validateQuote, validateMoney } from './quote.ts';
import { calculateShares, allocateProportionally } from './splits.ts';
import type { AttendeeShare } from './splits.ts';
import { createReimbursements, normalizePayPalMeHandle, buildPayPalMePaymentUrl, payerReportedSent, buyerConfirmedReceived } from './reimbursements.ts';

/** Supplied by Part 2's authoritative membership/selection repository, never the HTTP body. */
export type SelectedPlan = {
  planId: string; revision: number; versionId: string; optionId: string; title: string;
  memberUserIds: string[]; attendeeUserIds: string[]; buyerUserId: string | null;
  mode: Mode; candidate: Candidate;
  privateMaximumShares?: Record<string, Money>;
};
export type FulfillmentOptions = {
  repository: FulfillmentRepository;
  loadPlan(actor: ActorContext, planId: string): Promise<SelectedPlan | null>;
  wallet: WalletPort;
  quote(plan: SelectedPlan, seatPreference?: string): Promise<BookingQuote>;
  submit(input: { quote: BookingQuote; authorization: BuyerAuthorization }): Promise<BookingResult>;
  reconcile?(booking: BookingResult): Promise<BookingResult>;
  now?: () => Date;
};

const SUCCESS = new Set<BookingResult['status']>(['merchant_confirmed', 'buyer_reported', 'test_confirmed']);
const UNCERTAIN = new Set<BookingResult['status']>(['submitting', 'outcome_unknown', 'handoff_required']);
function sameSet(a: string[], b: string[]): boolean { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
function safeMerchantUrl(value: string | null): string | null {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}

export class FulfillmentService {
  private readonly o: FulfillmentOptions;
  readonly repository: FulfillmentRepository;
  private readonly now: () => Date;
  constructor(options: FulfillmentOptions) { this.o = options; this.repository = options.repository; this.now = options.now ?? (() => new Date()); }

  private async plan(actor: ActorContext, planId: string): Promise<SelectedPlan> {
    assert(actor?.userId, 'UNAUTHENTICATED', 'Sign in first.', 401);
    const plan = await this.o.loadPlan(actor, planId);
    assert(plan && plan.planId === planId && plan.memberUserIds.includes(actor.userId), 'NOT_FOUND', 'Plan not found.', 404);
    return plan;
  }
  private revision(plan: SelectedPlan, expected: number, versionId?: string): void {
    assert(plan.revision === expected && (!versionId || plan.versionId === versionId), 'STALE_PLAN', 'The plan changed. Refresh before continuing.', 409);
  }
  private buyer(actor: ActorContext, buyer: string): void { assert(actor.userId === buyer, 'FORBIDDEN', 'Only the nominated buyer can perform this action.', 403); }
  private async unbooked(planId: string): Promise<void> {
    const blocked = await this.repository.read(s => Object.values(s.bookings).some(b => b.planId === planId && (SUCCESS.has(b.status) || UNCERTAIN.has(b.status))));
    assert(!blocked, 'BOOKING_EXISTS', 'This plan already has a booking or an unresolved purchase. Check its status before booking again.', 409);
  }
  private async reserve(key: string, planId: string, kind: Effect['kind']): Promise<{ fresh: boolean; effect: Effect }> {
    return this.repository.transact(s => {
      if (s.effects[key]) return { fresh: false, effect: s.effects[key] };
      const effect: Effect = { key, planId, kind, state: 'started', createdAt: this.now().toISOString(), resultId: null };
      s.effects[key] = effect; return { fresh: true, effect };
    });
  }

  async createQuote(actor: ActorContext, input: { planId: string; versionId: string; optionId: string; buyerUserId: string; expectedRevision: number; requestId: string; seatPreference?: string }): Promise<BookingQuote> {
    let plan = await this.plan(actor, input.planId);
    this.revision(plan, input.expectedRevision, input.versionId);
    assert(plan.optionId === input.optionId && plan.buyerUserId === input.buyerUserId, 'STALE_PLAN', 'The selected option or buyer changed.', 409);
    assert(plan.buyerUserId && plan.attendeeUserIds.includes(plan.buyerUserId), 'BUYER_REQUIRED', 'Nominate a buyer from the attendees first.');
    await this.unbooked(plan.planId);
    const fingerprint = createHash('sha256').update(JSON.stringify([input.versionId, input.optionId, input.buyerUserId, input.seatPreference ?? ''])).digest('hex');
    const key = `quote:${plan.planId}:${input.requestId}`;
    const reservation = await this.reserve(key, plan.planId, 'quote');
    if (!reservation.fresh) {
      const cached = await this.repository.read(s => reservation.effect.resultId ? s.quotes[reservation.effect.resultId] : undefined);
      assert(cached && cached.effectKey === `${key}:${fingerprint}`, 'OPERATION_PENDING', 'This quote request is pending, changed, or failed. Use its result or start a new request.', 409);
      validateQuote(cached.quote, this.now());
      return cached.quote;
    }
    try {
      const quote = await this.o.quote(plan, input.seatPreference);
      validateQuote(quote, this.now());
      plan = await this.plan(actor, input.planId);
      this.revision(plan, input.expectedRevision, input.versionId);
      assert(quote.planId === plan.planId && quote.versionId === plan.versionId && quote.optionId === plan.optionId && quote.buyerUserId === plan.buyerUserId && quote.mode === plan.mode && sameSet(quote.attendeeUserIds, plan.attendeeUserIds), 'QUOTE_MISMATCH', 'The quote does not match the selected plan.', 409);
      this.checkMaximumShares(plan, quote);
      await this.repository.transact(s => {
        s.quotes[quote.id] = { quote, inputRevision: plan.revision, effectKey: `${key}:${fingerprint}` };
        s.effects[key] = { ...s.effects[key], state: 'confirmed', resultId: quote.id };
      });
      return quote;
    } catch (error) {
      await this.repository.transact(s => { s.effects[key].state = 'failed'; });
      throw error;
    }
  }

  private checkMaximumShares(plan: SelectedPlan, quote: BookingQuote): void {
    for (const share of calculateShares(quote)) {
      const maximum = plan.privateMaximumShares?.[share.attendeeUserId];
      if (maximum) assert(maximum.currency === 'USD' && share.amount.amountMinor <= maximum.amountMinor, 'CONSTRAINT_CONFLICT', 'This purchase exceeds a participant constraint. Revise the plan.', 409);
    }
  }

  private async currentQuote(actor: ActorContext, quoteId: string, expectedRevision: number): Promise<{ plan: SelectedPlan; quote: BookingQuote }> {
    const row = await this.repository.read(s => s.quotes[quoteId]);
    assert(row, 'NOT_FOUND', 'Quote not found.', 404);
    const plan = await this.plan(actor, row.quote.planId);
    this.revision(plan, expectedRevision, row.quote.versionId);
    assert(row.inputRevision === expectedRevision && row.quote.optionId === plan.optionId && row.quote.buyerUserId === plan.buyerUserId && row.quote.mode === plan.mode && sameSet(row.quote.attendeeUserIds, plan.attendeeUserIds), 'STALE_PLAN', 'The selected attendees, buyer, or option changed.', 409);
    validateQuote(row.quote, this.now()); this.checkMaximumShares(plan, row.quote);
    return { plan, quote: row.quote };
  }

  async startWalletConnection(actor: ActorContext): Promise<{ url: string; phrase?: string; connectionId: string }> {
    assert(actor?.userId, 'UNAUTHENTICATED', 'Sign in first.', 401);
    return this.o.wallet.startConnect(actor.userId);
  }
  async walletConnection(actor: ActorContext): Promise<{ status: 'pending' | 'connected' | 'not_connected' }> {
    assert(actor?.userId, 'UNAUTHENTICATED', 'Sign in first.', 401);
    return { status: await this.o.wallet.checkConnection(actor.userId) };
  }

  async requestApproval(actor: ActorContext, quoteId: string, expectedRevision: number): Promise<{ authorizationId: string; approvalUrl: string }> {
    const { quote, plan } = await this.currentQuote(actor, quoteId, expectedRevision);
    this.buyer(actor, quote.buyerUserId); await this.unbooked(plan.planId);
    const key = `approval:${quote.id}`;
    const reserved = await this.reserve(key, plan.planId, 'wallet_approval');
    if (!reserved.fresh) {
      assert(reserved.effect.state === 'confirmed' && reserved.effect.resultId && reserved.effect.resultUrl, 'OPERATION_PENDING', 'Approval creation is pending or uncertain. Check its status before creating another.', 409);
      return { authorizationId: reserved.effect.resultId, approvalUrl: reserved.effect.resultUrl };
    }
    try {
      const result = await this.o.wallet.requestPurchaseApproval(quote.id);
      const authorization = await this.o.wallet.refreshAuthorization(result.authorizationId);
      await this.currentQuote(actor, quoteId, expectedRevision);
      assert(authorization.quoteId === quote.id && authorization.buyerUserId === actor.userId && authorization.mode === quote.mode, 'WALLET_MISMATCH', 'Wallet approval does not match this buyer and quote.', 409);
      await this.repository.transact(s => {
        s.authorizations[authorization.id] = { ...authorization, requestedBindingHash: quote.bindingHash };
        s.effects[key] = { ...s.effects[key], state: 'confirmed', resultId: authorization.id, resultUrl: result.approvalUrl };
      });
      return result;
    } catch (error) {
      await this.repository.transact(s => { s.effects[key].state = 'unknown'; });
      throw error;
    }
  }

  async refreshAuthorization(actor: ActorContext, authorizationId: string): Promise<BuyerAuthorization> {
    const prior = await this.repository.read(s => s.authorizations[authorizationId]);
    assert(prior, 'NOT_FOUND', 'Approval not found.', 404); this.buyer(actor, prior.buyerUserId);
    const quote = await this.repository.read(s => s.quotes[prior.quoteId]?.quote);
    assert(quote, 'NOT_FOUND', 'Quote not found.', 404); await this.plan(actor, quote.planId);
    const value = await this.o.wallet.refreshAuthorization(authorizationId);
    assert(value.id === prior.id && value.quoteId === prior.quoteId && value.buyerUserId === prior.buyerUserId && value.mode === prior.mode, 'WALLET_MISMATCH', 'Wallet approval does not match the saved request.', 409);
    if (value.status === 'approved') assert(value.approvedBindingHash === quote.bindingHash, 'QUOTE_CHANGED', 'The approved quote no longer matches.', 409);
    const freshPlan = await this.plan(actor, quote.planId);
    assert(freshPlan.versionId === quote.versionId && freshPlan.optionId === quote.optionId && freshPlan.buyerUserId === quote.buyerUserId && sameSet(freshPlan.attendeeUserIds, quote.attendeeUserIds), 'STALE_PLAN', 'The plan changed while checking approval.', 409);
    await this.repository.transact(s => { s.authorizations[value.id] = { ...value, requestedBindingHash: prior.requestedBindingHash }; });
    return value;
  }

  async book(actor: ActorContext, quoteId: string, authorizationId: string, expectedRevision: number, buyerPayPalMe: string | null = null): Promise<BookingResult> {
    const { quote, plan } = await this.currentQuote(actor, quoteId, expectedRevision);
    this.buyer(actor, quote.buyerUserId);
    if (buyerPayPalMe !== null) normalizePayPalMeHandle(buyerPayPalMe);
    const prior = await this.repository.read(s => { const effect = s.effects[`booking:${quote.id}`]; return effect?.resultId ? s.bookings[effect.resultId] : null; });
    if (prior) return prior;
    const authorization = await this.refreshAuthorization(actor, authorizationId);
    assert(authorization.status === 'approved' && authorization.quoteId === quote.id && authorization.approvedBindingHash === quote.bindingHash, 'APPROVAL_REQUIRED', 'The buyer must approve this exact quote first.', 409);
    // Re-read after waiting on the wallet, before reserving the purchase.
    await this.currentQuote(actor, quoteId, expectedRevision);
    const bookingId = randomUUID();
    const placeholder = { id: bookingId, planId: plan.planId, versionId: plan.versionId, quoteId, authorizationId, status: 'submitting' as const, merchantOrderRef: null, confirmationUrl: null, actualTotal: null, mode: plan.mode, buyerUserId: quote.buyerUserId, attendeeUserIds: quote.attendeeUserIds };
    const booked = await this.repository.transact(s => {
      const effect = s.effects[`booking:${quote.id}`];
      if (effect?.resultId) return s.bookings[effect.resultId];
      assert(!Object.values(s.bookings).some(b => b.planId === plan.planId && (SUCCESS.has(b.status) || UNCERTAIN.has(b.status))), 'BOOKING_EXISTS', 'Another purchase exists or is unresolved for this plan.', 409);
      s.bookings[bookingId] = placeholder;
      s.effects[`booking:${quote.id}`] = { key: `booking:${quote.id}`, planId: plan.planId, kind: 'booking', state: 'started', createdAt: this.now().toISOString(), resultId: bookingId };
      return null;
    });
    if (booked) return booked;
    let result: BookingResult;
    try { result = { ...await this.o.submit({ quote, authorization }), id: bookingId }; }
    catch { result = { ...placeholder, status: 'outcome_unknown' }; }
    assert(result.planId === quote.planId && result.versionId === quote.versionId && result.quoteId === quote.id && result.authorizationId === authorization.id && result.mode === quote.mode, 'BOOKING_MISMATCH', 'Booking result does not match the authorized quote.', 409);
    assert(result.status !== 'buyer_reported', 'BOOKING_MISMATCH', 'Only the buyer report action may record a buyer-reported purchase.', 409);
    assert(!(result.mode === 'test' && result.status === 'merchant_confirmed') && !(result.mode === 'live' && result.status === 'test_confirmed'), 'MODE_MISMATCH', 'Test and live booking results cannot be mixed.', 409);
    await this.repository.transact(s => {
      s.bookings[bookingId] = { ...result, buyerUserId: quote.buyerUserId, attendeeUserIds: quote.attendeeUserIds };
      s.effects[`booking:${quote.id}`].state = UNCERTAIN.has(result.status) ? 'unknown' : 'confirmed';
    });
    // A confirmed purchase is durable even if accounting needs a later correction.
    if (SUCCESS.has(result.status) && result.actualTotal?.currency === 'USD' && result.actualTotal.amountMinor === quote.total.amountMinor) {
      await this.repository.transact(s => this.addRepayments(s, result, quote.buyerUserId, calculateShares(quote), buyerPayPalMe));
    }
    return result;
  }

  async handoff(actor: ActorContext, planId: string, expectedRevision: number): Promise<{ booking: BookingResult; handoffUrl: string | null }> {
    const plan = await this.plan(actor, planId); this.revision(plan, expectedRevision);
    assert(plan.buyerUserId, 'BUYER_REQUIRED', 'Nominate the buyer before checkout.'); this.buyer(actor, plan.buyerUserId);
    const booking = await this.repository.transact(s => {
      const prior = Object.values(s.bookings).find(b => b.planId === planId && b.versionId === plan.versionId && b.status === 'handoff_required');
      if (prior) return prior;
      assert(!Object.values(s.bookings).some(b => b.planId === planId && (SUCCESS.has(b.status) || UNCERTAIN.has(b.status))), 'BOOKING_EXISTS', 'Check the existing purchase before starting another.', 409);
      const record = { id: randomUUID(), planId, versionId: plan.versionId, quoteId: null, authorizationId: null, status: 'handoff_required' as const, merchantOrderRef: null, confirmationUrl: null, actualTotal: null, mode: plan.mode, buyerUserId: plan.buyerUserId!, attendeeUserIds: plan.attendeeUserIds };
      s.bookings[record.id] = record; return record;
    });
    return { booking, handoffUrl: safeMerchantUrl(plan.candidate.bookingUrl) };
  }

  async reportCompleted(actor: ActorContext, bookingId: string, input: { total: Money; orderReference: string; expectedRevision: number; shares?: AttendeeShare[]; buyerPayPalMe?: string | null }): Promise<BookingResult> {
    const prior = await this.repository.read(s => s.bookings[bookingId]); assert(prior, 'NOT_FOUND', 'Booking not found.', 404);
    const plan = await this.plan(actor, prior.planId); this.revision(plan, input.expectedRevision);
    const buyer = prior.buyerUserId ?? plan.buyerUserId;
    const attendees = prior.attendeeUserIds ?? plan.attendeeUserIds;
    assert(buyer, 'BUYER_REQUIRED', 'This plan needs a nominated buyer.'); this.buyer(actor, buyer);
    validateMoney(input.total);
    assert(input.orderReference.trim().length > 0 && input.orderReference.length <= 200, 'INVALID_INPUT', 'Provide the buyer-reported order reference.', 400);
    const shares = input.shares ?? allocateProportionally(input.total.amountMinor, attendees.map(() => 1)).map((amountMinor, index) => ({ attendeeUserId: attendees[index], amount: { amountMinor, currency: 'USD' as const } }));
    assert(sameSet(shares.map(x => x.attendeeUserId), attendees), 'INVALID_SPLIT', 'Shares must name exactly the intended attendees.');
    return this.repository.transact(s => {
      const current = s.bookings[bookingId];
      if (current.status === 'buyer_reported') {
        assert(current.actualTotal?.amountMinor === input.total.amountMinor && current.merchantOrderRef === input.orderReference, 'ALREADY_REPORTED', 'The buyer already reported different purchase details.', 409);
        return current;
      }
      assert(['handoff_required', 'outcome_unknown'].includes(current.status), 'INVALID_STATE', 'Only a checkout handoff or unresolved purchase can be reported complete.', 409);
      assert(!Object.values(s.bookings).some(b => b.id !== current.id && b.planId === plan.planId && SUCCESS.has(b.status)), 'BOOKING_EXISTS', 'This plan already has a completed purchase.', 409);
      const result: BookingResult = { ...current, status: 'buyer_reported', merchantOrderRef: input.orderReference, actualTotal: input.total };
      s.bookings[result.id] = result;
      this.addRepayments(s, result, buyer, shares, input.buyerPayPalMe ?? null);
      return result;
    });
  }

  async reconcileBooking(actor: ActorContext, bookingId: string): Promise<BookingResult> {
    const prior = await this.repository.read(s => s.bookings[bookingId]); assert(prior, 'NOT_FOUND', 'Booking not found.', 404);
    const plan = await this.plan(actor, prior.planId);
    const buyer = prior.buyerUserId ?? plan.buyerUserId; assert(buyer, 'BUYER_REQUIRED', 'A buyer is required.'); this.buyer(actor, buyer);
    if (!['submitting', 'outcome_unknown'].includes(prior.status) || !this.o.reconcile) return prior;
    const refreshed = await this.o.reconcile(prior);
    assert(refreshed.id === prior.id && refreshed.planId === prior.planId && refreshed.versionId === prior.versionId && refreshed.quoteId === prior.quoteId && refreshed.mode === prior.mode && refreshed.authorizationId === prior.authorizationId && refreshed.status !== 'buyer_reported', 'BOOKING_MISMATCH', 'The reconciled booking does not match this purchase.', 409);
    assert(!(refreshed.mode === 'test' && refreshed.status === 'merchant_confirmed') && !(refreshed.mode === 'live' && refreshed.status === 'test_confirmed'), 'MODE_MISMATCH', 'Test and live results cannot be mixed.', 409);
    await this.repository.transact(s => {
      s.bookings[prior.id] = { ...prior, ...refreshed };
      if (prior.quoteId && s.effects[`booking:${prior.quoteId}`]) s.effects[`booking:${prior.quoteId}`].state = UNCERTAIN.has(refreshed.status) ? 'unknown' : 'confirmed';
    });
    const quote = prior.quoteId ? await this.repository.read(s => s.quotes[prior.quoteId!]?.quote) : null;
    if (quote && SUCCESS.has(refreshed.status) && refreshed.actualTotal?.amountMinor === quote.total.amountMinor) {
      await this.repository.transact(s => this.addRepayments(s, refreshed, buyer, calculateShares(quote), null));
    }
    return refreshed;
  }

  async resolveUnpurchasedHandoff(actor: ActorContext, bookingId: string): Promise<BookingResult> {
    const prior = await this.repository.read(s => s.bookings[bookingId]); assert(prior, 'NOT_FOUND', 'Booking not found.', 404);
    const plan = await this.plan(actor, prior.planId);
    const buyer = prior.buyerUserId ?? plan.buyerUserId; assert(buyer, 'BUYER_REQUIRED', 'A buyer is required.'); this.buyer(actor, buyer);
    return this.repository.transact(s => {
      const current = s.bookings[bookingId];
      assert(current.status === 'handoff_required', 'INVALID_STATE', 'Only an unpurchased handoff may be cleared. Uncertain charges require reconciliation.', 409);
      const result = { ...current, status: 'failed' as const };
      s.bookings[bookingId] = result; return result;
    });
  }

  async finalizeShares(actor: ActorContext, bookingId: string, shares: AttendeeShare[], buyerPayPalMe: string | null): Promise<void> {
    const booking = await this.repository.read(s => s.bookings[bookingId]); assert(booking, 'NOT_FOUND', 'Booking not found.', 404);
    const plan = await this.plan(actor, booking.planId);
    const buyer = booking.buyerUserId ?? plan.buyerUserId; assert(buyer, 'BUYER_REQUIRED', 'A buyer is required.'); this.buyer(actor, buyer);
    assert(SUCCESS.has(booking.status) && booking.actualTotal !== null, 'INVALID_STATE', 'A confirmed or buyer-reported total is required.');
    assert(sameSet(shares.map(s => s.attendeeUserId), booking.attendeeUserIds ?? plan.attendeeUserIds), 'INVALID_SPLIT', 'Shares must name exactly the booked attendees.');
    await this.repository.transact(s => this.addRepayments(s, booking, buyer, shares, buyerPayPalMe));
  }

  /** Part 3 calls this with its idempotent private-outbox enqueue; never expose it as an anonymous HTTP endpoint. */
  async flushPrivateDeliveries(enqueue: (delivery: Readonly<PrivateDelivery>) => Promise<void>): Promise<number> {
    const pending = await this.repository.read(s => Object.values(s.deliveries).filter(d => d.status === 'pending'));
    let count = 0;
    for (const delivery of pending) {
      await enqueue(delivery); // Part 3 deduplicates by delivery.id.
      await this.repository.transact(s => { if (s.deliveries[delivery.id]) s.deliveries[delivery.id].status = 'delivered'; });
      count++;
    }
    return count;
  }

  private addRepayments(state: Parameters<Parameters<FulfillmentRepository['transact']>[0]>[0], booking: BookingResult, buyer: string, shares: AttendeeShare[], payPalMe: string | null): void {
    const rows = createReimbursements(booking, buyer, shares, payPalMe, Object.values(state.reimbursements));
    for (const row of rows) {
      state.reimbursements[row.id] = row;
      const amount = (row.amount.amountMinor / 100).toFixed(2);
      const text = row.mode === 'test'
        ? `TEST — simulated share is $${amount} USD. No payment is due; do not pay. Booking reference: ${booking.id}.`
        : `Your share is $${amount} USD.${row.paymentUrl ? ` Repay the buyer: ${row.paymentUrl}` : ' Coordinate repayment with the buyer.'} Booking reference: ${booking.id}.`;
      const delivery: PrivateDelivery = { id: `request:${row.id}`, planId: booking.planId, bookingId: booking.id, recipientUserId: row.payerUserId, text, mode: row.mode, status: 'pending' };
      state.deliveries[delivery.id] = delivery;
    }
  }

  async paymentView(actor: ActorContext, planId: string): Promise<Record<string, unknown>> {
    const plan = await this.plan(actor, planId);
    return this.repository.read(s => {
      const bookings = Object.values(s.bookings).filter(b => b.planId === planId);
      const ids = new Set(bookings.map(b => b.id));
      const rows = Object.values(s.reimbursements).filter(r => ids.has(r.bookingId));
      if (actor.userId === plan.buyerUserId) return {
        viewerUserId: actor.userId, buyerUserId: plan.buyerUserId,
        ownShare: rows.find(r => r.payerUserId === actor.userId) ?? null,
        buyerLedger: rows.filter(r => r.recipientUserId === actor.userId),
        booking: bookings.at(-1) ?? null,
        quote: Object.values(s.quotes).filter(q => q.quote.planId === planId && q.quote.buyerUserId === actor.userId).at(-1)?.quote ?? null,
        role: 'buyer', mode: plan.mode, bookings,
        quotes: Object.values(s.quotes).filter(q => q.quote.planId === planId && q.quote.buyerUserId === actor.userId).map(q => q.quote),
        authorizations: Object.values(s.authorizations).filter(a => s.quotes[a.quoteId]?.quote.planId === planId && a.buyerUserId === actor.userId).map(({ requestedBindingHash: _private, ...value }) => value),
        reimbursements: rows.filter(r => r.recipientUserId === actor.userId),
        handoffUrl: safeMerchantUrl(plan.candidate.bookingUrl),
        repaymentNeedsReview: bookings.filter(b => SUCCESS.has(b.status) && (b.attendeeUserIds ?? plan.attendeeUserIds).some(id => id !== actor.userId) && !rows.some(r => r.bookingId === b.id)).map(b => b.id),
      };
      return { viewerUserId: actor.userId, buyerUserId: plan.buyerUserId, ownShare: rows.find(r => r.payerUserId === actor.userId) ?? null, booking: bookings.length ? { status: bookings.at(-1)!.status, mode: bookings.at(-1)!.mode, actualTotal: null } : null, role: 'attendee', mode: plan.mode, reimbursements: rows.filter(r => r.payerUserId === actor.userId), bookingStatus: bookings.map(b => ({ id: b.id, status: b.status, mode: b.mode })) };
    });
  }

  async updateReimbursement(actor: ActorContext, id: string, action: 'report-sent' | 'confirm-received'): Promise<Reimbursement> {
    const prior = await this.repository.read(s => s.reimbursements[id]); assert(prior, 'NOT_FOUND', 'Payment request not found.', 404);
    const booking = await this.repository.read(s => s.bookings[prior.bookingId]); assert(booking, 'NOT_FOUND', 'Booking not found.', 404);
    await this.plan(actor, booking.planId);
    assert(actor.userId === (action === 'report-sent' ? prior.payerUserId : prior.recipientUserId), 'FORBIDDEN', 'You cannot update this payment request.', 403);
    return this.repository.transact(s => {
      const current = s.reimbursements[id];
      if (action === 'report-sent' && ['payer_reported_sent', 'buyer_confirmed_received'].includes(current.status)) return current;
      if (action === 'confirm-received' && current.status === 'buyer_confirmed_received') return current;
      let next: Reimbursement;
      try { next = action === 'report-sent' ? payerReportedSent(current, actor) : buyerConfirmedReceived(current, actor); }
      catch { throw new FulfillmentError('INVALID_STATE', 'This payment request cannot make that transition.', 409); }
      s.reimbursements[id] = next; return next;
    });
  }

  async setRepaymentLink(actor: ActorContext, planId: string, payPalMe: string): Promise<void> {
    const plan = await this.plan(actor, planId); assert(plan.buyerUserId, 'BUYER_REQUIRED', 'Nominate a buyer.'); this.buyer(actor, plan.buyerUserId);
    const handle = normalizePayPalMeHandle(payPalMe);
    await this.repository.transact(s => {
      const ids = new Set(Object.values(s.bookings).filter(b => b.planId === planId).map(b => b.id));
      for (const row of Object.values(s.reimbursements)) if (ids.has(row.bookingId) && row.recipientUserId === actor.userId) {
        if (row.mode === 'test') {
          row.paymentUrl = null;
          if (row.status === 'draft') row.status = 'requested';
          const safeText = `TEST — simulated share is $${(row.amount.amountMinor / 100).toFixed(2)} USD. No payment is due; do not pay. Booking reference: ${row.bookingId}.`;
          for (const key of [`request:${row.id}`, `link:${row.id}`]) {
            const delivery = s.deliveries[key];
            if (delivery) delivery.text = safeText;
          }
          continue;
        }
        if (row.status !== 'draft') continue;
        row.paymentUrl = buildPayPalMePaymentUrl(handle, row.amount); row.status = 'requested';
        const delivery = s.deliveries[`request:${row.id}`];
        if (delivery?.status === 'pending') delivery.text += ` Repay: ${row.paymentUrl}`;
        else if (delivery) s.deliveries[`link:${row.id}`] = { ...delivery, id: `link:${row.id}`, status: 'pending', text: `Your repayment link for $${(row.amount.amountMinor / 100).toFixed(2)} USD: ${row.paymentUrl}` };
      }
    });
  }

  async requestChange(actor: ActorContext, planId: string, text: string, expectedRevision: number): Promise<{ id: string; status: 'buyer_handoff' }> {
    const plan = await this.plan(actor, planId); this.revision(plan, expectedRevision);
    assert(text.trim().length > 0 && text.length <= 2000, 'INVALID_INPUT', 'Describe the requested change.', 400);
    const id = randomUUID();
    await this.repository.transact(s => {
      const booking = Object.values(s.bookings).find(b => b.planId === planId && SUCCESS.has(b.status));
      assert(booking, 'PLAN_REPAIR_REQUIRED', 'This plan is not booked yet. Send the change to the planning agent.', 409);
      const buyer = booking.buyerUserId ?? plan.buyerUserId; assert(buyer, 'BUYER_REQUIRED', 'The booking buyer is missing.');
      s.changes[id] = { id, planId, requestedBy: actor.userId, text, createdAt: this.now().toISOString(), status: 'buyer_handoff' };
      s.deliveries[`change:${id}`] = { id: `change:${id}`, planId, bookingId: booking.id, recipientUserId: buyer, text: `A participant requested a change to booking ${booking.merchantOrderRef ?? booking.id}. Review provider change/cancellation options; no purchase or refund has been made automatically.`, mode: booking.mode, status: 'pending' };
    });
    return { id, status: 'buyer_handoff' };
  }
}
