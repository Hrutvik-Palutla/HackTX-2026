import test from 'node:test';
import assert from 'node:assert/strict';
import type { BookingQuote, Money } from '../src/types.ts';
import { allocateProportionally, calculateShares } from '../src/splits.ts';

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });

function quote(input: {
  lineAmounts: number[];
  fees?: number;
  discount?: number;
}): BookingQuote {
  const attendeeUserIds = input.lineAmounts.map((_, index) => `u${index + 1}`);
  const subtotal = input.lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const fees = input.fees ?? 0;
  const discount = input.discount ?? 0;
  return {
    id: 'q1', planId: 'p1', versionId: 'v1', optionId: 'o1', attendeeUserIds,
    buyerUserId: attendeeUserIds[0]!, merchantHost: 'tickets.example',
    merchantUrl: 'https://tickets.example/checkout', performanceRef: null,
    seatRefs: [],
    lineItems: input.lineAmounts.map((amount, index) => ({ attendeeUserId: attendeeUserIds[index]!, label: 'ticket', amount: usd(amount) })),
    sharedFees: usd(fees), sharedDiscount: usd(discount), total: usd(subtotal + fees - discount),
    expiresAt: '2026-10-25T00:00:00Z', bindingHash: 'hash', mode: 'test',
  };
}

test('equal ticket costs stay equal after shared odd-cent fees and discounts', () => {
  const shares = calculateShares(quote({ lineAmounts: [1000, 1000, 1000], fees: 5, discount: 2 }));
  assert.deepEqual(shares.map((share) => share.amount.amountMinor), [1001, 1001, 1001]);
  assert.equal(shares.reduce((sum, share) => sum + share.amount.amountMinor, 0), 3003);
});

test('unequal attendee subtotals receive proportional shared fees and discounts', () => {
  const shares = calculateShares(quote({ lineAmounts: [1000, 2000, 3000], fees: 7, discount: 4 }));
  assert.deepEqual(shares.map((share) => share.amount.amountMinor), [1000, 2001, 3002]);
  assert.equal(shares.reduce((sum, share) => sum + share.amount.amountMinor, 0), 6003);
});

test('all-zero subtotals split a shared charge equally with stable leftover cents', () => {
  const shares = calculateShares(quote({ lineAmounts: [0, 0, 0], fees: 5 }));
  assert.deepEqual(shares.map((share) => share.amount.amountMinor), [2, 2, 1]);
  assert.equal(shares.reduce((sum, share) => sum + share.amount.amountMinor, 0), 5);
});

test('rejects negative, fractional, unsafe, mismatched and negative-result inputs', () => {
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => allocateProportionally(invalid, [1]));
  }
  assert.throws(() => allocateProportionally(1, [-1]));
  assert.throws(() => allocateProportionally(1, [1.2]));
  assert.throws(() => calculateShares(quote({ lineAmounts: [100], fees: -1 })));
  const badLine = quote({ lineAmounts: [100] });
  badLine.lineItems[0]!.amount = usd(-1);
  assert.throws(() => calculateShares(badLine));
  const fractionalLine = quote({ lineAmounts: [100] });
  fractionalLine.lineItems[0]!.amount = usd(1.25);
  assert.throws(() => calculateShares(fractionalLine));
  const mismatched = quote({ lineAmounts: [100] });
  mismatched.total = usd(99);
  assert.throws(() => calculateShares(mismatched));
  assert.throws(() => calculateShares(quote({ lineAmounts: [1, 0], discount: 2 })));
});

test('largest remainder ties use attendee order and conserve each allocation', () => {
  assert.deepEqual(allocateProportionally(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(allocateProportionally(11, [1, 2, 3]), [2, 4, 5]);
});

test('deterministic varied inputs conserve total and never produce negative shares', () => {
  let seed = 0x5eed;
  const next = (limit: number): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % limit;
  };
  for (let trial = 0; trial < 250; trial += 1) {
    const count = 1 + next(8);
    const lineAmounts = Array.from({ length: count }, () => next(20_000));
    const subtotal = lineAmounts.reduce((sum, amount) => sum + amount, 0);
    const fees = next(1000);
    const discount = next(subtotal + fees + 1);
    const shares = calculateShares(quote({ lineAmounts, fees, discount }));
    assert.equal(shares.reduce((sum, share) => sum + share.amount.amountMinor, 0), subtotal + fees - discount);
    assert.ok(shares.every((share) => share.amount.amountMinor >= 0));
  }
});
