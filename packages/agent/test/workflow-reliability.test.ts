import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversations, conversationMembers, messages, messagingIdentities, outbox, planningDrafts, planConversations, planParticipants, plans, researchEvidence } from '@hacktx/db';
import { createPlan, open, seal } from '@hacktx/core';
import { fixtureDiscovery, handleInbound, runPlanJob, type Muse } from '../src/index';
import { toolsFor, type ToolCtx } from '../src/tools';
import { austin, befriend, seedUsers, testDb, web } from '../../core/test/helpers';

afterEach(() => vi.unstubAllEnvs());
const args = { request: 'An outing with Mark and Sam', friendNames: ['Mark', 'Sam'], includeChatMembers: false,
  friendContacts: [], kind: 'local-outing', windowStartAt: null, windowEndAt: null };
async function invoke(ctx: ToolCtx, name: string, input: unknown) {
  const tool = toolsFor([name]).byName.get(name)!;
  return tool.run(ctx, tool.args.parse(input)) as Promise<Record<string, any>>;
}
async function setup() {
  vi.stubEnv('PHONE_LOOKUP_HMAC_KEY', 'owned-local-workflow-fixture-key');
  const db = await testDb();
  const u = await seedUsers(db, ['Alex', 'Mark', 'Eve']);
  await befriend(db, u.Alex!, u.Mark!);
  const [group] = await db.insert(conversations).values({ provider: 'claw_messenger', sendingLine: 'owned', externalChatId: 'owned-group', kind: 'group' }).returning();
  const [privateChat] = await db.insert(conversations).values({ provider: 'claw_messenger', sendingLine: 'owned', externalChatId: 'owned-private', kind: 'private' }).returning();
  const [groupMessage] = await db.insert(messages).values({ conversationId: group!.id, providerMessageId: 'request', senderUserId: u.Alex!, senderHandle: '+15125550101', body: args.request, isPrivate: false, occurredAt: new Date() }).returning();
  const [privateMessage] = await db.insert(messages).values({ conversationId: privateChat!.id, providerMessageId: 'contacts', senderUserId: u.Alex!, senderHandle: '+15125550101', bodyEnc: seal('message', 'Sam is +15125550109'), isPrivate: true, occurredAt: new Date() }).returning();
  const groupCtx: ToolCtx = { db, actor: { userId: u.Alex!, source: 'group_message', conversationId: group!.id }, planId: null,
    conversation: { id: group!.id, kind: 'group' }, messageId: groupMessage!.id, providerMessageId: 'request' };
  const privateCtx: ToolCtx = { ...groupCtx, actor: { userId: u.Alex!, source: 'private_message', conversationId: privateChat!.id },
    conversation: { id: privateChat!.id, kind: 'private' }, messageId: privateMessage!.id, providerMessageId: 'contacts' };
  return { db, u, group: group!, privateChat: privateChat!, groupCtx, privateCtx };
}

