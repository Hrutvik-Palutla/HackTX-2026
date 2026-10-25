// Model-callable tools. Every tool runs as the injected, verified sender (ctx.actor); the model never
// supplies a user identity for itself. Effects go through the same core services as the HTTP API.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq, inArray, or } from 'drizzle-orm';
import { conversationMembers, conversations, friendships, messages, messagingIdentities, planConversations, planOptions, plans, user, type Db } from '@hacktx/db';
import { City, type ActorContext } from '@hacktx/contracts';
import {
  AppError, activeTally, assertMember, createPlan, enqueue, enqueueMessage, parseCity, open, publicPlan,
  recordDecision, recordVote, requestRepair, savePrivateFact,
  inviteByPhone, normalizePhone, pendingRequestsFor, respondToFriendRequest,
} from '@hacktx/core';
import type { ToolSpec } from './muse';
import {
  NOT_SET_UP, afterBooking, bookingLabel, fulfillmentError, fulfillmentService, moveStatus, readSelection, sendHandoff, setBuyer,
  type FulfillmentAuthorization, type FulfillmentBooking, type SelectionState, type FulfillmentPort, type FulfillmentQuote, type FulfillmentReimbursement,
} from './fulfillment';

export type ToolCtx = {
  db: Db;
  actor: ActorContext; // verified sender
  planId: string | null;
  conversation: { id: string; kind: 'group' | 'private' };
  messageId: string; // internal messages.id of the triggering message
  providerMessageId: string;
  availablePlanIds?: string[];
};

type Tool<A> = { name: string; description: string; args: z.ZodType<A>; run(ctx: ToolCtx, args: A): Promise<unknown> };
const tool = <A>(t: Tool<A>) => t as Tool<unknown>;

const isoUtc = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'ISO 8601 time with offset').transform((s) => new Date(s).toISOString());
const Iv = z.object({ startAt: isoUtc, endAt: isoUtc });
const Label = z.enum(['A', 'B', 'C']);

function needPlan(ctx: ToolCtx) {
  if (!ctx.planId) throw new AppError('UNRESOLVED', 'No active plan in this conversation');
  return ctx.planId;
}

async function labelsToIds(db: Db, planId: string, labels: string[]) {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan?.activeVersionId) throw new AppError('UNRESOLVED', 'No options published yet');
  const opts = await db.select().from(planOptions).where(eq(planOptions.versionId, plan.activeVersionId));
  const ids = labels.map((l) => opts.find((o) => o.label === l)?.id);
  if (ids.some((i) => !i)) throw new AppError('INVALID', 'Unknown option label');
  return { plan, versionId: plan.activeVersionId, ids: ids as string[] };
}

/** Accepted friends of `userId` matching a spoken name (full name or first name, case-insensitive). */
export async function resolveFriendNames(db: Db, userId: string, names: string[]) {
  const rows = await db.select({ low: friendships.userLow, high: friendships.userHigh }).from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId))));
  const friendIds = rows.map((r) => (r.low === userId ? r.high : r.low));
  const friends = friendIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(or(...friendIds.map((id) => eq(user.id, id)))) : [];
  const matched: { name: string; userId: string }[] = [];
  const ambiguous: { name: string; options: string[] }[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const n = raw.trim().toLowerCase();
    let hits = friends.filter((f) => f.name.toLowerCase() === n);
    if (!hits.length) hits = friends.filter((f) => f.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
    if (hits.length === 1) matched.push({ name: raw, userId: hits[0]!.id });
    else if (hits.length > 1) ambiguous.push({ name: raw, options: hits.map((h) => h.name) });
    else unknown.push(raw);
  }
  return { matched, ambiguous, unknown };
}

/**
 * Current members of a messaging group with linked accounts (excluding `exceptUserId`), plus how many members
 * have no account. Chat membership is context only: it never creates a friendship.
 */
export async function chatMembers(db: Db, conversationId: string, exceptUserId?: string) {
  const rows = await db.select({ userId: messagingIdentities.userId, verifiedAt: messagingIdentities.verifiedAt })
    .from(conversationMembers)
    .leftJoin(messagingIdentities, eq(messagingIdentities.id, conversationMembers.messagingIdentityId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.isCurrent, true)));
  const ids = [...new Set(rows.filter((r) => r.userId && r.verifiedAt).map((r) => r.userId!))].filter((id) => id !== exceptUserId);
  const named = ids.length ? await db.select({ userId: user.id, name: user.name }).from(user).where(inArray(user.id, ids)) : [];
  return { members: named, withoutAccount: rows.filter((r) => !r.userId || !r.verifiedAt).length };
}

