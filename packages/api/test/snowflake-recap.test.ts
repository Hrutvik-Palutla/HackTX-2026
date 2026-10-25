import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentRuns, messages, plans, privateFacts, runSteps } from '@hacktx/db';
import { createPlan, postPlanChat } from '@hacktx/core';
import { cortexRecap, recapPlanChat, snowflakeConfig } from '@hacktx/agent';
import { configureApi, postChatRecap } from '@hacktx/api';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

const config = { origin: 'https://example.snowflakecomputing.com', token: 'test-only', model: 'llama3.1-8b' };
const response = (messageId = 'm1', quote = 'after 7 pm') => Response.json({ id: 'test-request', choices: [{ message: { content: JSON.stringify({ items: [{ kind: 'concern', text: 'A later start was requested.', evidence: [{ messageId, quote }] }] }) } }], usage: { prompt_tokens: 80, completion_tokens: 35 } });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup() {
  vi.stubEnv('SNOWFLAKE_ACCOUNT_URL', config.origin); vi.stubEnv('SNOWFLAKE_PAT', config.token);
  const db = await testDb(); const users = await seedUsers(db, ['Alex', 'Mel', 'Eve']);
  await befriend(db, users.Alex!, users.Mel!);
  const { plan } = await createPlan(db, web(users.Alex!), { request: 'Friday evening', templateId: 'local-outing', city: austin, participantUserIds: [users.Mel!], window: null });
  const send = (scope: 'group' | 'private', text: string, requestId: string) => postPlanChat(db, web(users.Alex!), { planId: plan.id, scope, text, destination: 'website', requestId });
  const group = await send('group', 'Could we start after 7 pm?', 'group'); const privateMessage = await send('private', 'Keep my budget private', 'private');
  return { db, users, plan, group, privateMessage };
}

describe('Snowflake evidence-backed conversation recap', () => {
  it('uses the real Cortex API shape, aliases IDs, validates quotes, and returns actual usage', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response());
    const result = await cortexRecap([{ id: 'local-message-id', text: 'Could we start after 7 pm?' }], config, request);
    expect(request.mock.calls[0]![0]).toBe(`${config.origin}/api/v2/cortex/v1/chat/completions`);
    const options = request.mock.calls[0]![1]!;
    expect(options.redirect).toBe('error'); expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(String(options.body)).not.toContain('local-message-id'); expect(String(options.body)).not.toContain(config.token);
    expect(JSON.parse(String(options.body)).response_format.type).toBe('json_schema');
    expect(result).toMatchObject({ inputTokens: 80, outputTokens: 35, items: [{ evidence: [{ messageId: 'local-message-id', quote: 'after 7 pm' }] }] });
    for (const badResponse of [response('not-a-message'), response('m1', 'everyone approved'), Response.json({ choices: [] })]) {
      await expect(cortexRecap([{ id: 'one', text: 'after 7 pm' }], config, vi.fn<typeof fetch>().mockResolvedValue(badResponse))).rejects.toMatchObject({ code: 'PROVIDER' });
    }
  });

  it('rejects outsiders and private/unscoped evidence before any provider call, stores only redacted run metadata', async () => {
    const { db, users, plan, group, privateMessage } = await setup(); const request = vi.fn<typeof fetch>().mockImplementation(async () => response());
    await expect(recapPlanChat(db, web(users.Eve!), plan.id, [group.messageId], request)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(recapPlanChat(db, web(users.Alex!), plan.id, [privateMessage.messageId], request)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(recapPlanChat(db, web(users.Alex!), plan.id, [group.messageId, group.messageId], request)).rejects.toMatchObject({ code: 'INVALID' });
    expect(request).not.toHaveBeenCalled();
    const result = await recapPlanChat(db, web(users.Alex!), plan.id, [group.messageId], request);
    expect(result.provider).toBe('snowflake'); expect(result.costKnown).toBe(false);
    expect(JSON.stringify(request.mock.calls)).not.toContain('Keep my budget');
    expect(JSON.stringify(await db.select().from(runSteps))).not.toContain('after 7 pm');
    expect((await db.select().from(agentRuns))[0]).toMatchObject({ task: 'snowflake-recap', status: 'ok', inputTokens: 80 });
    expect(await db.select().from(privateFacts).where(eq(privateFacts.kind, 'snowflake_recap_usage'))).toHaveLength(1);
    await db.update(messages).set({ planId: null }).where(eq(messages.id, group.messageId));
    await expect(recapPlanChat(db, web(users.Alex!), plan.id, [group.messageId], request)).rejects.toMatchObject({ code: 'INVALID' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bounds lifetime requests and rejects a plan changed during inference', async () => {
    const { db, users, plan, group } = await setup();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => { await db.update(plans).set({ inputRevision: 1 }).where(eq(plans.id, plan.id)); return response(); });
    await expect(recapPlanChat(db, web(users.Alex!), plan.id, [group.messageId], request)).rejects.toMatchObject({ code: 'STALE_PLAN' });
    expect((await db.select().from(agentRuns))[0]?.status).toBe('stale');
    for (let i = 0; i < 7; i++) await db.insert(privateFacts).values({ ownerUserId: users.Alex!, kind: 'snowflake_recap_usage', valueEnc: 'test-unused' });
    await expect(recapPlanChat(db, web(users.Alex!), plan.id, [group.messageId], request)).rejects.toMatchObject({ code: 'QUOTA_LIMIT' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('requires authenticated same-origin explicit consent at the route', async () => {
    const { db, users, plan, group } = await setup(); let actor: string | null = null;
    configureApi({ db, getUserId: async () => actor, appOrigin: 'https://app.test' });
    const ctx = { params: Promise.resolve({ id: plan.id }) };
    const req = (consent: boolean, origin = 'https://app.test') => new Request('https://app.test/api/recap', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ consent, messageIds: [group.messageId] }) });
    expect((await postChatRecap(req(true), ctx)).status).toBe(401);
    actor = users.Alex!;
    expect((await postChatRecap(req(true, 'https://other.test'), ctx)).status).toBe(403);
    expect((await postChatRecap(req(false), ctx)).status).toBe(400);
    const request = vi.fn<typeof fetch>().mockImplementation(async () => response()); vi.stubGlobal('fetch', request);
    expect((await postChatRecap(req(true), ctx)).status).toBe(200); expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly without credentials, on provider failures, and for untrusted account origins', async () => {
    vi.stubEnv('SNOWFLAKE_ACCOUNT_URL', 'https://example.snowflakecomputing.com.attacker.invalid'); vi.stubEnv('SNOWFLAKE_PAT', 'not-a-real-token');
    expect(() => snowflakeConfig()).toThrow('Snowflake HTTPS');
    vi.stubEnv('SNOWFLAKE_PAT', ''); expect(() => snowflakeConfig()).toThrow('configured');
    await expect(cortexRecap([{ id: 'one', text: 'after 7 pm' }], config, vi.fn<typeof fetch>().mockResolvedValue(new Response('Secret diagnostic text', { status: 403 })))).rejects.toMatchObject({ message: 'Snowflake recap unavailable (HTTP 403).' });
  });
});
