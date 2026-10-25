import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';
import { privateFacts, user, planParticipants, plans, planOptions, agentRuns, type Db } from '@hacktx/db';
import { AppError, assertMember, missingConnections, openJson, sealJson, publicPlan } from '@hacktx/core';
import { loadTemplate, PRODUCT_VOICE } from '@hacktx/templates';
import type { ActorContext } from '@hacktx/contracts';
import type { Muse } from './muse';
import { RunRecorder } from './recorder';

const Chip = z.object({ id: z.string(), label: z.string().trim().min(1).max(120), evidence: z.string().min(1).max(500), kind: z.enum(['interest', 'wish']), confirmed: z.boolean(), shared: z.boolean() });
const Drop = z.object({ note: z.string().max(4000), url: z.string().nullable(), chips: z.array(Chip).max(12) });
export type DropValue = z.infer<typeof Drop>;
const Extracted = z.object({ interests: z.array(z.object({ label: z.string(), evidence: z.string() })).max(6), wishes: z.array(z.object({ label: z.string(), evidence: z.string() })).max(6) });
const Ground = z.object({ theme: z.string().min(1).max(200), searchQuery: z.string().min(1).max(300), chipIds: z.array(z.string()).min(2).max(12) });
type SharedChip = z.infer<typeof Chip> & { dropId: string; ownerId: string; name: string };
export type CommonGround = { id: string; theme: string; searchQuery: string; memberIds: string[]; why: SharedChip[]; runId: string };
const QuestDraft = z.object({ title: z.string().min(1).max(150), challenges: z.array(z.object({ kind: z.enum(['photo', 'riddle']), title: z.string().min(1).max(120), challenge: z.string().min(1).max(700), hint: z.string().max(400) })).length(5) });
export type QuestValue = Omit<z.infer<typeof QuestDraft>, 'challenges'> & { art?: string; versionId: string; optionId: string; runId: string; challenges: (z.infer<typeof QuestDraft>['challenges'][number] & { id: string; completedBy: string | null; completedByName?: string; completedAt: string | null })[] };

async function modelStep<T>(db: Db, muse: Muse, templateId: 'drop-extraction' | 'common-ground' | 'quest', schema: z.ZodType<T>, input: unknown, planId: string | null = null, revision = 0) {
  const template = await loadTemplate(db, templateId);
  const rec = await RunRecorder.start(db, { planId, task: templateId, template, model: muse.model, inputRevision: revision });
  try {
    if (!template.allowedTools.includes({ 'drop-extraction': 'extract_interests', 'common-ground': 'match_shared_interests', quest: 'create_quest' }[templateId])) throw new AppError('FORBIDDEN', 'This recipe has disabled its task.');
    rec.charge('turn');
    const result = await rec.step('model', templateId, () => muse.structured({ name: templateId.replaceAll('-', '_'), schema, messages: [{ role: 'system', content: `${template.systemInstruction}\n${PRODUCT_VOICE}` }, { role: 'user', content: JSON.stringify(input) }] }), r => ({ summary: 'Structured result generated; private input omitted.', usage: r.usage }));
    await rec.finish('ok');
    return { value: result.value, runId: rec.runId };
  } catch (error) { await rec.finish('error', 'Generation failed validation or provider request.'); throw error; }
}

export async function listDrops(db: Db, ownerId: string) {
  const rows = await db.select().from(privateFacts).where(and(eq(privateFacts.ownerUserId, ownerId), eq(privateFacts.kind, 'interest_drop'), isNull(privateFacts.planId))).orderBy(desc(privateFacts.updatedAt));
  return rows.map(r => ({ id: r.id, ...Drop.parse(openJson('private_fact', r.valueEnc)) }));
}

