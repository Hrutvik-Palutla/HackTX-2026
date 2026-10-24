import { createHash } from 'node:crypto';
import type { AttendeeShare } from './splits.ts';
import type { FulfillmentService } from './service.ts';
import type { ActorContext, Money } from './types.ts';

/** Payload actor is trusted worker context established before enqueue, never parsed from an HTTP body. */
type JobBase = { actor: ActorContext; operationKey: string };
export type QuoteBookingJobPayload = JobBase & {
  planId: string;
  versionId: string;
  optionId: string;
  buyerUserId: string;
  expectedRevision: number;
  requestId: string;
  seatPreference?: string;
};
export type RefreshWalletJobPayload = JobBase & { authorizationId: string };
export type SubmitBookingJobPayload = JobBase & {
  quoteId: string;
  authorizationId: string;
  expectedRevision: number;
  buyerPayPalMe?: string | null;
};
export type ReconcileBookingJobPayload = JobBase & { bookingId: string };
export type HandleChangeJobPayload = JobBase & { planId: string; text: string; expectedRevision: number };
export type CreateReimbursementsJobPayload = JobBase & {
  bookingId: string;
  shares: AttendeeShare[];
  buyerPayPalMe?: string | null;
};

export type FulfillmentJobPayloads = {
  quote_booking: QuoteBookingJobPayload;
  refresh_wallet: RefreshWalletJobPayload;
  submit_booking: SubmitBookingJobPayload;
  reconcile_booking: ReconcileBookingJobPayload;
  handle_change: HandleChangeJobPayload;
  create_reimbursements: CreateReimbursementsJobPayload;
};
export type FulfillmentJobKind = keyof FulfillmentJobPayloads;
export type Part4JobKind = FulfillmentJobKind;
export type Part4Job = {
  [K in FulfillmentJobKind]: { kind: K; payload: FulfillmentJobPayloads[K] }
}[FulfillmentJobKind];
export type FulfillmentJob = Part4Job;
export type FulfillmentJobHandlers = Record<FulfillmentJobKind, (payload: unknown) => Promise<unknown>>;
export type FulfillmentJobService = Pick<FulfillmentService,
  'createQuote' | 'refreshAuthorization' | 'book' | 'reconcileBooking' | 'requestChange' | 'finalizeShares'>;

