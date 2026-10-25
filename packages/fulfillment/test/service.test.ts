import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness, testActor } from '../src/test-fixture.ts';
import type { FulfillmentOptions } from '../src/service.ts';
import { FulfillmentError } from '../src/errors.ts';
import { MemoryRepository } from '../src/repository.ts';

const fakeCheckout: FulfillmentOptions['submit'] = async ({ quote, authorization }) => ({ id: 'provider-result', planId: quote.planId, versionId: quote.versionId, quoteId: quote.id, authorizationId: authorization.id, status: 'test_confirmed', merchantOrderRef: 'TEST-unit-order', confirmationUrl: null, actualTotal: quote.total, mode: 'test' });
async function ready(h = createTestHarness({ submit: fakeCheckout })) {
  const quote = await h.service.createQuote(testActor(), { planId: h.plan.planId, versionId: h.plan.versionId, optionId: h.plan.optionId, buyerUserId: 'buyer', expectedRevision: h.plan.revision, requestId: 'create-quote-1' });
  const approval = await h.service.requestApproval(testActor(), quote.id, h.plan.revision);
  h.wallet.approve(approval.authorizationId);
  return { h, quote, approval };
}
const hasCode = (code: string) => (error: unknown) => error instanceof FulfillmentError && error.code === code;

test('full service purchase is idempotent and creates only recipient-scoped nonbuyer requests', async () => {
  const { h, quote, approval } = await ready();
  const [a, b] = await Promise.all([
    h.service.book(testActor(), quote.id, approval.authorizationId, 1, 'DemoBuyer'),
    h.service.book(testActor(), quote.id, approval.authorizationId, 1, 'DemoBuyer'),
  ]);
  assert.equal(a.id, b.id); assert.equal(h.submissions, 1);
  const view = await h.service.paymentView(testActor('mark'), h.plan.planId);
  assert.equal(view.role, 'attendee'); assert.equal((view.reimbursements as unknown[]).length, 1);
  assert.equal('authorizations' in view, false); assert.equal('quotes' in view, false);
  const rows = await h.repository.read(s => Object.values(s.reimbursements));
  assert.equal(rows.length, 2); assert.equal(rows.some(r => r.payerUserId === 'buyer'), false);
  assert.equal(rows.reduce((sum, row) => sum + row.amount.amountMinor, 0) + 1592, 4775);
  let sent = 0;
  assert.equal(await h.service.flushPrivateDeliveries(async d => { assert.match(d.text, /TEST/); assert.equal(d.recipientUserId === 'mark' || d.recipientUserId === 'mel', true); sent++; }), 2);
  assert.equal(await h.service.flushPrivateDeliveries(async () => { sent++; }), 0); assert.equal(sent, 2);
});

test('quote retries reuse a result and changed request details cannot reuse its idempotency key', async () => {
  const { h, quote } = await ready();
  const input = { planId: h.plan.planId, versionId: h.plan.versionId, optionId: h.plan.optionId, buyerUserId: 'buyer', expectedRevision: 1, requestId: 'create-quote-1' };
  assert.equal((await h.service.createQuote(testActor(), input)).id, quote.id);
  await assert.rejects(h.service.createQuote(testActor(), { ...input, seatPreference: 'front' }), hasCode('OPERATION_PENDING'));
});

test('nonmembers and nonbuyers cannot view private data or spend', async () => {
  const { h, quote } = await ready();
  await assert.rejects(h.service.paymentView(testActor('outsider'), h.plan.planId), hasCode('NOT_FOUND'));
  await assert.rejects(h.service.requestApproval(testActor('mark'), quote.id, 1), hasCode('FORBIDDEN'));
  await assert.rejects(h.service.paymentView(testActor('outsider'), 'missing'), hasCode('NOT_FOUND'));
});

test('material plan change invalidates an already approved quote before checkout', async () => {
  const { h, quote, approval } = await ready();
  h.plan.revision++; h.plan.versionId = 'test-v2';
  await assert.rejects(h.service.book(testActor(), quote.id, approval.authorizationId, 2), hasCode('STALE_PLAN'));
  assert.equal(h.submissions, 0);
});

test('private maximum share is enforced without naming the constrained person', async () => {
  const h = createTestHarness({ submit: fakeCheckout }); h.plan.privateMaximumShares = { mel: { amountMinor: 100, currency: 'USD' } };
  await assert.rejects(h.service.createQuote(testActor(), { planId: h.plan.planId, versionId: h.plan.versionId, optionId: h.plan.optionId, buyerUserId: 'buyer', expectedRevision: 1, requestId: 'limit' }), error => hasCode('CONSTRAINT_CONFLICT')(error) && !(error as Error).message.includes('mel'));
});

