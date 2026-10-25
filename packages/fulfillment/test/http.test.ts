import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness, testActor } from '../src/test-fixture.ts';
import { handlePart4, type Part4Runtime } from '../src/http.ts';

const csrf = 'fixture-csrf';

function runtimeFor(harness: ReturnType<typeof createTestHarness>, userId: string | null): Part4Runtime {
  return {
    service: harness.service,
    authenticate: async () => userId === null ? null : testActor(userId),
    authorizeMutation: async (request) => request.headers.get('x-csrf-token') === csrf,
  };
}

function request(method: string, body?: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.test/api', {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

async function data(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

test('HTTP gate rejects missing actors, nonmembers, CSRF failures, and malformed bodies', async () => {
  const harness = createTestHarness();
  const missing = await handlePart4('payment', request('GET'), { id: 'test-plan' }, runtimeFor(harness, null));
  assert.equal(missing.status, 401);

  const wrongActor = await handlePart4('payment', request('GET'), { id: 'test-plan' }, runtimeFor(harness, 'unknown-user'));
  assert.equal(wrongActor.status, 404);

  const deniedCsrf = await handlePart4('handoff', request('POST', JSON.stringify({ expectedRevision: 1 }), {}), { id: 'test-plan' }, runtimeFor(harness, 'buyer'));
  assert.equal(deniedCsrf.status, 403);

  const malformed = await handlePart4('quote', request('POST', '{', { 'x-csrf-token': csrf, 'Idempotency-Key': 'http-test-key' }), { id: 'test-plan' }, runtimeFor(harness, 'buyer'));
  assert.equal(malformed.status, 400);
  assert.equal((await data(malformed)).error.code, 'INVALID_INPUT');
});

test('HTTP journey keeps payment views private and supports manual repayment acknowledgments', async () => {
  const harness = createTestHarness({
    submit: async ({ quote, authorization }) => ({
      id: 'provider-fixture-result', planId: quote.planId, versionId: quote.versionId, quoteId: quote.id,
      authorizationId: authorization.id, status: 'test_confirmed', merchantOrderRef: 'OWNED-TEST-ORDER',
      confirmationUrl: null, actualTotal: quote.total, mode: 'test',
    }),
  });
  const buyerRuntime = runtimeFor(harness, 'buyer');
  const markRuntime = runtimeFor(harness, 'mark');
  const writeHeaders = { 'x-csrf-token': csrf, 'content-type': 'application/json' };

  const quoteResponse = await handlePart4('quote', request('POST', JSON.stringify({
    versionId: 'test-v1', optionId: 'test-option', buyerUserId: 'buyer', expectedRevision: 1,
  }), { ...writeHeaders, 'Idempotency-Key': 'journey-quote' }), { id: 'test-plan' }, buyerRuntime);
  assert.equal(quoteResponse.status, 201);
  const quote = (await data(quoteResponse)).data;

  const approvalResponse = await handlePart4('approve', request('POST', JSON.stringify({ expectedRevision: 1 }), writeHeaders), { id: quote.id }, buyerRuntime);
  assert.equal(approvalResponse.status, 200);
  const authorizationId = (await data(approvalResponse)).data.authorizationId as string;
  harness.wallet.approve(authorizationId);

  const bookingResponse = await handlePart4('book', request('POST', JSON.stringify({ authorizationId, expectedRevision: 1 }), writeHeaders), { id: quote.id }, buyerRuntime);
  assert.equal(bookingResponse.status, 200);
  const booking = (await data(bookingResponse)).data;
  assert.equal(booking.status, 'test_confirmed');
  assert.equal(booking.mode, 'test');
  assert.equal(harness.submissions, 1);

  const buyerViewResponse = await handlePart4('payment', request('GET'), { id: 'test-plan' }, buyerRuntime);
  const buyerView = (await data(buyerViewResponse)).data;
  assert.equal(buyerView.role, 'buyer');
  assert.equal(buyerView.reimbursements.length, 2);
  assert.ok(buyerView.reimbursements.every((row: { mode: string }) => row.mode === 'test'));

  const payerViewResponse = await handlePart4('payment', request('GET'), { id: 'test-plan' }, markRuntime);
  const payerView = (await data(payerViewResponse)).data;
  assert.equal(payerView.role, 'attendee');
  assert.equal(payerView.reimbursements.length, 1);
  assert.equal(payerView.reimbursements[0].payerUserId, 'mark');
  assert.equal(payerView.reimbursements[0].amount.amountMinor, 1592);
  assert.equal(JSON.stringify(payerView).includes('mel'), false);
  assert.equal(JSON.stringify(payerView).includes('merchantOrderRef'), false);

  const reimbursementId = payerView.reimbursements[0].id as string;
  const sentResponse = await handlePart4('report-sent', request('POST', '{}', writeHeaders), { id: reimbursementId }, markRuntime);
  assert.equal((await data(sentResponse)).data.status, 'payer_reported_sent');
  assert.equal((await data(await handlePart4('report-sent', request('POST', '{}', writeHeaders), { id: reimbursementId }, buyerRuntime))).error.code, 'FORBIDDEN');

  const receivedResponse = await handlePart4('confirm-received', request('POST', '{}', writeHeaders), { id: reimbursementId }, buyerRuntime);
  const received = (await data(receivedResponse)).data;
  assert.equal(received.status, 'buyer_confirmed_received');
  assert.equal(received.confirmationSource, 'manual_buyer');
  assert.equal(received.mode, 'test');

  const deliveries = await harness.repository.read(state => Object.values(state.deliveries));
  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every(delivery => delivery.mode === 'test' && delivery.text.includes('TEST — simulated share') && delivery.text.includes('do not pay')));
  assert.ok(deliveries.every(delivery => !delivery.text.includes('paypal.me')));
});
