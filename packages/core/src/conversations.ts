// Agent -> conversation. The agent's own message is stored in the transcript (providers like Linq don't echo
// bot messages back), then delivered through the outbox. Web conversations have no outbox: the row is the delivery.
import { and, eq } from 'drizzle-orm';
import { conversations, messages, planConversations, type Db } from '@hacktx/db';
import { enqueueMessage } from './jobs';
import { seal } from './crypto';

export const AGENT_HANDLE = 'agent';
export const WEB = 'web';

type Conv = { id: string; kind: string; provider: string };

export async function postToConversation(
  db: Db,
  conv: Conv,
  text: string,
  o: { effectKey: string; planId?: string | null; versionId?: string | null; privateUserId?: string },
) {
  const isPrivate = conv.kind === 'private';
  await db.insert(messages).values({
    conversationId: conv.id, providerMessageId: `agent:${o.effectKey}`, senderUserId: null, senderHandle: AGENT_HANDLE,
    isPrivate, body: isPrivate ? null : text, bodyEnc: isPrivate ? seal('message', text) : null, occurredAt: new Date(),
  }).onConflictDoNothing();
  if (conv.provider === WEB) return;
  if (isPrivate && !o.privateUserId) throw new Error('private conversation post needs privateUserId');
  const recipient = isPrivate
    ? { kind: 'private' as const, userId: o.privateUserId!, conversationId: conv.id }
    : { kind: 'group' as const, conversationId: conv.id };
  await enqueueMessage(db, { recipient, text, effectKey: o.effectKey, planId: o.planId ?? null, versionId: o.versionId ?? null });
}

/** The plan's shared web conversation (fallback/supporting UI); created on first use and linked as a group. */
export async function webConversation(db: Db, planId: string, scope: 'group' | 'private', userId: string) {
  const externalChatId = scope === 'group' ? `plan:${planId}` : `plan:${planId}:user:${userId}`;
  await db.insert(conversations).values({ provider: WEB, sendingLine: WEB, externalChatId, kind: scope, activePlanId: planId }).onConflictDoNothing();
  const [conv] = await db.select().from(conversations).where(and(
    eq(conversations.provider, WEB), eq(conversations.sendingLine, WEB), eq(conversations.externalChatId, externalChatId),
  ));
  if (scope === 'group') await db.insert(planConversations).values({ planId, conversationId: conv!.id, audience: 'group' }).onConflictDoNothing();
  return conv!;
}