test('uncertain purchase survives state reuse and cannot be submitted again', async () => {
  const h = createTestHarness({ submit: async () => { throw new Error('network lost after final click'); } });
  const { quote, approval } = await ready(h);
  const first = await h.service.book(testActor(), quote.id, approval.authorizationId, 1);
  assert.equal(first.status, 'outcome_unknown');
  assert.equal((await h.service.book(testActor(), quote.id, approval.authorizationId, 1)).id, first.id);
  assert.equal(h.submissions, 1);
  await assert.rejects(h.service.createQuote(testActor(), { planId: h.plan.planId, versionId: h.plan.versionId, optionId: h.plan.optionId, buyerUserId: 'buyer', expectedRevision: 1, requestId: 'another' }), hasCode('BOOKING_EXISTS'));
  const recovered = new MemoryRepository(await h.repository.read(s => s));
  assert.equal((await recovered.read(s => Object.values(s.bookings)))[0].status, 'outcome_unknown');
});

test('confirmed purchase is persisted even when actual total needs accounting review', async () => {
  const h = createTestHarness({ submit: async input => ({ ...await fakeCheckout(input), actualTotal: { amountMinor: 5000, currency: 'USD' } }) });
  const { quote, approval } = await ready(h);
  const result = await h.service.book(testActor(), quote.id, approval.authorizationId, 1);
  assert.equal(result.status, 'test_confirmed');
  assert.equal((await h.repository.read(s => s.bookings[result.id])).actualTotal?.amountMinor, 5000);
  assert.deepEqual((await h.service.paymentView(testActor(), h.plan.planId)).repaymentNeedsReview, [result.id]);
  await h.service.finalizeShares(testActor(), result.id, [{ attendeeUserId: 'buyer', amount: { amountMinor: 1666, currency: 'USD' } }, { attendeeUserId: 'mark', amount: { amountMinor: 1667, currency: 'USD' } }, { attendeeUserId: 'mel', amount: { amountMinor: 1667, currency: 'USD' } }], null);
  assert.equal(await h.repository.read(s => Object.keys(s.reimbursements).length), 2);
});

test('handoff blocks a new version until buyer explicitly clears or reports it', async () => {
  const h = createTestHarness({ submit: fakeCheckout });
  const handoff = await h.service.handoff(testActor(), h.plan.planId, 1);
  assert.equal(handoff.booking.confirmationUrl, null);
  h.plan.revision++; h.plan.versionId = 'test-v2';
  await assert.rejects(h.service.createQuote(testActor(), { planId: h.plan.planId, versionId: h.plan.versionId, optionId: h.plan.optionId, buyerUserId: 'buyer', expectedRevision: 2, requestId: 'after-handoff' }), hasCode('BOOKING_EXISTS'));
  await h.service.resolveUnpurchasedHandoff(testActor(), handoff.booking.id);
  await h.service.createQuote(testActor(), { planId: h.plan.planId, versionId: h.plan.versionId, optionId: h.plan.optionId, buyerUserId: 'buyer', expectedRevision: 2, requestId: 'cleared' });
});

test('buyer report after handoff creates exact shares and manual receipt stays distinct', async () => {
  const h = createTestHarness({ submit: fakeCheckout });
  const { booking } = await h.service.handoff(testActor(), h.plan.planId, 1);
  await assert.rejects(h.service.reportCompleted(testActor('mark'), booking.id, { total: { amountMinor: 1001, currency: 'USD' }, orderReference: 'manual', expectedRevision: 1 }), hasCode('FORBIDDEN'));
  const report = await h.service.reportCompleted(testActor(), booking.id, { total: { amountMinor: 1001, currency: 'USD' }, orderReference: 'manual', expectedRevision: 1, buyerPayPalMe: 'DemoBuyer' });
  assert.equal(report.status, 'buyer_reported');
  const rows = await h.repository.read(s => Object.values(s.reimbursements));
  assert.equal(rows.length, 2);
  const own = rows.find(r => r.payerUserId === 'mark')!;
  await assert.rejects(h.service.updateReimbursement(testActor('mel'), own.id, 'report-sent'), hasCode('FORBIDDEN'));
  await h.service.updateReimbursement(testActor('mark'), own.id, 'report-sent');
  const received = await h.service.updateReimbursement(testActor(), own.id, 'confirm-received');
  assert.equal(received.confirmationSource, 'manual_buyer');
});
