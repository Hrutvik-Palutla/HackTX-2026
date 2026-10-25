import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversations, jobs, messages, messagingIdentities, outbox, planConversations } from '@hacktx/db';
import { createPlan, postPlanChat, readPlanChat, seal, webConversation, type Job } from '@hacktx/core';
import { handleInbound, type Muse } from '@hacktx/agent';
import { configureApi, getChat, postMessage } from '@hacktx/api';
import { createSendOutboxHandler } from '../../integrations/messaging/claw-adapter';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

async function setup() {
  const db = await testDb(); const u = await seedUsers(db, ['Alex', 'Mel', 'Eve']);
  await befriend(db, u.Alex!, u.Mel!); await befriend(db, u.Alex!, u.Eve!);
  const { plan } = await createPlan(db, web(u.Alex!), { request: 'Friday outside', templateId: 'local-outing', city: austin, participantUserIds: [u.Mel!], window: null });
  const { plan: other } = await createPlan(db, web(u.Alex!), { request: 'Another group', templateId: 'local-outing', city: austin, participantUserIds: [u.Eve!], window: null });
  const [chat] = await db.insert(conversations).values({ provider: 'claw_messenger', kind: 'group', sendingLine: 'test-line', externalChatId: 'owned-test-group', activePlanId: plan.id }).returning();
  await db.insert(planConversations).values({ planId: plan.id, conversationId: chat!.id, audience: 'group' });
  return { db, u, plan, other, chat: chat! };
}

