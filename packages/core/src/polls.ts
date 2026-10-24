// Native poll <-> plan version mapping. Part 3's adapter publishes polls and normalizes poll events;
// these functions decide what a poll vote means. Option labels are published in A, B, C order.
import { and, eq } from 'drizzle-orm';
import { conversations, messagingIdentities, planOptions, planVersions, polls, type Db } from '@hacktx/db';
import { recordVote } from './votes';
import { AppError } from './errors';

export async function registerPoll(db: Db, p: { versionId: string; conversationId: string; providerMessageId: string }) {
  await db.insert(polls).values(p).onConflictDoNothing();
}

/**
 * Apply one voter's current poll selection (authoritative tally from the provider, not a delta).
 * Unknown/unverified voters and superseded polls never change votes.
 */
export async function applyPollVote(db: Db, e: {
  provider: string; sendingLine: string; conversationExternalId: string; pollMessageId: string;
  voterHandle: string; selectedLabels: string[]; eventId: string;
}) {
  const [conv] = await db.select().from(conversations).where(and(
    eq(conversations.provider, e.provider), eq(conversations.sendingLine, e.sendingLine), eq(conversations.externalChatId, e.conversationExternalId),
  ));
  const [poll] = conv ? await db.select().from(polls).where(and(eq(polls.conversationId, conv.id), eq(polls.providerMessageId, e.pollMessageId))) : [];
  if (!conv || !poll) return { status: 'unknown_poll' as const };
  if (poll.superseded) return { status: 'stale_poll' as const };
  const [ident] = await db.select().from(messagingIdentities).where(and(eq(messagingIdentities.provider, e.provider), eq(messagingIdentities.handle, e.voterHandle)));
  if (!ident?.verifiedAt) return { status: 'unknown_voter' as const };

  const opts = await db.select().from(planOptions).where(eq(planOptions.versionId, poll.versionId));
  const ids = e.selectedLabels.map((l) => opts.find((o) => o.label === l)?.id).filter((x): x is string => !!x);
  const [version] = await db.select({ planId: planVersions.planId }).from(planVersions).where(eq(planVersions.id, poll.versionId));
  try {
    await recordVote(db, { userId: ident.userId, source: 'group_message', conversationId: conv.id }, {
      planId: version!.planId, versionId: poll.versionId, acceptableOptionIds: ids, favoriteOptionId: null,
      noneAcceptable: false, source: 'native_poll', sourceEventId: e.eventId,
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'STALE_PLAN') return { status: 'stale_poll' as const };
    throw err;
  }
  return { status: 'recorded' as const, userId: ident.userId };
}
