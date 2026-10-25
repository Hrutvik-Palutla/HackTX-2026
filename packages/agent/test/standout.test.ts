import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { plans, privateFacts, agentRuns, user, planParticipants } from '@hacktx/db';
import { createPlan, publishVersion, loadFactsForFeasibility, sealJson } from '@hacktx/core';
import { configureApi, getQuest, getQuestArt } from '../../api/src/index';
import { createDrop, editDrop, listDrops, findCommonGround, getGroundDraft, attachGround, planGround, generateQuest, readQuest, completeQuestChallenge, loadPublicDemo, type Muse, type ChatMessage } from '@hacktx/agent';
import { loadTemplate, saveTemplate } from '@hacktx/templates';
import { testDb, seedUsers, befriend, austin, web } from '../../core/test/helpers';

function model(values: unknown[]): Muse & { seen: string[] } {
  const seen: string[] = [];
  return { model: 'test-muse', seen, async chat() { throw Error('Not used'); }, async structured<T>({ messages, schema }: { messages: ChatMessage[]; schema: z.ZodType<T> }) { seen.push(JSON.stringify(messages)); return { value: schema.parse(values.shift()), usage: { inputTokens: 12, outputTokens: 8, estimatedCostUsd: 0.001 } }; } };
}
async function setup() {
  const db = await testDb(); const u = await seedUsers(db, ['Alex', 'Mel', 'Eve']); await befriend(db, u.Alex!, u.Mel!);
  return { db, a: u.Alex!, b: u.Mel!, outsider: u.Eve! };
}
async function drop(db: Awaited<ReturnType<typeof testDb>>, owner: string, text: string, shared: boolean) {
  const result = await createDrop(db, model([{ interests: [{ label: text, evidence: text }], wishes: [] }]), owner, text, null);
  await editDrop(db, owner, result.id, result.chips.map(c => ({ id: c.id, label: c.label, confirmed: true, shared })));
  return result;
}

