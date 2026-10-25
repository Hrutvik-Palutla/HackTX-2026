import { and, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';
import {
  plans, planParticipants, planVersions, planOptions, polls, planDecisions, friendships, user, messages, planConversations, sources,
  votes, voteStates, fulfillmentBookings,
  type Db,
} from '@hacktx/db';
import { City as CityS, PlanOption, type ActorContext, type City, type Interval, type PlanStatus } from '@hacktx/contracts';
import { invalid, notFound, stale, AppError } from './errors';
import { enqueue } from './jobs';

export type PlanRow = typeof plans.$inferSelect;

// Allowed workflow transitions (ARCHITECTURE §7). Wallet/booking/calendar states live in their own tables.
const NEXT: Record<PlanStatus, PlanStatus[]> = {
  waiting_connections: ['planning', 'closed'],
  planning: ['clarifying', 'voting', 'planning', 'closed'],
  clarifying: ['planning', 'closed'],
  voting: ['planning', 'selected', 'closed'],
  selected: ['quoting', 'planning', 'needs_handoff', 'closed'],
  quoting: ['awaiting_payment_approval', 'selected', 'needs_handoff', 'planning'],
  awaiting_payment_approval: ['booking', 'quoting', 'selected', 'needs_handoff'],
  booking: ['booked', 'needs_handoff'],
  booked: ['change_requested'],
  needs_handoff: ['booked', 'selected', 'closed'],
  change_requested: ['booked'],
  closed: [],
};

export function assertTransition(from: PlanStatus, to: PlanStatus) {
  if (!NEXT[from].includes(to)) throw new AppError('UNRESOLVED', `Cannot move plan from ${from} to ${to}`);
}

const pair = (a: string, b: string) => (a < b ? [a, b] as const : [b, a] as const);

/** Users among `others` who are NOT accepted friends of `organizer`. */
export async function missingConnections(db: Db, organizerId: string, others: string[]): Promise<string[]> {
  const ids = others.filter((o) => o !== organizerId);
  if (!ids.length) return [];
  const rows = await db.select().from(friendships).where(and(
    eq(friendships.status, 'accepted'),
    or(...ids.map((o) => { const [lo, hi] = pair(organizerId, o); return and(eq(friendships.userLow, lo), eq(friendships.userHigh, hi)); })),
  ));
  const ok = new Set(rows.map((r) => (r.userLow === organizerId ? r.userHigh : r.userLow)));
  return ids.filter((o) => !ok.has(o));
}

/** Organizer or resolved participant; anyone else gets a generic 404. */
export async function assertMember(db: Db, planId: string, userId: string): Promise<PlanRow> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw notFound();
  if (plan.organizerUserId === userId) return plan;
  const [p] = await db.select({ id: planParticipants.id }).from(planParticipants)
    .where(and(eq(planParticipants.planId, planId), eq(planParticipants.userId, userId)));
  if (!p) throw notFound();
  return plan;
}

export async function createPlan(
  db: Db,
  actor: ActorContext,
  input: { request: string; templateId: 'movie-night' | 'local-outing'; city: City; window: Interval | null; participantUserIds: string[]; mode?: 'live' | 'test' },
) {
  const participants = [...new Set(input.participantUserIds.filter((u) => u !== actor.userId))];
  const missing = await missingConnections(db, actor.userId, participants);
  return db.transaction(async (tx) => {
    const [plan] = await tx.insert(plans).values({
      organizerUserId: actor.userId,
      request: input.request,
      templateId: input.templateId,
      city: input.city,
      timeZone: input.city.timeZone,
      windowStart: input.window ? new Date(input.window.startAt) : null,
      windowEnd: input.window ? new Date(input.window.endAt) : null,
      status: missing.length ? 'waiting_connections' : 'planning',
      mode: input.mode ?? 'test',
    }).returning();
    await tx.insert(planParticipants).values([actor.userId, ...participants].map((userId) => ({ planId: plan!.id, userId })));
    if (!missing.length) {
      await enqueue(tx, { kind: 'plan', planId: plan!.id, dedupeKey: `plan:${plan!.id}:0`, payload: { planId: plan!.id, inputRevision: 0 } });
    }
    return { plan: plan!, missingConnections: missing };
  });
}