export async function createDrop(db: Db, muse: Muse, ownerId: string, note: string, url: string | null) {
  if (url && !['http:', 'https:'].includes(new URL(url).protocol)) throw new AppError('INVALID', 'Use an http or https link.');
  const text = [note, url].filter(Boolean).join('\n');
  const grounded = Extracted.refine(v => [...v.interests, ...v.wishes].length > 0 && [...v.interests, ...v.wishes].every(c => c.evidence.trim() && text.includes(c.evidence)), 'Evidence must quote the submitted text.');
  const { value, runId } = await modelStep(db, muse, 'drop-extraction', grounded, { submittedText: text, linksFetched: false });
  const chips = [...value.interests.map(c => ({ ...c, kind: 'interest' as const })), ...value.wishes.map(c => ({ ...c, kind: 'wish' as const }))]
    .filter(c => text.includes(c.evidence) && c.evidence.trim()).map(c => Chip.parse({ ...c, id: randomUUID(), confirmed: false, shared: false }));
  if (!chips.length) throw new AppError('UNRESOLVED', 'No grounded interests found. Add a sentence about what you enjoy or want to try.');
  const stored = Drop.parse({ note, url, chips });
  const [row] = await db.insert(privateFacts).values({ ownerUserId: ownerId, kind: 'interest_drop', valueEnc: sealJson('private_fact', stored) }).returning();
  return { id: row!.id, ...stored, runId };
}

export async function editDrop(db: Db, ownerId: string, id: string, changes: { id: string; label: string; confirmed: boolean; shared: boolean }[] | null) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(privateFacts).where(and(eq(privateFacts.id, id), eq(privateFacts.ownerUserId, ownerId), eq(privateFacts.kind, 'interest_drop'), isNull(privateFacts.planId))).for('update');
    if (!row) throw new AppError('NOT_FOUND', 'Not found');
    if (changes === null) { await tx.delete(privateFacts).where(eq(privateFacts.id, id)); return { deleted: true }; }
    const drop = Drop.parse(openJson('private_fact', row.valueEnc));
    if (changes.length !== drop.chips.length || new Set(changes.map(c => c.id)).size !== drop.chips.length || changes.some(c => !drop.chips.some(old => old.id === c.id))) throw new AppError('INVALID', 'Keep the original chip IDs and evidence.');
    drop.chips = drop.chips.map(old => { const change = changes.find(c => c.id === old.id)!; return Chip.parse({ ...old, ...change, shared: change.confirmed && change.shared }); });
    await tx.update(privateFacts).set({ valueEnc: sealJson('private_fact', drop), updatedAt: new Date() }).where(eq(privateFacts.id, id));
    return { id, ...drop };
  });
}

async function sharedChips(db: Db, memberIds: string[]): Promise<SharedChip[]> {
  const rows = await db.select().from(privateFacts).where(and(inArray(privateFacts.ownerUserId, memberIds), eq(privateFacts.kind, 'interest_drop'), isNull(privateFacts.planId)));
  const names = new Map((await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, memberIds))).map(u => [u.id, u.name]));
  return rows.flatMap(r => Drop.parse(openJson('private_fact', r.valueEnc)).chips.filter(c => c.confirmed && c.shared).map(c => ({ ...c, dropId: r.id, ownerId: r.ownerUserId, name: names.get(r.ownerUserId) ?? 'Friend' })));
}

export async function findCommonGround(db: Db, muse: Muse, actor: ActorContext, friendIds: string[]) {
  const memberIds = [...new Set([actor.userId, ...friendIds])].sort();
  if (memberIds.length < 2 || memberIds.length > 10 || (await missingConnections(db, actor.userId, memberIds)).length) throw new AppError('FORBIDDEN', 'Choose connected friends.');
  const chips = await sharedChips(db, memberIds);
  if (memberIds.some(id => !chips.some(c => c.ownerId === id))) throw new AppError('UNRESOLVED', 'Each selected friend needs at least one confirmed shared interest.');
  const grounded = Ground.refine(v => v.chipIds.every(id => chips.some(c => c.id === id)) && new Set(chips.filter(c => v.chipIds.includes(c.id)).map(c => c.ownerId)).size >= 2, 'Cite real shared chips from at least two people.');
  const { value, runId } = await modelStep(db, muse, 'common-ground', grounded, { sharedInterests: chips.map(c => ({ chipId: c.id, personId: c.ownerId, label: c.label, evidence: c.evidence })) });
  const why = [...new Set(value.chipIds)].map(id => chips.find(c => c.id === id));
  if (why.some(c => !c) || new Set(why.map(c => c!.ownerId)).size < 2) throw new AppError('UNRESOLVED', 'The model could not ground a connection between friends. Try again.');
  const result: CommonGround = { id: randomUUID(), ...value, memberIds, why: why as SharedChip[], runId };
  await db.insert(privateFacts).values({ id: result.id, ownerUserId: actor.userId, kind: 'common_ground', valueEnc: sealJson('private_fact', result) });
  return result;
}

