import type { ActorContext, BookingResult, Money, Reimbursement } from './types.ts';
import type { AttendeeShare } from './splits.ts';

export type PrivateReimbursementMessage = {
  recipientUserId: string;
  amount: Money;
  paymentUrl: string | null;
  status: Reimbursement['status'];
};

export type BuyerReimbursementLedgerRow = {
  payerUserId: string;
  amount: Money;
  paymentUrl: string | null;
  status: Reimbursement['status'];
  mode: Reimbursement['mode'];
};

const HANDLE = /^[A-Za-z0-9]{1,20}$/;
const AMOUNT_PATH = /^\d+(?:\.\d{1,2})?USD$/;

/** Accept a PayPal.Me handle or a plain HTTPS PayPal.Me URL; reject all other hosts and schemes. */
export function normalizePayPalMeHandle(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('PayPal.Me handle or URL is required');
  const input = value.trim();
  let handle: string;
  if (/^[A-Za-z0-9]{1,20}$/.test(input)) {
    handle = input;
  } else {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new TypeError('expected a PayPal.Me handle or HTTPS URL');
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'paypal.me'
      || url.username || url.password || url.port || url.search || url.hash) {
      throw new TypeError('only plain HTTPS paypal.me URLs are accepted');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 1 || segments.length > 2 || (segments.length === 2 && !AMOUNT_PATH.test(segments[1]!))) {
      throw new TypeError('PayPal.Me URL must contain a handle and optional USD amount');
    }
    try {
      handle = decodeURIComponent(segments[0]!);
    } catch {
      throw new TypeError('invalid PayPal.Me handle encoding');
    }
    if (!HANDLE.test(handle)) throw new TypeError('invalid PayPal.Me handle');
  }
  return handle;
}

/** Build a PayPal.Me USD request link from an integer-cent amount. */
export function buildPayPalMePaymentUrl(handleOrUrl: string, amount: Money): string {
  if (!amount || amount.currency !== 'USD') throw new TypeError('PayPal.Me amount must use USD');
  if (!Number.isSafeInteger(amount.amountMinor) || amount.amountMinor < 0) {
    throw new RangeError('PayPal.Me amount must be non-negative safe integer cents');
  }
  const handle = normalizePayPalMeHandle(handleOrUrl);
  const dollars = Math.floor(amount.amountMinor / 100);
  const cents = amount.amountMinor % 100;
  return `https://paypal.me/${handle}/${dollars}.${String(cents).padStart(2, '0')}USD`;
}

function validateBookingForReimbursements(booking: BookingResult): void {
  if (booking.status !== 'merchant_confirmed' && booking.status !== 'buyer_reported' && booking.status !== 'test_confirmed') {
    throw new Error(`booking status ${booking.status} is not eligible for reimbursement creation`);
  }
  if (booking.status === 'merchant_confirmed' && booking.mode !== 'live') {
    throw new Error('test-mode booking cannot be represented as merchant-confirmed');
  }
  if (booking.status === 'test_confirmed' && booking.mode !== 'test') {
    throw new Error('test-confirmed booking must preserve test mode');
  }
}

function pairKey(bookingId: string, payerUserId: string): string {
  return `${bookingId}\u0000${payerUserId}`;
}

/**
 * Creates one private reimbursement row per nonbuyer. Deterministic IDs make
 * retries idempotent; pass existing rows from the repository before persisting.
 */