/** Which of `userIds` are accepted friends of `userId`. */
export async function friendsAmong(db: Db, userId: string, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db.select({ low: friendships.userLow, high: friendships.userHigh }).from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId))));
  const friends = new Set(rows.map((r) => (r.low === userId ? r.high : r.low)));
  return new Set(userIds.filter((u) => friends.has(u)));
}

async function assertSuppliedPhone(ctx: ToolCtx, phone: string) {
  if (ctx.conversation.kind !== 'private') throw new AppError('FORBIDDEN', 'Send contact numbers privately.');
  const normalized = normalizePhone(phone);
  const [message] = await ctx.db.select().from(messages).where(eq(messages.id, ctx.messageId));
  const text = message?.body ?? (message?.bodyEnc ? open('message', message.bodyEnc) : '');
  const supplied = text.match(/\+?\d[\d ().-]{6,}\d/g) ?? [];
  if (!normalized || !supplied.some(raw => normalizePhone(raw) === normalized)) throw new AppError('INVALID', 'Use a phone number supplied by the sender in this private message.');
}

export const TOOLS = [
  tool({
    name: 'select_plan', description: 'Choose the plan explicitly identified by the sender from context.openPlans in a private chat.',
    args: z.object({ planId: z.string() }),
    async run(ctx, a) {
      if (ctx.conversation.kind !== 'private' || !ctx.availablePlanIds?.includes(a.planId)) throw new AppError('INVALID', 'Choose a plan from the private conversation context.');
      const plan = await assertMember(ctx.db, a.planId, ctx.actor.userId);
      if (plan.status === 'closed') throw new AppError('INVALID', 'That plan is closed.');
      await linkConversation(ctx.db, plan.id, ctx.conversation, ctx.actor.userId);
      ctx.planId = plan.id;
      return { selected: true, planId: plan.id, request: plan.request };
    },
  }),

  tool({
    name: 'start_plan',
    description: 'Start a new plan for the sender and named friends. In a group chat set includeChatMembers=true when the request is for the people in this chat ("we", "us", "the three of us"). For unknown names, pass privately supplied friendContacts; the plan waits for connection acceptance. Missing or ambiguous contacts return a question without creating a partial plan.',
    args: z.object({
      request: z.string().min(3),
      friendNames: z.array(z.string()),
      includeChatMembers: z.boolean().default(false),
      friendContacts: z.array(z.object({ name: z.string().min(1).max(80), phone: z.string().min(7).max(30) })).default([]),
      kind: z.enum(['movie-night', 'local-outing']),
      windowStartAt: isoUtc.nullable(),
      windowEndAt: isoUtc.nullable(),
    }),
    async run(ctx, a) {
      if (ctx.planId && ctx.conversation.kind === 'group') return { error: 'This group already has an active plan', planId: ctx.planId };
      const r = await resolveFriendNames(ctx.db, ctx.actor.userId, a.friendNames);
      const pending = new Set(r.unknown);
      let unresolvedChatMembers = 0;
      if (a.includeChatMembers && ctx.conversation.kind === 'group') {
        const { members, withoutAccount } = await chatMembers(ctx.db, ctx.conversation.id, ctx.actor.userId);
        unresolvedChatMembers = withoutAccount;
        const friends = await friendsAmong(ctx.db, ctx.actor.userId, members.map(m => m.userId));
        for (const member of members) {
          if (!friends.has(member.userId)) pending.add(member.name);
          else if (!r.matched.some(match => match.userId === member.userId)) r.matched.push({ name: member.name, userId: member.userId });
        }
      }
      if (r.ambiguous.length) return { created: false, ambiguous: r.ambiguous };
      if (unresolvedChatMembers) return { created: false, needsSetup: unresolvedChatMembers, hint: 'Some chat members have not linked an account. Ask the organizer privately to identify the intended participants and provide their contacts.' };
      const contacts = [...pending].map(name => ({ name, matches: a.friendContacts.filter(contact => contact.name.trim().toLowerCase() === name.trim().toLowerCase()) }));
      const needsPhoneFor = contacts.filter(contact => contact.matches.length !== 1).map(contact => contact.name);
      if (needsPhoneFor.length) return { created: false, needsPhoneFor, hint: 'Ask the organizer privately for these phone numbers before starting the whole plan.' };
      for (const contact of contacts) await assertSuppliedPhone(ctx, contact.matches[0]!.phone);
      const [me] = await ctx.db.select({ city: user.city }).from(user).where(eq(user.id, ctx.actor.userId));
      const city = parseCity(me?.city);
      if (!city) return { created: false, error: 'Organizer has no city on file; ask where the outing should be.' };
      const window = a.windowStartAt && a.windowEndAt ? { startAt: a.windowStartAt, endAt: a.windowEndAt } : null;
      return ctx.db.transaction(async tx => {
        const { plan } = await createPlan(tx, ctx.actor, { request: a.request, templateId: a.kind, city, window, participantUserIds: r.matched.map(m => m.userId) });
        for (const contact of contacts) await inviteByPhone(tx, ctx.actor, { name: contact.name, phone: contact.matches[0]!.phone, context: a.request, planId: plan.id });
        await linkConversation(tx, plan.id, ctx.conversation, ctx.actor.userId);
        const [updated] = await tx.select().from(plans).where(eq(plans.id, plan.id));
        ctx.planId = plan.id;
        return { created: true, planId: plan.id, status: updated!.status, participants: r.matched.map(m => m.name), pendingConnections: contacts.length };
      });
    },
  }),
  tool({
    name: 'read_plan',
    description: 'Read the current plan: participants, options (A/B/C), votes tally, decision.',
    args: z.object({}),
    async run(ctx) {
      const planId = needPlan(ctx);
      return { ...(await publicPlan(ctx.db, ctx.actor, planId)), tally: await activeTally(ctx.db, planId) };
    },
  }),
  tool({
    name: 'record_availability',
    description: "Record the SENDER's own availability for this plan (times as ISO 8601 with offset). unavailable = times they cannot make; available = the only times they can make within the window, or null.",
    args: z.object({ window: Iv, available: z.array(Iv).nullable(), unavailable: z.array(Iv), certainty: z.enum(['explicit', 'tentative']) }),
    async run(ctx, a) {
      await savePrivateFact(ctx.db, ctx.actor, { planId: needPlan(ctx), fact: { kind: 'availability', value: a }, sourceMessageId: ctx.messageId });
      return { saved: true };
    },
  }),
  tool({
    name: 'record_spending_limit',
    description: "Record the SENDER's own private maximum spend per person in USD. Never repeat it in group messages.",
    args: z.object({ maxPerPersonUsd: z.number().positive().max(10_000) }),
    async run(ctx, a) {
      await savePrivateFact(ctx.db, ctx.actor, {
        planId: needPlan(ctx), sourceMessageId: ctx.messageId,
        fact: { kind: 'spending_limit', value: { maximumShare: { amountMinor: Math.round(a.maxPerPersonUsd * 100), currency: 'USD' } } },
      });
      return { saved: true };
    },
  }),
  tool({
    name: 'record_preference',
    description: "Record one of the SENDER's own preferences (e.g. key 'format', value 'IMAX').",
    args: z.object({ key: z.string().max(40), value: z.string().max(200), strength: z.enum(['soft', 'hard']) }),
    async run(ctx, a) {
      await savePrivateFact(ctx.db, ctx.actor, { planId: needPlan(ctx), fact: { kind: 'preference', value: a }, sourceMessageId: ctx.messageId });
      return { saved: true };
    },
  }),
  tool({
    name: 'record_vote',
    description: "Record the SENDER's own vote on the current options: every acceptable label, optional favorite (must be acceptable), or noneAcceptable.",
    args: z.object({ acceptableLabels: z.array(Label), favoriteLabel: Label.nullable(), noneAcceptable: z.boolean() }),
    async run(ctx, a) {
      const planId = needPlan(ctx);
      const { versionId, ids } = await labelsToIds(ctx.db, planId, a.acceptableLabels);
      const fav = a.favoriteLabel ? (await labelsToIds(ctx.db, planId, [a.favoriteLabel])).ids[0]! : null;
      await recordVote(ctx.db, ctx.actor, {
        planId, versionId, acceptableOptionIds: ids, favoriteOptionId: fav, noneAcceptable: a.noneAcceptable,
        source: 'message', sourceEventId: ctx.providerMessageId,
      });
      return { saved: true, tally: await activeTally(ctx.db, planId) };
    },
  }),
  tool({
    name: 'propose_selection',
    description: 'Record the group decision ONLY when messages clearly say to go ahead with an option and who is coming. Cite the message ids that establish it.',
    args: z.object({ label: Label, attendeeUserIds: z.array(z.string()).min(1), evidenceMessageIds: z.array(z.string()) }),
    async run(ctx, a) {
      const planId = needPlan(ctx);
      const { plan, versionId, ids } = await labelsToIds(ctx.db, planId, [a.label]);
      const r = await recordDecision(ctx.db, ctx.actor, {
        planId, versionId, optionId: ids[0]!, attendeeUserIds: a.attendeeUserIds,
        evidenceMessageIds: [...new Set([ctx.messageId, ...a.evidenceMessageIds])], expectedRevision: plan.inputRevision,
      });
      // Calendar details may go out before booking; the event text says it is not booked yet.
      await enqueue(ctx.db, { kind: 'sync_calendar', planId, dedupeKey: `sync_calendar:${planId}:${versionId}:selected`, payload: { planId } });
      return {
        selected: a.label, notAttendingUserIds: r.notAttending,
        next: 'Confirm the option and who is coming, then ask who will pay for everyone (you may suggest the organizer; never assign it). The buyer must say it themselves (confirm_buyer). Nothing is booked or charged yet.',
      };
    },
  }),
  tool({
    name: 'request_replan',
    description: 'Ask for revised options because a constraint, time, or activity materially changed. Old votes become stale.',
    args: z.object({ reason: z.string().max(200) }),
    async run(ctx, a) {
      const planId = needPlan(ctx);
      const plan = await assertMember(ctx.db, planId, ctx.actor.userId);
      // A reason written in a private chat may contain private details; the planner sees only a generic one.
      const reason = ctx.conversation.kind === 'group' ? a.reason : "a participant's constraints changed";
      await requestRepair(ctx.db, planId, plan.inputRevision, reason);
      return { replanning: true };
    },
  }),
  tool({
    name: 'ask_private_question',
    description: 'Privately ask one plan participant a short question (group conversations only).',
    args: z.object({ userId: z.string(), question: z.string().min(3).max(400) }),
    async run(ctx, a) {
      if (ctx.conversation.kind !== 'group') throw new AppError('FORBIDDEN', 'Only from a group conversation');
      const planId = needPlan(ctx);
      await assertMember(ctx.db, planId, a.userId);
      await enqueueMessage(ctx.db, { recipient: { kind: 'private', userId: a.userId }, text: a.question, effectKey: `ask:${ctx.messageId}:${a.userId}`, planId });
      return { sent: true };
    },
  }),
  tool({
    name: 'invite_friend',
    description: 'Send a SideQuest connection request from the sender to someone by phone number (E.164, or a 10-digit US number). Use for people the sender named who are not connected yet. context = a short, non-private description of what the group wants to do (e.g. "watch Avengers this weekend"). If this conversation has an active plan the sender organizes, the person is added to it and planning waits until they accept. The result never says whether the number has an account.',
    args: z.object({ name: z.string().min(1).max(80), phoneE164: z.string().min(7).max(20), context: z.string().max(120).nullable() }),
    async run(ctx, a) {
      await assertSuppliedPhone(ctx, a.phoneE164);
      if (!normalizePhone(a.phoneE164)) return { sent: false, error: 'That does not look like a phone number; ask for it with the country code.' };
      return inviteByPhone(ctx.db, ctx.actor, { name: a.name, phone: a.phoneE164, context: a.context, planId: ctx.planId });
    },
  }),
  tool({
    name: 'respond_friend_request',
    description: "Accept or decline a pending connection request someone sent the SENDER (e.g. they replied YES or NO). inviterName = the requester's name; empty string if the sender has exactly one pending request.",
    args: z.object({ inviterName: z.string().max(80), accept: z.boolean() }),
    async run(ctx, a) {
      const pending = await pendingRequestsFor(ctx.db, ctx.actor.userId);
      const n = a.inviterName.trim().toLowerCase();
      let hits = n ? pending.filter((p) => p.name.toLowerCase() === n) : pending;
      if (n && !hits.length) hits = pending.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
      if (!hits.length) return { done: false, error: 'No pending connection request from that person', pendingFrom: pending.map((p) => p.name) };
      if (hits.length > 1) return { done: false, ambiguous: hits.map((h) => h.name) };
      const r = await respondToFriendRequest(ctx.db, ctx.actor, hits[0]!.userId, a.accept);
      return { done: true, with: hits[0]!.name, status: r.status, plansResumed: r.resumedPlanIds.length };
    },
  }),
  // ---------- booking & payment (Part 4 via ./fulfillment). Selection, attendees and buyer come from the DB. ----------
  tool({
    name: 'confirm_buyer',
    description: 'The SENDER volunteers to pay for the whole group (confirm=true), or steps down as buyer (confirm=false). Call ONLY when the sender themself says they will pay; never because someone else nominated them. One buyer pays the merchant; everyone else gets a private request for their own share after booking.',
    args: z.object({ confirm: z.boolean() }),
    async run(ctx, a) {
      return setBuyer(ctx.db, ctx.actor, needPlan(ctx), a.confirm);
    },
  }),
  tool({
    name: 'get_quote',
    description: 'Get a current merchant quote (exact total, line items, seats) for the chosen option, attendees and confirmed buyer. The app posts the quote to the group when ready. seatPreference = the group\'s stated seating wish (e.g. "together, middle rows"), or null. Use this, not record_preference, for seats after the decision.',
    args: z.object({ seatPreference: z.string().max(300).nullable() }),
    async run(ctx, a) {
      return withFulfillment(async () => {
        const planId = needPlan(ctx);
        const sel = await readSelection(ctx.db, planId);
        if (!sel.ok) return { quoting: false, error: 'NO_SELECTION', message: sel.reason };
        if (!sel.buyerUserId) return { quoting: false, error: 'NO_BUYER', hint: 'Ask who will pay; they must confirm themselves.' };
        if (sel.plan.status !== 'selected') return { quoting: false, error: 'LOCKED', message: `Plan is ${sel.plan.status}; check booking_status.` };
        if (!sel.candidate) return { quoting: false, error: 'NO_MERCHANT', message: 'This option has no bookable source on file. The buyer can buy it directly (checkout_handoff).' };
        await assertMember(ctx.db, planId, ctx.actor.userId);
        const requestId = ctx.messageId;
        const operationKey = `quote:${planId}:${requestId}`;
        await enqueue(ctx.db, {
          kind: 'quote_booking', planId, dedupeKey: operationKey, maxAttempts: 1,
          payload: {
            actor: ctx.actor, operationKey, planId, versionId: sel.versionId, optionId: sel.optionId, buyerUserId: sel.buyerUserId,
            expectedRevision: sel.plan.inputRevision, requestId, ...(a.seatPreference ? { seatPreference: a.seatPreference } : {}),
          },
        });
        return { quoting: true, hint: 'Say you are checking the current price and seats; the app posts the exact quote. Do not state a price yourself.' };
      });
    },
  }),
  tool({
    name: 'request_payment_approval',
    description: "The BUYER (sender) asks to approve the latest quote. Sends the buyer a PRIVATE wallet approval link (or a private wallet-connect link first). Never repeat links or card details in chat. Approval alone does not book anything.",
    args: z.object({}),
    async run(ctx) {
      return withBuyer(ctx, async (svc, planId, sel) => {
        const wallet = await svc.walletConnection(ctx.actor);
        if (wallet.status !== 'connected') {
          const c = await svc.startWalletConnection(ctx.actor);
          await enqueueMessage(ctx.db, {
            recipient: { kind: 'private', userId: ctx.actor.userId }, planId, effectKey: `p4:connect:${c.connectionId}`,
            text: `Connect your Link wallet so you can approve the ${sel.option.title} purchase: ${c.url}${c.phrase ? ` (check that Link shows the phrase "${c.phrase}")` : ''}. Then tell me and I'll send the approval.`,
          });
          return { approvalSent: false, walletConnectLinkSentPrivately: true, hint: 'Tell the buyer to check their private messages to connect their wallet, then ask again.' };
        }
        const view = await svc.paymentView(ctx.actor, planId);
        const quote = latestQuote(view, sel.versionId, sel.optionId, ctx.actor.userId);
        if (!quote) return { approvalSent: false, error: 'NO_QUOTE', hint: 'Call get_quote first; a quote expires after a few minutes.' };
        const r = await svc.requestApproval(ctx.actor, quote.id, sel.plan.inputRevision);
        await enqueueMessage(ctx.db, {
          recipient: { kind: 'private', userId: ctx.actor.userId }, planId, effectKey: `p4:approval:${r.authorizationId}`,
          text: `${quote.mode === 'test' ? 'TEST MODE (no real charge): ' : ''}Approve paying ${usdText(quote.total)} USD for ${quote.attendeeUserIds.length} tickets to ${sel.option.title}: ${r.approvalUrl} . This authorizes exactly this quote. Reply "book it" here or in the group after approving.`,
        });
        return { approvalSent: true, sentPrivatelyTo: 'buyer', total: usdText(quote.total), hint: 'Tell the buyer to check their private messages. Do not say paid or booked.' };
      });
    },
  }),
  tool({
    name: 'book',
    description: 'The BUYER (sender) asks to complete the purchase after approving in their wallet. Verifies the approval with the payment provider and starts the booking; the app posts the actual result (Test booking / Booked / checkout handoff / uncertain). payPalMeHandle = the buyer\'s own PayPal.Me handle if they gave one for repayment links, else null.',
    args: z.object({ payPalMeHandle: z.string().max(60).nullable() }),
    async run(ctx, a) {
      return withBuyer(ctx, async (svc, planId, sel) => {
        const view = await svc.paymentView(ctx.actor, planId);
        const quote = latestQuote(view, sel.versionId, sel.optionId, ctx.actor.userId);
        if (!quote) return { submitted: false, error: 'NO_QUOTE', hint: 'Get a fresh quote (get_quote), then approval.' };
        const auths = ((view.authorizations ?? []) as FulfillmentAuthorization[]).filter((x) => x.quoteId === quote.id);
        const prior = auths.find((x) => x.status === 'approved') ?? auths.at(-1);
        if (!prior) return { submitted: false, error: 'NO_APPROVAL', hint: 'Call request_payment_approval first.' };
        const auth = await svc.refreshAuthorization(ctx.actor, prior.id);
        if (auth.status !== 'approved') return { submitted: false, approvalStatus: auth.status, hint: 'The buyer has not approved this exact quote yet; ask them to use the private link.' };
        const operationKey = `booking:${quote.id}`;
        await enqueue(ctx.db, {
          kind: 'submit_booking', planId, dedupeKey: operationKey, maxAttempts: 1,
          payload: { actor: ctx.actor, operationKey, quoteId: quote.id, authorizationId: auth.id, expectedRevision: sel.plan.inputRevision, ...(a.payPalMeHandle ? { buyerPayPalMe: a.payPalMeHandle } : {}) },
        });
        return { submitted: true, hint: 'Say you are attempting the booking now and will post the result. Do not say booked yet.' };
      });
    },
  }),
  tool({
    name: 'checkout_handoff',
    description: 'The BUYER (sender) will buy the tickets themself on the merchant site (direct booking unsupported or they prefer it). Sends them the checkout link PRIVATELY. Nothing is bought by the app.',
    args: z.object({}),
    async run(ctx) {
      return withBuyer(ctx, async (svc, planId, sel) => {
        const h = await svc.handoff(ctx.actor, planId, sel.plan.inputRevision);
        await moveStatus(ctx.db, planId, 'needs_handoff');
        await sendHandoff(ctx.db, planId, ctx.actor.userId, sel.option.title, h.handoffUrl);
        return { handoff: true, linkSentPrivately: !!h.handoffUrl, status: bookingLabel(h.booking.status), hint: 'Tell the group the buyer is completing checkout; not booked yet. Ask the buyer to report the total and order number when done.' };
      }, ['selected', 'needs_handoff']);
    },
  }),
  tool({
    name: 'report_booked',
    description: "The BUYER (sender) reports they completed the purchase themself (after a checkout handoff): the total actually charged in USD and the order/confirmation number. Records 'Buyer reports booked' and sends each other attendee a private request for their share. payPalMeHandle = the buyer's own PayPal.Me handle if given, else null.",
    args: z.object({ totalUsd: z.number().positive().max(100_000), orderReference: z.string().min(1).max(200), payPalMeHandle: z.string().max(60).nullable() }),
    async run(ctx, a) {
      return withBuyer(ctx, async (svc, planId, sel) => {
        const view = await svc.paymentView(ctx.actor, planId);
        const open = ((view.bookings ?? []) as FulfillmentBooking[]).find((b) => b.versionId === sel.versionId && (b.status === 'handoff_required' || b.status === 'outcome_unknown'));
        const bookingId = open?.id ?? (await svc.handoff(ctx.actor, planId, sel.plan.inputRevision)).booking.id;
        const b = await svc.reportCompleted(ctx.actor, bookingId, {
          total: { amountMinor: Math.round(a.totalUsd * 100), currency: 'USD' }, orderReference: a.orderReference.trim(),
          expectedRevision: sel.plan.inputRevision, buyerPayPalMe: a.payPalMeHandle,
        });
        await afterBooking(ctx.db, svc, ctx.actor, b);
        return { recorded: true, status: bookingLabel(b.status), hint: 'The app posted the update and sent private shares. Do not restate individual shares in the group.' };
      }, ['selected', 'needs_handoff', 'booking']);
    },
  }),
  tool({
    name: 'booking_status',
    description: 'Current buyer, quote, approval, booking and repayment status for this plan. Use before answering "are we booked?" or "what do I owe?". In a private chat it includes the sender\'s own share only.',
    args: z.object({}),
    async run(ctx) {
      return withFulfillment(async (svc) => {
        const planId = needPlan(ctx);
        const sel = await readSelection(ctx.db, planId);
        if (!sel.ok) return { selected: false, message: sel.reason };
        const view = await svc.paymentView(ctx.actor, planId);
        const isBuyer = sel.buyerUserId === ctx.actor.userId;
        const bookings = (isBuyer ? (view.bookings ?? []) : (view.bookingStatus ?? [])) as Pick<FulfillmentBooking, 'id' | 'status' | 'mode'>[];
        const latest = bookings.at(-1);
        const quote = isBuyer ? latestQuote(view, sel.versionId, sel.optionId, ctx.actor.userId) : null;
        const auth = quote ? ((view.authorizations ?? []) as FulfillmentAuthorization[]).filter((x) => x.quoteId === quote.id).at(-1) : undefined;
        const mine = ((view.reimbursements ?? []) as FulfillmentReimbursement[]).filter((r) => r.payerUserId === ctx.actor.userId);
        const [buyer] = sel.buyerUserId ? await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, sel.buyerUserId)) : [];
        return {
          planStatus: sel.plan.status, mode: sel.plan.mode, option: sel.option.title, attendees: sel.attendeeUserIds.length,
          buyer: buyer?.name ?? null, booking: latest ? bookingLabel(latest.status) : 'Not booked',
          ...(quote ? { quoteTotal: usdText(quote.total), quoteExpiresAt: quote.expiresAt, approval: auth?.status ?? 'not requested' } : {}),
          ...(ctx.conversation.kind === 'private' && mine.length ? { yourShare: mine.map((r) => ({ amount: usdText(r.amount), status: r.status })) } : {}),
        };
      });
    },
  }),
  tool({
    name: 'record_repayment',
    description: "Repayment status after booking. action='sent': the SENDER says they paid the buyer back their own share. action='received': the BUYER (sender) confirms they received money from payerName. These are manual statuses, not verified by any payment provider.",
    args: z.object({ action: z.enum(['sent', 'received']), payerName: z.string().max(80).nullable() }),
    async run(ctx, a) {
      return withFulfillment(async (svc) => {
        const planId = needPlan(ctx);
        const view = await svc.paymentView(ctx.actor, planId);
        let rows = ((view.reimbursements ?? []) as FulfillmentReimbursement[]).filter((r) => a.action === 'sent' ? r.payerUserId === ctx.actor.userId : r.recipientUserId === ctx.actor.userId);
        if (a.action === 'received') {
          const n = (a.payerName ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
          const people = rows.length ? await ctx.db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, rows.map((r) => r.payerUserId))) : [];
          const ids = new Set(people.filter((p) => n && p.name.toLowerCase().split(/\s+/)[0] === n).map((p) => p.id));
          rows = rows.filter((r) => ids.has(r.payerUserId));
        }
        if (rows.length !== 1) return { updated: false, error: rows.length ? 'AMBIGUOUS' : 'NOT_FOUND', message: 'No single matching repayment request for the sender.' };
        const r = await svc.updateReimbursement(ctx.actor, rows[0]!.id, a.action === 'sent' ? 'report-sent' : 'confirm-received');
        return { updated: true, status: r.status, note: 'Manual status, not provider-verified.' };
      });
    },
  }),
  tool({
    name: 'request_booking_change',
    description: 'After booking: a participant asks to change or cancel. Hands it to the buyer privately to handle with the provider. Nothing is refunded or re-bought automatically.',
    args: z.object({ description: z.string().min(3).max(500) }),
    async run(ctx, a) {
      return withFulfillment(async () => {
        const planId = needPlan(ctx);
        const plan = await assertMember(ctx.db, planId, ctx.actor.userId);
        const text = ctx.conversation.kind === 'group' ? a.description : 'A participant asked privately for a change.';
        // Same key format as Part 4's fulfillmentJobOperationKey, which its job handler verifies.
        const operationKey = `handle_change:${planId}:${plan.inputRevision}:${ctx.actor.userId}:${createHash('sha256').update(text).digest('hex')}`;
        await enqueue(ctx.db, { kind: 'handle_change', planId, dedupeKey: operationKey, maxAttempts: 1, payload: { actor: ctx.actor, operationKey, planId, text, expectedRevision: plan.inputRevision } });
        return { handedToBuyer: true, hint: 'Say the buyer will check the provider\'s change/cancellation options; nothing is refunded automatically.' };
      });
    },
  }),
];

