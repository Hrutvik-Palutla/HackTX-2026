import { createHash } from 'node:crypto';
import { assert } from './errors.ts';
import type { BookingQuote, Money } from './types.ts';

export function validateMoney(money: Money, label = 'amount'): void {
  assert(money?.currency === 'USD' && Number.isSafeInteger(money.amountMinor) && money.amountMinor >= 0, 'INVALID_MONEY', `Invalid ${label}.`);
}

export function quoteBinding(quote: BookingQuote): string {
  return createHash('sha256').update(JSON.stringify({
    planId: quote.planId, versionId: quote.versionId, optionId: quote.optionId,
    attendees: [...quote.attendeeUserIds].sort(), buyer: quote.buyerUserId,
    merchantHost: quote.merchantHost, merchantUrl: quote.merchantUrl,
    performanceRef: quote.performanceRef, seats: [...quote.seatRefs].sort(),
    lineItems: [...quote.lineItems].sort((a, b) => a.attendeeUserId.localeCompare(b.attendeeUserId) || a.label.localeCompare(b.label) || a.amount.amountMinor - b.amount.amountMinor),
    fees: quote.sharedFees, discount: quote.sharedDiscount, total: quote.total,
    expiresAt: quote.expiresAt, mode: quote.mode,
  })).digest('hex');
}

export function validateQuote(quote: BookingQuote, now = new Date()): void {
  assert(quote && (quote.mode === 'test' || quote.mode === 'live'), 'INVALID_QUOTE', 'Invalid quote mode.');
  assert(quote.attendeeUserIds.length > 0 && new Set(quote.attendeeUserIds).size === quote.attendeeUserIds.length, 'INVALID_QUOTE', 'Quote attendees must be unique.');
  assert(quote.attendeeUserIds.includes(quote.buyerUserId), 'INVALID_QUOTE', 'The buyer must be an attendee.');
  assert(Number.isFinite(Date.parse(quote.expiresAt)) && Date.parse(quote.expiresAt) > now.getTime(), 'QUOTE_EXPIRED', 'This quote expired. Request a new quote.', 409);
  let url: URL;
  try { url = new URL(quote.merchantUrl); } catch { throw new Error('Invalid merchant URL.'); }
  const localTest = quote.mode === 'test' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  assert(url.protocol === 'https:' || (localTest && url.protocol === 'http:'), 'INVALID_QUOTE', 'Merchant URL must use HTTPS.');
  assert(!url.username && !url.password && url.hostname === quote.merchantHost, 'INVALID_QUOTE', 'Merchant host does not match the quote.');
  validateMoney(quote.total, 'total'); validateMoney(quote.sharedFees, 'fees'); validateMoney(quote.sharedDiscount, 'discount');
  let total = BigInt(quote.sharedFees.amountMinor) - BigInt(quote.sharedDiscount.amountMinor);
  const represented = new Set<string>();
  for (const item of quote.lineItems) {
    validateMoney(item.amount, 'item price');
    assert(quote.attendeeUserIds.includes(item.attendeeUserId), 'INVALID_QUOTE', 'Quote contains an unknown attendee.');
    represented.add(item.attendeeUserId);
    total += BigInt(item.amount.amountMinor);
  }
  assert(represented.size === quote.attendeeUserIds.length && total === BigInt(quote.total.amountMinor), 'INVALID_QUOTE', 'Quote total or attendee items do not match.');
  assert(quote.bindingHash === quoteBinding(quote), 'QUOTE_CHANGED', 'The quote details changed. Request a new approval.', 409);
}