describe('pending group requests', () => {
  it('collects contacts privately before a plan exists, then resumes the original group exactly once', async () => {
    const t = await setup();
    const pending = await invoke(t.groupCtx, 'start_plan', args);
    expect(pending).toMatchObject({ created: false, needsPhoneFor: ['Sam'], privateQuestionQueued: true });
    expect(await t.db.select().from(plans)).toHaveLength(0);
    const [draft] = await t.db.select().from(planningDrafts);
    expect(draft!.requestEnc).not.toContain(args.request);
    const [question] = await t.db.select().from(outbox);
    expect(question!.recipient).toEqual({ kind: 'private', userId: t.u.Alex });
    expect(open('outbox', question!.bodyEnc!)).toContain('Sam');
    const resume = { ...args, request: 'ignored replacement', friendNames: [], draftId: pending.draftId,
      friendContacts: [{ name: 'Sam', phone: '+15125550109' }] };
    await expect(invoke({ ...t.privateCtx, actor: web(t.u.Eve!) }, 'start_plan', resume)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const results = await Promise.all([invoke(t.privateCtx, 'start_plan', resume), invoke(t.privateCtx, 'start_plan', resume)]);
    const created = results.find(result => !result.alreadyResumed)!;
    expect(results.filter(result => result.alreadyResumed)).toHaveLength(1);
    expect(created).toMatchObject({ created: true, status: 'waiting_connections' });
    expect((await t.db.select().from(plans))[0]!.request).toBe(args.request);
    expect((await t.db.select().from(conversations).where(eq(conversations.id, t.group.id)))[0]!.activePlanId).toBe(created.planId);
    expect((await t.db.select().from(planParticipants)).some(participant => participant.userId === t.u.Mark)).toBe(true);
    expect(await invoke(t.privateCtx, 'start_plan', resume)).toMatchObject({ alreadyResumed: true, planId: created.planId });
    expect(await t.db.select().from(plans)).toHaveLength(1);
  });

  it('allows a private pre-plan question only to the requesting organizer', async () => {
    const t = await setup();
    expect(await invoke(t.groupCtx, 'ask_private_question', { userId: t.u.Alex, question: 'What is Sam’s number?' })).toMatchObject({ sent: true });
    await expect(invoke(t.groupCtx, 'ask_private_question', { userId: t.u.Eve, question: 'Send a number?' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('supplies the real pending draft ID only to its owner in private', async () => {
    const t = await setup();
    const pending = await invoke(t.groupCtx, 'start_plan', args);
    await t.db.insert(messagingIdentities).values({ provider: 'claw_messenger', userId: t.u.Alex!, handle: '+15125550101', kind: 'phone', verifiedAt: new Date() });
    let context: any;
    const muse: Muse = { model: 'fixture', structured: async () => { throw Error('unused'); }, chat: async input => {
      context = JSON.parse((input.messages[1]!.content as string).split('Context:\n')[1]!.split('\n\nRecent messages:')[0]!);
      return { message: { role: 'assistant', content: 'NO_REPLY', refusal: null }, usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } };
    } };
    await handleInbound({ db: t.db, muse }, { sendingLine: 'owned', message: { provider: 'claw_messenger', eventId: 'new', messageId: 'new', conversationExternalId: 'owned-private', conversationKind: 'private', senderHandle: '+15125550101', senderKind: 'phone', text: 'Here are the contacts', occurredAt: new Date().toISOString(), replyToMessageId: null } });
    expect(context.pendingGroupRequests[0].draftId).toBe(pending.draftId);
    expect(context.pendingGroupRequests[0].request).toBe(args.request);
  });
});

describe('audience and failure boundaries', () => {
  it('notifies the group when a planner cannot start because the global budget is exhausted', async () => {
    const t = await setup();
    const { plan } = await createPlan(t.db, web(t.u.Alex!), { request: 'An outing', templateId: 'local-outing', city: austin, window: null, participantUserIds: [] });
    await t.db.insert(planConversations).values({ planId: plan.id, conversationId: t.group.id, audience: 'group' });
    vi.stubEnv('MUSE_BUDGET_USD', '0');
    expect(await runPlanJob({ db: t.db, muse: { model: 'fixture' } as Muse, discovery: fixtureDiscovery }, { planId: plan.id, inputRevision: 0 })).toMatchObject({ status: 'budget_limit' });
    expect((await t.db.select().from(plans))[0]!.status).toBe('clarifying');
    expect((await t.db.select().from(outbox))[0]!.body).toContain('budget');
  });

  it('stops an in-flight planner model call and notifies the group at its deadline', async () => {
    const t = await setup();
    const { plan } = await createPlan(t.db, web(t.u.Alex!), { request: 'An outing', templateId: 'local-outing', city: austin, window: null, participantUserIds: [] });
    await t.db.insert(planConversations).values({ planId: plan.id, conversationId: t.group.id, audience: 'group' });
    vi.stubEnv('MUSE_RUN_DEADLINE_MS', '30');
    let signal: AbortSignal | undefined;
    const muse: Muse = { model: 'fixture', chat: async () => { throw Error('unused'); }, structured: input => {
      signal = input.signal; return new Promise(() => {});
    } };
    expect(await runPlanJob({ db: t.db, muse, discovery: fixtureDiscovery }, { planId: plan.id, inputRevision: 0 })).toMatchObject({ status: 'limit' });
    expect(signal?.aborted).toBe(true);
    expect((await t.db.select().from(outbox))[0]!.body).toContain('narrow');
  });

  it('filters previous plans against the current group roster even without an active plan', async () => {
    const t = await setup();
    await t.db.update(conversations).set({ membershipComplete: true }).where(eq(conversations.id, t.group.id));
    await createPlan(t.db, web(t.u.Alex!), { request: 'UNRELATED_PRIVATE_OUTING', templateId: 'local-outing', city: austin, window: null, participantUserIds: [t.u.Eve!] });
    await createPlan(t.db, web(t.u.Alex!), { request: 'SAME_GROUP_OUTING', templateId: 'local-outing', city: austin, window: null, participantUserIds: [t.u.Mark!] });
    for (const [id, phone] of [[t.u.Alex!, '+15125550101'], [t.u.Mark!, '+15125550102']] as const) {
      const [ident] = await t.db.insert(messagingIdentities).values({ provider: 'claw_messenger', userId: id, handle: phone, kind: 'phone', verifiedAt: new Date() }).returning();
      await t.db.insert(conversationMembers).values({ conversationId: t.group.id, messagingIdentityId: ident!.id, unresolvedHandle: phone });
    }
    let prompt = '';
    const muse: Muse = { model: 'fixture', structured: async () => { throw Error('unused'); }, chat: async input => {
      prompt = JSON.stringify(input.messages);
      return { message: { role: 'assistant', content: 'NO_REPLY', refusal: null }, usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } };
    } };
    await handleInbound({ db: t.db, muse }, { sendingLine: 'owned', message: { provider: 'claw_messenger', eventId: 'hello', messageId: 'hello', conversationExternalId: 'owned-group', conversationKind: 'group', senderHandle: '+15125550101', senderKind: 'phone', text: 'What have we done before?', occurredAt: new Date().toISOString(), replyToMessageId: null } });
    expect(prompt).toContain('SAME_GROUP_OUTING');
    expect(prompt).not.toContain('UNRELATED_PRIVATE_OUTING');
    await t.db.update(conversations).set({ membershipComplete: false }).where(eq(conversations.id, t.group.id));
    await handleInbound({ db: t.db, muse }, { sendingLine: 'owned', message: { provider: 'claw_messenger', eventId: 'partial', messageId: 'partial', conversationExternalId: 'owned-group', conversationKind: 'group', senderHandle: '+15125550101', senderKind: 'phone', text: 'What have we done before?', occurredAt: new Date().toISOString(), replyToMessageId: null } });
    expect(prompt).not.toContain('SAME_GROUP_OUTING');
    expect(prompt).not.toContain('UNRELATED_PRIVATE_OUTING');
  });

  it('sends a visible response when the global budget is exhausted before run creation', async () => {
    vi.stubEnv('MUSE_BUDGET_USD', '0');
    const t = await setup();
    await t.db.insert(messagingIdentities).values({ provider: 'claw_messenger', userId: t.u.Alex!, handle: '+15125550101', kind: 'phone', verifiedAt: new Date() });
    const chat = vi.fn();
    const input = { sendingLine: 'owned', message: { provider: 'claw_messenger' as const, eventId: 'budget', messageId: 'budget', conversationExternalId: 'owned-group', conversationKind: 'group' as const, senderHandle: '+15125550101', senderKind: 'phone' as const, text: 'Help us plan', occurredAt: new Date().toISOString(), replyToMessageId: null } };
    expect(await handleInbound({ db: t.db, muse: { model: 'fixture', chat } as unknown as Muse }, input)).toMatchObject({ status: 'budget_limit', replied: true });
    await handleInbound({ db: t.db, muse: { model: 'fixture', chat } as unknown as Muse }, input);
    expect(chat).not.toHaveBeenCalled();
    expect((await t.db.select().from(outbox)).filter(row => row.effectKey.startsWith('agent-budget:'))).toHaveLength(1);
  });

  it('returns compact research to the parent while retaining complete public evidence separately', async () => {
    const t = await setup();
    let step = 0;
    const source = { sourceId: 'owned-large-source', url: 'https://www.google.com/search?q=owned', fetchedAt: new Date().toISOString(), engine: 'google', query: 'owned', text: 'Verified result', results: { huge: 'RAW_EVIDENCE_SENTINEL'.repeat(20_000) } };
    const muse: Muse = { model: 'fixture', structured: async () => { throw Error('unused'); }, chat: async () => ({
      message: step++ === 0 ? { role: 'assistant', content: null, refusal: null, tool_calls: [{ id: 'search', type: 'function', function: { name: 'search_public_web', arguments: '{"query":"owned"}' } }] } : { role: 'assistant', content: 'Verified result [owned-large-source]', refusal: null },
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
    }) };
    const result = await invoke({ ...t.groupCtx, muse, research: { search: async () => source, read: async () => { throw Error('unused'); } } }, 'research_public', { question: 'Find a public listing' });
    expect(JSON.stringify(result).length).toBeLessThan(2000);
    expect(JSON.stringify(result)).not.toContain('RAW_EVIDENCE_SENTINEL');
    expect((await t.db.select().from(researchEvidence))[0]!.payload).toEqual(source);
  });
});
