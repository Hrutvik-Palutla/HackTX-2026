import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingWorker, OwnedTestCheckoutDriver, type FixturePage } from './worker.ts';
import type { BookingQuote, BuyerAuthorization } from '../../packages/fulfillment/src/types.ts';

function quote(mode: 'test' | 'live' = 'test'): BookingQuote {
  return {
    id: 'quote_123', planId: 'plan_123', versionId: 'version_123', optionId: 'option_123',
    attendeeUserIds: ['user_123', 'user_456'], buyerUserId: 'user_123',
    merchantHost: 'fixture.booking.test', merchantUrl: 'https://fixture.booking.test/checkout',
    performanceRef: 'fixture-screening', seatRefs: ['A1', 'A2'],
    lineItems: [
      { attendeeUserId: 'user_123', label: 'Ticket', amount: { amountMinor: 1000, currency: 'USD' } },
      { attendeeUserId: 'user_456', label: 'Ticket', amount: { amountMinor: 1000, currency: 'USD' } },
    ],
    sharedFees: { amountMinor: 0, currency: 'USD' }, sharedDiscount: { amountMinor: 0, currency: 'USD' },
    total: { amountMinor: 2000, currency: 'USD' }, expiresAt: '2099-01-01T00:00:00.000Z',
    bindingHash: 'binding_123', mode,
  };
}

const authorization: BuyerAuthorization = {
  id: 'authorization_123', quoteId: 'quote_123', buyerUserId: 'user_123', walletRequestId: 'lsrq_123',
  status: 'approved', approvedBindingHash: 'binding_123', checkedAt: '2026-10-24T12:00:00.000Z', mode: 'test',
};

class FakeFixturePage implements FixturePage {
  private values = new Map<string, string>();
  private attrs = new Map<string, string>();
  private messages = new Map<string, string>();
  content = '';
  async setContent(html: string): Promise<void> { this.content = html; this.values.clear(); this.attrs.clear(); this.messages.clear(); }
  locator(selector: string) {
    return {
      fill: async (value: string) => { this.values.set(selector, value); },
      click: async () => {
        if (selector === '[data-testid="place-test-order"]' && this.values.has('[data-testid="attendees"]')) {
          const ref = 'TEST-order_fixture_123';
          this.attrs.set('[data-testid="confirmation"]:data-order-ref', ref);
          this.messages.set('[data-testid="confirmation"]', `Test order confirmed: ${ref}`);
        }
      },
      textContent: async () => this.messages.get(selector) ?? null,
      getAttribute: async (name: string) => this.attrs.get(`${selector}:${name}`) ?? null,
    };
  }
}

test('owned checkout fixture produces an explicitly test-only confirmation', async () => {
  const q = quote();
  const driver = new OwnedTestCheckoutDriver(new FakeFixturePage());
  const worker = new BookingWorker({
    mode: 'test', allowedHosts: new Set([driver.host]), drivers: new Map([[driver.host, driver]]),
    verifyQuoteBinding: async () => true,
    withCredential: async () => { throw new Error('test fixture never uses a payment credential'); },
  });
  const result = await worker.submit({ quote: q, authorization });
  assert.equal(result.status, 'test_confirmed');
  assert.equal(result.mode, 'test');
  assert.match(result.merchantOrderRef ?? '', /^TEST-/);
  assert.equal(result.actualTotal?.amountMinor, q.total.amountMinor);
});

test('owned fixture HTML is loaded only when the fixture driver runs', async () => {
  const page = new FakeFixturePage();
  const driver = new OwnedTestCheckoutDriver(page, '<main>fixture injected by test</main>');
  await driver.run({ quote: quote(), signal: new AbortController().signal });
  assert.equal(page.content, '<main>fixture injected by test</main>');
});

test('changed authorization binding stops before checkout', async () => {
  const result = await new BookingWorker({
    mode: 'test', allowedHosts: new Set(['fixture.booking.test']),
    drivers: new Map(), verifyQuoteBinding: async () => true,
    withCredential: async () => { throw new Error('must not execute'); },
  }).submit({ quote: quote(), authorization: { ...authorization, approvedBindingHash: 'stale' } });
  assert.equal(result.status, 'failed');
  assert.equal(result.merchantOrderRef, null);
});

