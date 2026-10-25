// Part 2's HTTP handlers on web-standard Request/Response, so Next Route Handlers are one-liners:
//   // apps/web/app/api/plans/[id]/route.ts
//   export { getPlan as GET } from '@hacktx/api';
// Part 1 calls configureApi({ db, getUserId }) once (e.g. in apps/web/lib/api.ts) with its Better Auth session lookup.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { agentRuns, messages, runSteps, user, plans, planDecisions, type Db } from '@hacktx/db';
import { City, Interval, PrivateFactValue, type ActorContext } from '@hacktx/contracts';
import {
  AGENT_HANDLE, AppError, activeTally, assertMember, closePlan, parseCity, enqueue, open, webConversation, createPlan, listOwnFacts, listPlans, publicPlan, recordDecision, recordVote,
  savePrivateFact, updateParticipants, readPlanChat, postPlanChat,
} from '@hacktx/core';
import { templates, loadTemplate, saveTemplate } from '@hacktx/templates';
import { recapPlanChat } from '@hacktx/agent';
import { setBuyer, createMuse, createDrop, listDrops, editDrop, findCommonGround, getGroundDraft, attachGround, planGround, readQuest, generateQuest, completeQuestChallenge, describePhoto, transcribeVoice, createQuestArt, loadPublicDemo } from '@hacktx/agent';

type Cfg = { db: Db; getUserId(req: Request): Promise<string | null>; appOrigin?: string; teamUserIds?: string[] };
// Kept on globalThis: Next loads instrumentation and each route bundle as separate module instances.
const registry = globalThis as typeof globalThis & { hacktxApiCfg?: Cfg };
export function configureApi(c: Cfg) { registry.hacktxApiCfg = c; }
export async function getPublicDemo() {
  try {
    const cfg = registry.hacktxApiCfg;
    if (!cfg) return Response.json({ data: null }, { status: 503 });
    const data = await loadPublicDemo(cfg.db);
    if (data?.quest?.art) data.quest.art = '/api/demo/art';
    return Response.json({ data }, { headers: { 'Cache-Control': 'public, max-age=30' } });
  } catch { return Response.json({ error: { code: 'UNRESOLVED', message: 'The recorded example is temporarily unavailable.', retryable: true } }, { status: 503 }); }
}
export async function getPublicDemoArt() {
  try {
    const cfg = registry.hacktxApiCfg;
    const art = cfg ? (await loadPublicDemo(cfg.db))?.quest?.art : null;
    if (!art?.startsWith('data:image/png;base64,')) return new Response(null, { status: 404 });
    return new Response(Buffer.from(art.slice('data:image/png;base64,'.length), 'base64'), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response(null, { status: 503 }); }
}

type Ctx = { req: Request; db: Db; actor: ActorContext; params: Record<string, string>; requestId: string };
// Matches Next.js route context exactly (its build-time type check rejects an optional second argument).
type NextCtx = { params: Promise<Record<string, string>> };

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function route(fn: (ctx: Ctx) => Promise<{ data: unknown; revision?: number } | Response>) {
  return async (req: Request, next: NextCtx): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const cfg = registry.hacktxApiCfg;
      if (!cfg) throw new AppError('INTERNAL', 'API not configured');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // Same-origin check for cookie-authenticated mutations (CSRF).
        const origin = req.headers.get('origin');
        const allowed = cfg.appOrigin ?? process.env.APP_BASE_URL;
        if (allowed && origin !== new URL(allowed).origin) throw new AppError('FORBIDDEN', 'Cross-origin request');
      }
      const userId = await cfg.getUserId(req);
      if (!userId) return json(401, { error: { code: 'FORBIDDEN', message: 'Sign in required', retryable: false }, requestId });
      const params = (await next?.params) ?? {}; // `next` may be absent when called outside Next
      const result = await fn({ req, db: cfg.db, actor: { userId, source: 'web' }, params, requestId });
      return result instanceof Response ? result : json(200, result);
    } catch (e) {
      if (e instanceof AppError) return json(e.status, e.toBody(requestId));
      if (e instanceof z.ZodError) return json(400, { error: { code: 'INVALID', message: e.issues[0]?.message ?? 'Invalid input', retryable: false }, requestId });
      console.error(`[api] ${requestId}`, e);
      return json(500, { error: { code: 'INTERNAL', message: 'Something went wrong', retryable: true }, requestId });
    }
  };
}

