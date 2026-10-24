import test from 'node:test';
import assert from 'node:assert/strict';
import { createFulfillmentJobHandlers, dispatchFulfillmentJob, fulfillmentJobOperationKey, FulfillmentJobError } from '../src/jobs.ts';
import type { FulfillmentJob, FulfillmentJobKind, FulfillmentJobPayloads, FulfillmentJobService } from '../src/jobs.ts';
import type { BookingQuote } from '../src/types.ts';
import { createTestHarness, testActor } from '../src/test-fixture.ts';
import { FulfillmentError } from '../src/errors.ts';

function makeJob<K extends FulfillmentJobKind>(kind: K, payload: Omit<FulfillmentJobPayloads[K], 'operationKey'>): Extract<FulfillmentJob, { kind: K }> {
  const seed = { kind, payload: { ...payload, operationKey: '' } } as unknown as Extract<FulfillmentJob, { kind: K }>;
  seed.payload.operationKey = fulfillmentJobOperationKey(seed);
  return seed;
}

test('job registry delegates each typed payload to the corresponding service method', async () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const service = {
    createQuote: async (...args: unknown[]) => { calls.push({ method: 'createQuote', args }); return { quote: 'ok' }; },
    refreshAuthorization: async (...args: unknown[]) => { calls.push({ method: 'refreshAuthorization', args }); return { authorization: 'ok' }; },
    book: async (...args: unknown[]) => { calls.push({ method: 'book', args }); return { booking: 'ok' }; },
    reconcileBooking: async (...args: unknown[]) => { calls.push({ method: 'reconcileBooking', args }); return { booking: 'reconciled' }; },
    requestChange: async (...args: unknown[]) => { calls.push({ method: 'requestChange', args }); return { id: 'change-1', status: 'buyer_handoff' }; },
    finalizeShares: async (...args: unknown[]) => { calls.push({ method: 'finalizeShares', args }); },
  } as unknown as FulfillmentJobService;
  const handlers = createFulfillmentJobHandlers(service);
  const actor = testActor('buyer');
  const jobs: FulfillmentJob[] = [
    makeJob('quote_booking', { actor, planId: 'plan-1', versionId: 'version-1', optionId: 'option-1', buyerUserId: 'buyer', expectedRevision: 2, requestId: 'quote-request', seatPreference: 'aisle' }),
    makeJob('refresh_wallet', { actor, authorizationId: 'auth-1' }),
    makeJob('submit_booking', { actor, quoteId: 'quote-1', authorizationId: 'auth-1', expectedRevision: 2, buyerPayPalMe: 'BuyerDemo' }),
    makeJob('reconcile_booking', { actor, bookingId: 'booking-1' }),
    makeJob('handle_change', { actor, planId: 'plan-1', text: 'Move the time', expectedRevision: 2 }),
    makeJob('create_reimbursements', { actor, bookingId: 'booking-1', shares: [{ attendeeUserId: 'buyer', amount: { amountMinor: 500, currency: 'USD' } }], buyerPayPalMe: null }),
  ];
  for (const item of jobs) await dispatchFulfillmentJob(handlers, item);
  assert.deepEqual(calls.map(call => call.method), [
    'createQuote', 'refreshAuthorization', 'book', 'reconcileBooking', 'requestChange', 'finalizeShares',
  ]);
  assert.deepEqual(calls[0].args, [actor, { planId: 'plan-1', versionId: 'version-1', optionId: 'option-1', buyerUserId: 'buyer', expectedRevision: 2, requestId: 'quote-request', seatPreference: 'aisle' }]);
  assert.deepEqual(calls[2].args, [actor, 'quote-1', 'auth-1', 2, 'BuyerDemo']);
  assert.deepEqual(calls[4].args, [actor, 'plan-1', 'Move the time', 2]);
});

test('malformed jobs, invalid actors, mismatched operation keys, and unknown kinds fail closed', async () => {
  const handlers = createFulfillmentJobHandlers({} as FulfillmentJobService);
  await assert.rejects(dispatchFulfillmentJob(handlers, null), (error: unknown) => error instanceof FulfillmentJobError && error.code === 'INVALID_JOB');
  await assert.rejects(dispatchFulfillmentJob(handlers, { kind: 'not_a_job', payload: {} }), (error: unknown) => error instanceof FulfillmentJobError && error.code === 'UNKNOWN_JOB');
  await assert.rejects(dispatchFulfillmentJob(handlers, { kind: 'quote_booking' }), (error: unknown) => error instanceof FulfillmentJobError && error.code === 'INVALID_JOB');
  await assert.rejects(handlers.quote_booking({ planId: 'plan' }), (error: unknown) => error instanceof FulfillmentJobError && error.code === 'INVALID_JOB');
  const valid = makeJob('refresh_wallet', { actor: testActor(), authorizationId: 'auth-1' });
  await assert.rejects(handlers.refresh_wallet({ ...valid.payload, actor: { userId: 'buyer', source: 'untrusted_http_body' } }), (error: unknown) => error instanceof FulfillmentJobError && error.code === 'INVALID_JOB');
  await assert.rejects(handlers.refresh_wallet({ ...valid.payload, operationKey: 'wrong-key' }), (error: unknown) => error instanceof FulfillmentJobError && error.code === 'INVALID_OPERATION_KEY');
});

async function readyToSubmit() {
  const h = createTestHarness();
  const handlers = createFulfillmentJobHandlers(h.service);
  const quoteJob = makeJob('quote_booking', {
    actor: testActor(), planId: h.plan.planId, versionId: h.plan.versionId, optionId: h.plan.optionId,
    buyerUserId: 'buyer', expectedRevision: h.plan.revision, requestId: 'job-quote-1',
  });
  const quote = await handlers.quote_booking(quoteJob.payload) as BookingQuote;
  const approval = await h.service.requestApproval(testActor(), quote.id, h.plan.revision);
  h.wallet.approve(approval.authorizationId);
  const submitJob = makeJob('submit_booking', {
    actor: testActor(), quoteId: quote.id, authorizationId: approval.authorizationId, expectedRevision: h.plan.revision,
  });
  return { h, handlers, quote, approval, submitJob };
}

test('repeated submit job returns the service idempotent booking without another provider submission', async () => {
  const { h, handlers, submitJob } = await readyToSubmit();
  const first = await handlers.submit_booking(submitJob.payload) as { id: string };
  const repeated = await handlers.submit_booking(submitJob.payload) as { id: string };
  assert.equal(repeated.id, first.id);
  assert.equal(h.submissions, 1);
});

test('stale submit job delegates to the service revision guard and does not submit', async () => {
  const { h, handlers, submitJob } = await readyToSubmit();
  h.plan.revision += 1;
  h.plan.versionId = 'new-version';
  await assert.rejects(handlers.submit_booking(submitJob.payload), (error: unknown) => error instanceof FulfillmentError && error.code === 'STALE_PLAN');
  assert.equal(h.submissions, 0);
});
