// Part 2 <-> Part 4 bridge: after the group decides, move the plan toward booking through Part 4's FulfillmentService.
// The selection Part 4 sees is read from our DB (never from model arguments). Part 4 is injected at startup
// (configureFulfillment) because it lives outside the strict workspace build; its types are mirrored structurally
// here and the worker's typecheck proves the real service satisfies FulfillmentPort.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { candidates, planDecisions, planOptions, plans, user, type Db } from '@hacktx/db';
import { Candidate as CandidateSchema, type ActorContext, type Candidate, type JobKind, type Money, type PlanOption, type PlanStatus } from '@hacktx/contracts';
import { assertTransition, enqueue, enqueueMessage, loadFactsForFeasibility, planMemberIds, type Job } from '@hacktx/core';
import { notifyPlan } from './planner';

// ---------- Part 4 shapes (structural mirror of packages/fulfillment/src/types.ts + service.ts) ----------
type Mode = 'live' | 'test';
export type SelectedPlanForFulfillment = {
  planId: string; revision: number; versionId: string; optionId: string; title: string;
  memberUserIds: string[]; attendeeUserIds: string[]; buyerUserId: string | null;
  mode: Mode; candidate: Candidate; privateMaximumShares?: Record<string, Money>;
};
export type FulfillmentQuote = {
  id: string; planId: string; versionId: string; optionId: string; attendeeUserIds: string[]; buyerUserId: string;
  merchantHost: string; merchantUrl: string; performanceRef: string | null; seatRefs: string[];
  lineItems: { attendeeUserId: string; label: string; amount: Money }[];
  sharedFees: Money; sharedDiscount: Money; total: Money; expiresAt: string; bindingHash: string; mode: Mode;
};
export type FulfillmentAuthorization = {
  id: string; quoteId: string; buyerUserId: string; walletRequestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled'; approvedBindingHash: string | null; checkedAt: string; mode: Mode;
};
export type FulfillmentBookingStatus = 'submitting' | 'merchant_confirmed' | 'failed' | 'outcome_unknown' | 'handoff_required' | 'buyer_reported' | 'test_confirmed';
export type FulfillmentBooking = {
  id: string; planId: string; versionId: string; quoteId: string | null; authorizationId: string | null;
  status: FulfillmentBookingStatus; merchantOrderRef: string | null; confirmationUrl: string | null; actualTotal: Money | null; mode: Mode;
};
export type FulfillmentDelivery = { id: string; planId: string; bookingId: string; recipientUserId: string; text: string; mode: Mode; status: 'pending' | 'delivered' };
export type FulfillmentReimbursement = { id: string; bookingId: string; payerUserId: string; recipientUserId: string; amount: Money; paymentUrl: string | null; status: string; mode: Mode };

/** The subset of Part 4's FulfillmentService this bridge uses. */
export interface FulfillmentPort {
  createQuote(actor: ActorContext, input: { planId: string; versionId: string; optionId: string; buyerUserId: string; expectedRevision: number; requestId: string; seatPreference?: string }): Promise<FulfillmentQuote>;
  startWalletConnection(actor: ActorContext): Promise<{ url: string; phrase?: string; connectionId: string }>;
  walletConnection(actor: ActorContext): Promise<{ status: 'pending' | 'connected' | 'not_connected' }>;
  requestApproval(actor: ActorContext, quoteId: string, expectedRevision: number): Promise<{ authorizationId: string; approvalUrl: string }>;
  refreshAuthorization(actor: ActorContext, authorizationId: string): Promise<FulfillmentAuthorization>;
  book(actor: ActorContext, quoteId: string, authorizationId: string, expectedRevision: number, buyerPayPalMe?: string | null): Promise<FulfillmentBooking>;
  handoff(actor: ActorContext, planId: string, expectedRevision: number): Promise<{ booking: FulfillmentBooking; handoffUrl: string | null }>;
  reportCompleted(actor: ActorContext, bookingId: string, input: { total: Money; orderReference: string; expectedRevision: number; buyerPayPalMe?: string | null }): Promise<FulfillmentBooking>;
  reconcileBooking(actor: ActorContext, bookingId: string): Promise<FulfillmentBooking>;
  requestChange(actor: ActorContext, planId: string, text: string, expectedRevision: number): Promise<{ id: string; status: 'buyer_handoff' }>;
  paymentView(actor: ActorContext, planId: string): Promise<Record<string, unknown>>;
  updateReimbursement(actor: ActorContext, id: string, action: 'report-sent' | 'confirm-received'): Promise<FulfillmentReimbursement>;
  flushPrivateDeliveries(enqueue: (delivery: Readonly<FulfillmentDelivery>) => Promise<void>): Promise<number>;
}