const body = async <T>(req: Request, schema: z.ZodType<T>) => schema.parse(await req.json().catch(() => { throw new AppError('INVALID', 'JSON body required'); }));

// ---------- plans ----------
export const createPlanRoute = route(async ({ req, db, actor }) => {
  const b = await body(req, z.object({
    request: z.string().min(3).max(500),
    templateId: z.enum(['movie-night', 'local-outing']).default('local-outing'),
    participantUserIds: z.array(z.string()).max(12),
    window: Interval.nullable().default(null),
    mode: z.enum(['live', 'test']).default('test'),
    commonGroundId: z.string().uuid().optional(),
  }));
  const [me] = await db.select({ city: user.city }).from(user).where(eq(user.id, actor.userId));
  const city = parseCity(me?.city);
  if (!city) throw new AppError('UNRESOLVED', 'Set your city in your profile first');
  const ground = b.commonGroundId ? await getGroundDraft(db, actor, b.commonGroundId, b.participantUserIds) : null;
  const { plan, missingConnections } = await db.transaction(async tx => {
    const result = await createPlan(tx, actor, { ...b, request: ground ? `${ground.theme}. Search: ${ground.searchQuery}` : b.request, city });
    if (ground) await attachGround(tx, actor, result.plan.id, ground);
    return result;
  });
  return { data: { id: plan.id, status: plan.status, missingConnections: missingConnections.length }, revision: plan.inputRevision };
});

// CONTRACTS.md: membership-filtered public projections (same shape as GET /plans/:id).
export const listPlansRoute = route(async ({ db, actor }) => ({
  data: await Promise.all((await listPlans(db, actor)).map((p) => publicPlan(db, actor, p.id))),
}));

export const getPlan = route(async ({ db, actor, params }) => {
  const p = await publicPlan(db, actor, params.id!);
  return { data: { ...p, tally: await activeTally(db, p.id) }, revision: p.revision };
});

export const putVote = route(async ({ req, db, actor, params, requestId }) => {
  const b = await body(req, z.object({
    versionId: z.string(), acceptableOptionIds: z.array(z.string()), favoriteOptionId: z.string().nullable(), noneAcceptable: z.boolean(),
  }));
  const vote = await recordVote(db, actor, { ...b, planId: params.id!, source: 'web', sourceEventId: `web:${requestId}` });
  return { data: { ...vote, tally: await activeTally(db, params.id!) } };
});

export const postDecision = route(async ({ req, db, actor, params }) => {
  const b = await body(req, z.object({
    versionId: z.string(), optionId: z.string(), attendeeUserIds: z.array(z.string()).min(1),
    evidenceMessageIds: z.array(z.string()).default([]), expectedRevision: z.number().int(),
  }));
  const r = await recordDecision(db, actor, { ...b, planId: params.id! });
  await enqueue(db, { kind: 'sync_calendar', planId: params.id!, dedupeKey: `sync_calendar:${params.id}:${b.versionId}:selected`, payload: { planId: params.id! } });
  return { data: { decisionId: r.decision.id, notAttendingUserIds: r.notAttending } };
});
export const postBuyer = route(async ({ req, db, actor, params }) => {
  const input = await body(req, z.object({ expectedRevision: z.number().int() }));
  const result = await setBuyer(db, actor, params.id!, true, input.expectedRevision);
  if (!result.confirmed) throw new AppError(result.error === 'NOT_ATTENDEE' ? 'FORBIDDEN' : 'STALE_PLAN', result.message || 'Buyer could not be confirmed.');
  return { data: { buyerUserId: actor.userId } };
});

export const patchParticipants = route(async ({ req, db, actor, params }) => {
  const b = await body(req, z.object({ add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]), expectedRevision: z.number().int() }));
  const row = await updateParticipants(db, actor, { ...b, planId: params.id! });
  return { data: { status: row.status }, revision: row.inputRevision };
});

export const postClose = route(async ({ req, db, actor, params }) => {
  const b = await body(req, z.object({ expectedRevision: z.number().int() }));
  const row = await closePlan(db, actor, params.id!, b.expectedRevision);
  return { data: { status: row.status }, revision: row.inputRevision };
});

