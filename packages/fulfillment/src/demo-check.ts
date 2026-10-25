import assert from 'node:assert/strict';
import { createTestHarness, testActor } from './test-fixture.ts';
import { handlePart4 } from './http.ts';
import type { Part4Runtime, Part4Action } from './http.ts';

const harness = createTestHarness();
const tokens = new Map([['test-buyer', 'buyer'], ['test-mark', 'mark'], ['test-mel', 'mel']]);
const rt: Part4Runtime = {
  service: harness.service,
  authenticate: async request => { const user = tokens.get(request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''); return user ? testActor(user) : null; },
  authorizeMutation: async request => request.headers.get('Origin') === 'http://127.0.0.1:4444',
};
async function call(action: Part4Action, id: string, input: unknown = {}, user = 'buyer', method = 'POST'): Promise<any> {
  const response = await handlePart4(action, new Request('http://127.0.0.1:4444/api/test', { method, headers: { Authorization: `Bearer test-${user}`, Origin: 'http://127.0.0.1:4444', 'Content-Type': 'application/json', 'Idempotency-Key': 'demo-quote' }, ...(method === 'GET' ? {} : { body: JSON.stringify(input) }) }), { id }, rt);
  const value = await response.json();
  assert(response.ok, `HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value.data;
}

const quote = await call('quote', 'test-plan', { versionId: 'test-v1', optionId: 'test-option', buyerUserId: 'buyer', expectedRevision: 1 });
const approval = await call('approve', quote.id, { expectedRevision: 1 });
harness.wallet.approve(approval.authorizationId);
const booking = await call('book', quote.id, { authorizationId: approval.authorizationId, expectedRevision: 1, buyerPayPalMe: 'DemoBuyer' });
assert.equal(booking.status, 'test_confirmed');
const retry = await call('book', quote.id, { authorizationId: approval.authorizationId, expectedRevision: 1 });
assert.equal(retry.id, booking.id); assert.equal(harness.submissions, 1);
const mark = await call('payment', 'test-plan', {}, 'mark', 'GET');
assert.equal(mark.reimbursements.length, 1);
assert.equal('authorizations' in mark, false);
const share = mark.reimbursements[0];
await call('report-sent', share.id, {}, 'mark');
const settled = await call('confirm-received', share.id);
assert.equal(settled.confirmationSource, 'manual_buyer');
console.log(JSON.stringify({ mode: 'test', checkout: 'real headless Chromium, owned fake-money page', wallet: 'explicit simulated approval; no Link account or funds used', bookingStatus: booking.status, merchantReference: booking.merchantOrderRef, totalMinor: quote.total.amountMinor, browserSubmissions: harness.submissions, ownRequestCount: mark.reimbursements.length, receiptSource: settled.confirmationSource, result: 'PASS' }, null, 2));
