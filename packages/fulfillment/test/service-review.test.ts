import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness, testActor } from '../src/test-fixture.ts';
import { FulfillmentService } from '../src/service.ts';
import { calculateShares } from '../src/splits.ts';
import type { BookingQuote } from '../src/types.ts';

async function makeQuote(harness: ReturnType<typeof createTestHarness>, requestId: string): Promise<BookingQuote> {
  return harness.service.createQuote(testActor(), {
    planId: 'test-plan', versionId: harness.plan.versionId, optionId: harness.plan.optionId,
    buyerUserId: 'buyer', expectedRevision: harness.plan.revision, requestId,
  });
}

async function approve(harness: ReturnType<typeof createTestHarness>, quote: BookingQuote): Promise<string> {
  const approval = await harness.service.requestApproval(testActor(), quote.id, harness.plan.revision);
  harness.wallet.approve(approval.authorizationId);
  return approval.authorizationId;
}

test('delayed wallet response cannot submit a quote after its plan revision changes', async () => {
  const harness = createTestHarness({ submit: async () => { throw new Error('submit must not run'); } });
  const quote = await makeQuote(harness, 'stale-wallet');
  const authorizationId = await approve(harness, quote);
  const refresh = harness.wallet.refreshAuthorization.bind(harness.wallet);
  let started!: () => void;
  let release!: () => void;
  const enteredWallet = new Promise<void>((resolve) => { started = resolve; });
  const walletGate = new Promise<void>((resolve) => { release = resolve; });
  harness.wallet.refreshAuthorization = async (id: string) => {
    started();
    await walletGate;
    return refresh(id);
  };

  const booking = harness.service.book(testActor(), quote.id, authorizationId, 1);
  await enteredWallet;
  harness.plan.revision = 2;
  release();
  await assert.rejects(booking, (error: { code?: string }) => error.code === 'STALE_PLAN');
  assert.equal(harness.submissions, 0);
  const state = await harness.repository.read(value => value);
  assert.equal(Object.keys(state.bookings).length, 0);
});

test('confirmed booking persists even when actual total is missing or differs from the quote', async () => {
  for (const totalKind of ['missing', 'mismatch'] as const) {
    const harness = createTestHarness({
      submit: async ({ quote, authorization }) => ({
        id: 'provider-result', planId: quote.planId, versionId: quote.versionId, quoteId: quote.id,
        authorizationId: authorization.id, status: 'test_confirmed', merchantOrderRef: `TEST-${totalKind}`,
        confirmationUrl: null,
        actualTotal: totalKind === 'missing' ? null : { ...quote.total, amountMinor: quote.total.amountMinor + 1 },
        mode: 'test',
      }),
    });
    const quote = await makeQuote(harness, `actual-total-${totalKind}`);
    const authorizationId = await approve(harness, quote);
    const booking = await harness.service.book(testActor(), quote.id, authorizationId, 1);
    assert.equal(booking.status, 'test_confirmed');
    assert.equal(booking.actualTotal === null, totalKind === 'missing');
    const state = await harness.repository.read(value => value);
    assert.equal(state.bookings[booking.id]?.status, 'test_confirmed');
    assert.equal(Object.keys(state.reimbursements).length, 0);
    const view = await harness.service.paymentView(testActor(), 'test-plan');
    assert.deepEqual(view.repaymentNeedsReview, [booking.id]);
  }
});

