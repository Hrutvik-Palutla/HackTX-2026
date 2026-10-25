import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { conversations, messages, outbox, planConversations, user, type Db } from '@hacktx/db';
import type { ActorContext } from '@hacktx/contracts';
import { assertMember } from './plans';
import { AGENT_HANDLE, webConversation } from './conversations';
import { AppError } from './errors';
import { open, seal } from './crypto';
import { enqueue, enqueueMessage } from './jobs';

async function linkedChats(db: Db, planId: string) {
  return db.select({ id: conversations.id, activePlanId: conversations.activePlanId, provider: conversations.provider, kind: conversations.kind })
    .from(planConversations).innerJoin(conversations, eq(conversations.id, planConversations.conversationId))
    .where(and(eq(planConversations.planId, planId), eq(planConversations.audience, 'group'), eq(conversations.kind, 'group'), eq(conversations.provider, 'claw_messenger')));
}

/** Conversation links alone cannot authorize history: every message must match the plan. */
export async function readPlanChat(db: Db, actor: ActorContext, planId: string) {
  await assertMember(db, planId, actor.userId);
  const group = await webConversation(db, planId, 'group', actor.userId);
  const own = await webConversation(db, planId, 'private', actor.userId);
  const linked = await linkedChats(db, planId);
  const external = linked.map(c => c.id);
  const rows = await db.select({ message: messages, provider: conversations.provider }).from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.planId, planId), or(inArray(messages.conversationId, [group.id, own.id]), external.length ? and(inArray(messages.conversationId, external), eq(messages.isPrivate, false)) : undefined)))
    .orderBy(desc(messages.occurredAt), desc(messages.id)).limit(100);
  rows.reverse();
  const ids = [...new Set(rows.flatMap(r => r.message.senderUserId ? [r.message.senderUserId] : []))];
  const names = new Map(ids.length ? (await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map(u => [u.id, u.name]) : []);
  const deliveryRows = rows.length ? await db.select({ key: outbox.effectKey, status: outbox.status }).from(outbox).where(and(eq(outbox.planId, planId), inArray(outbox.effectKey, rows.map(r => `web-group:${r.message.id}`)))) : [];
  const delivery = new Map(deliveryRows.map(r => [r.key, r.status]));
  return {
    linkedGroupChat: linked.filter(c => c.activePlanId === planId).length === 1,
    messages: rows.map(({ message: m, provider }) => ({ id: m.id, scope: m.isPrivate ? 'private' : 'group', from: m.senderHandle === AGENT_HANDLE ? 'agent' : m.senderUserId ? { id: m.senderUserId, name: names.get(m.senderUserId) ?? 'Member' } : 'unknown', text: m.body ?? open('message', m.bodyEnc!), at: m.occurredAt.toISOString(), source: provider === 'web' || m.providerMessageId.startsWith('web:') ? 'website' : 'messages', deliveryStatus: delivery.get(`web-group:${m.id}`) ?? null })),
  };
}

export async function postPlanChat(db: Db, actor: ActorContext, input: { planId: string; text: string; scope: 'group' | 'private'; destination: 'website' | 'linked_chat'; requestId: string }) {
  return db.transaction(async tx => {
    const plan = await assertMember(tx, input.planId, actor.userId);
    if (plan.status === 'closed') throw new AppError('INVALID', 'This plan is closed.');
    let conv;
    if (input.destination === 'linked_chat') {
      if (input.scope !== 'group') throw new AppError('FORBIDDEN', 'Private notes cannot be sent to a group chat.');
      const linked = (await linkedChats(tx, input.planId)).filter(c => c.activePlanId === input.planId);
      if (linked.length !== 1) throw new AppError('INVALID', 'Send from the original chat until one group is linked to this plan.');
      const [locked] = await tx.select().from(conversations).where(eq(conversations.id, linked[0]!.id)).for('update');
      if (locked?.activePlanId !== input.planId) throw new AppError('STALE_PLAN', 'The linked chat has moved to another plan.');
      conv = locked;
    } else conv = await webConversation(tx, input.planId, input.scope, actor.userId);
    const isPrivate = input.scope === 'private';
    const [row] = await tx.insert(messages).values({ planId: input.planId, conversationId: conv.id, providerMessageId: `web:${input.requestId}`, senderUserId: actor.userId, senderHandle: `web:${actor.userId}`, isPrivate, body: isPrivate ? null : input.text, bodyEnc: isPrivate ? seal('message', input.text) : null, occurredAt: new Date() }).returning({ id: messages.id });
    if (input.destination === 'linked_chat') {
      const [sender] = await tx.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
      await enqueueMessage(tx, { recipient: { kind: 'group', conversationId: conv.id }, text: `${sender?.name ?? 'A friend'} (via SideQuest): ${input.text}`, effectKey: `web-group:${row!.id}`, planId: input.planId, expiresAt: new Date(Date.now() + 90_000) });
    }
    await enqueue(tx, { kind: 'process_inbound', planId: input.planId, conversationId: conv.id, dedupeKey: `web:${row!.id}`, payload: { web: { messageId: row!.id } } });
    return { messageId: row!.id, destination: input.destination };
  });
}