describe('Standout privacy, evidence and state', () => {
  it('never exposes real accounts through the public synthetic demo', async () => {
    const db = await testDb();
    for (const id of ['sidequest_demo_alex', 'sidequest_demo_mel']) await db.insert(user).values({ id, name: 'Synthetic demo', email: `${id}@demo.sidequest.invalid`, emailVerified: false });
    const [plan] = await db.insert(plans).values({ organizerUserId: 'sidequest_demo_alex', request: 'Explicit synthetic example', templateId: 'local-outing', timeZone: austin.timeZone, city: austin, mode: 'test', status: 'selected' }).returning();
    for (const userId of ['sidequest_demo_alex', 'sidequest_demo_mel']) await db.insert(planParticipants).values({ planId: plan!.id, userId });
    expect((await loadPublicDemo(db))?.synthetic).toBe(true);
    await db.update(user).set({ phoneNumber: '+15125550100' }).where(eq(user.id, 'sidequest_demo_mel'));
    expect(await loadPublicDemo(db)).toBeNull();
    await db.update(user).set({ phoneNumber: null, email: 'real@example.com' }).where(eq(user.id, 'sidequest_demo_mel'));
    expect(await loadPublicDemo(db)).toBeNull();
  });
  it('keeps extraction private, encrypts the note, and blocks non-owner edits', async () => {
    const { db, a, b } = await setup();
    const result = await createDrop(db, model([{ interests: [{ label: 'Stargazing', evidence: 'I love stargazing' }], wishes: [] }]), a, 'I love stargazing', null);
    expect(result.chips[0]).toMatchObject({ shared: false, confirmed: false });
    expect(JSON.stringify(await db.select().from(privateFacts))).not.toContain('stargazing');
    expect(await listDrops(db, b)).toEqual([]);
    await expect(editDrop(db, b, result.id, [])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createDrop(db, model([{ interests: [{ label: 'Secret', evidence: 'made-up quote' }], wishes: [] }]), a, 'I enjoy music', null)).rejects.toThrow();
    expect((await db.select().from(agentRuns)).some(r => r.status === 'error')).toBe(true);
  });

  it('uses only confirmed shared chips, checks friend access and invalidates revoked evidence', async () => {
    const { db, a, b, outsider } = await setup();
    const da = await drop(db, a, 'Night photography', true); const dbb = await drop(db, b, 'Stargazing', true);
    await drop(db, b, 'PRIVATE medical appointment', false);
    const muse = model([{ theme: 'Night-sky photo walk', searchQuery: 'Austin stargazing photography walk', chipIds: [da.chips[0]!.id, dbb.chips[0]!.id] }]);
    const ground = await findCommonGround(db, muse, web(a), [b]);
    expect(ground.why.map(c => c.name)).toEqual(['Alex', 'Mel']);
    expect(muse.seen.join()).not.toContain('PRIVATE medical');
    await expect(findCommonGround(db, muse, web(a), [outsider])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(findCommonGround(db, model([{ theme: 'Bad', searchQuery: 'Bad', chipIds: ['invented', da.chips[0]!.id] }]), web(a), [b])).rejects.toThrow();
    const { plan } = await createPlan(db, web(a), { request: ground.theme, templateId: 'local-outing', city: austin, participantUserIds: [b], window: null });
    await attachGround(db, web(a), plan.id, ground);
    expect((await planGround(db, plan.id))?.searchQuery).toBe(ground.searchQuery);
    expect(await loadFactsForFeasibility(db, plan.id)).toEqual([]);
    await editDrop(db, b, dbb.id, dbb.chips.map(c => ({ ...c, shared: false })));
    expect(await planGround(db, plan.id)).toBeNull();
    await expect(getGroundDraft(db, web(a), ground.id, [b])).rejects.toMatchObject({ code: 'STALE_PLAN' });
  });

  it('creates one version-bound cooperative quest and preserves completion ownership', async () => {
    const { db, a, b, outsider } = await setup();
    const { plan } = await createPlan(db, web(a), { request: 'Walk', templateId: 'local-outing', city: austin, participantUserIds: [b], window: null });
    const published = await publishVersion(db, { planId: plan.id, inputRevision: 0, runId: null, options: [{ label: 'A', title: 'Park walk', candidateIds: ['test-park'], startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-01T02:00:00.000Z', timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown', fit: 'fits_known_constraints', uncertainties: [], publicExplanation: 'A walk', sourceIds: [] }] });
    await db.update(plans).set({ selectedOptionId: published.options[0]!.id, status: 'selected' }).where(eq(plans.id, plan.id));
    const muse = model([{ title: 'Night explorers', challenges: Array.from({ length: 5 }, (_, i) => ({ kind: i < 3 ? 'photo' : 'riddle', title: `Challenge ${i}`, challenge: 'Find a pattern together', hint: 'Look around you' })) }]);
    const quest = await generateQuest(db, muse, web(a), plan.id);
    expect((await generateQuest(db, muse, web(b), plan.id)).id).toBe(quest.id);
    expect(muse.seen).toHaveLength(1);
    await expect(readQuest(db, web(outsider), plan.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { id: questId, ...payload } = quest;
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await db.update(privateFacts).set({ valueEnc: sealJson('private_fact', { ...payload, art: `data:image/png;base64,${png.toString('base64')}` }) }).where(eq(privateFacts.id, questId));
    configureApi({ db, getUserId: async req => req.headers.get('x-test-user') });
    const url = `https://sidequest.test/api/plans/${plan.id}/quest/art?version=${quest.versionId}&option=${quest.optionId}`;
    const context = { params: Promise.resolve({ id: plan.id }) };
    expect((await getQuestArt(new Request(url), context)).status).toBe(401);
    expect((await getQuestArt(new Request(url, { headers: { 'x-test-user': outsider } }), context)).status).toBe(404);
    expect((await getQuestArt(new Request(url.replace(quest.versionId, 'old-version'), { headers: { 'x-test-user': a } }), context)).status).toBe(404);
    const image = await getQuestArt(new Request(url, { headers: { 'x-test-user': a } }), context);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    const json = await (await getQuest(new Request(url, { headers: { 'x-test-user': a } }), context)).json();
    expect(json.data.art).toContain(`/api/plans/${plan.id}/quest/art?version=`);
    expect(JSON.stringify(json)).not.toContain('data:image');
    await completeQuestChallenge(db, web(a), plan.id, quest.challenges[0]!.id, true);
    await completeQuestChallenge(db, web(b), plan.id, quest.challenges[1]!.id, true);
    expect((await readQuest(db, web(a), plan.id))?.challenges.filter(c => c.completedBy)).toHaveLength(2);
    await expect(completeQuestChallenge(db, web(b), plan.id, quest.challenges[0]!.id, false)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.update(plans).set({ selectedOptionId: null, status: 'planning' }).where(eq(plans.id, plan.id));
    expect(await readQuest(db, web(a), plan.id)).toBeNull();
    await expect(completeQuestChallenge(db, web(a), plan.id, quest.challenges[2]!.id, true)).rejects.toMatchObject({ code: 'STALE_PLAN' });
  });

  it('loads saved recipes, applies their instructions and rejects stale or unsupported edits', async () => {
    const { db, a } = await setup(); const recipe = await loadTemplate(db, 'drop-extraction');
    const patch = { systemInstruction: 'Find grounded outdoors interests. Keep all suggestions private.', allowedTools: recipe.allowedTools, limits: recipe.limits };
    const saved = await saveTemplate(db, recipe.id, recipe.version, patch);
    expect(saved.version).toBe(2);
    await expect(saveTemplate(db, recipe.id, 1, patch)).rejects.toThrow('STALE_TEMPLATE');
    await expect(saveTemplate(db, recipe.id, 2, { ...patch, allowedTools: ['send_money'] })).rejects.toThrow('INVALID_TEMPLATE');
    const muse = model([{ interests: [{ label: 'Hiking', evidence: 'Hiking' }], wishes: [] }]);
    await createDrop(db, muse, a, 'Hiking', null);
    expect(muse.seen[0]).toContain(patch.systemInstruction);
    expect((await db.select().from(agentRuns))[0]).toMatchObject({ templateId: recipe.id, templateVersion: 2 });
  });
});
