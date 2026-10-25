// Cross-part check: chat tools + bridge drive Part 4's real FulfillmentService (memory repository, owned test wallet,
// fake-money quote/submit; no network or browser). Proves buyer-only actions, private approval/share delivery, exact
// share totals, and calendar sync after booking, using Part 4's own job handlers as the worker does.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Job } from '@hacktx/core';
import { configureFulfillment, fulfillmentJobHandlers, loadSelectedPlan } from '@hacktx/agent';
import { FulfillmentService, MemoryRepository, createFulfillmentJobHandlers, quoteBinding, type BookingQuote } from '../../../packages/fulfillment/src/index.ts';
import { TestWallet } from '../../../packages/fulfillment/src/test-fixture.ts';
import { callTool, groupTexts, jobsOf, planStatus, privateTo, sent, votedPlan } from '../../../packages/agent/test/fulfillment-helpers';

afterEach(() => configureFulfillment(null));

async function setup(opts: { directQuotes?: boolean } = {}) {
  const t = await votedPlan();
  const quotes = new Map<string, BookingQuote>();
  const wallet = new TestWallet(quotes);
  let submissions = 0;
  const service = new FulfillmentService({
    repository: new MemoryRepository(),
    loadPlan: (actor, planId) => loadSelectedPlan(t.db, actor, planId),
    wallet,
    quote: async (plan, seatPreference) => {
      if (!opts.directQuotes) throw Object.assign(new Error('Direct booking is not configured for this deployment. Use merchant checkout handoff.'), { code: 'HANDOFF_REQUIRED', status: 409 });
      const q: BookingQuote = {
        id: randomUUID(), planId: plan.planId, versionId: plan.versionId, optionId: plan.optionId,
        attendeeUserIds: [...plan.attendeeUserIds], buyerUserId: plan.buyerUserId!,
        merchantHost: 'fixture.booking.test', merchantUrl: 'https://fixture.booking.test/checkout', performanceRef: `screening:${seatPreference ?? 'any'}`,
        seatRefs: plan.attendeeUserIds.map((_, i) => `F${i + 7}`),
        lineItems: plan.attendeeUserIds.map((attendeeUserId) => ({ attendeeUserId, label: 'Test ticket', amount: { amountMinor: 1500, currency: 'USD' } })),
        sharedFees: { amountMinor: 301, currency: 'USD' }, sharedDiscount: { amountMinor: 0, currency: 'USD' },
        total: { amountMinor: 1500 * plan.attendeeUserIds.length + 301, currency: 'USD' },
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), bindingHash: '', mode: 'test',
      };
      q.bindingHash = quoteBinding(q); quotes.set(q.id, q); return q;
    },
    submit: async ({ quote, authorization }) => {
      submissions++;
      return { id: randomUUID(), planId: quote.planId, versionId: quote.versionId, quoteId: quote.id, authorizationId: authorization.id, status: 'test_confirmed', merchantOrderRef: 'TEST-ORDER-1', confirmationUrl: null, actualTotal: quote.total, mode: 'test' };
    },
  });
  configureFulfillment(service);
  const handlers = fulfillmentJobHandlers(createFulfillmentJobHandlers(service));
  const runJobs = async (kind: keyof typeof handlers) => {
    for (const job of await jobsOf(t.db, kind)) await handlers[kind]({ db: t.db, job: job as Job });
  };
  const go = await t.say(t.u.Alex!, 'Go ahead with A for all three of us');
  await callTool(go, 'propose_selection', { label: 'A', attendeeUserIds: [t.u.Alex!, t.u.Mark!, t.u.Mel!], evidenceMessageIds: [] });
  return { ...t, wallet, runJobs, get submissions() { return submissions; } };
}