async function currentGround(db: Db, ground: CommonGround): Promise<boolean> {
  const current = await sharedChips(db, ground.memberIds);
  return ground.why.every(c => current.some(n => n.id === c.id && n.ownerId === c.ownerId && n.label === c.label && n.evidence === c.evidence));
}

export async function getGroundDraft(db: Db, actor: ActorContext, id: string, friendIds: string[]) {
  const [row] = await db.select().from(privateFacts).where(and(eq(privateFacts.id, id), eq(privateFacts.ownerUserId, actor.userId), eq(privateFacts.kind, 'common_ground'), isNull(privateFacts.planId)));
  if (!row) throw new AppError('NOT_FOUND', 'Not found');
  const ground = openJson<CommonGround>('private_fact', row.valueEnc);
  if (ground.memberIds.join() !== [...new Set([actor.userId, ...friendIds])].sort().join() || !(await currentGround(db, ground))) throw new AppError('STALE_PLAN', 'Shared interests changed. Find your common ground again.');
  return ground;
}

export async function attachGround(db: Db, actor: ActorContext, planId: string, ground: CommonGround) {
  await db.insert(privateFacts).values({ ownerUserId: actor.userId, planId, kind: 'common_ground', valueEnc: sealJson('private_fact', ground) });
}

export async function planGround(db: Db, planId: string): Promise<CommonGround | null> {
  const [row] = await db.select().from(privateFacts).where(and(eq(privateFacts.planId, planId), eq(privateFacts.kind, 'common_ground'))).orderBy(desc(privateFacts.updatedAt)).limit(1);
  if (!row) return null;
  const ground = openJson<CommonGround>('private_fact', row.valueEnc);
  return await currentGround(db, ground) ? ground : null;
}

export async function readQuest(db: Db, actor: ActorContext, planId: string) {
  const plan = await assertMember(db, planId, actor.userId);
  const [row] = await db.select().from(privateFacts).where(and(eq(privateFacts.planId, planId), eq(privateFacts.kind, 'quest'))).orderBy(desc(privateFacts.updatedAt)).limit(1);
  if (!row) return null;
  const quest = openJson<QuestValue>('private_fact', row.valueEnc);
  if (quest.versionId !== plan.activeVersionId || quest.optionId !== plan.selectedOptionId) return null;
  const ids = quest.challenges.flatMap(c => c.completedBy ? [c.completedBy] : []);
  const names = new Map(ids.length ? (await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map(u => [u.id, u.name]) : []);
  return { id: row.id, ...quest, challenges: quest.challenges.map(c => ({ ...c, completedByName: c.completedBy ? names.get(c.completedBy) ?? 'Friend' : undefined })) };
}

export async function generateQuest(db: Db, muse: Muse, actor: ActorContext, planId: string) {
  const plan = await assertMember(db, planId, actor.userId);
  const existing = await readQuest(db, actor, planId);
  if (existing) return existing;
  if (!plan.selectedOptionId || !plan.activeVersionId || !['selected', 'booked', 'handoff'].includes(plan.status)) throw new AppError('UNRESOLVED', 'Choose an outing together first.');
  const [option] = await db.select().from(planOptions).where(and(eq(planOptions.id, plan.selectedOptionId), eq(planOptions.versionId, plan.activeVersionId)));
  if (!option) throw new AppError('STALE_PLAN', 'Choose the current outing first.');
  const format = QuestDraft.refine(v => v.challenges.filter(c => c.kind === 'photo').length === 3 && v.challenges.filter(c => c.kind === 'riddle').length === 2, 'Use three photo challenges and two riddles.');
  const { value, runId } = await modelStep(db, muse, 'quest', format, { selectedOuting: option.payload, sharedInterests: (await planGround(db, planId))?.why.map(c => c.label) ?? [], format: '3 photo challenges and 2 riddles' }, planId, plan.inputRevision);
  if (value.challenges.filter(c => c.kind === 'photo').length !== 3 || value.challenges.filter(c => c.kind === 'riddle').length !== 2) throw new AppError('UNRESOLVED', 'Quest did not match the cooperative format. Try again.');
  const quest: QuestValue = { ...value, versionId: plan.activeVersionId, optionId: plan.selectedOptionId, runId, challenges: value.challenges.map(c => ({ ...c, id: randomUUID(), completedBy: null, completedAt: null })) };
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
    if (locked?.activeVersionId !== quest.versionId || locked.selectedOptionId !== quest.optionId) throw new AppError('STALE_PLAN', 'The plan changed while the quest was being created.');
    const [old] = await tx.select().from(privateFacts).where(and(eq(privateFacts.planId, planId), eq(privateFacts.kind, 'quest'))).orderBy(desc(privateFacts.updatedAt)).limit(1);
    if (old) { const previous = openJson<QuestValue>('private_fact', old.valueEnc); if (previous.versionId === quest.versionId && previous.optionId === quest.optionId) return { id: old.id, ...previous }; }
    const [row] = await tx.insert(privateFacts).values({ ownerUserId: plan.organizerUserId, planId, kind: 'quest', valueEnc: sealJson('private_fact', quest) }).returning();
    return { id: row!.id, ...quest };
  });
}

