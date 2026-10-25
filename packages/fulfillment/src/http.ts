import type { ActorContext, Money } from './types.ts';
import type { FulfillmentService } from './service.ts';
import { assert, errorResponse, FulfillmentError, parseObject, requiredRevision, requiredString } from './errors.ts';

export interface Part4Runtime {
  service: FulfillmentService;
  /** Must use Part 1's verified server session. Never trust a request-body/header user ID. */
  authenticate(request: Request): Promise<ActorContext | null>;
  /** Verify Origin/session CSRF for cookie auth; bearer-based internal adapters can implement their own check. */
  authorizeMutation(request: Request, actor: ActorContext): Promise<boolean>;
  /** Project durable outcomes into shared chat/plan state. The worker retries if this callback fails. */
  afterMutation?(): Promise<void>;
}
const runtimeKey = Symbol.for('hacktx.part4.runtime.v1');
const runtimeStorage = globalThis as typeof globalThis & { [key: symbol]: Part4Runtime | undefined };
export function installPart4Runtime(runtime: Part4Runtime): void { runtimeStorage[runtimeKey] = runtime; }
export function clearPart4Runtime(): void { delete runtimeStorage[runtimeKey]; }
export function getPart4Runtime(): Part4Runtime {
  const installed = runtimeStorage[runtimeKey];
  if (!installed) throw new FulfillmentError('PART4_NOT_CONFIGURED', 'Part 4 has not been connected to the shared auth and plan services.', 503);
  return installed;
}

export type Part4Action = 'quote' | 'approve' | 'authorization' | 'book' | 'handoff' | 'payment'
  | 'connect-wallet' | 'wallet-status' | 'report-completed' | 'report-sent' | 'confirm-received'
  | 'repayment-link' | 'change' | 'reconcile' | 'resolve-handoff' | 'split';

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  assert(text.length <= 32_768, 'INVALID_INPUT', 'Request body is too large.', 413);
  try { return parseObject(JSON.parse(text || '{}')); }
  catch (error) { if (error instanceof FulfillmentError) throw error; throw new FulfillmentError('INVALID_INPUT', 'Expected valid JSON.', 400); }
}
function optionalString(value: unknown, name: string, max = 200): string | undefined { return value === undefined ? undefined : requiredString(value, name, max); }
function money(value: unknown): Money {
  const parsed = parseObject(value);
  assert(parsed.currency === 'USD' && Number.isSafeInteger(parsed.amountMinor) && (parsed.amountMinor as number) >= 0, 'INVALID_INPUT', 'Expected a non-negative USD amount in cents.', 400);
  return { amountMinor: parsed.amountMinor as number, currency: 'USD' };
}