describe('website and Messages share only explicitly scoped plan chat', () => {
  it('keeps sessions, CSRF and verified actor attribution on the HTTP boundary', async () => {
    const { db, u, plan, chat } = await setup(); let actor: string | null = null;
    configureApi({ db, appOrigin: 'https://app.test', getUserId: async () => actor });
    const ctx = { params: Promise.resolve({ id: plan.id }) };
    expect((await getChat(new Request('https://app.test/api/chat'), ctx)).status).toBe(401);
    actor = u.Eve!; expect((await getChat(new Request('https://app.test/api/chat'), ctx)).status).toBe(404);
    actor = u.Alex!;
    const data = { text: 'Sid, Friday works.', scope: 'group', destination: 'linked_chat', userId: u.Eve!, conversationId: 'not-accepted-from-client' };
    const request = (origin: string) => new Request('https://app.test/api/chat', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    expect((await postMessage(request('https://other.test'), ctx)).status).toBe(403);
    expect(await db.select().from(outbox)).toHaveLength(0);
    const result = await postMessage(request('https://app.test'), ctx); expect(result.status).toBe(200);
    const id = (await result.json()).data.messageId;
    expect((await db.select().from(messages).where(eq(messages.id, id)))[0]).toMatchObject({ senderUserId: u.Alex!, conversationId: chat.id });
  });
  it('includes the right group and own notes, excluding other plans, private threads and unscoped history', async () => {
    const { db, u, plan, other, chat } = await setup();
    await postPlanChat(db, web(u.Alex!), { planId: plan.id, scope: 'group', destination: 'website', text: 'Website hello', requestId: 'web-1' });
    await postPlanChat(db, web(u.Alex!), { planId: plan.id, scope: 'private', destination: 'website', text: 'My private note', requestId: 'private-1' });
    await postPlanChat(db, web(u.Mel!), { planId: plan.id, scope: 'private', destination: 'website', text: 'Mel private detail', requestId: 'private-2' });
    const webGroup = await webConversation(db, plan.id, 'group', u.Alex!);
    for (const [id, planId] of [['old-web', null], ['other-web', other.id]] as const) {
      await db.insert(messages).values({ conversationId: webGroup.id, planId, providerMessageId: id, senderHandle: 'agent', isPrivate: false, body: 'Unscoped or different-plan website history', occurredAt: new Date() });
    }
    for (const [id, planId, text, isPrivate] of [['good', plan.id, 'Messages hello', false], ['other', other.id, 'Other plan detail', false], ['old', null, 'Old group history', false], ['bad-private', plan.id, 'Never group-visible', true]] as const) {
      await db.insert(messages).values({ conversationId: chat.id, planId, providerMessageId: id, senderUserId: u.Mel!, senderHandle: '+15125550101', isPrivate, body: isPrivate ? null : text, bodyEnc: isPrivate ? seal('message', text) : null, occurredAt: new Date() });
    }
    const result = await readPlanChat(db, web(u.Alex!), plan.id);
    expect(result.linkedGroupChat).toBe(true);
    expect(result.messages.map(m => m.text).sort()).toEqual(['Website hello', 'My private note', 'Messages hello'].sort());
    expect(JSON.stringify(result)).not.toContain('+15125550101');
    expect(result.messages.find(m => m.text === 'Messages hello')?.source).toBe('messages');
    await expect(readPlanChat(db, web(u.Eve!), plan.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires explicit group delivery, forbids private forwarding and rejects outsiders', async () => {
    const { db, u, plan, chat } = await setup();
    const base = { planId: plan.id, text: 'Sid, try Friday', scope: 'group' as const, requestId: 'send-1' };
    await postPlanChat(db, web(u.Alex!), { ...base, destination: 'website' });
    expect(await db.select().from(outbox)).toHaveLength(0);
    await expect(postPlanChat(db, web(u.Alex!), { ...base, scope: 'private', destination: 'linked_chat' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(postPlanChat(db, web(u.Eve!), { ...base, destination: 'linked_chat' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const sent = await postPlanChat(db, web(u.Alex!), { ...base, requestId: 'send-2', destination: 'linked_chat' });
    const [queued] = await db.select().from(outbox);
    expect(queued).toMatchObject({ planId: plan.id, status: 'pending', body: 'Alex (via SideQuest): Sid, try Friday', recipient: { kind: 'group', conversationId: chat.id } });
    expect((await readPlanChat(db, web(u.Alex!), plan.id)).messages.find(m => m.id === sent.messageId)?.deliveryStatus).toBe('pending');
  });

  it('does not send or process a queued website message against a replacement plan', async () => {
    const { db, u, plan, other, chat } = await setup();
    const sent = await postPlanChat(db, web(u.Alex!), { planId: plan.id, text: 'Sid, change this', scope: 'group', destination: 'linked_chat', requestId: 'stale' });
    await db.update(conversations).set({ activePlanId: other.id }).where(eq(conversations.id, chat.id));
    const [delivery] = (await db.select().from(jobs)).filter(j => j.kind === 'send_outbox');
    let calls = 0;
    await createSendOutboxHandler({ send: async () => { calls++; throw Error('Must not send'); } })({ db, job: delivery as unknown as Job });
    expect(calls).toBe(0); expect((await db.select().from(outbox))[0]?.status).toBe('failed');
    const muse = { model: 'test', chat: async () => { throw Error('Must not call a model'); } } as unknown as Muse;
    expect(await handleInbound({ db, muse }, { web: { messageId: sent.messageId } })).toMatchObject({ status: 'stale_plan' });
    expect((await readPlanChat(db, web(u.Alex!), plan.id)).linkedGroupChat).toBe(false);
  });

  it('does not expose replayed provider messages or their new replies as current-plan history', async () => {
    const { db, u, plan, chat } = await setup();
    await db.insert(messagingIdentities).values({ provider: 'claw_messenger', handle: '+15125550100', kind: 'phone', userId: u.Alex!, verifiedAt: new Date() });
    const muse: Muse = { model: 'test', async chat() { return { message: { role: 'assistant', content: 'A reply to historical text.', refusal: null }, usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } }; }, async structured() { throw Error('Not used'); } };
    await handleInbound({ db, muse }, { sendingLine: 'test-line', replayed: true, message: { provider: 'claw_messenger', eventId: 'replay', messageId: 'replay', conversationExternalId: chat.externalChatId, conversationKind: 'group', senderHandle: '+15125550100', senderKind: 'phone', text: 'Historical group text', occurredAt: new Date().toISOString(), replyToMessageId: null } });
    const body = JSON.stringify((await readPlanChat(db, web(u.Alex!), plan.id)).messages);
    expect(body).not.toContain('Historical'); expect(body).not.toContain('historical');
    expect((await db.select().from(messages)).filter(m => m.conversationId === chat.id).every(m => m.planId === null)).toBe(true);
    await handleInbound({ db, muse }, { sendingLine: 'test-line', message: { provider: 'claw_messenger', eventId: 'live', messageId: 'live', conversationExternalId: chat.externalChatId, conversationKind: 'group', senderHandle: '+15125550100', senderKind: 'phone', text: 'Current group text', occurredAt: new Date().toISOString(), replyToMessageId: null } });
    const current = await readPlanChat(db, web(u.Alex!), plan.id);
    expect(current.messages.map(m => m.text)).toEqual(['Current group text', 'A reply to historical text.']);
  });
});