export async function completeQuestChallenge(db: Db, actor: ActorContext, planId: string, challengeId: string, done: boolean) {
  return db.transaction(async tx => {
    const plan = await assertMember(tx, planId, actor.userId);
    const [locked] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
    const quest = await readQuest(tx, actor, planId);
    if (!quest || locked?.activeVersionId !== quest.versionId || plan.selectedOptionId !== quest.optionId) throw new AppError('STALE_PLAN', 'Generate a quest for the current outing.');
    const item = quest.challenges.find(c => c.id === challengeId);
    if (!item) throw new AppError('NOT_FOUND', 'Not found');
    if (!done && item.completedBy && item.completedBy !== actor.userId) throw new AppError('FORBIDDEN', 'Only the person who completed this challenge can undo it.');
    if (done && item.completedBy) return quest;
    item.completedBy = done ? actor.userId : null;
    item.completedAt = done ? new Date().toISOString() : null;
    const { id, ...stored } = quest;
    await tx.update(privateFacts).set({ valueEnc: sealJson('private_fact', stored), updatedAt: new Date() }).where(eq(privateFacts.id, id));
    return quest;
  });
}

/** Public read-only showcase: only the explicitly seeded synthetic, phone-less accounts qualify. */
export async function loadPublicDemo(db: Db) {
  const [plan] = await db.select().from(plans).where(and(eq(plans.organizerUserId, 'sidequest_demo_alex'), eq(plans.mode, 'test'), eq(plans.status, 'selected'))).orderBy(desc(plans.updatedAt)).limit(1);
  if (!plan) return null;
  const people = await db.select({ id: user.id, email: user.email, phone: user.phoneNumber }).from(planParticipants).innerJoin(user, eq(user.id, planParticipants.userId)).where(eq(planParticipants.planId, plan.id));
  if (people.length < 2 || people.some(p => !p.id.startsWith('sidequest_demo_') || !p.email.endsWith('@demo.sidequest.invalid') || p.phone !== null)) return null;
  const actor: ActorContext = { userId: plan.organizerUserId, source: 'web' };
  const runs = await db.select({ id: agentRuns.id, task: agentRuns.task, templateId: agentRuns.templateId, templateVersion: agentRuns.templateVersion, model: agentRuns.model, status: agentRuns.status, inputTokens: agentRuns.inputTokens, outputTokens: agentRuns.outputTokens }).from(agentRuns).where(eq(agentRuns.planId, plan.id));
  return { synthetic: true as const, readOnly: true as const, recordedAt: plan.updatedAt.toISOString(), plan: await publicPlan(db, actor, plan.id), ground: await planGround(db, plan.id), quest: await readQuest(db, actor, plan.id), runs };
}