/** Compare-and-swap the plan's input revision. Any constraint/roster/message that changes planning input calls this. */
export async function bumpRevision(db: Db, planId: string, expectedRevision: number, patch: Partial<Pick<PlanRow, 'status'>> = {}) {
  const [row] = await db.update(plans)
    .set({ ...patch, inputRevision: sql`${plans.inputRevision} + 1`, updatedAt: new Date() })
    .where(and(eq(plans.id, planId), eq(plans.inputRevision, expectedRevision)))
    .returning();
  if (!row) throw stale();
  return row;
}

/**
 * A material change: new revision, plan back to `planning`, fresh repair job. Old version/poll become stale
 * because publishVersion supersedes them and votes require the active version.
 */
export async function requestRepair(db: Db, planId: string, expectedRevision: number, reason: string, change?: { request?: string; templateId?: 'movie-night' | 'local-outing' }) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(plans).where(eq(plans.id, planId));
    if (!cur) throw notFound();
    if (!['planning', 'clarifying', 'voting', 'selected', 'needs_handoff'].includes(cur.status)) {
      throw new AppError('UNRESOLVED', `Plan in ${cur.status} cannot be repaired automatically`);
    }
    const purchases = await tx.select({ payload: fulfillmentBookings.payload }).from(fulfillmentBookings).where(eq(fulfillmentBookings.planId, planId));
    if (cur.status === 'needs_handoff' && !purchases.some(row => (row.payload as { status?: string }).status === 'failed')) {
      throw new AppError('UNRESOLVED', 'The buyer must confirm the handoff was not purchased before changing the plan.');
    }
    if (purchases.some(row => ['handoff_required', 'submitting', 'outcome_unknown', 'merchant_confirmed', 'test_confirmed', 'buyer_reported'].includes((row.payload as { status?: string }).status ?? ''))) {
      throw new AppError('UNRESOLVED', 'The buyer must resolve the existing checkout before the plan can change.');
    }
    const row = await bumpRevision(tx, planId, expectedRevision, { status: 'planning' });
    await tx.update(plans).set({ selectedOptionId: null, ...change, updatedAt: new Date() }).where(eq(plans.id, planId));
    await enqueue(tx, { kind: 'repair', planId, dedupeKey: `repair:${planId}:${row.inputRevision}`, payload: { planId, inputRevision: row.inputRevision, reason } });
    const [updated] = await tx.select().from(plans).where(eq(plans.id, planId));
    return updated!;
  });
}

export type OptionDraft = Omit<PlanOption, 'id' | 'versionId'>;

/**
 * Publish options computed from `inputRevision`. Fails with STALE_PLAN if the plan moved on while the
 * agent was working, so an obsolete draft never replaces newer constraints.
 */
export async function publishVersion(db: Db, input: { planId: string; inputRevision: number; runId: string | null; options: OptionDraft[] }) {
  if (input.options.length < 1 || input.options.length > 3) throw invalid('1-3 options required');
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId)).for('update');
    if (!plan) throw notFound();
    if (plan.inputRevision !== input.inputRevision) throw stale('Plan input changed during planning');
    assertTransition(plan.status as PlanStatus, 'voting');

    const [{ n } = { n: 0 }] = await tx.select({ n: max(planVersions.versionNumber) }).from(planVersions).where(eq(planVersions.planId, plan.id));
    if (plan.activeVersionId) {
      await tx.update(planVersions).set({ supersededAt: new Date() }).where(eq(planVersions.id, plan.activeVersionId));
      await tx.update(polls).set({ superseded: true }).where(eq(polls.versionId, plan.activeVersionId));
    }
    const [version] = await tx.insert(planVersions).values({
      planId: plan.id, versionNumber: (n ?? 0) + 1, inputRevision: input.inputRevision, runId: input.runId,
    }).returning();

    const options: PlanOption[] = [];
    for (const draft of input.options) {
      const id = crypto.randomUUID();
      const opt = PlanOption.parse({ ...draft, id, versionId: version!.id });
      await tx.insert(planOptions).values({ id, versionId: version!.id, label: opt.label, payload: opt });
      options.push(opt);
    }
    await tx.update(plans).set({ activeVersionId: version!.id, status: 'voting', updatedAt: new Date() }).where(eq(plans.id, plan.id));
    return { version: version!, options };
  });
}