export function createReimbursements(
  booking: BookingResult,
  buyerUserId: string,
  shares: readonly AttendeeShare[],
  buyerPayPalMe: string | null,
  existing: readonly Reimbursement[] = [],
): Reimbursement[] {
  validateBookingForReimbursements(booking);
  if (!booking.id || !buyerUserId) throw new TypeError('booking and buyer IDs are required');
  if (booking.actualTotal === null) throw new Error('eligible booking must have an actual total before reimbursements are created');
  if (booking.actualTotal.currency !== 'USD' || !Number.isSafeInteger(booking.actualTotal.amountMinor) || booking.actualTotal.amountMinor < 0) {
    throw new RangeError('booking actual total must be non-negative safe integer USD cents');
  }
  const handle = buyerPayPalMe === null ? null : normalizePayPalMeHandle(buyerPayPalMe);
  const existingByPair = new Map(existing.map((item) => [pairKey(item.bookingId, item.payerUserId), item]));
  const seen = new Set<string>();
  const created: Reimbursement[] = [];
  let sharesTotal = 0n;
  let includesBuyer = false;

  for (const share of shares) {
    const payerUserId = share.attendeeUserId;
    if (!payerUserId || seen.has(payerUserId)) throw new TypeError('share attendee IDs must be non-empty and unique');
    seen.add(payerUserId);
    if (share.amount.currency !== 'USD' || !Number.isSafeInteger(share.amount.amountMinor) || share.amount.amountMinor < 0) {
      throw new RangeError('reimbursement shares must be non-negative safe integer USD cents');
    }
    sharesTotal += BigInt(share.amount.amountMinor);
    if (payerUserId === buyerUserId) {
      includesBuyer = true;
      continue;
    }
    const key = pairKey(booking.id, payerUserId);
    const existingRow = existingByPair.get(key);
    if (existingRow) {
      if (existingRow.recipientUserId !== buyerUserId
        || existingRow.amount.currency !== share.amount.currency
        || existingRow.amount.amountMinor !== share.amount.amountMinor
        || existingRow.mode !== booking.mode) {
        throw new Error(`existing reimbursement for ${payerUserId} conflicts with the booking share`);
      }
      continue;
    }
    const id = `reimbursement:${encodeURIComponent(booking.id)}:${encodeURIComponent(payerUserId)}`;
    created.push({
      id,
      bookingId: booking.id,
      payerUserId,
      recipientUserId: buyerUserId,
      amount: { ...share.amount },
      paymentUrl: booking.mode === 'test' || handle === null ? null : buildPayPalMePaymentUrl(handle, share.amount),
      // Test bookings retain the full requested/sent/received state machine,
      // but can never carry a link that moves real money.
      status: booking.mode === 'test' || handle !== null ? 'requested' : 'draft',
      confirmationSource: 'none',
      mode: booking.mode,
    });
  }
  if (!includesBuyer) throw new TypeError('shares must include the original buyer');
  if (sharesTotal !== BigInt(booking.actualTotal.amountMinor)) {
    throw new RangeError('attendee shares must sum to the booking actual total');
  }
  return created;
}

/** The payer can receive only their own amount and payment link. */
export function buildPrivateReimbursementMessage(
  reimbursement: Reimbursement,
  actor: ActorContext,
): PrivateReimbursementMessage {
  if (actor.userId !== reimbursement.payerUserId) throw new Error('only the payer may receive this private request');
  return {
    recipientUserId: reimbursement.payerUserId,
    amount: { ...reimbursement.amount },
    paymentUrl: reimbursement.paymentUrl,
    status: reimbursement.status,
  };
}

/** The original buyer alone can inspect the booking's payer ledger. */
export function projectBuyerReimbursementLedger(
  reimbursements: readonly Reimbursement[],
  actor: ActorContext,
  bookingId?: string,
): BuyerReimbursementLedgerRow[] {
  const relevant = bookingId === undefined
    ? reimbursements
    : reimbursements.filter((item) => item.bookingId === bookingId);
  if (relevant.some((item) => item.recipientUserId !== actor.userId)) {
    throw new Error('only the original buyer may inspect this reimbursement ledger');
  }
  return relevant.map((item) => ({
    payerUserId: item.payerUserId,
    amount: { ...item.amount },
    paymentUrl: item.paymentUrl,
    status: item.status,
    mode: item.mode,
  }));
}

function assertTransitionActor(reimbursement: Reimbursement, actor: ActorContext, expectedUserId: string, message: string): void {
  if (actor.userId !== expectedUserId) throw new Error(message);
  if (reimbursement.mode !== 'live' && reimbursement.mode !== 'test') throw new TypeError('invalid reimbursement mode');
}

/** Record the payer's own manual statement; this is not provider verification. */
export function payerReportedSent(reimbursement: Reimbursement, actor: ActorContext): Reimbursement {
  assertTransitionActor(reimbursement, actor, reimbursement.payerUserId, 'only the payer may report sending');
  if (reimbursement.status !== 'requested' && reimbursement.status !== 'draft') {
    throw new Error(`cannot report sent from ${reimbursement.status}`);
  }
  return { ...reimbursement, status: 'payer_reported_sent', confirmationSource: 'none' };
}

/** Record a manual receipt acknowledgment by the original buyer. */
export function buyerConfirmedReceived(reimbursement: Reimbursement, actor: ActorContext): Reimbursement {
  assertTransitionActor(reimbursement, actor, reimbursement.recipientUserId, 'only the original buyer may confirm receipt');
  if (reimbursement.status !== 'payer_reported_sent') {
    throw new Error(`cannot confirm receipt from ${reimbursement.status}`);
  }
  return { ...reimbursement, status: 'buyer_confirmed_received', confirmationSource: 'manual_buyer' };
}
