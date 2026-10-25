// Web-standard Route Handlers for Calendar (Part 3 routes). Next route files are one-liners over these.
// Call configureCalendar({ db, getUserId }) once at startup; getUserId resolves the Better Auth session.
import type { Db } from '@hacktx/db';
import { AppError } from '@hacktx/core';
import {
  GoogleCalendar, authorizationUrl, buildIcs, completeConnection, connectionStatus, createOAuthState, disconnect,
  googleConfig, icsUidFor, isPlanMember, outingEvent, verifyOAuthState,
} from './google-calendar.ts';

type Deps = { db: Db; getUserId: (req: Request) => Promise<string | null>; fetch?: typeof fetch; env?: NodeJS.ProcessEnv };
// Next bundles instrumentation and routes separately; share the configured runtime across them.
const registry = globalThis as typeof globalThis & { sidequestCalendar?: Deps };
export const configureCalendar = (d: Deps) => { registry.sidequestCalendar = d; };

const NONCE_COOKIE = 'sq_cal_nonce';
const SETTINGS_PATH = '/settings';
const noStore = { 'cache-control': 'private, no-store' };

const err = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, retryable: status >= 500 }, requestId: crypto.randomUUID() }, { status, headers: noStore });

function ready() {
  const deps = registry.sidequestCalendar;
  if (!deps) throw new AppError('UNRESOLVED', 'Calendar routes are not configured');
  return { ...deps, f: deps.fetch ?? fetch };
}

const sameOrigin = (req: Request, env: NodeJS.ProcessEnv = process.env) => {
  const allowed = env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).origin : new URL(req.url).origin;
  return req.headers.get('origin') === allowed;
};

const cookie = (req: Request, name: string) =>
  req.headers.get('cookie')?.split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1] ?? null;

async function guarded(fn: () => Promise<Response>) {
  try { return await fn(); } catch (e) {
    if (e instanceof AppError) return err(e.status, e.code, e.message);
    return err(500, 'INTERNAL', 'Unable to complete this request.');
  }
}

/** GET /api/calendar/connect[?write=1]: redirect to Google consent, bound to this session and browser. */
export const connectCalendar = (req: Request) => guarded(async () => {
  const { getUserId, env } = ready();
  const userId = await getUserId(req);
  if (!userId) return err(401, 'UNAUTHORIZED', 'Sign in to continue.');
  const cfg = googleConfig(env);
  const { state, nonce } = createOAuthState(cfg, userId);
  const write = new URL(req.url).searchParams.get('write') === '1';
  const secure = new URL(cfg.redirectUri).protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 302,
    headers: { ...noStore, location: authorizationUrl(cfg, state, { write }), 'set-cookie': `${NONCE_COOKIE}=${nonce}; Path=/api/calendar; HttpOnly; SameSite=Lax; Max-Age=600${secure}` },
  });
});

/** GET /api/calendar/callback: verify state + nonce + session, exchange the code, then return to settings. */
export const calendarCallback = (req: Request) => guarded(async () => {
  const { db, getUserId, env, f } = ready();
  const cfg = googleConfig(env);
  const url = new URL(req.url);
  const back = (result: string) => new Response(null, {
    status: 302,
    headers: { ...noStore, location: `${SETTINGS_PATH}?calendar=${result}`, 'set-cookie': `${NONCE_COOKIE}=; Path=/api/calendar; HttpOnly; SameSite=Lax; Max-Age=0` },
  });
  if (url.searchParams.get('error')) return back('declined');
  const code = url.searchParams.get('code');
  const stateUser = verifyOAuthState(cfg, url.searchParams.get('state') ?? '', cookie(req, NONCE_COOKIE));
  const sessionUser = await getUserId(req);
  if (!code || !stateUser || stateUser !== sessionUser) return back('invalid');
  try { await completeConnection(db, cfg, stateUser, code, f); } catch { return back('failed'); }
  return back('connected');
});

/** GET /api/calendar/connection: own status. DELETE: disconnect and delete the stored token. */
export const getCalendarConnection = (req: Request) => guarded(async () => {
  const { db, getUserId } = ready();
  const userId = await getUserId(req);
  if (!userId) return err(401, 'UNAUTHORIZED', 'Sign in to continue.');
  return Response.json({ data: await connectionStatus(db, userId) }, { headers: noStore });
});

export const deleteCalendarConnection = (req: Request) => guarded(async () => {
  const { db, getUserId, f, env } = ready();
  if (!sameOrigin(req, env)) return err(403, 'FORBIDDEN', 'Request origin is not allowed.');
  const userId = await getUserId(req);
  if (!userId) return err(401, 'UNAUTHORIZED', 'Sign in to continue.');
  await disconnect(db, userId, f);
  return Response.json({ data: { connected: false, canWriteEvents: false } }, { headers: noStore });
});

/** POST /api/plans/:id/calendar: add the chosen outing to the caller's own Google Calendar, or point to the ICS. */
export const addPlanToCalendar = (req: Request, planId: string) => guarded(async () => {
  const { db, getUserId, f, env } = ready();
  if (!sameOrigin(req, env)) return err(403, 'FORBIDDEN', 'Request origin is not allowed.');
  const userId = await getUserId(req);
  if (!userId) return err(401, 'UNAUTHORIZED', 'Sign in to continue.');
  if (!(await isPlanMember(db, planId, userId))) return err(404, 'NOT_FOUND', 'Not found');
  const found = await outingEvent(db, planId);
  if (!found) return err(422, 'UNRESOLVED', 'The group has not chosen an option yet.');
  const icsUrl = `/api/plans/${planId}/calendar.ics`;
  if (!(await connectionStatus(db, userId)).canWriteEvents) return Response.json({ data: { mode: 'ics', icsUrl } }, { headers: noStore });
  const { eventId } = await new GoogleCalendar(db, googleConfig(env), f).upsertOwnEvent(userId, planId, found.versionId);
  return Response.json({ data: { mode: 'google', eventId, icsUrl } }, { headers: noStore });
});

/** GET /api/plans/:id/calendar.ics: the caller's own ICS file (stable UID, so re-imports update instead of duplicating). */
export const planCalendarIcs = (req: Request, planId: string) => guarded(async () => {
  const { db, getUserId } = ready();
  const userId = await getUserId(req);
  if (!userId) return err(401, 'UNAUTHORIZED', 'Sign in to continue.');
  if (!(await isPlanMember(db, planId, userId))) return err(404, 'NOT_FOUND', 'Not found');
  const found = await outingEvent(db, planId);
  if (!found) return err(422, 'UNRESOLVED', 'The group has not chosen an option yet.');
  return new Response(buildIcs(icsUidFor(planId, userId), found.event), {
    headers: { ...noStore, 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="sidequest-outing.ics"' },
  });
});

/** Adapts a (req, planId) handler to a Next dynamic route: export const POST = planRoute(addPlanToCalendar). */
export const planRoute = (h: (req: Request, planId: string) => Promise<Response>) =>
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => h(req, (await ctx.params).id);