/** Set a non-version status (e.g. clarifying, closed) only if the revision is still current. */
export async function setStatus(db: Db, planId: string, expectedRevision: number, to: PlanStatus) {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw notFound();
  if (plan.inputRevision !== expectedRevision) throw stale();
  assertTransition(plan.status as PlanStatus, to);
  const [row] = await db.update(plans).set({ status: to, updatedAt: new Date() })
    .where(and(eq(plans.id, planId), eq(plans.inputRevision, expectedRevision), eq(plans.status, plan.status))).returning();
  if (!row) throw stale();
  return row;
}

/**
 * Record the group decision. Attendees must be resolved participants; evidence messages must come from this
 * plan's conversations. Returns participants left out so the agent can say so publicly (never silently drop).
 */
export async function recordDecision(
  db: Db,
  actor: ActorContext,
  input: { planId: string; versionId: string; optionId: string; attendeeUserIds: string[]; evidenceMessageIds: string[]; expectedRevision: number },
) {
  return db.transaction(async (tx) => {
    await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, input.planId)).for('update');
    const plan = await assertMember(tx, input.planId, actor.userId);
    if (plan.inputRevision !== input.expectedRevision || plan.activeVersionId !== input.versionId) throw stale();
    assertTransition(plan.status as PlanStatus, 'selected');
    const [opt] = await tx.select().from(planOptions).where(and(eq(planOptions.id, input.optionId), eq(planOptions.versionId, input.versionId)));
    if (!opt) throw invalid('Option is not in this version');
    const option = PlanOption.parse(opt.payload);
    if (!option.startAt || !option.endAt) throw invalid('Pick a theater and clarify a real showtime before selecting or booking this option.');

    const parts = await tx.select({ userId: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, plan.id));
    const members = new Set(parts.map((p) => p.userId).filter(Boolean) as string[]);
    const attendees = [...new Set(input.attendeeUserIds)];
    if (!attendees.length || attendees.some((a) => !members.has(a))) throw invalid('Attendees must be plan participants');

    if (input.evidenceMessageIds.length) {
      const ev = await tx.select({ id: messages.id }).from(messages)
        .innerJoin(planConversations, eq(planConversations.conversationId, messages.conversationId))
        .where(and(eq(planConversations.planId, plan.id), inArray(messages.id, input.evidenceMessageIds)));
      if (ev.length !== new Set(input.evidenceMessageIds).size) throw invalid('Evidence must be messages from this plan');
    } else if (actor.source !== 'web') {
      throw invalid('A chat decision needs the message(s) that established it');
    }

    const [decision] = await tx.insert(planDecisions).values({
      planId: plan.id, versionId: input.versionId, optionId: input.optionId,
      attendeeUserIds: attendees, evidenceMessageIds: input.evidenceMessageIds, recordedBy: actor.userId,
    }).returning();
    const moved = await tx.update(plans).set({ status: 'selected', selectedOptionId: input.optionId, updatedAt: new Date() })
      .where(and(eq(plans.id, plan.id), eq(plans.inputRevision, input.expectedRevision), eq(plans.status, 'voting')))
      .returning({ id: plans.id });
    if (!moved.length) throw stale();
    return { decision: decision!, notAttending: [...members].filter((m) => !attendees.includes(m)) };
  });
}

