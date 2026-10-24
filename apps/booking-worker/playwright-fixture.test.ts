import test from 'node:test';
import assert from 'node:assert/strict';
import { runOwnedFixtureBrowserTest } from './worker.ts';
import type { BookingQuote } from '../../packages/fulfillment/src/types.ts';

// This worker runtime dependency is intentionally optional until the isolated browser image is pinned.
let playwrightAvailable = false;
try {
  // @ts-ignore Playwright is installed only in the isolated booking-worker image.
  await import('playwright');
  playwrightAvailable = true;
} catch {
  playwrightAvailable = false;
}

test('owned fake-money checkout works in a real headless browser', { skip: !playwrightAvailable }, async (t) => {
  const quote: BookingQuote = {
    id: 'quote_123', planId: 'plan_123', versionId: 'version_123', optionId: 'option_123',
    attendeeUserIds: ['buyer_123'], buyerUserId: 'buyer_123', merchantHost: 'fixture.booking.test',
    merchantUrl: 'https://fixture.booking.test/checkout', performanceRef: null, seatRefs: [],
    lineItems: [{ attendeeUserId: 'buyer_123', label: 'Test ticket', amount: { amountMinor: 500, currency: 'USD' } }],
    sharedFees: { amountMinor: 0, currency: 'USD' }, sharedDiscount: { amountMinor: 0, currency: 'USD' },
    total: { amountMinor: 500, currency: 'USD' }, expiresAt: '2099-01-01T00:00:00.000Z',
    bindingHash: 'binding_123', mode: 'test',
  };
  let result;
  try {
    result = await runOwnedFixtureBrowserTest(quote);
  } catch (error) {
    if (error instanceof Error && /Executable doesn't exist|Please run the following command to download new browsers/.test(error.message)) {
      t.skip('Playwright is installed but its Chromium browser binary is not installed.');
      return;
    }
    throw error;
  }
  assert.equal(result.kind, 'confirmed');
  if (result.kind === 'confirmed') assert.match(result.merchantOrderRef, /^TEST-/);
});
