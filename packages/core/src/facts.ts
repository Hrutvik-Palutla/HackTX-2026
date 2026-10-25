// Private facts: owner-only through APIs; the deterministic feasibility layer reads them server-side.
// Nothing here returns another user's fact to a caller, and nothing feeds raw facts to public prompts.
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { availabilitySnapshots, plans, privateFacts, type Db } from '@hacktx/db';
import { PrivateFactValue, type ActorContext, type Interval, type PrivateFact } from '@hacktx/contracts';
import { openJson, sealJson } from './crypto';
import { assertMember, requestRepair } from './plans';
import { statementToBusy, type KnownBusy, type MemberAvailability } from './availability';

/**
 * Save the actor's own fact for a plan. Supersedes their previous fact of the same kind (and key, for
 * preferences/requirements). While planning or after options exist, this is a material change -> repair.
 */
export async function savePrivateFact(
  db: Db,
  actor: ActorContext,
  input: { planId: string; fact: PrivateFactValue; sourceMessageId?: string | null; expectedRevision?: number },
) {
  const fact = PrivateFactValue.parse(input.fact);
  const plan = await assertMember(db, input.planId, actor.userId);
  const row = await db.transaction(async (tx) => {
    const [row] = await tx.insert(privateFacts).values({
      ownerUserId: actor.userId, planId: plan.id, kind: fact.kind,
      valueEnc: sealJson('private_fact', fact.value), sourceMessageId: input.sourceMessageId ?? null,
    }).returning();
    const prev = await tx.select().from(privateFacts).where(and(
      eq(privateFacts.ownerUserId, actor.userId), eq(privateFacts.planId, plan.id),
      eq(privateFacts.kind, fact.kind), isNull(privateFacts.supersededBy),
    ));
    const sameKey = (r: typeof prev[number]) => {
      if (r.id === row!.id) return false;
      if (fact.kind !== 'preference' && fact.kind !== 'requirement') return true;
      return openJson<{ key: string }>('private_fact', r.valueEnc).key === fact.value.key;
    };
    const old = prev.filter(sameKey).map((r) => r.id);
    if (old.length) await tx.update(privateFacts).set({ supersededBy: row!.id }).where(inArray(privateFacts.id, old));
    return row!;
  });
  // 'planning' included: bumping the revision makes an in-flight run's draft stale instead of publishing without this fact.
  if (['planning', 'voting', 'selected', 'clarifying'].includes(plan.status)) {
    await requestRepair(db, plan.id, input.expectedRevision ?? plan.inputRevision, 'private constraint changed');
  }
  return { id: row.id };
}

const toFact = (r: typeof privateFacts.$inferSelect): PrivateFact => ({
  id: r.id, ownerUserId: r.ownerUserId, planId: r.planId, sourceMessageId: r.sourceMessageId,
  updatedAt: r.updatedAt.toISOString(), supersededBy: r.supersededBy,
  ...PrivateFactValue.parse({ kind: r.kind, value: openJson('private_fact', r.valueEnc) }),
} as PrivateFact);

/** The caller's own current facts for a plan. */
export async function listOwnFacts(db: Db, actor: ActorContext, planId: string): Promise<PrivateFact[]> {
  await assertMember(db, planId, actor.userId);
  const rows = await db.select().from(privateFacts).where(and(
    eq(privateFacts.ownerUserId, actor.userId), eq(privateFacts.planId, planId), isNull(privateFacts.supersededBy),
  ));
  return rows.filter(r => ['availability', 'spending_limit', 'preference', 'requirement'].includes(r.kind)).map(toFact);
}

/** Server-only: all current facts for a plan's members, for deterministic checks. Never return to clients/prompts. */
export async function loadFactsForFeasibility(db: Db, planId: string): Promise<PrivateFact[]> {
  const rows = await db.select().from(privateFacts).where(and(eq(privateFacts.planId, planId), isNull(privateFacts.supersededBy)));
  return rows.filter(r => ['availability', 'spending_limit', 'preference', 'requirement'].includes(r.kind)).map(toFact);
}

/** Combine calendar free/busy snapshots and explicit chat statements into per-member busy data. */
export async function loadMemberAvailability(db: Db, planId: string, userIds: string[], window: Interval): Promise<MemberAvailability[]> {
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId));
  if (!plan || !userIds.length) return userIds.map((userId) => ({ userId, sources: [] }));
  const snaps = await db.select().from(availabilitySnapshots).where(and(
    inArray(availabilitySnapshots.userId, userIds),
    eq(availabilitySnapshots.status, 'ok'),
    lte(availabilitySnapshots.windowStart, new Date(window.endAt)),
    gte(availabilitySnapshots.windowEnd, new Date(window.startAt)),
  ));
  const facts = (await loadFactsForFeasibility(db, planId)).filter((f) => f.kind === 'availability');
  return userIds.map((userId) => {
    const sources: KnownBusy[] = snaps
      .filter((s) => s.userId === userId && (s.planId === null || s.planId === planId) && (!s.validUntil || s.validUntil > new Date()))
      .map((s) => ({ status: 'known', window: { startAt: s.windowStart.toISOString(), endAt: s.windowEnd.toISOString() }, busy: s.busy }));
    for (const f of facts) {
      if (f.ownerUserId === userId && f.kind === 'availability') {
        sources.push(statementToBusy(f.value.window, f.value.available, f.value.unavailable));
      }
    }
    return { userId, sources };
  });
}