/** Group-safe projection: no phones, interests, private facts, calendars, or payment details. */
export async function publicPlan(db: Db, actor: ActorContext, planId: string) {
  const plan = await assertMember(db, planId, actor.userId);
  const people = await db.select({ id: user.id, name: user.name, avatarUrl: user.image, attendance: planParticipants.attendance })
    .from(planParticipants).innerJoin(user, eq(user.id, planParticipants.userId)).where(eq(planParticipants.planId, planId));
  const invited = await db.select({ requestedName: planParticipants.requestedName }).from(planParticipants)
    .where(and(eq(planParticipants.planId, planId), isNull(planParticipants.userId)));
  const options = plan.activeVersionId
    ? (await db.select().from(planOptions).where(eq(planOptions.versionId, plan.activeVersionId))).map((o) => o.payload as PlanOption)
    : [];
  const [decision] = plan.activeVersionId
    ? await db.select().from(planDecisions).where(eq(planDecisions.versionId, plan.activeVersionId)).orderBy(sql`${planDecisions.recordedAt} desc`).limit(1)
    : [];
  const sourceIds = [...new Set(options.flatMap((o) => o.sourceIds))];
  // Current votes are part of the group-visible plan (CONTRACTS.md §5); one entry per voter on the active version.
  const voteRows = plan.activeVersionId ? await db.select().from(votes).where(eq(votes.versionId, plan.activeVersionId)) : [];
  const stateRows = plan.activeVersionId ? await db.select().from(voteStates).where(eq(voteStates.versionId, plan.activeVersionId)) : [];
  const sourceRows = sourceIds.length ? await db.select().from(sources).where(inArray(sources.id, sourceIds)) : [];
  return {
    id: plan.id,
    request: plan.request,
    status: plan.status as PlanStatus,
    revision: plan.inputRevision,
    timeZone: plan.timeZone,
    mode: plan.mode,
    organizerUserId: plan.organizerUserId,
    participants: people,
    pendingInvites: invited.map((i) => i.requestedName),
    activeVersionId: plan.activeVersionId,
    options: options.sort((a, b) => a.label.localeCompare(b.label)),
    votes: stateRows.map((v) => ({
      userId: v.userId, versionId: v.versionId, favoriteOptionId: v.favoriteOptionId, noneAcceptable: v.noneAcceptable,
      acceptableOptionIds: voteRows.filter((r) => r.userId === v.userId).map((r) => r.optionId),
    })),
    sources: sourceRows.map((s) => ({ id: s.id, url: s.url, title: s.title, provider: s.provider, fetchedAt: s.fetchedAt.toISOString() })),
    decision: decision ? { optionId: decision.optionId, attendeeUserIds: decision.attendeeUserIds, recordedAt: decision.recordedAt.toISOString() } : null,
  };
}

/**
 * Call after a friendship is accepted (Part 1's accept handler). Any waiting plan of this user whose organizer
 * is now connected to every participant moves to planning and gets a plan job. Existing friends need no extra step.
 */
export async function resumeWaitingPlans(db: Db, userId: string) {
  const waiting = await db.selectDistinct({ id: plans.id, organizer: plans.organizerUserId, rev: plans.inputRevision }).from(plans)
    .leftJoin(planParticipants, eq(planParticipants.planId, plans.id))
    .where(and(eq(plans.status, 'waiting_connections'), or(eq(plans.organizerUserId, userId), eq(planParticipants.userId, userId))));
  const resumed: string[] = [];
  for (const p of waiting) {
    const parts = await db.select({ userId: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, p.id));
    if (parts.some((x) => !x.userId)) continue; // invitee hasn't signed up yet
    if ((await missingConnections(db, p.organizer, parts.map((x) => x.userId!))).length) continue;
    await db.transaction(async (tx) => {
      const row = await bumpRevision(tx, p.id, p.rev, { status: 'planning' });
      await enqueue(tx, { kind: 'plan', planId: p.id, dedupeKey: `plan:${p.id}:${row.inputRevision}`, payload: { planId: p.id, inputRevision: row.inputRevision } });
    });
    resumed.push(p.id);
  }
  return resumed;
}

