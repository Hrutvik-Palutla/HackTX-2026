import type { BookingQuote, Money } from './types.ts';

export type AttendeeShare = {
  attendeeUserId: string;
  amount: Money;
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function requireMinor(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer number of cents`);
  }
  return BigInt(value);
}

function requireUsd(money: Money, field: string): bigint {
  if (!money || money.currency !== 'USD') {
    throw new TypeError(`${field} must use USD`);
  }
  return requireMinor(money.amountMinor, field);
}

function toSafeNumber(value: bigint, field: string): number {
  if (value < 0n || value > MAX_SAFE) throw new RangeError(`${field} is outside the safe integer range`);
  return Number(value);
}

/**
 * Allocates a non-negative shared amount in proportion to attendee subtotals.
 * If every subtotal is zero, it uses equal weights. Ties go to the earliest
 * attendee in quote.attendeeUserIds, making every result deterministic.
 */
export function allocateProportionally(
  amountMinor: number,
  weights: readonly number[],
): number[] {
  const amount = requireMinor(amountMinor, 'shared amount');
  if (weights.length === 0) {
    if (amount === 0n) return [];
    throw new RangeError('cannot allocate a non-zero amount without attendees');
  }
  const parsedWeights = weights.map((weight, index) => requireMinor(weight, `weight[${index}]`));
  let totalWeight = parsedWeights.reduce((sum, weight) => sum + weight, 0n);
  const effectiveWeights = totalWeight === 0n
    ? parsedWeights.map(() => 1n)
    : parsedWeights;
  if (totalWeight === 0n) totalWeight = BigInt(weights.length);

  const bases: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0n;
  for (let index = 0; index < effectiveWeights.length; index += 1) {
    const numerator = amount * effectiveWeights[index]!;
    const base = numerator / totalWeight;
    bases.push(base);
    allocated += base;
    remainders.push({ index, remainder: numerator % totalWeight });
  }

  let centsLeft = amount - allocated;
  remainders.sort((a, b) => a.remainder === b.remainder
    ? a.index - b.index
    : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; centsLeft > 0n; index += 1, centsLeft -= 1n) {
    bases[remainders[index % remainders.length]!.index]! += 1n;
  }
  return bases.map((share, index) => toSafeNumber(share, `allocation[${index}]`));
}

/**
 * Splits the exact quote total into per-attendee USD shares. Individual line
 * items stay with their attendee; shared fees and discounts use subtotal
 * weights (equal allocation only when every subtotal is zero).
 */
export function calculateShares(quote: BookingQuote): AttendeeShare[] {
  const attendeeIds = quote.attendeeUserIds;
  if (!Array.isArray(attendeeIds) || attendeeIds.length === 0) {
    throw new RangeError('quote must name at least one attendee');
  }
  if (new Set(attendeeIds).size !== attendeeIds.length || attendeeIds.some((id) => !id)) {
    throw new TypeError('attendee IDs must be non-empty and unique');
  }
  if (!quote.buyerUserId || !attendeeIds.includes(quote.buyerUserId)) {
    throw new TypeError('quote buyer must be one of the named attendees');
  }

  const attendeeIndex = new Map(attendeeIds.map((id, index) => [id, index]));
  const subtotals = attendeeIds.map(() => 0n);
  for (const [index, line] of quote.lineItems.entries()) {
    const target = attendeeIndex.get(line.attendeeUserId);
    if (target === undefined) throw new TypeError(`lineItems[${index}] names a non-attendee`);
    subtotals[target]! += requireUsd(line.amount, `lineItems[${index}].amount`);
  }

  const sharedFees = requireUsd(quote.sharedFees, 'sharedFees');
  const sharedDiscount = requireUsd(quote.sharedDiscount, 'sharedDiscount');
  const quoteTotal = requireUsd(quote.total, 'total');
  const subtotalTotal = subtotals.reduce((sum, value) => sum + value, 0n);
  if (subtotalTotal > MAX_SAFE) throw new RangeError('line item subtotal exceeds the safe integer range');
  const expectedTotal = subtotalTotal + sharedFees - sharedDiscount;
  if (expectedTotal < 0n) throw new RangeError('shared discount exceeds the charged subtotal and fees');
  if (expectedTotal !== quoteTotal) throw new RangeError('quote total does not equal line items plus fees minus discount');

  const weights = subtotals.map((value) => toSafeNumber(value, 'attendee subtotal'));
  const feeShares = allocateProportionally(toSafeNumber(sharedFees, 'sharedFees'), weights).map(BigInt);
  const discountShares = allocateProportionally(toSafeNumber(sharedDiscount, 'sharedDiscount'), weights).map(BigInt);
  const shares = subtotals.map((subtotal, index) => subtotal + feeShares[index]! - discountShares[index]!);

  if (shares.some((share) => share < 0n)) throw new RangeError('calculated attendee share cannot be negative');
  const sum = shares.reduce((acc, share) => acc + share, 0n);
  if (sum !== quoteTotal) throw new Error('internal share allocation did not conserve the quote total');
  return attendeeIds.map((attendeeUserId, index) => ({
    attendeeUserId,
    amount: { amountMinor: toSafeNumber(shares[index]!, 'attendee share'), currency: 'USD' },
  }));
}