let service: FulfillmentPort | null = null;
/** Install Part 4 (the worker does this at startup; tests pass a service built on Part 4's memory repository). */
export const configureFulfillment = (s: FulfillmentPort | null) => { service = s; };
export const fulfillmentService = () => service;

export const NOT_SET_UP = {
  error: 'PAYMENTS_NOT_SET_UP',
  message: 'Booking and payments are not set up on this deployment yet. Nothing was quoted, charged, or booked. The group can buy tickets themselves from the option link.',
} as const;

/** Part 4 throws FulfillmentError {code,message,status}; its messages are written for end users. */
export function fulfillmentError(e: unknown): { code: string; message: string } | null {
  if (e instanceof Error && 'code' in e && 'status' in e) return { code: String(e.code), message: e.message };
  return null;
}

// ---------- authoritative selection from our DB ----------
export type SelectionState =
  | { ok: false; reason: string }
  | {
    ok: true; plan: typeof plans.$inferSelect; decisionId: string; versionId: string; optionId: string; option: PlanOption;
    attendeeUserIds: string[]; buyerUserId: string | null; candidate: Candidate | null;
  };

export async function readSelection(db: Db, planId: string): Promise<SelectionState> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) return { ok: false, reason: 'Plan not found' };
  if (!plan.activeVersionId || !plan.selectedOptionId) return { ok: false, reason: 'The group has not chosen an option yet (propose_selection first).' };
  const [decision] = await db.select().from(planDecisions)
    .where(and(eq(planDecisions.planId, planId), eq(planDecisions.versionId, plan.activeVersionId), eq(planDecisions.optionId, plan.selectedOptionId)))
    .orderBy(desc(planDecisions.recordedAt)).limit(1);
  const [opt] = await db.select().from(planOptions).where(eq(planOptions.id, plan.selectedOptionId));
  if (!decision || !opt) return { ok: false, reason: 'The group has not chosen an option yet (propose_selection first).' };
  const option = opt.payload as PlanOption;
  const [cand] = option.candidateIds[0] ? await db.select().from(candidates).where(eq(candidates.id, option.candidateIds[0])) : [];
  const parsed = cand ? CandidateSchema.safeParse(cand.payload) : null;
  return {
    ok: true, plan, decisionId: decision.id, versionId: plan.activeVersionId, optionId: plan.selectedOptionId, option,
    attendeeUserIds: decision.attendeeUserIds, buyerUserId: decision.buyerUserId, candidate: parsed?.success ? parsed.data : null,
  };
}

/** Part 4's `loadPlan`: membership, attendees, buyer, mode, candidate and private limits, all from the DB. */
export async function loadSelectedPlan(db: Db, actor: ActorContext, planId: string): Promise<SelectedPlanForFulfillment | null> {
  const sel = await readSelection(db, planId);
  if (!sel.ok || !sel.candidate) return null;
  const memberUserIds = await planMemberIds(db, planId);
  if (!memberUserIds.includes(actor.userId)) return null;
  const limits: Record<string, Money> = {};
  for (const f of await loadFactsForFeasibility(db, planId)) {
    if (f.kind === 'spending_limit' && sel.attendeeUserIds.includes(f.ownerUserId)) limits[f.ownerUserId] = f.value.maximumShare;
  }
  return {
    planId, revision: sel.plan.inputRevision, versionId: sel.versionId, optionId: sel.optionId, title: sel.option.title,
    memberUserIds, attendeeUserIds: sel.attendeeUserIds, buyerUserId: sel.buyerUserId,
    mode: sel.plan.mode === 'live' ? 'live' : 'test', candidate: sel.candidate,
    ...(Object.keys(limits).length ? { privateMaximumShares: limits } : {}),
  };
}