/** Plans visible to the user (organizer or participant), newest first. */
export async function listPlans(db: Db, actor: ActorContext) {
  return db.selectDistinct({ id: plans.id, request: plans.request, status: plans.status, updatedAt: plans.updatedAt }).from(plans)
    .leftJoin(planParticipants, eq(planParticipants.planId, plans.id))
    .where(or(eq(plans.organizerUserId, actor.userId), eq(planParticipants.userId, actor.userId)))
    .orderBy(sql`${plans.updatedAt} desc`);
}

const BEFORE_BOOKING: PlanStatus[] = ['waiting_connections', 'planning', 'clarifying', 'voting', 'selected'];

/** Organizer edits the roster before booking. New people must be accepted friends; options are re-planned. */
export async function updateParticipants(db: Db, actor: ActorContext, input: { planId: string; add: string[]; remove: string[]; removeInviteIds?: string[]; expectedRevision: number }) {
  const plan = await assertMember(db, input.planId, actor.userId);
  if (plan.organizerUserId !== actor.userId) throw new AppError('FORBIDDEN', 'Only the organizer can change who is invited');
  if (!BEFORE_BOOKING.includes(plan.status as PlanStatus)) throw new AppError('UNRESOLVED', 'Roster is locked after booking starts');
  if (input.remove.includes(plan.organizerUserId)) throw invalid('Organizer cannot be removed');
  const missing = await missingConnections(db, plan.organizerUserId, input.add);
  if (missing.length) throw new AppError('UNRESOLVED', 'Connect with these people first');
  return db.transaction(async (tx) => {
    const status = plan.status === 'waiting_connections' ? 'waiting_connections' : 'planning';
    const row = await bumpRevision(tx, plan.id, input.expectedRevision, { status });
    if (input.remove.length) await tx.delete(planParticipants).where(and(eq(planParticipants.planId, plan.id), inArray(planParticipants.userId, input.remove)));
    if (input.removeInviteIds?.length) await tx.delete(planParticipants).where(and(eq(planParticipants.planId, plan.id), inArray(planParticipants.inviteId, input.removeInviteIds), isNull(planParticipants.userId)));
    if (input.add.length) await tx.insert(planParticipants).values(input.add.map((userId) => ({ planId: plan.id, userId }))).onConflictDoNothing();
    await tx.update(plans).set({ selectedOptionId: null }).where(eq(plans.id, plan.id));
    if (status === 'planning') {
      await enqueue(tx, { kind: 'repair', planId: plan.id, dedupeKey: `repair:${plan.id}:${row.inputRevision}`, payload: { planId: plan.id, inputRevision: row.inputRevision, reason: 'the group changed' } });
    }
    if (status === 'waiting_connections') {
      const resumed = await resumeWaitingPlans(tx, plan.organizerUserId);
      if (resumed.includes(plan.id)) return (await tx.select().from(plans).where(eq(plans.id, plan.id)))[0]!;
    }
    return row;
  });
}

/** Organizer closes an unbooked plan. */
export async function closePlan(db: Db, actor: ActorContext, planId: string, expectedRevision: number) {
  const plan = await assertMember(db, planId, actor.userId);
  if (plan.organizerUserId !== actor.userId) throw new AppError('FORBIDDEN', 'Only the organizer can close the plan');
  return setStatus(db, planId, expectedRevision, 'closed');
}

/** `user.city` is a JSON-encoded City string (Better Auth string field, written by Part 1's accounts repository). */
export function parseCity(raw: unknown): City | null {
  try {
    const r = CityS.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