const usdText = (m: { amountMinor: number }) => `$${(m.amountMinor / 100).toFixed(2)}`;

function latestQuote(view: Record<string, unknown>, versionId: string, optionId: string, buyerUserId: string) {
  const now = Date.now();
  return ((view.quotes ?? []) as FulfillmentQuote[])
    .filter((q) => q.versionId === versionId && q.optionId === optionId && q.buyerUserId === buyerUserId && Date.parse(q.expiresAt) > now)
    .sort((x, y) => Date.parse(y.expiresAt) - Date.parse(x.expiresAt))[0] ?? null;
}

/** Runs a Part 4 operation; unconfigured -> honest NOT_SET_UP, Part 4 business errors -> data for the model. */
async function withFulfillment<T>(fn: (svc: FulfillmentPort) => Promise<T>) {
  const svc = fulfillmentService();
  if (!svc) return NOT_SET_UP;
  try { return await fn(svc); } catch (e) {
    const fe = fulfillmentError(e);
    if (fe) return { error: fe.code, message: fe.message };
    throw e;
  }
}

/** Buyer-only operations: the sender must be the buyer recorded on the decision. */
async function withBuyer<T>(
  ctx: ToolCtx,
  fn: (svc: FulfillmentPort, planId: string, sel: Extract<SelectionState, { ok: true }>) => Promise<T>,
  statuses: string[] = ['selected'],
) {
  return withFulfillment(async (svc) => {
    const planId = needPlan(ctx);
    const sel = await readSelection(ctx.db, planId);
    if (!sel.ok) return { error: 'NO_SELECTION', message: sel.reason };
    if (!sel.buyerUserId) return { error: 'NO_BUYER', hint: 'Ask who will pay; they must confirm themselves (confirm_buyer).' };
    if (sel.buyerUserId !== ctx.actor.userId) return { error: 'NOT_BUYER', message: 'Only the confirmed buyer can do this.' };
    if (!statuses.includes(sel.plan.status)) return { error: 'LOCKED', message: `Plan is ${sel.plan.status}; check booking_status.` };
    return fn(svc, planId, sel);
  });
}

export function toolsFor(allowed: string[]) {
  const list = TOOLS.filter((t) => allowed.includes(t.name));
  const specs: ToolSpec[] = list.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.args, { io: 'input' }) as Record<string, unknown> },
  }));
  return { list, specs, byName: new Map(list.map((t) => [t.name, t])) };
}

/** Attach a conversation to a plan so options/replies reach it. Group chats get the plan as their active plan. */
export async function linkConversation(db: Db, planId: string, conv: { id: string; kind: 'group' | 'private' }, ownerUserId: string) {
  await db.insert(planConversations).values({
    planId, conversationId: conv.id, audience: conv.kind, ownerUserId: conv.kind === 'private' ? ownerUserId : null,
  }).onConflictDoNothing();
  await db.update(conversations).set({ activePlanId: planId }).where(eq(conversations.id, conv.id));
}

