// Model-callable tools. Every tool runs as the injected, verified sender (ctx.actor); the model never
// supplies a user identity for itself. Effects go through the same core services as the HTTP API.
import { z } from 'zod';
import { and, eq, or } from 'drizzle-orm';
import { conversations, friendships, planConversations, planOptions, plans, user, type Db } from '@hacktx/db';
import { City, type ActorContext } from '@hacktx/contracts';
import { AppError, activeTally, assertMember, createPlan, enqueueMessage, publicPlan, recordDecision, recordVote, requestRepair, savePrivateFact } from '@hacktx/core';
import type { ToolSpec } from './muse';

export type ToolCtx = {
  db: Db;
  actor: ActorContext; // verified sender
  planId: string | null;
  conversation: { id: string; kind: 'group' | 'private' };
  messageId: string; // internal messages.id of the triggering message
  providerMessageId: string;
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

export const TOOLS = [
  tool({
    name: 'start_plan',
    description: 'Start a new plan for the sender and named friends. Returns ambiguous/unknown names instead of creating if any name cannot be resolved among the sender\'s accepted friends.',
    args: z.object({
      request: z.string().min(3),
      friendNames: z.array(z.string()),
      kind: z.enum(['movie-night', 'local-outing']),
      windowStartAt: isoUtc.nullable(),
      windowEndAt: isoUtc.nullable(),
    }),
    async run(ctx, a) {
      if (ctx.planId) return { error: 'This conversation already has an active plan', planId: ctx.planId };
      const r = await resolveFriendNames(ctx.db, ctx.actor.userId, a.friendNames);
      if (r.ambiguous.length || r.unknown.length) {
        return { created: false, ambiguous: r.ambiguous, notConnected: r.unknown, hint: 'Ask which person they mean, or ask the organizer for the phone number of anyone not connected yet.' };
      }
      const [me] = await ctx.db.select({ city: user.city }).from(user).where(eq(user.id, ctx.actor.userId));
      const city = City.safeParse(me?.city);
      if (!city.success) return { created: false, error: 'Organizer has no city on file; ask where the outing should be.' };
      const window = a.windowStartAt && a.windowEndAt ? { startAt: a.windowStartAt, endAt: a.windowEndAt } : null;
      const { plan, missingConnections } = await createPlan(ctx.db, ctx.actor, {
        request: a.request, templateId: a.kind, city: city.data, window, participantUserIds: r.matched.map((m) => m.userId),
      });
      await linkConversation(ctx.db, plan.id, ctx.conversation, ctx.actor.userId);
      return { created: true, planId: plan.id, status: plan.status, participants: r.matched.map((m) => m.name), pendingConnections: missingConnections.length };
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
      return { selected: a.label, notAttendingUserIds: r.notAttending };
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
];

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
  if (conv.kind === 'group') await db.update(conversations).set({ activePlanId: planId }).where(eq(conversations.id, conv.id));
}