describe('booking and payment through Part 4', () => {
  it('quote -> private approval -> test booking -> private shares that sum to the total -> calendar sync', async () => {
    const t = await setup({ directQuotes: true });
    // Not the buyer yet: buyer-only tools refuse.
    expect(await callTool(await t.say(t.u.Alex!, 'approve'), 'request_payment_approval', {})).toMatchObject({ error: 'NO_BUYER' });
    await callTool(await t.say(t.u.Mark!, "I'll pay for everyone"), 'confirm_buyer', { confirm: true });

    expect(await callTool(await t.say(t.u.Mel!, 'seats together in the middle please, quote?'), 'get_quote', { seatPreference: 'together, middle' })).toMatchObject({ quoting: true });
    await t.runJobs('quote_booking');
    const quoteMsg = groupTexts(await sent(t.db)).find((m) => m.includes('Current quote'))!;
    expect(quoteMsg).toContain('TEST MODE');
    expect(quoteMsg).toContain('Total $48.01 USD');
    expect(quoteMsg).toContain('Seats: F7, F8, F9');

    // Only the buyer can request approval; the link goes privately to the buyer alone.
    expect(await callTool(await t.say(t.u.Alex!, 'approve it'), 'request_payment_approval', {})).toMatchObject({ error: 'NOT_BUYER' });
    const ap = await callTool(await t.say(t.u.Mark!, 'looks good'), 'request_payment_approval', {});
    expect(ap).toMatchObject({ approvalSent: true });
    expect(JSON.stringify(ap)).not.toContain('fixture.booking.test/approve'); // the model never sees the link
    const afterApproval = await sent(t.db);
    const withLink = afterApproval.filter((m) => m.text.includes('fixture.booking.test/approve/'));
    expect(withLink).toHaveLength(1);
    expect(withLink[0]!.recipient).toEqual({ kind: 'private', userId: t.u.Mark });

    // Booking requires the wallet's approval of this exact quote.
    const markCtx = await t.say(t.u.Mark!, 'book it');
    expect(await callTool(markCtx, 'book', { payPalMeHandle: null })).toMatchObject({ submitted: false, approvalStatus: 'pending' });
    const authId = [...t.wallet.records.keys()][0]!;
    t.wallet.approve(authId);
    expect(await callTool(await t.say(t.u.Mark!, 'approved, book it'), 'book', { payPalMeHandle: null })).toMatchObject({ submitted: true });
    await t.runJobs('submit_booking');
    expect(t.submissions).toBe(1);
    expect(await planStatus(t.db, t.planId)).toBe('booked');

    const all = await sent(t.db);
    const group = groupTexts(all).join('\n');
    expect(group).toContain('Test booking confirmed');
    expect(group).not.toMatch(/\$16\.0\d/); // individual shares are never posted to the group
    const share = (texts: string[]) => Number(texts.join(' ').match(/simulated share is \$(\d+\.\d\d)/)![1]);
    const melShare = share(privateTo(all, t.u.Mel!)), alexShare = share(privateTo(all, t.u.Alex!));
    expect(privateTo(all, t.u.Mark!).join(' ')).not.toContain('simulated share'); // the buyer gets no request to themself
    expect(privateTo(all, t.u.Mark!).join(' ')).toContain('Simulated repayment requests');
    // Largest-remainder split of $48.01 = 16.01 + 16.00 + 16.00 (some order); requests to non-buyers + buyer's share = total.
    const buyerShare = 48.01 - melShare - alexShare;
    expect([melShare, alexShare, Number(buyerShare.toFixed(2))].sort()).toEqual([16, 16, 16.01]);

    const cal = (await jobsOf(t.db, 'sync_calendar')).map((j) => j.dedupeKey);
    expect(cal).toHaveLength(2); // on selection and after booking
    expect(cal.some((k) => k.includes(':booking:'))).toBe(true);

    const status = await callTool(await t.say(t.u.Mel!, 'are we booked?'), 'booking_status', {});
    expect(status).toMatchObject({ booking: expect.stringContaining('Test booking'), buyer: 'Mark' });
    expect(status.yourShare).toBeUndefined(); // group chat: no individual amounts

    // Manual repayment statuses: payer reports sent, only the buyer confirms receipt.
    expect(await callTool(await t.say(t.u.Mel!, 'paid Mark back'), 'record_repayment', { action: 'sent', payerName: null })).toMatchObject({ updated: true, status: 'payer_reported_sent' });
    expect(await callTool(await t.say(t.u.Alex!, 'Mel paid'), 'record_repayment', { action: 'received', payerName: 'Mel' })).toMatchObject({ updated: false });
    expect(await callTool(await t.say(t.u.Mark!, 'got it from Mel'), 'record_repayment', { action: 'received', payerName: 'Mel' })).toMatchObject({ updated: true, status: 'buyer_confirmed_received' });
  });

  it('without a direct-booking integration: honest handoff, private link, buyer reports booked', async () => {
    const t = await setup();
    await callTool(await t.say(t.u.Alex!, "I'll pay"), 'confirm_buyer', { confirm: true });
    await callTool(await t.say(t.u.Alex!, 'quote please'), 'get_quote', { seatPreference: null });
    await t.runJobs('quote_booking');
    expect(groupTexts(await sent(t.db)).join('\n')).toContain('checkout handoff');

    expect(await callTool(await t.say(t.u.Mark!, 'send link'), 'checkout_handoff', {})).toMatchObject({ error: 'NOT_BUYER' });
    expect(await callTool(await t.say(t.u.Alex!, 'send me the checkout link'), 'checkout_handoff', {})).toMatchObject({ handoff: true, linkSentPrivately: true });
    const links = (await sent(t.db)).filter((m) => m.text.includes('https://fixture.booking.test/checkout'));
    expect(links.map((m) => m.recipient)).toEqual([{ kind: 'private', userId: t.u.Alex }]);
    expect(await planStatus(t.db, t.planId)).toBe('needs_handoff');

    expect(await callTool(await t.say(t.u.Alex!, 'bought them, $50 total, order AB123'), 'report_booked', { totalUsd: 50, orderReference: 'AB123', payPalMeHandle: null }))
      .toMatchObject({ recorded: true, status: expect.stringContaining('Buyer reports booked') });
    const all = await sent(t.db);
    expect(groupTexts(all).join('\n')).toContain('Buyer reports booked');
    // Test-mode plan, so shares are labeled simulated; equal split of $50.00 by largest remainder: 16.67/16.67/16.66.
    const shares = [t.u.Mark!, t.u.Mel!].map((id) => Number(privateTo(all, id).join(' ').match(/simulated share is \$(\d+\.\d\d)/)![1]));
    const buyerShare = Number((50 - shares[0]! - shares[1]!).toFixed(2));
    for (const s of [...shares, buyerShare]) expect([16.66, 16.67]).toContain(s);
    expect(privateTo(all, t.u.Alex!).join(' ')).not.toContain('simulated share');
    expect(await planStatus(t.db, t.planId)).toBe('booked');
    expect((await jobsOf(t.db, 'sync_calendar')).length).toBe(2);
  });
});