/** Only the sender can make themself the buyer (or step down). Before any booking attempt only. */
export async function setBuyer(db: Db, actor: ActorContext, planId: string, confirm: boolean) {
  const sel = await readSelection(db, planId);
  if (!sel.ok) return { confirmed: false, error: 'NO_SELECTION', message: sel.reason };
  if (sel.plan.status !== 'selected') return { confirmed: false, error: 'LOCKED', message: `The buyer can't change while the plan is ${sel.plan.status}.` };
  if (!sel.attendeeUserIds.includes(actor.userId)) return { confirmed: false, error: 'NOT_ATTENDEE', message: 'Only someone attending can be the buyer.' };
  if (!confirm) {
    if (sel.buyerUserId !== actor.userId) return { confirmed: false, message: 'The sender is not the buyer.' };
    await db.update(planDecisions).set({ buyerUserId: null }).where(eq(planDecisions.id, sel.decisionId));
    return { confirmed: false, steppedDown: true, hint: 'Ask the group who will pay instead.' };
  }
  await db.update(planDecisions).set({ buyerUserId: actor.userId }).where(eq(planDecisions.id, sel.decisionId));
  return { confirmed: true, buyer: await nameOf(db, actor.userId), hint: 'Ask about seat preferences if it matters, then call get_quote.' };
}

// ---------- formatting ----------
const usd = (m: Money) => `$${(m.amountMinor / 100).toFixed(2)}`;
const TEST_NOTE = 'TEST MODE: no real tickets, no real charge.';

async function names(db: Db, ids: string[]) {
  const rows = ids.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids)) : [];
  return new Map(rows.map((r) => [r.id, r.name.split(/\s+/)[0] ?? r.name]));
}
async function nameOf(db: Db, id: string) { return (await names(db, [id])).get(id) ?? 'the buyer'; }

function localTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Public label for a booking status; never claims more than Part 4 recorded. */
export function bookingLabel(status: FulfillmentBookingStatus) {
  switch (status) {
    case 'test_confirmed': return 'Test booking (fake-money test checkout; no real tickets)';
    case 'merchant_confirmed': return 'Booked (merchant confirmed)';
    case 'buyer_reported': return 'Buyer reports booked (not provider-verified)';
    case 'handoff_required': return 'Checkout handoff: the buyer completes the purchase; not booked yet';
    case 'submitting': case 'outcome_unknown': return 'Booking outcome being checked; not confirmed';
    case 'failed': return 'Not booked';
  }
}

export async function quoteText(db: Db, q: FulfillmentQuote, timeZone: string) {
  const who = await names(db, q.attendeeUserIds);
  const items = q.lineItems.map((i) => `${who.get(i.attendeeUserId) ?? 'guest'}: ${i.label} ${usd(i.amount)}`).join('; ');
  const extras = [q.sharedFees.amountMinor ? `fees ${usd(q.sharedFees)}` : '', q.sharedDiscount.amountMinor ? `discount -${usd(q.sharedDiscount)}` : ''].filter(Boolean).join(', ');
  return [
    q.mode === 'test' ? TEST_NOTE : null,
    `Current quote for ${q.attendeeUserIds.length}: ${items}${extras ? `; ${extras}` : ''}. Total ${usd(q.total)} USD.`,
    q.seatRefs.length ? `Seats: ${q.seatRefs.join(', ')}.` : 'Seats: assigned at checkout.',
    `Price held until ${localTime(q.expiresAt, timeZone)}.`,
    `${who.get(q.buyerUserId) ?? 'Buyer'}, if this looks right, say so and I'll send you a private approval link. Nothing is charged until you approve.`,
  ].filter(Boolean).join(' ');
}