test('reconciles persisted unknown state without resubmitting and then creates shares', async () => {
  const harness = createTestHarness({ submit: async ({ quote, authorization }) => ({
    id: 'provider-unknown', planId: quote.planId, versionId: quote.versionId, quoteId: quote.id,
    authorizationId: authorization.id, status: 'outcome_unknown', merchantOrderRef: null,
    confirmationUrl: null, actualTotal: null, mode: 'test',
  }) });
  const quote = await makeQuote(harness, 'recover-unknown');
  const authorizationId = await approve(harness, quote);
  const unknown = await harness.service.book(testActor(), quote.id, authorizationId, 1);
  assert.equal(unknown.status, 'outcome_unknown');
  assert.equal(harness.submissions, 1);

  let reconcileCalls = 0;
  const recoveryService = new FulfillmentService({
    repository: harness.repository,
    loadPlan: async (_actor, planId) => planId === 'test-plan' ? structuredClone(harness.plan) : null,
    wallet: harness.wallet,
    quote: async () => { throw new Error('quote must not run during recovery'); },
    submit: async () => { throw new Error('submit must not run during recovery'); },
    reconcile: async (prior) => {
      reconcileCalls += 1;
      return { ...prior, status: 'test_confirmed', merchantOrderRef: 'RECONCILED-TEST-ORDER', actualTotal: quote.total };
    },
  });
  const recovered = await recoveryService.reconcileBooking(testActor(), unknown.id);
  assert.equal(recovered.status, 'test_confirmed');
  assert.equal(reconcileCalls, 1);
  assert.equal(harness.submissions, 1);
  const state = await harness.repository.read(value => value);
  assert.equal(state.bookings[unknown.id]?.status, 'test_confirmed');
  const buyerShare = calculateShares(quote).find(share => share.attendeeUserId === 'buyer')!.amount.amountMinor;
  assert.equal(Object.values(state.reimbursements).reduce((sum, row) => sum + row.amount.amountMinor, 0), quote.total.amountMinor - buyerShare);
});

test('an unresolved handoff blocks purchases on later plan versions until buyer resolves it', async () => {
  const harness = createTestHarness({ submit: async () => { throw new Error('submit must not run'); } });
  const { booking } = await harness.service.handoff(testActor(), 'test-plan', 1);
  assert.equal(booking.status, 'handoff_required');
  harness.plan.revision = 2;
  harness.plan.versionId = 'test-v2';
  await assert.rejects(
    makeQuote(harness, 'later-version'),
    (error: { code?: string }) => error.code === 'BOOKING_EXISTS',
  );
  const resolved = await harness.service.resolveUnpurchasedHandoff(testActor(), booking.id);
  assert.equal(resolved.status, 'failed');
  const quote = await makeQuote(harness, 'later-version-after-resolution');
  assert.equal(quote.versionId, 'test-v2');
});

test('setting a repayment handle never leaves a payable link in test reimbursements or deliveries', async () => {
  const harness = createTestHarness({ submit: async ({ quote, authorization }) => ({
    id: 'provider-test', planId: quote.planId, versionId: quote.versionId, quoteId: quote.id,
    authorizationId: authorization.id, status: 'test_confirmed', merchantOrderRef: 'TEST-ORDER',
    confirmationUrl: null, actualTotal: quote.total, mode: 'test',
  }) });
  const quote = await makeQuote(harness, 'test-link-safety');
  const authorizationId = await approve(harness, quote);
  await harness.service.book(testActor(), quote.id, authorizationId, 1);

  // Exercise cleanup of a stale/misconfigured test record as well as the normal setter.
  await harness.repository.transact(state => {
    const row = Object.values(state.reimbursements)[0]!;
    row.status = 'draft';
    row.paymentUrl = 'https://paypal.me/RealHandle/15.92USD';
    state.deliveries[`request:${row.id}`]!.text += ' Repay: https://paypal.me/RealHandle/15.92USD';
  });
  await harness.service.setRepaymentLink(testActor(), 'test-plan', 'AnotherRealHandle');
  const state = await harness.repository.read(value => value);
  assert.ok(Object.values(state.reimbursements).every(row => row.mode !== 'test' || (row.paymentUrl === null && row.status !== 'draft')));
  assert.ok(Object.values(state.deliveries).filter(delivery => delivery.mode === 'test').every(delivery =>
    !delivery.text.includes('paypal.me') && delivery.text.includes('TEST — simulated share') && delivery.text.includes('do not pay'),
  ));
});
