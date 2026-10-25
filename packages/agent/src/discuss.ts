// process_inbound job. Two entry shapes, one conversation path:
//  - provider: a normalized, already-authenticated Linq/Telegram message (Part 3's webhook) -> identity -> stored row
//  - web: a row already stored by the authenticated POST /plans/:id/messages handler
// Then: bounded Muse tool loop as that sender -> reply in the same conversation.
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { conversations, messages, messagingIdentities, planParticipants, plans, user, type Db } from '@hacktx/db';
import { InboundMessage, type ActorContext } from '@hacktx/contracts';
import { AGENT_HANDLE, AppError, activeTally, listOwnFacts, open, postToConversation, publicPlan, seal } from '@hacktx/core';
import { loadTemplate } from '@hacktx/templates';
import type { ChatMessage, Muse } from './muse';
import { LimitError, RunRecorder } from './recorder';
import { toolsFor, type ToolCtx } from './tools';

export const NO_REPLY = 'NO_REPLY';
const HISTORY = 20;

export type InboundJob = { sendingLine: string; message: InboundMessage } | { web: { messageId: string } };
type Deps = { db: Db; muse: Muse };

export async function handleInbound(deps: Deps, job: InboundJob) {
  const { db } = deps;
  if ('web' in job) {
    const [stored] = await db.select().from(messages).where(eq(messages.id, job.web.messageId));
    if (!stored?.senderUserId) return { status: 'unknown_sender' as const };
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, stored.conversationId));
    return converse(deps, conv!, stored, stored.senderUserId);
  }
  const m = InboundMessage.parse(job.message);

  // 1. Conversation (one row per provider/line/chat).
  await db.insert(conversations).values({
    provider: m.provider, sendingLine: job.sendingLine, externalChatId: m.conversationExternalId, kind: m.conversationKind,
  }).onConflictDoNothing();
  const [conv] = await db.select().from(conversations).where(and(
    eq(conversations.provider, m.provider), eq(conversations.sendingLine, job.sendingLine), eq(conversations.externalChatId, m.conversationExternalId),
  ));
  if (!conv) throw new Error('conversation upsert failed');

  // 2. Verified identity only. A display name or chat membership never identifies an account.
  const [ident] = await db.select().from(messagingIdentities).where(and(
    eq(messagingIdentities.provider, m.provider), eq(messagingIdentities.handle, m.senderHandle),
  ));
  const userId = ident?.verifiedAt ? ident.userId : null;

  // 3. Store the message (private bodies encrypted). Retries reuse the stored row.
  const isPrivate = conv.kind === 'private';
  await db.insert(messages).values({
    conversationId: conv.id, providerMessageId: m.messageId, senderUserId: userId, senderHandle: m.senderHandle,
    isPrivate, body: isPrivate ? null : m.text, bodyEnc: isPrivate ? seal('message', m.text) : null,
    replyToProviderMessageId: m.replyToMessageId, occurredAt: new Date(m.occurredAt),
  }).onConflictDoNothing();
  const [stored] = await db.select().from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.providerMessageId, m.messageId)));
  if (!userId) return { status: 'unknown_sender' as const, conversationId: conv.id }; // Part 3 sends the signup/link prompt
  return converse(deps, conv, stored!, userId);
}