// ---------- own private details ----------
export const getPrivate = route(async ({ db, actor, params }) => {
  const facts = await listOwnFacts(db, actor, params.id!);
  const thread = await webConversation(db, params.id!, 'private', actor.userId);
  const rows = await db.select().from(messages).where(and(eq(messages.conversationId, thread.id), eq(messages.planId, params.id!))).orderBy(asc(messages.occurredAt));
  return { data: {
    ownerUserId: actor.userId,
    facts: facts.map((f) => ({ id: f.id, kind: f.kind, value: f.value })),
    messages: rows.map((r) => ({ id: r.id, text: `${r.senderHandle === AGENT_HANDLE ? 'Agent' : 'You'}: ${open('message', r.bodyEnc!)}` })),
  } };
});

/** Manual availability / limits / preferences from the web (the no-calendar fallback). Owner-only by construction. */
export const putPrivateFact = route(async ({ req, db, actor, params }) => {
  const b = await body(req, z.object({ fact: PrivateFactValue, expectedRevision: z.number().int().optional() }));
  return { data: await savePrivateFact(db, actor, { planId: params.id!, fact: b.fact, expectedRevision: b.expectedRevision }) };
});

// ---------- Studio (team allowlist, redacted) ----------
function assertTeam(actor: ActorContext) {
  const team = registry.hacktxApiCfg?.teamUserIds ?? (process.env.TEAM_ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!team.includes(actor.userId)) throw new AppError('NOT_FOUND', 'Not found');
}

export const getStudioTemplates = route(async ({ db, actor }) => {
  assertTeam(actor);
  return { data: await Promise.all(Object.keys(templates).map(id => loadTemplate(db, id))) };
});

export const getStudioTemplate = route(async ({ db, actor, params }) => {
  assertTeam(actor);
  if (!(params.id! in templates)) throw new AppError('NOT_FOUND', 'Not found');
  return { data: await loadTemplate(db, params.id!) };
});
export const putStudioTemplate = route(async ({ req, db, actor, params }) => {
  assertTeam(actor);
  if (!(params.id! in templates)) throw new AppError('NOT_FOUND', 'Not found');
  const input = await body(req, z.object({ expectedVersion: z.number().int().positive(), systemInstruction: z.string().trim().min(1).max(12000), allowedTools: z.array(z.string()).max(20), limits: z.object({ maxTurns: z.number().int().min(1).max(12), maxTools: z.number().int().min(0).max(24), maxSearches: z.number().int().min(0).max(8) }) }));
  try { return { data: await saveTemplate(db, params.id!, input.expectedVersion, input) }; }
  catch (e) { if (e instanceof Error && e.message === 'STALE_TEMPLATE') throw new AppError('STALE_PLAN', 'Recipe changed. Reload before saving.'); if (e instanceof Error && e.message === 'INVALID_TEMPLATE') throw new AppError('INVALID', 'The recipe contains an unsupported tool or limit.'); throw e; }
});

