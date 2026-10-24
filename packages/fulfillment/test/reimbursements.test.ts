import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActorContext, BookingResult } from '../src/types.ts';
import {
  buildPayPalMePaymentUrl,
  buildPrivateReimbursementMessage,
  buyerConfirmedReceived,
  createReimbursements,
  normalizePayPalMeHandle,
  payerReportedSent,
  projectBuyerReimbursementLedger,
} from '../src/reimbursements.ts';
import type { AttendeeShare } from '../src/splits.ts';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });
const payer: ActorContext = { userId: 'friend', source: 'private_message' };
const buyer: ActorContext = { userId: 'buyer', source: 'web' };

function booking(overrides: Partial<BookingResult> = {}): BookingResult {
  return {
    id: 'book-1', planId: 'plan-1', versionId: 'v1', quoteId: 'q1', authorizationId: null,
    status: 'merchant_confirmed', merchantOrderRef: 'merchant-order', confirmationUrl: null,
    actualTotal: usd(1001), mode: 'live', ...overrides,
  };
}

const shares: AttendeeShare[] = [
  { attendeeUserId: 'buyer', amount: usd(600) },
  { attendeeUserId: 'friend', amount: usd(401) },
];

test('validates PayPal.Me handles and generates USD links with exact cents', () => {
  assert.equal(normalizePayPalMeHandle('Alex123'), 'Alex123');
  assert.equal(normalizePayPalMeHandle('https://paypal.me/Alex123'), 'Alex123');
  assert.equal(normalizePayPalMeHandle('https://paypal.me/Alex123/4.01USD'), 'Alex123');
  assert.equal(buildPayPalMePaymentUrl('https://paypal.me/Alex123', usd(401)), 'https://paypal.me/Alex123/4.01USD');
  assert.equal(buildPayPalMePaymentUrl('Alex123', usd(0)), 'https://paypal.me/Alex123/0.00USD');
  for (const invalid of [
    'javascript:alert(1)', 'http://paypal.me/Alex', 'https://paypal.me.evil.example/Alex',
    'https://evil.example/paypal.me/Alex', 'https://user@paypal.me/Alex',
    'https://paypal.me/Alex/4.01EUR', 'https://paypal.me/Alex/one/two', 'bad-handle',
  ]) assert.throws(() => normalizePayPalMeHandle(invalid), { name: 'TypeError' });
  assert.throws(() => buildPayPalMePaymentUrl('Alex', { amountMinor: 1.1, currency: 'USD' }));
});

test('creates one reimbursement per nonbuyer and preserves booking mode', () => {
  const result = createReimbursements(booking(), 'buyer', shares, 'https://paypal.me/Alex');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: 'reimbursement:book-1:friend', bookingId: 'book-1', payerUserId: 'friend', recipientUserId: 'buyer',
    amount: usd(401), paymentUrl: 'https://paypal.me/Alex/4.01USD', status: 'requested',
    confirmationSource: 'none', mode: 'live',
  });
  assert.deepEqual(createReimbursements(booking(), 'buyer', shares, 'Alex', result), []);
  assert.throws(() => createReimbursements(booking(), 'buyer', shares, 'Alex', [{ ...result[0]!, amount: usd(400) }]));
  assert.equal(createReimbursements(booking({ mode: 'test', status: 'test_confirmed' }), 'buyer', shares, null)[0]!.mode, 'test');
  assert.equal(createReimbursements(booking(), 'buyer', shares, null)[0]!.status, 'draft');
});

test('test reimbursements have no live PayPal link but retain simulated manual transitions', () => {
  const [created] = createReimbursements(booking({ mode: 'test', status: 'test_confirmed' }), 'buyer', shares, 'https://paypal.me/Alex');
  assert.equal(created!.paymentUrl, null);
  assert.equal(created!.status, 'requested');
  const sent = payerReportedSent(created!, payer);
  const received = buyerConfirmedReceived(sent, buyer);
  assert.equal(received.status, 'buyer_confirmed_received');
  assert.equal(received.confirmationSource, 'manual_buyer');
  assert.equal(received.mode, 'test');
});

test('requires a reportable purchase state, matching mode, actual total, and conserved shares', () => {
  assert.throws(() => createReimbursements(booking({ status: 'submitting' }), 'buyer', shares, null));
  assert.throws(() => createReimbursements(booking({ status: 'merchant_confirmed', mode: 'test' }), 'buyer', shares, null));
  assert.throws(() => createReimbursements(booking({ status: 'test_confirmed', mode: 'live' }), 'buyer', shares, null));
  assert.throws(() => createReimbursements(booking({ actualTotal: null }), 'buyer', shares, null));
  assert.throws(() => createReimbursements(booking(), 'buyer', [{ ...shares[0]!, amount: usd(599) }, shares[1]!], null));
  assert.throws(() => createReimbursements(booking(), 'buyer', [shares[1]!], null));
  const testMode = booking({ status: 'test_confirmed', mode: 'test' });
  assert.equal(createReimbursements(testMode, 'buyer', shares, null)[0]!.status, 'requested');
});

test('private message reveals only the addressed payer reimbursement', () => {
  const [reimbursement] = createReimbursements(booking(), 'buyer', shares, 'Alex');
  const message = buildPrivateReimbursementMessage(reimbursement!, payer);
  assert.deepEqual(message, { recipientUserId: 'friend', amount: usd(401), paymentUrl: 'https://paypal.me/Alex/4.01USD', status: 'requested' });
  assert.equal('buyerUserId' in message, false);
  assert.throws(() => buildPrivateReimbursementMessage(reimbursement!, buyer), /only the payer/);
});

test('buyer ledger is recipient-only and includes repayment mode/status', () => {
  const rows = createReimbursements(booking(), 'buyer', shares, 'Alex');
  assert.deepEqual(projectBuyerReimbursementLedger(rows, buyer, 'book-1'), [{
    payerUserId: 'friend', amount: usd(401), paymentUrl: 'https://paypal.me/Alex/4.01USD', status: 'requested', mode: 'live',
  }]);
  assert.throws(() => projectBuyerReimbursementLedger(rows, payer, 'book-1'), /only the original buyer/);
});

test('only the payer reports sent, only the buyer confirms, and neither claim is provider verified', () => {
  const [created] = createReimbursements(booking(), 'buyer', shares, 'Alex');
  assert.throws(() => payerReportedSent(created!, buyer), /only the payer/);
  const sent = payerReportedSent(created!, payer);
  assert.equal(sent.status, 'payer_reported_sent');
  assert.equal(sent.confirmationSource, 'none');
  assert.throws(() => buyerConfirmedReceived(sent, payer), /only the original buyer/);
  const received = buyerConfirmedReceived(sent, buyer);
  assert.equal(received.status, 'buyer_confirmed_received');
  assert.equal(received.confirmationSource, 'manual_buyer');
  assert.equal(received.mode, 'live');
  assert.throws(() => payerReportedSent(received, payer), /cannot report sent/);
  assert.throws(() => buyerConfirmedReceived(created!, buyer), /cannot confirm receipt/);
});