// ---------- side effects shared by tools and jobs ----------
/** Hand Part 4's pending private messages (shares, change notices) to our encrypted outbox, one per delivery id. */
export async function deliverPrivate(db: Db, svc: FulfillmentPort) {
  return svc.flushPrivateDeliveries(async (d) => {
    const sel = await readSelection(db, d.planId);
    const prefix = sel.ok ? `${sel.option.title}: ` : '';
    await enqueueMessage(db, { recipient: { kind: 'private', userId: d.recipientUserId }, text: `${prefix}${d.text}`, effectKey: `p4:${d.id}`, planId: sel.ok ? d.planId : null });
  });
}

const PATH: PlanStatus[] = ['selected', 'quoting', 'awaiting_payment_approval', 'booking', 'booked'];
const can = (from: PlanStatus, to: PlanStatus) => { try { assertTransition(from, to); return true; } catch { return false; } };
/** Walk the plan's workflow status toward `to` along allowed transitions; leaves it unchanged if none applies. */
export async function moveStatus(db: Db, planId: string, to: PlanStatus) {
  for (let i = 0; i < PATH.length; i++) {
    const [p] = await db.select({ status: plans.status }).from(plans).where(eq(plans.id, planId));
    const from = p?.status as PlanStatus | undefined;
    if (!from || from === to) return;
    const step = PATH.indexOf(from) >= 0 ? PATH[PATH.indexOf(from) + 1] : undefined; // only walk forward along PATH
    const next = can(from, to) ? to : step;
    if (!next || !can(from, next)) return;
    await db.update(plans).set({ status: next, updatedAt: new Date() }).where(and(eq(plans.id, planId), eq(plans.status, from)));
  }
}

const SUCCESS = new Set<FulfillmentBookingStatus>(['test_confirmed', 'merchant_confirmed', 'buyer_reported']);

