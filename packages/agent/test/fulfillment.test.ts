// Booking bridge without Part 4 installed: decision -> calendar job, buyer self-confirmation, honest "not set up".
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { planDecisions } from '@hacktx/db';
import { configureFulfillment } from '@hacktx/agent';
import { callTool, jobsOf, votedPlan } from './fulfillment-helpers';

afterEach(() => configureFulfillment(null));

async function decided() {
  const t = await votedPlan();
  const go = await t.say(t.u.Alex!, 'Go ahead with A for all three of us');
  const r = await callTool(go, 'propose_selection', { label: 'A', attendeeUserIds: [t.u.Alex!, t.u.Mark!, t.u.Mel!], evidenceMessageIds: [] });
  expect(r.selected).toBe('A');
  return t;
}

describe('after the group decides', () => {
  it('enqueues one sync_calendar job per plan version on selection', async () => {
    const t = await decided();
    const jobs = await jobsOf(t.db, 'sync_calendar');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({ planId: t.planId });
    expect(jobs[0]!.dedupeKey).toBe(`sync_calendar:${t.planId}:${t.versionId}:selected`);
  });

  it('only the sender can make themself the buyer, and only an attendee', async () => {
    const t = await decided();
    const buyer = async () => (await t.db.select().from(planDecisions).where(eq(planDecisions.planId, t.planId)))[0]!.buyerUserId;
    // The organizer suggesting Mark records nothing: confirm_buyer always acts on the verified sender.
    const alex = await t.say(t.u.Alex!, 'Mark, can you pay?');
    expect((await callTool(alex, 'confirm_buyer', { confirm: false })).confirmed).toBe(false);
    expect(await buyer()).toBeNull();
    const mark = await t.say(t.u.Mark!, "Sure, I'll pay");
    expect((await callTool(mark, 'confirm_buyer', { confirm: true })).confirmed).toBe(true);
    expect(await buyer()).toBe(t.u.Mark);
    // Someone else cannot step the buyer down.
    expect((await callTool(await t.say(t.u.Mel!, 'nah'), 'confirm_buyer', { confirm: false })).steppedDown).toBeUndefined();
    expect(await buyer()).toBe(t.u.Mark);
  });

  it('says payments are not set up when Part 4 is not configured, and changes nothing', async () => {
    const t = await decided();
    await callTool(await t.say(t.u.Mark!, "I'll pay"), 'confirm_buyer', { confirm: true });
    const ctx = await t.say(t.u.Mark!, 'get a quote');
    for (const [name, args] of [['get_quote', { seatPreference: null }], ['request_payment_approval', {}], ['book', { payPalMeHandle: null }], ['booking_status', {}]] as const) {
      expect(await callTool(ctx, name, args)).toMatchObject({ error: 'PAYMENTS_NOT_SET_UP' });
    }
    expect(await jobsOf(t.db, 'quote_booking')).toHaveLength(0);
  });
});