// Interest suggestions are private until the owner explicitly confirms each shared chip.
export const getDrops = route(async ({ db, actor }) => ({ data: await listDrops(db, actor.userId) }));
export const postDrop = route(async ({ req, db, actor }) => {
  const input = await body(req, z.object({ note: z.string().trim().min(1).max(4000), url: z.string().url().max(2000).nullable().default(null) }));
  return { data: await createDrop(db, createMuse(), actor.userId, input.note, input.url) };
});
export const patchDrop = route(async ({ req, db, actor, params }) => {
  const input = await body(req, z.object({ chips: z.array(z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(120), confirmed: z.boolean(), shared: z.boolean() })).max(12) }));
  return { data: await editDrop(db, actor.userId, params.id!, input.chips) };
});
export const deleteDrop = route(async ({ db, actor, params }) => ({ data: await editDrop(db, actor.userId, params.id!, null) }));
export const postCommonGround = route(async ({ req, db, actor }) => {
  const input = await body(req, z.object({ friendIds: z.array(z.string()).min(1).max(9) }));
  return { data: await findCommonGround(db, createMuse(), actor, input.friendIds) };
});
export const getPlanGround = route(async ({ db, actor, params }) => { await assertMember(db, params.id!, actor.userId); return { data: await planGround(db, params.id!) }; });
function questView<T extends { art?: string; versionId: string; optionId: string }>(quest: T | null, planId: string) {
  return quest?.art ? { ...quest, art: `/api/plans/${planId}/quest/art?version=${quest.versionId}&option=${quest.optionId}` } : quest;
}
export const getQuest = route(async ({ db, actor, params }) => ({ data: questView(await readQuest(db, actor, params.id!), params.id!) }));
export const postQuest = route(async ({ db, actor, params }) => ({ data: questView(await generateQuest(db, createMuse(), actor, params.id!), params.id!) }));
export const patchQuest = route(async ({ req, db, actor, params }) => {
  const input = await body(req, z.object({ challengeId: z.string().uuid(), done: z.boolean() }));
  return { data: questView(await completeQuestChallenge(db, actor, params.id!, input.challengeId, input.done), params.id!) };
});
export const postPhotoDescription = route(async ({ req, db, actor }) => {
  const input = await body(req, z.object({ dataUrl: z.string().max(1_600_000) }));
  return { data: await describePhoto(db, actor, input.dataUrl) };
});
export const postVoiceTranscription = route(async ({ req, db, actor }) => {
  const form = await req.formData();
  const file = form.get('audio');
  if (!(file instanceof Blob)) throw new AppError('INVALID', 'Choose a WAV recording.');
  return { data: await transcribeVoice(db, actor, file) };
});
export const postQuestArt = route(async ({ db, actor, params }) => ({ data: questView(await createQuestArt(db, actor, params.id!), params.id!) }));
export const getQuestArt = route(async ({ req, db, actor, params }) => {
  const quest = await readQuest(db, actor, params.id!);
  const query = new URL(req.url).searchParams;
  if (!quest?.art?.startsWith('data:image/png;base64,') || query.get('version') !== quest.versionId || query.get('option') !== quest.optionId) throw new AppError('NOT_FOUND', 'Not found');
  return new Response(Buffer.from(quest.art.slice('data:image/png;base64,'.length), 'base64'), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' } });
});

export const getStudioRuns = route(async ({ req, db, actor }) => {
  assertTeam(actor);
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 25) || 25, 100);
  const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(limit);
  const steps = runs.length ? await db.select().from(runSteps).where(inArray(runSteps.runId, runs.map((r) => r.id))) : [];
  return {
    data: runs.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      costKnown: !['voice-input', 'quest-art', 'snowflake-recap'].includes(r.task),
      summary: `${r.task} · ${r.templateId} v${r.templateVersion} · ${r.inputTokens + r.outputTokens} tokens · ${['voice-input', 'quest-art', 'snowflake-recap'].includes(r.task) ? 'Provider cost unavailable (excluded from Spark total)' : `~$${Number(r.estimatedCostUsd).toFixed(4)}`}${r.error ? ` · ${r.error}` : ''}`,
      mode: 'test' as const, // no live purchases are made by agent runs
      estimatedCostUsd: Number(r.estimatedCostUsd),
      steps: steps.filter((s) => s.runId === r.id).sort((a, b) => a.index - b.index).map((s) => ({ ...s, estimatedCostUsd: Number(s.estimatedCostUsd) })),
    })),
  };
});

// ---------- web chat (supporting UI and the fallback if messaging-provider access fails) ----------
/** Post to the plan's web group thread or your own private web thread; the agent replies asynchronously. */
export const postMessage = route(async ({ req, db, actor, params, requestId }) => {
  const b = await body(req, z.object({ text: z.string().trim().min(1).max(1000), scope: z.enum(['group', 'private']), destination: z.enum(['website', 'linked_chat']).default('website') }));
  return { data: await postPlanChat(db, actor, { ...b, planId: params.id!, requestId }) };
});

/** The plan's web group thread plus the caller's own private thread. Poll this every ~2 s while waiting for a reply. */
export const getMessages = route(async ({ db, actor, params }) => {
  return { data: (await readPlanChat(db, actor, params.id!)).messages };
});
export const getChat = route(async ({ db, actor, params }) => ({ data: await readPlanChat(db, actor, params.id!) }));

export const postChatRecap = route(async ({ req, db, actor, params }) => {
  const input = await body(req, z.object({ consent: z.literal(true), messageIds: z.array(z.string().uuid()).min(1).max(20) }).strict());
  return { data: await recapPlanChat(db, actor, params.id!, input.messageIds) };
});