/** Standard Request/Response handler; thin Next routes and the local harness use exactly this implementation. */
export async function handlePart4(action: Part4Action, request: Request, params: Record<string, string> = {}, runtime?: Part4Runtime): Promise<Response> {
  try {
    const rt = runtime ?? getPart4Runtime();
    const actor = await rt.authenticate(request);
    assert(actor?.userId, 'UNAUTHENTICATED', 'Sign in first.', 401);
    const readOnly = ['payment', 'authorization', 'wallet-status'].includes(action);
    assert(request.method === (readOnly ? 'GET' : 'POST'), 'METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
    if (!readOnly) assert(await rt.authorizeMutation(request, actor), 'FORBIDDEN', 'This request failed its session/CSRF check.', 403);
    const input = readOnly ? {} : await body(request);
    const planId = params.id;
    const service = rt.service;
    let result: unknown;
    let status = 200;
    switch (action) {
      case 'quote': {
        const key = requiredString(request.headers.get('Idempotency-Key'), 'Idempotency-Key', 128);
        result = await service.createQuote(actor, { planId, versionId: requiredString(input.versionId, 'versionId'), optionId: requiredString(input.optionId, 'optionId'), buyerUserId: requiredString(input.buyerUserId, 'buyerUserId'), expectedRevision: requiredRevision(input.expectedRevision), requestId: key, seatPreference: optionalString(input.seatPreference, 'seatPreference', 500) });
        status = 201; break;
      }
      case 'approve': result = await service.requestApproval(actor, params.id, requiredRevision(input.expectedRevision)); break;
      case 'authorization': result = await service.refreshAuthorization(actor, params.id); break;
      case 'book': result = await service.book(actor, params.id, requiredString(input.authorizationId, 'authorizationId'), requiredRevision(input.expectedRevision), optionalString(input.buyerPayPalMe, 'buyerPayPalMe') ?? null); break;
      case 'handoff': result = await service.handoff(actor, planId, requiredRevision(input.expectedRevision)); break;
      case 'payment': result = await service.paymentView(actor, planId); break;
      case 'connect-wallet': result = await service.startWalletConnection(actor); break;
      case 'wallet-status': result = await service.walletConnection(actor); break;
      case 'report-completed': {
        let shares;
        if (input.shares !== undefined) {
          assert(Array.isArray(input.shares) && input.shares.length <= 100, 'INVALID_INPUT', 'Invalid shares.', 400);
          shares = input.shares.map(value => { const item = parseObject(value); return { attendeeUserId: requiredString(item.attendeeUserId, 'attendeeUserId'), amount: money(item.amount) }; });
        }
        result = await service.reportCompleted(actor, params.id, { total: money(input.total), orderReference: requiredString(input.orderReference, 'orderReference'), expectedRevision: requiredRevision(input.expectedRevision), shares, buyerPayPalMe: optionalString(input.buyerPayPalMe, 'buyerPayPalMe') ?? null }); break;
      }
      case 'report-sent': result = await service.updateReimbursement(actor, params.id, 'report-sent'); break;
      case 'confirm-received': result = await service.updateReimbursement(actor, params.id, 'confirm-received'); break;
      case 'repayment-link': await service.setRepaymentLink(actor, planId, requiredString(input.buyerPayPalMe, 'buyerPayPalMe')); result = { updated: true }; break;
      case 'change': result = await service.requestChange(actor, planId, requiredString(input.text, 'text', 2000), requiredRevision(input.expectedRevision)); status = 202; break;
      case 'reconcile': result = await service.reconcileBooking(actor, params.id); break;
      case 'resolve-handoff': assert(input.outcome === 'not_purchased', 'INVALID_INPUT', 'Explicitly confirm that the handoff purchase was not made.', 400); result = await service.resolveUnpurchasedHandoff(actor, params.id); break;
      case 'split': {
        assert(Array.isArray(input.shares) && input.shares.length <= 100, 'INVALID_INPUT', 'Provide the booked attendee shares.', 400);
        const shares = input.shares.map(value => { const item = parseObject(value); return { attendeeUserId: requiredString(item.attendeeUserId, 'attendeeUserId'), amount: money(item.amount) }; });
        await service.finalizeShares(actor, params.id, shares, optionalString(input.buyerPayPalMe, 'buyerPayPalMe') ?? null); result = { updated: true }; break;
      }
    }
    if (!readOnly && rt.afterMutation) {
      try { await rt.afterMutation(); }
      catch { console.error('[fulfillment] Outcome projection pending; the worker will retry.'); }
    }
    return Response.json({ data: result }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof FulfillmentError) return errorResponse(error);
    if (error instanceof TypeError || error instanceof RangeError) return errorResponse(new FulfillmentError('INVALID_INPUT', 'The supplied payment or quote details are invalid.', 400));
    if (error instanceof Error && ['LinkWalletError', 'SerpApiError'].includes(error.name)) return errorResponse(new FulfillmentError('PROVIDER_UNAVAILABLE', 'The provider is not ready or could not complete this request. Check its account configuration or use checkout handoff.', 503, true));
    return errorResponse(error);
  }
}

export function nextPart4Route(action: Part4Action) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }): Promise<Response> => handlePart4(action, request, await context.params);
}
