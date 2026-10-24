// Part 2's HTTP handlers on web-standard Request/Response, so Next Route Handlers are one-liners:
//   // apps/web/app/api/plans/[id]/route.ts
//   export { getPlan as GET } from '@hacktx/api';
// Part 1 calls configureApi({ db, getUserId }) once (e.g. in apps/web/lib/api.ts) with its Better Auth session lookup.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { agentRuns, messages, runSteps, user, type Db } from '@hacktx/db';
import { City, Interval, PrivateFactValue, type ActorContext } from '@hacktx/contracts';
import {
  AGENT_HANDLE, AppError, activeTally, assertMember, closePlan, enqueue, open, seal, webConversation, createPlan, listOwnFacts, listPlans, publicPlan, recordDecision, recordVote,
  savePrivateFact, updateParticipants,
} from '@hacktx/core';
import { templates } from '@hacktx/templates';

type Cfg = { db: Db; getUserId(req: Request): Promise<string | null>; appOrigin?: string; teamUserIds?: string[] };
let cfg: Cfg | null = null;
export function configureApi(c: Cfg) { cfg = c; }

type Ctx = { req: Request; db: Db; actor: ActorContext; params: Record<string, string>; requestId: string };
type NextCtx = { params?: Promise<Record<string, string>> | Record<string, string> };

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function route(fn: (ctx: Ctx) => Promise<{ data: unknown; revision?: number }>) {
  return async (req: Request, next?: NextCtx): Promise<Response> => {
    const requestId = randomUUID();
    try {
      if (!cfg) throw new AppError('INTERNAL', 'API not configured');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // Same-origin check for cookie-authenticated mutations (CSRF).
        const origin = req.headers.get('origin');
        const allowed = cfg.appOrigin ?? process.env.APP_BASE_URL;
        if (allowed && origin !== new URL(allowed).origin) throw new AppError('FORBIDDEN', 'Cross-origin request');
      }
      const userId = await cfg.getUserId(req);
      if (!userId) return json(401, { error: { code: 'FORBIDDEN', message: 'Sign in required', retryable: false }, requestId });
      const params = (await next?.params) ?? {};
      return json(200, await fn({ req, db: cfg.db, actor: { userId, source: 'web' }, params, requestId }));
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
  }));
  const [me] = await db.select({ city: user.city }).from(user).where(eq(user.id, actor.userId));
  const city = City.safeParse(me?.city);
  if (!city.success) throw new AppError('UNRESOLVED', 'Set your city in your profile first');
  const { plan, missingConnections } = await createPlan(db, actor, { ...b, city: city.data });
  return { data: { id: plan.id, status: plan.status, missingConnections: missingConnections.length }, revision: plan.inputRevision };
});

export const listPlansRoute = route(async ({ db, actor }) => ({ data: await listPlans(db, actor) }));

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
  return { data: { decisionId: r.decision.id, notAttendingUserIds: r.notAttending } };
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
export const getPrivate = route(async ({ db, actor, params }) => ({ data: { facts: await listOwnFacts(db, actor, params.id!) } }));

/** Manual availability / limits / preferences from the web (the no-calendar fallback). Owner-only by construction. */
export const putPrivateFact = route(async ({ req, db, actor, params }) => {
  const b = await body(req, z.object({ fact: PrivateFactValue, expectedRevision: z.number().int().optional() }));
  return { data: await savePrivateFact(db, actor, { planId: params.id!, fact: b.fact, expectedRevision: b.expectedRevision }) };
});

// ---------- Studio (team allowlist, redacted) ----------
function assertTeam(actor: ActorContext) {
  const team = cfg?.teamUserIds ?? (process.env.TEAM_ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!team.includes(actor.userId)) throw new AppError('NOT_FOUND', 'Not found');
}

export const getStudioTemplates = route(async ({ actor }) => {
  assertTeam(actor);
  return { data: Object.values(templates) };
});

export const getStudioRuns = route(async ({ req, db, actor }) => {
  assertTeam(actor);
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 25) || 25, 100);
  const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(limit);
  const steps = runs.length ? await db.select().from(runSteps).where(inArray(runSteps.runId, runs.map((r) => r.id))) : [];
  return {
    data: runs.map((r) => ({
      ...r,
      estimatedCostUsd: Number(r.estimatedCostUsd),
      steps: steps.filter((s) => s.runId === r.id).sort((a, b) => a.index - b.index).map((s) => ({ ...s, estimatedCostUsd: Number(s.estimatedCostUsd) })),
    })),
  };
});

// ---------- web chat (supporting UI and the fallback if messaging-provider access fails) ----------
/** Post to the plan's web group thread or your own private web thread; the agent replies asynchronously. */
export const postMessage = route(async ({ req, db, actor, params, requestId }) => {
  const b = await body(req, z.object({ text: z.string().trim().min(1).max(1000), scope: z.enum(['group', 'private']) }));
  await assertMember(db, params.id!, actor.userId);
  const conv = await webConversation(db, params.id!, b.scope, actor.userId);
  const isPrivate = b.scope === 'private';
  const [row] = await db.insert(messages).values({
    conversationId: conv.id, providerMessageId: `web:${requestId}`, senderUserId: actor.userId, senderHandle: `web:${actor.userId}`,
    isPrivate, body: isPrivate ? null : b.text, bodyEnc: isPrivate ? seal('message', b.text) : null, occurredAt: new Date(),
  }).returning({ id: messages.id });
  await enqueue(db, { kind: 'process_inbound', planId: params.id!, dedupeKey: `web:${row!.id}`, payload: { web: { messageId: row!.id } } });
  return { data: { messageId: row!.id } };
});

/** The plan's web group thread plus the caller's own private thread. Poll this every ~2 s while waiting for a reply. */
export const getMessages = route(async ({ db, actor, params }) => {
  await assertMember(db, params.id!, actor.userId);
  const threads = [await webConversation(db, params.id!, 'group', actor.userId), await webConversation(db, params.id!, 'private', actor.userId)];
  const rows = await db.select().from(messages).where(inArray(messages.conversationId, threads.map((t) => t.id))).orderBy(asc(messages.occurredAt));
  const names = new Map((await db.select({ id: user.id, name: user.name }).from(user)
    .where(inArray(user.id, [...new Set(rows.map((r) => r.senderUserId).filter(Boolean) as string[]), actor.userId]))).map((u) => [u.id, u.name]));
  return {
    data: rows.map((r) => ({
      id: r.id,
      scope: r.isPrivate ? 'private' : 'group',
      from: r.senderHandle === AGENT_HANDLE ? 'agent' : r.senderUserId ? { id: r.senderUserId, name: names.get(r.senderUserId) ?? 'member' } : 'unknown',
      text: r.body ?? open('message', r.bodyEnc!),
      at: r.occurredAt.toISOString(),
    })),
  };
});