test('unknown checkout result is recorded as uncertain and does not retry', async () => {
  let attempts = 0;
  const q = { ...quote('live'), merchantHost: 'shop.example.test', merchantUrl: 'https://shop.example.test/checkout' };
  const driver = {
    host: q.merchantHost,
    async run() { attempts += 1; return { kind: 'unknown' as const }; },
  };
  const liveAuthorization = { ...authorization, mode: 'live' as const };
  const result = await new BookingWorker({
    mode: 'live', allowedHosts: new Set([q.merchantHost]), drivers: new Map([[driver.host, driver]]),
    verifyQuoteBinding: async () => true,
    withCredential: async (_id, use) => use('/private/one-use-card.json'),
    fillPaymentCredential: async () => undefined,
  }).submit({ quote: q, authorization: liveAuthorization });
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(attempts, 1);
});

test('confirmed merchant order keeps its authoritative actual total when it differs from the quote', async () => {
  const q = { ...quote('live'), merchantHost: 'shop.example.test', merchantUrl: 'https://shop.example.test/checkout' };
  const actualTotal = { amountMinor: q.total.amountMinor + 325, currency: 'USD' as const };
  const driver = {
    host: q.merchantHost,
    async run() { return { kind: 'confirmed' as const, merchantOrderRef: 'ORDER-actual-42', actualTotal }; },
  };
  const result = await new BookingWorker({
    mode: 'live', allowedHosts: new Set([q.merchantHost]), drivers: new Map([[driver.host, driver]]),
    verifyQuoteBinding: async () => true,
    withCredential: async (_id, use) => use('/private/one-use-card.json'),
    fillPaymentCredential: async () => undefined,
  }).submit({ quote: q, authorization: { ...authorization, mode: 'live' } });
  assert.equal(result.status, 'merchant_confirmed');
  assert.equal(result.merchantOrderRef, 'ORDER-actual-42');
  assert.deepEqual(result.actualTotal, actualTotal);
});

test('invalid negative confirmed total remains unresolved', async () => {
  const q = { ...quote('live'), merchantHost: 'shop.example.test', merchantUrl: 'https://shop.example.test/checkout' };
  const driver = {
    host: q.merchantHost,
    async run() {
      return {
        kind: 'confirmed' as const,
        merchantOrderRef: 'ORDER-invalid-total',
        actualTotal: { amountMinor: -1, currency: 'USD' as const },
      };
    },
  };
  const result = await new BookingWorker({
    mode: 'live', allowedHosts: new Set([q.merchantHost]), drivers: new Map([[driver.host, driver]]),
    verifyQuoteBinding: async () => true,
    withCredential: async (_id, use) => use('/private/one-use-card.json'),
    fillPaymentCredential: async () => undefined,
  }).submit({ quote: q, authorization: { ...authorization, mode: 'live' } });
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(result.merchantOrderRef, null);
  assert.equal(result.actualTotal, null);
});

test('driver timeout aborts the session and returns an uncertain result', async () => {
  const q = { ...quote('live'), merchantHost: 'shop.example.test', merchantUrl: 'https://shop.example.test/checkout' };
  let signal: AbortSignal | undefined;
  let attempts = 0;
  const driver = {
    host: q.merchantHost,
    run(input: { signal: AbortSignal }) {
      attempts += 1;
      signal = input.signal;
      return new Promise<{ kind: 'unknown' }>((resolve) => {
        input.signal.addEventListener('abort', () => resolve({ kind: 'unknown' }), { once: true });
      });
    },
  };
  const result = await new BookingWorker({
    mode: 'live', allowedHosts: new Set([q.merchantHost]), drivers: new Map([[driver.host, driver]]),
    verifyQuoteBinding: async () => true,
    withCredential: async (_id, use) => use('/private/one-use-card.json'),
    fillPaymentCredential: async () => undefined,
    driverTimeoutMs: 5,
  }).submit({ quote: q, authorization: { ...authorization, mode: 'live' } });
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(signal?.aborted, true);
  assert.equal(attempts, 1);
});

test('test mode never sends Link credentials to a non-owned fixture driver', async () => {
  let attempts = 0;
  const host = 'tickets.test.example';
  const q = { ...quote('test'), merchantHost: host, merchantUrl: `https://${host}/checkout` };
  const driver = { host, async run() { attempts += 1; return { kind: 'unknown' as const }; } };
  const result = await new BookingWorker({
    mode: 'test', allowedHosts: new Set([host]), drivers: new Map([[host, driver]]),
    verifyQuoteBinding: async () => true,
    withCredential: async () => { throw new Error('test mode must not retrieve a payment credential'); },
  }).submit({ quote: q, authorization });
  assert.equal(result.status, 'failed');
  assert.equal(attempts, 0);
});