/** After a booking result: honest group status, private shares/links, buyer's ledger, calendar sync. */
export async function afterBooking(db: Db, svc: FulfillmentPort, actor: ActorContext, b: FulfillmentBooking) {
  const sel = await readSelection(db, b.planId);
  const title = sel.ok ? sel.option.title : 'the outing';
  const tz = sel.ok ? sel.plan.timeZone : 'UTC';
  const when = sel.ok ? ` on ${localTime(sel.option.startAt, tz)}` : '';
  const buyerId = sel.ok ? sel.buyerUserId ?? actor.userId : actor.userId;
  const buyer = await nameOf(db, buyerId);
  const key = `booking:${b.id}:${b.status}`;
  if (SUCCESS.has(b.status)) {
    await moveStatus(db, b.planId, 'booked');
    const ref = b.merchantOrderRef ? ` Order ${b.merchantOrderRef}.` : '';
    const lead = b.status === 'test_confirmed'
      ? `Test booking confirmed for ${title}${when} (fake-money test checkout: no real tickets were bought and nobody was charged).`
      : b.status === 'buyer_reported'
        ? `Buyer reports booked: ${buyer} says they bought ${title}${when}${b.actualTotal ? ` for ${usd(b.actualTotal)} total` : ''}. This is ${buyer}'s report, not a provider confirmation.`
        : `Booked: ${title}${when}, confirmed by the merchant.`;
    await notifyPlan(db, b.planId, key, `${lead}${ref} Everyone else gets a private message with their own share. Calendar details are on the way.`);
    await deliverPrivate(db, svc);
    const view = await svc.paymentView({ ...actor, userId: buyerId }, b.planId).catch(() => null);
    const rows = ((view?.reimbursements ?? []) as FulfillmentReimbursement[]).filter((r) => r.bookingId === b.id);
    const who = await names(db, rows.map((r) => r.payerUserId));
    const review = (view?.repaymentNeedsReview as string[] | undefined)?.includes(b.id);
    const ledger = rows.length
      ? b.mode === 'test'
        ? `Simulated repayment requests (test, nobody owes anything): ${rows.map((r) => `${who.get(r.payerUserId) ?? 'guest'} ${usd(r.amount)}`).join(', ')}.`
        : `Repayments requested from: ${rows.map((r) => `${who.get(r.payerUserId) ?? 'guest'} ${usd(r.amount)}`).join(', ')}. A request being sent doesn't mean it's paid; tell me when someone pays you back and I'll mark it received.`
      : review ? 'The charged total differs from the quote, so shares were not sent. Tell me the split to use.' : 'No repayments are needed.';
    await enqueueMessage(db, { recipient: { kind: 'private', userId: buyerId }, text: `${b.mode === 'test' ? 'TEST: ' : ''}${title}: ${ledger}`, effectKey: `p4:ledger:${b.id}`, planId: b.planId });
    await enqueue(db, { kind: 'sync_calendar', planId: b.planId, dedupeKey: `sync_calendar:${b.planId}:${b.versionId}:booking:${b.id}`, payload: { planId: b.planId } });
    return;
  }
  if (b.status === 'handoff_required') {
    await moveStatus(db, b.planId, 'needs_handoff');
    const h = await svc.handoff({ ...actor, userId: buyerId }, b.planId, sel.ok ? sel.plan.inputRevision : 0).catch(() => null);
    await sendHandoff(db, b.planId, buyerId, title, h?.handoffUrl ?? null);
    await notifyPlan(db, b.planId, key, `Direct checkout couldn't finish, so this is a checkout handoff: ${buyer} will buy the tickets on the venue's site. Not booked yet; I'll update everyone when ${buyer} reports it.`);
    return;
  }
  if (b.status === 'submitting' || b.status === 'outcome_unknown') {
    await moveStatus(db, b.planId, 'booking');
    await notifyPlan(db, b.planId, key, `The booking result for ${title} is uncertain. I'm checking its status before trying anything again, so there won't be a duplicate purchase. Not confirmed yet.`);
    const operationKey = `reconcile_booking:${b.id}`;
    await enqueue(db, { kind: 'reconcile_booking', planId: b.planId, dedupeKey: operationKey, runAfter: new Date(Date.now() + 60_000), payload: { actor: { ...actor, userId: buyerId }, operationKey, bookingId: b.id } });
    return;
  }
  await notifyPlan(db, b.planId, key, `The booking for ${title} did not go through, and nothing was confirmed. We can try another option, or ${buyer} can buy through the venue's checkout.`);
}

export async function sendHandoff(db: Db, planId: string, buyerId: string, title: string, url: string | null) {
  const text = url
    ? `Checkout handoff for ${title}: buy the agreed tickets here: ${url} . SideQuest has not bought anything. When you're done, tell me the total charged and the order/confirmation number so I can send everyone their share.`
    : `Checkout handoff for ${title}: there's no checkout link on file, so buy the agreed tickets at the venue. When you're done, tell me the total charged and the order/confirmation number.`;
  await enqueueMessage(db, { recipient: { kind: 'private', userId: buyerId }, text, effectKey: `p4:handoff:${planId}:${buyerId}`, planId });
}

// ---------- job handlers ----------
export const FULFILLMENT_JOB_KINDS = ['quote_booking', 'refresh_wallet', 'submit_booking', 'reconcile_booking', 'create_reimbursements', 'handle_change'] as const satisfies readonly JobKind[];
export type FulfillmentJobKind = typeof FULFILLMENT_JOB_KINDS[number];
export type FulfillmentRunner = (payload: unknown) => Promise<unknown>;

