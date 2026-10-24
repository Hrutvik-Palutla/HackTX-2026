import { and, eq } from 'drizzle-orm';
import { plans, planOptions, planVersions, votes, voteStates, type Db } from '@hacktx/db';
import { Vote, type ActorContext } from '@hacktx/contracts';
import { assertMember } from './plans';
import { invalid, stale } from './errors';

/**
 * Record the actor's own vote on the active version. Votes on a superseded version (old poll) are rejected
 * with STALE_PLAN so they can never select the new version's options.
 * A native-poll update replaces acceptable choices only; it keeps a favorite that is still acceptable.
 */
export async function recordVote(db: Db, actor: ActorContext, input: Omit<Vote, 'userId'> & { planId: string }) {
  return db.transaction(async (tx) => {
    const plan = await assertMember(tx, input.planId, actor.userId);
    const [version] = await tx.select().from(planVersions).where(eq(planVersions.id, input.versionId));
    if (!version || version.planId !== plan.id || plan.activeVersionId !== version.id || version.supersededAt || plan.status !== 'voting') {
      throw stale('That poll is for an older version of the plan');
    }
    const optionIds = new Set((await tx.select({ id: planOptions.id }).from(planOptions).where(eq(planOptions.versionId, version.id))).map((o) => o.id));
    const acceptable = [...new Set(input.acceptableOptionIds)];
    if (acceptable.some((id) => !optionIds.has(id))) throw invalid('Unknown option for this version');

    const key = and(eq(voteStates.versionId, version.id), eq(voteStates.userId, actor.userId));
    const [prev] = await tx.select().from(voteStates).where(key);
    let favorite = input.favoriteOptionId;
    if (input.source === 'native_poll' && favorite === null && prev?.favoriteOptionId && acceptable.includes(prev.favoriteOptionId)) {
      favorite = prev.favoriteOptionId;
    }
    const vote = Vote.parse({ ...input, userId: actor.userId, acceptableOptionIds: acceptable, favoriteOptionId: favorite });

    await tx.delete(votes).where(and(eq(votes.versionId, version.id), eq(votes.userId, actor.userId)));
    if (vote.acceptableOptionIds.length) {
      await tx.insert(votes).values(vote.acceptableOptionIds.map((optionId) => ({
        versionId: version.id, userId: actor.userId, optionId, source: vote.source, sourceEventId: vote.sourceEventId,
      })));
    }
    const state = { favoriteOptionId: vote.favoriteOptionId, noneAcceptable: vote.noneAcceptable, sourceEventId: vote.sourceEventId, updatedAt: new Date() };
    await tx.insert(voteStates).values({ versionId: version.id, userId: actor.userId, ...state })
      .onConflictDoUpdate({ target: [voteStates.versionId, voteStates.userId], set: state });
    return vote;
  });
}

export type Tally = {
  versionId: string;
  options: { optionId: string; label: string; acceptable: number; favorite: number }[];
  noneAcceptable: number;
  voters: number;
  leader: string | null; // optionId; null when no votes or a tie
  tiedOptionIds: string[];
};

/** Rank by acceptable count, then favorites. A tie is reported, never resolved silently. */
export async function tally(db: Db, versionId: string): Promise<Tally> {
  const opts = await db.select({ id: planOptions.id, label: planOptions.label }).from(planOptions).where(eq(planOptions.versionId, versionId));
  const vs = await db.select().from(votes).where(eq(votes.versionId, versionId));
  const states = await db.select().from(voteStates).where(eq(voteStates.versionId, versionId));
  const options = opts
    .map((o) => ({
      optionId: o.id,
      label: o.label,
      acceptable: vs.filter((v) => v.optionId === o.id).length,
      favorite: states.filter((s) => s.favoriteOptionId === o.id).length,
    }))
    .sort((a, b) => b.acceptable - a.acceptable || b.favorite - a.favorite || a.label.localeCompare(b.label));
  const top = options[0];
  const tied = top && top.acceptable > 0
    ? options.filter((o) => o.acceptable === top.acceptable && o.favorite === top.favorite).map((o) => o.optionId)
    : [];
  return {
    versionId,
    options,
    noneAcceptable: states.filter((s) => s.noneAcceptable).length,
    voters: states.length,
    leader: tied.length === 1 ? tied[0]! : null,
    tiedOptionIds: tied.length > 1 ? tied : [],
  };
}

/** Convenience for the active version of a plan (already membership-checked by caller). */
export async function activeTally(db: Db, planId: string) {
  const [plan] = await db.select({ v: plans.activeVersionId }).from(plans).where(eq(plans.id, planId));
  return plan?.v ? tally(db, plan.v) : null;
}