export class FulfillmentJobError extends Error {
  readonly code: 'INVALID_JOB' | 'UNKNOWN_JOB' | 'INVALID_OPERATION_KEY';
  constructor(code: 'INVALID_JOB' | 'UNKNOWN_JOB' | 'INVALID_OPERATION_KEY', message: string) {
    super(message);
    this.name = 'FulfillmentJobError';
    this.code = code;
  }
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

/** Stable queue keys align with the service's quote and booking idempotency boundaries. */
export function fulfillmentJobOperationKey(job: FulfillmentJob): string {
  switch (job.kind) {
    case 'quote_booking': return `quote:${job.payload.planId}:${job.payload.requestId}`;
    case 'refresh_wallet': return `refresh_wallet:${job.payload.authorizationId}`;
    case 'submit_booking': return `booking:${job.payload.quoteId}`;
    case 'reconcile_booking': return `reconcile_booking:${job.payload.bookingId}`;
    case 'handle_change': return `handle_change:${job.payload.planId}:${job.payload.expectedRevision}:${job.payload.actor.userId}:${digest(job.payload.text)}`;
    case 'create_reimbursements': return `create_reimbursements:${job.payload.bookingId}`;
  }
}

function invalid(message: string): never { throw new FulfillmentJobError('INVALID_JOB', message); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid('Expected a job payload object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) return invalid(`Invalid ${name}.`);
  return value.trim();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return invalid('Invalid expectedRevision.');
  return value as number;
}
function actorContext(value: unknown): ActorContext {
  const row = object(value);
  const userId = text(row.userId, 'actor.userId');
  const source = row.source;
  if (source !== 'web' && source !== 'group_message' && source !== 'private_message' && source !== 'provider_event') return invalid('Invalid trusted actor source.');
  const actor: ActorContext = { userId, source };
  if (row.conversationId !== undefined) actor.conversationId = text(row.conversationId, 'actor.conversationId');
  if (row.sourceMessageId !== undefined) actor.sourceMessageId = text(row.sourceMessageId, 'actor.sourceMessageId');
  return actor;
}
function base(value: Record<string, unknown>): JobBase {
  return { actor: actorContext(value.actor), operationKey: text(value.operationKey, 'operationKey', 500) };
}
function optionalText(value: unknown, name: string, max = 500): string | undefined {
  return value === undefined ? undefined : text(value, name, max);
}
function optionalNullableText(value: unknown, name: string, max = 200): string | null | undefined {
  if (value === undefined || value === null) return value;
  return text(value, name, max);
}
function readQuoteBooking(value: unknown): QuoteBookingJobPayload {
  const row = object(value), common = base(row);
  const payload: QuoteBookingJobPayload = {
    ...common,
    planId: text(row.planId, 'planId'),
    versionId: text(row.versionId, 'versionId'),
    optionId: text(row.optionId, 'optionId'),
    buyerUserId: text(row.buyerUserId, 'buyerUserId'),
    expectedRevision: revision(row.expectedRevision),
    requestId: text(row.requestId, 'requestId', 128),
  };
  const seatPreference = optionalText(row.seatPreference, 'seatPreference', 500);
  if (seatPreference !== undefined) payload.seatPreference = seatPreference;
  return payload;
}
function readRefreshWallet(value: unknown): RefreshWalletJobPayload {
  const row = object(value);
  return { ...base(row), authorizationId: text(row.authorizationId, 'authorizationId') };
}
function readSubmitBooking(value: unknown): SubmitBookingJobPayload {
  const row = object(value), payload: SubmitBookingJobPayload = {
    ...base(row),
    quoteId: text(row.quoteId, 'quoteId'),
    authorizationId: text(row.authorizationId, 'authorizationId'),
    expectedRevision: revision(row.expectedRevision),
  };
  const buyerPayPalMe = optionalNullableText(row.buyerPayPalMe, 'buyerPayPalMe');
  if (buyerPayPalMe !== undefined) payload.buyerPayPalMe = buyerPayPalMe;
  return payload;
}
function readReconcileBooking(value: unknown): ReconcileBookingJobPayload {
  const row = object(value);
  return { ...base(row), bookingId: text(row.bookingId, 'bookingId') };
}
function readHandleChange(value: unknown): HandleChangeJobPayload {
  const row = object(value);
  return { ...base(row), planId: text(row.planId, 'planId'), text: text(row.text, 'text', 2000), expectedRevision: revision(row.expectedRevision) };
}
function readCreateReimbursements(value: unknown): CreateReimbursementsJobPayload {
  const row = object(value);
  if (!Array.isArray(row.shares) || row.shares.length > 100) return invalid('Invalid reimbursement shares.');
  const shares = row.shares.map((value): AttendeeShare => {
    const share = object(value), amount = object(share.amount);
    if (amount.currency !== 'USD' || !Number.isSafeInteger(amount.amountMinor) || (amount.amountMinor as number) < 0) return invalid('Invalid reimbursement share amount.');
    const money: Money = { currency: 'USD', amountMinor: amount.amountMinor as number };
    return { attendeeUserId: text(share.attendeeUserId, 'attendeeUserId'), amount: money };
  });
  const payload: CreateReimbursementsJobPayload = { ...base(row), bookingId: text(row.bookingId, 'bookingId'), shares };
  const buyerPayPalMe = optionalNullableText(row.buyerPayPalMe, 'buyerPayPalMe');
  if (buyerPayPalMe !== undefined) payload.buyerPayPalMe = buyerPayPalMe;
  return payload;
}

function assertOperationKey(job: FulfillmentJob): void {
  if (job.payload.operationKey !== fulfillmentJobOperationKey(job)) {
    throw new FulfillmentJobError('INVALID_OPERATION_KEY', 'The job operation key does not match its payload.');
  }
}

/**
 * Queue registration map. The queue should persist operationKey as its unique effect/dedupe key;
 * service methods remain responsible for business authorization, revision checks, and purchase guards.
 */
export function createFulfillmentJobHandlers(service: FulfillmentJobService): FulfillmentJobHandlers {
  return {
    quote_booking: async value => {
      const payload = readQuoteBooking(value), job: FulfillmentJob = { kind: 'quote_booking', payload };
      assertOperationKey(job);
      return service.createQuote(payload.actor, {
        planId: payload.planId, versionId: payload.versionId, optionId: payload.optionId,
        buyerUserId: payload.buyerUserId, expectedRevision: payload.expectedRevision,
        requestId: payload.requestId, seatPreference: payload.seatPreference,
      });
    },
    refresh_wallet: async value => {
      const payload = readRefreshWallet(value), job: FulfillmentJob = { kind: 'refresh_wallet', payload };
      assertOperationKey(job);
      return service.refreshAuthorization(payload.actor, payload.authorizationId);
    },
    submit_booking: async value => {
      const payload = readSubmitBooking(value), job: FulfillmentJob = { kind: 'submit_booking', payload };
      assertOperationKey(job);
      return service.book(payload.actor, payload.quoteId, payload.authorizationId, payload.expectedRevision, payload.buyerPayPalMe ?? null);
    },
    reconcile_booking: async value => {
      const payload = readReconcileBooking(value), job: FulfillmentJob = { kind: 'reconcile_booking', payload };
      assertOperationKey(job);
      return service.reconcileBooking(payload.actor, payload.bookingId);
    },
    handle_change: async value => {
      const payload = readHandleChange(value), job: FulfillmentJob = { kind: 'handle_change', payload };
      assertOperationKey(job);
      return service.requestChange(payload.actor, payload.planId, payload.text, payload.expectedRevision);
    },
    create_reimbursements: async value => {
      const payload = readCreateReimbursements(value), job: FulfillmentJob = { kind: 'create_reimbursements', payload };
      assertOperationKey(job);
      await service.finalizeShares(payload.actor, payload.bookingId, payload.shares, payload.buyerPayPalMe ?? null);
      return { finalized: true, bookingId: payload.bookingId };
    },
  };
}

/** Dispatch an envelope read from the durable queue; unknown kinds and malformed envelopes fail closed. */
export async function dispatchFulfillmentJob(handlers: FulfillmentJobHandlers, value: unknown): Promise<unknown> {
  const envelope = object(value);
  const kind = text(envelope.kind, 'job kind', 80);
  if (!Object.hasOwn(handlers, kind)) throw new FulfillmentJobError('UNKNOWN_JOB', `Unsupported fulfillment job kind: ${kind}.`);
  if (!('payload' in envelope)) return invalid('Missing job payload.');
  return handlers[kind as FulfillmentJobKind](envelope.payload);
}