/** Direct runners over the configured service (the worker passes Part 4's validated createFulfillmentJobHandlers instead). */
function directRunners(svc: FulfillmentPort): Partial<Record<FulfillmentJobKind, FulfillmentRunner>> {
  type P = { actor: ActorContext; [k: string]: unknown };
  return {
    quote_booking: async (v) => { const p = v as P; return svc.createQuote(p.actor, p as never); },
    submit_booking: async (v) => { const p = v as P; return svc.book(p.actor, p.quoteId as string, p.authorizationId as string, p.expectedRevision as number, (p.buyerPayPalMe as string | null) ?? null); },
    reconcile_booking: async (v) => { const p = v as P; return svc.reconcileBooking(p.actor, p.bookingId as string); },
    refresh_wallet: async (v) => { const p = v as P; return svc.refreshAuthorization(p.actor, p.authorizationId as string); },
    handle_change: async (v) => { const p = v as P; return svc.requestChange(p.actor, p.planId as string, p.text as string, p.expectedRevision as number); },
  };
}

/**
 * Worker handlers for Part 4's job kinds: run Part 4's operation, then post the outcome. Business failures are
 * reported to the group (once) instead of retried: Part 4 records failed/uncertain effects and refuses blind retries.
 */
export function fulfillmentJobHandlers(runners?: Partial<Record<FulfillmentJobKind, FulfillmentRunner>>) {
  const out = {} as Record<FulfillmentJobKind, (ctx: { db: Db; job: Job }) => Promise<void>>;
  for (const kind of FULFILLMENT_JOB_KINDS) {
    out[kind] = async ({ db, job }) => {
      const svc = service;
      if (!svc) throw new Error('Fulfillment is not configured');
      const run = runners?.[kind] ?? directRunners(svc)[kind];
      if (!run) throw new Error(`No fulfillment runner for ${kind}`);
      const payload = job.payload as { actor: ActorContext; planId?: string };
      const planId = payload.planId ?? job.planId;
      let result: unknown;
      try {
        result = await run(job.payload);
      } catch (e) {
        const fe = fulfillmentError(e);
        if (!planId) throw e;
        await notifyPlan(db, planId, `p4-error:${job.id}`, await failureText(db, planId, kind, fe));
        return;
      }
      if (kind === 'quote_booking') {
        const q = result as FulfillmentQuote;
        const [p] = await db.select({ tz: plans.timeZone }).from(plans).where(eq(plans.id, q.planId));
        await notifyPlan(db, q.planId, `quote:${q.id}`, await quoteText(db, q, p?.tz ?? 'UTC'));
      } else if (kind === 'submit_booking' || kind === 'reconcile_booking') {
        const b = result as FulfillmentBooking;
        if (kind === 'reconcile_booking' && (b.status === 'submitting' || b.status === 'outcome_unknown')) return; // still unknown; buyer can ask again
        await afterBooking(db, svc, payload.actor, b);
      } else {
        await deliverPrivate(db, svc);
      }
    };
  }
  return out;
}

async function failureText(db: Db, planId: string, kind: FulfillmentJobKind, fe: { code: string; message: string } | null) {
  const sel = await readSelection(db, planId);
  const buyer = sel.ok && sel.buyerUserId ? await nameOf(db, sel.buyerUserId) : 'the buyer';
  if (fe?.code === 'HANDOFF_REQUIRED') {
    return `I can't book this venue directly, so it will be a checkout handoff: ${buyer} buys the agreed tickets on the venue's site. ${buyer}, ask me for the checkout link when you're ready. Nothing has been booked or charged.`;
  }
  if (fe?.code === 'CONSTRAINT_CONFLICT') return "This price doesn't fit everyone's limits, so I didn't continue. Want to pick another option or adjust the plan? Nothing was charged.";
  if (fe?.code === 'STALE_PLAN') return 'The plan changed while I was working on it. Ask me for a fresh quote. Nothing was charged.';
  const what = kind === 'quote_booking' ? 'get a quote' : kind === 'submit_booking' ? 'complete the booking' : 'finish that step';
  return `I couldn't ${what}${fe ? `: ${fe.message}` : ' right now'}. Nothing new was booked or charged.`;
}