async function converse(
  { db, muse }: Deps,
  conv: typeof conversations.$inferSelect,
  stored: typeof messages.$inferSelect,
  userId: string,
) {
  const kind = conv.kind as 'group' | 'private';
  const actor: ActorContext = {
    userId, source: kind === 'group' ? 'group_message' : 'private_message', conversationId: conv.id, sourceMessageId: stored.id,
  };

  // Which plan? The conversation's active plan; for a DM without one, the sender's most recently updated open plan.
  // ponytail: DM with several open plans picks the latest; add an explicit "which plan?" step if that confuses testers.
  let planId = conv.activePlanId;
  if (!planId && kind === 'private') {
    const [p] = await db.select({ id: plans.id }).from(plans)
      .leftJoin(planParticipants, eq(planParticipants.planId, plans.id))
      .where(and(ne(plans.status, 'closed'), or(eq(plans.organizerUserId, userId), eq(planParticipants.userId, userId))))
      .orderBy(desc(plans.updatedAt)).limit(1);
    planId = p?.id ?? null;
  }
  const [plan] = planId ? await db.select().from(plans).where(eq(plans.id, planId)) : [];
  const template = await loadTemplate(db, plan?.templateId ?? 'local-outing');

  // Context: only what this audience may see. The agent's own earlier messages are part of the transcript.
  const history = await db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(desc(messages.occurredAt)).limit(HISTORY);
  const names = new Map((await db.select({ id: user.id, name: user.name }).from(user)
    .where(inArray(user.id, [...new Set(history.map((h) => h.senderUserId).filter(Boolean) as string[]), userId]))).map((u) => [u.id, u.name]));
  const who = (h: typeof history[number]) => (h.senderUserId ? names.get(h.senderUserId) ?? 'member' : h.senderHandle === AGENT_HANDLE ? 'you (agent)' : 'unlinked');
  const transcript = history.reverse().map((h) => `[${h.id}] ${who(h)}: ${h.body ?? open('message', h.bodyEnc!)}`).join('\n');

  const context: Record<string, unknown> = {
    now: new Date().toISOString(),
    conversation: kind,
    sender: { userId, name: names.get(userId) },
    currentMessageId: stored.id,
    plan: plan ? { ...(await publicPlan(db, actor, plan.id)), tally: await activeTally(db, plan.id) } : null,
  };
  if (kind === 'private' && plan) context.yourPrivateFacts = await listOwnFacts(db, actor, plan.id); // sender's own only

  const rec = await RunRecorder.start(db, { planId: plan?.id ?? null, task: 'discuss', template, model: muse.model, inputRevision: plan?.inputRevision ?? 0 });
  const ctx: ToolCtx = { db, actor, planId: plan?.id ?? null, conversation: { id: conv.id, kind }, messageId: stored.id, providerMessageId: stored.providerMessageId };
  try {
    const reply = await runToolLoop({ muse, rec, ctx, allowedTools: template.allowedTools, messages: [
      { role: 'system', content: `${template.systemInstruction}
You are in a ${kind === 'group' ? 'GROUP chat: everything you write is seen by all members' : 'PRIVATE chat with the sender only'}.
Respond when addressed or when the message affects the plan (availability, votes, preferences, go-ahead, new requests).
Stay quiet during unrelated chatter: answer exactly ${NO_REPLY}.
Use tools to record facts and votes; never claim something was saved, booked, or paid unless a tool result says so.
Times in tool arguments are ISO 8601 with offset; the plan's time zone is ${plan?.timeZone ?? 'the organizer city time zone'}.
Message ids in brackets can be cited as evidence.` },
      { role: 'user', content: `Context:\n${JSON.stringify(context)}\n\nRecent messages:\n${transcript}` },
    ] });
    await rec.finish('ok');
    const text = reply.trim();
    const replied = !!text && text !== NO_REPLY;
    if (replied) {
      await postToConversation(db, conv, text.slice(0, 1500), { effectKey: `reply:${stored.id}`, planId: plan?.id ?? null, privateUserId: userId });
    }
    return { status: 'ok' as const, replied };
  } catch (e) {
    if (e instanceof LimitError) { await rec.finish('limit', e.message); return { status: 'limit' as const }; }
    await rec.finish('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Bounded Muse tool loop. Tool errors go back to the model as data; limits are enforced by the recorder. */
export async function runToolLoop(input: { muse: Muse; rec: RunRecorder; ctx: ToolCtx; allowedTools: string[]; messages: ChatMessage[] }) {
  const { muse, rec, ctx } = input;
  const { specs, byName } = toolsFor(input.allowedTools);
  const msgs = [...input.messages];
  for (;;) {
    rec.charge('turn');
    const { message } = await rec.step('model', 'chat', () => muse.chat({ messages: msgs, tools: specs }),
      (r) => ({ summary: r.message.tool_calls?.length ? `${r.message.tool_calls.length} tool call(s)` : 'reply', usage: r.usage }));
    msgs.push(message);
    const calls = (message.tool_calls ?? []).filter((c) => c.type === 'function');
    if (!calls.length) return message.content ?? '';
    for (const call of calls) {
      rec.charge('tool');
      const t = byName.get(call.function.name);
      let result: unknown;
      try {
        if (!t) throw new AppError('INVALID', `Unknown tool ${call.function.name}`);
        const args = t.args.safeParse(JSON.parse(call.function.arguments || '{}'));
        if (!args.success) throw new AppError('INVALID', `Bad arguments: ${args.error.issues[0]?.message}`);
        result = await rec.step('tool', t.name, () => t.run(ctx, args.data), () => ({ summary: 'ok' }));
      } catch (e) {
        if (e instanceof LimitError) throw e;
        result = { error: e instanceof AppError ? e.code : 'ERROR', message: e instanceof Error ? e.message : String(e) };
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
}
