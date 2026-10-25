import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import {
  schema, migrationsFolder, availabilitySnapshots, calendarConnections, calendarEvents, planOptions, planParticipants, plans,
  planVersions, user, type Db,
} from '@hacktx/db';
import { seal } from '@hacktx/core';
import {
  GoogleCalendar, SCOPE_EVENTS, SCOPE_FREEBUSY, authorizationUrl, buildIcs, completeConnection, createOAuthState, eventIdFor,
  verifyOAuthState, type GoogleConfig,
} from './google-calendar.ts';
import { refreshPlanAvailability } from './calendar-jobs.ts';
import { addPlanToCalendar, calendarCallback, configureCalendar, connectCalendar, planCalendarIcs } from './calendar-http.ts';

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

const cfg: GoogleConfig = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:3000/api/calendar/callback', stateSecret: 's'.repeat(32) };
const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: cfg.redirectUri, BETTER_AUTH_SECRET: cfg.stateSecret, BETTER_AUTH_URL: 'http://localhost:3000' };
const austin = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };
const window = { startAt: '2026-10-31T00:00:00.000Z', endAt: '2026-11-01T00:00:00.000Z' };

/** Records Google calls and answers from a route table. */
function fakeGoogle(routes: Record<string, (body: string) => { status?: number; json: unknown }>) {
  const calls: { method: string; url: string; body: string }[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? String(init.body) : '';
    calls.push({ method, url, body });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k));
    const r = key ? routes[key]!(body) : { status: 404, json: {} };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}
const tokenOk = (extra: object = {}) => () => ({ json: { access_token: 'at', expires_in: 3600, scope: `${SCOPE_FREEBUSY} ${SCOPE_EVENTS}`, ...extra } });

let db: Db;
beforeEach(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder });
  for (const id of ['u_alex', 'u_mark', 'u_out']) await db.insert(user).values({ id, name: id, email: `${id}@users.invalid`, city: austin });
});

async function selectedPlan() {
  const [p] = await db.insert(plans).values({ organizerUserId: 'u_alex', request: 'movie', templateId: 'movie-night', city: austin, timeZone: 'America/Chicago', status: 'selected' }).returning();
  await db.insert(planParticipants).values({ planId: p!.id, userId: 'u_mark' });
  const [v] = await db.insert(planVersions).values({ planId: p!.id, versionNumber: 1, inputRevision: 0 }).returning();
  const [o] = await db.insert(planOptions).values({ versionId: v!.id, label: 'B', payload: {
    id: 'x', versionId: v!.id, label: 'B', title: 'Avengers, Alamo Drafthouse; IMAX', candidateIds: [], startAt: '2026-10-31T00:30:00.000Z',
    endAt: '2026-10-31T03:30:00.000Z', timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown',
    fit: 'fits_known_constraints', uncertainties: [], publicExplanation: 'x', sourceIds: [],
  } }).returning();
  await db.update(plans).set({ activeVersionId: v!.id, selectedOptionId: o!.id }).where(eq(plans.id, p!.id));
  return { planId: p!.id, versionId: v!.id };
}

describe('OAuth state', () => {
  it('accepts only the issuing browser, unexpired and untampered', () => {
    const { state, nonce } = createOAuthState(cfg, 'u_alex');
    expect(verifyOAuthState(cfg, state, nonce)).toBe('u_alex');
    expect(verifyOAuthState(cfg, state, 'other-nonce')).toBeNull();
    expect(verifyOAuthState(cfg, state, null)).toBeNull();
    expect(verifyOAuthState(cfg, `${state.split('.')[0]}x.${state.split('.')[1]}`, nonce)).toBeNull();
    expect(verifyOAuthState(cfg, state, nonce, Date.now() + 11 * 60_000)).toBeNull();
  });

  it('asks for free/busy by default and adds event write only when requested', () => {
    const read = new URL(authorizationUrl(cfg, 'st'));
    expect(read.searchParams.get('scope')).toBe(SCOPE_FREEBUSY);
    expect(read.searchParams.get('access_type')).toBe('offline');
    expect(new URL(authorizationUrl(cfg, 'st', { write: true })).searchParams.get('scope')).toBe(`${SCOPE_FREEBUSY} ${SCOPE_EVENTS}`);
  });
});

describe('connection', () => {
  it('stores the refresh token encrypted and keeps it when a later grant omits one', async () => {
    const g1 = fakeGoogle({ 'POST https://oauth2.googleapis.com/token': tokenOk({ refresh_token: 'rt-secret', scope: SCOPE_FREEBUSY }) });
    await completeConnection(db, cfg, 'u_alex', 'code1', g1.f);
    const [c1] = await db.select().from(calendarConnections);
    expect(c1!.refreshTokenEnc).not.toContain('rt-secret');
    expect(c1!.scopes).toEqual([SCOPE_FREEBUSY]);

    const g2 = fakeGoogle({ 'POST https://oauth2.googleapis.com/token': tokenOk({ scope: SCOPE_EVENTS }) });
    await completeConnection(db, cfg, 'u_alex', 'code2', g2.f);
    const [c2] = await db.select().from(calendarConnections);
    expect(c2!.refreshTokenEnc).toBe(c1!.refreshTokenEnc);
    expect(c2!.scopes.sort()).toEqual([SCOPE_EVENTS, SCOPE_FREEBUSY].sort());
  });
});

describe('free/busy', () => {
  it('is disconnected without a connection and maps busy intervals when connected', async () => {
    const g = fakeGoogle({
      'POST https://oauth2.googleapis.com/token': tokenOk({ refresh_token: 'rt' }),
      'POST https://www.googleapis.com/calendar/v3/freeBusy': () => ({ json: { calendars: { primary: { busy: [{ start: '2026-10-31T01:00:00Z', end: '2026-10-31T02:00:00Z' }] } } } }),
    });
    const cal = new GoogleCalendar(db, cfg, g.f);
    expect((await cal.getBusy('u_mark', window)).status).toBe('disconnected');
    await completeConnection(db, cfg, 'u_alex', 'code', g.f);
    const r = await cal.getBusy('u_alex', window);
    expect(r).toMatchObject({ status: 'ok', busy: [{ startAt: '2026-10-31T01:00:00.000Z', endAt: '2026-10-31T02:00:00.000Z' }] });
    const fb = g.calls.find((c) => c.url.endsWith('/freeBusy'))!;
    expect(JSON.parse(fb.body)).toEqual({ timeMin: window.startAt, timeMax: window.endAt, items: [{ id: 'primary' }] });
  });

  it('marks a revoked grant and reports it as disconnected, never as free', async () => {
    // Stored directly (no cached access token), so getBusy must refresh and hits invalid_grant.
    await db.insert(calendarConnections).values({ userId: 'u_mark', refreshTokenEnc: seal('oauth', 'rt'), scopes: [SCOPE_FREEBUSY], status: 'connected' });
    const revoked = fakeGoogle({ 'POST https://oauth2.googleapis.com/token': () => ({ status: 400, json: { error: 'invalid_grant' } }) });
    expect((await new GoogleCalendar(db, cfg, revoked.f).getBusy('u_mark', window)).status).toBe('disconnected');
    const [row] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, 'u_mark'));
    expect(row!.status).toBe('revoked');
  });

  it('snapshots every plan member with their real status', async () => {
    const { planId } = await selectedPlan();
    const g = fakeGoogle({
      'POST https://oauth2.googleapis.com/token': tokenOk({ refresh_token: 'rt' }),
      'POST https://www.googleapis.com/calendar/v3/freeBusy': () => ({ json: { calendars: { primary: { busy: [] } } } }),
    });
    await completeConnection(db, cfg, 'u_alex', 'code', g.f);
    const out = await refreshPlanAvailability(db, new GoogleCalendar(db, cfg, g.f), planId, window);
    expect(out.map((o) => [o.userId, o.status]).sort()).toEqual([['u_alex', 'ok'], ['u_mark', 'disconnected']]);
    const snaps = await db.select().from(availabilitySnapshots);
    expect(snaps).toHaveLength(2);
    expect(snaps.every((s) => s.planId === planId && s.source === 'calendar')).toBe(true);
  });
});

describe('events', () => {
  it('creates the event once, then updates it with the same stable ID', async () => {
    const { planId, versionId } = await selectedPlan();
    let created = false;
    const g = fakeGoogle({
      'POST https://oauth2.googleapis.com/token': tokenOk({ refresh_token: 'rt' }),
      'POST https://www.googleapis.com/calendar/v3/calendars/primary/events': () => (created ? { status: 409, json: {} } : ((created = true), { json: { id: 'x' } })),
      'PUT https://www.googleapis.com/calendar/v3/calendars/primary/events/': () => ({ json: { id: 'x' } }),
    });
    await completeConnection(db, cfg, 'u_alex', 'code', g.f);
    const cal = new GoogleCalendar(db, cfg, g.f);
    const a = await cal.upsertOwnEvent('u_alex', planId, versionId);
    const b = await cal.upsertOwnEvent('u_alex', planId, versionId);
    expect(a.eventId).toBe(eventIdFor(planId, 'u_alex'));
    expect(b.eventId).toBe(a.eventId);
    expect(g.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    const posted = JSON.parse(g.calls.find((c) => c.url.endsWith('/events'))!.body);
    expect(posted).toMatchObject({ id: a.eventId, summary: 'Avengers, Alamo Drafthouse; IMAX', start: { timeZone: 'America/Chicago' } });
    expect(posted.description).toContain('TEST plan');
    expect(await db.select().from(calendarEvents)).toHaveLength(1);
  });

  it('builds a valid ICS with escaping and a stable UID', () => {
    const ics = buildIcs('uid-1@sidequest', { title: 'Movie; IMAX, 3D', startAt: '2026-10-31T00:30:00.000Z', endAt: '2026-10-31T03:30:00.000Z', timeZone: 'America/Chicago', location: null, description: 'line1\nline2' }, new Date('2026-10-25T00:00:00Z'));
    expect(ics).toContain('\r\nUID:uid-1@sidequest\r\n');
    expect(ics).toContain('DTSTART:20261031T003000Z');
    expect(ics).toContain('SUMMARY:Movie\\; IMAX\\, 3D');
    expect(ics).toContain('DESCRIPTION:line1\\nline2');
    expect(ics).not.toContain('LOCATION');
  });
});

describe('routes', () => {
  const session = (userId: string | null) => async () => userId;

  it('connect requires a session and binds a nonce cookie', async () => {
    configureCalendar({ db, getUserId: session(null), env });
    expect((await connectCalendar(new Request('http://localhost:3000/api/calendar/connect'))).status).toBe(401);
    configureCalendar({ db, getUserId: session('u_alex'), env });
    const res = await connectCalendar(new Request('http://localhost:3000/api/calendar/connect?write=1'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('accounts.google.com');
    expect(res.headers.get('set-cookie')).toMatch(/^sq_cal_nonce=.+HttpOnly/);
  });

  it('callback rejects a state issued to someone else', async () => {
    const g = fakeGoogle({ 'POST https://oauth2.googleapis.com/token': tokenOk({ refresh_token: 'rt' }) });
    const { state, nonce } = createOAuthState(cfg, 'u_alex');
    configureCalendar({ db, getUserId: session('u_mark'), env, fetch: g.f });
    const req = (s: string) => new Request(`http://localhost:3000/api/calendar/callback?code=c&state=${encodeURIComponent(s)}`, { headers: { cookie: `sq_cal_nonce=${nonce}` } });
    expect((await calendarCallback(req(state))).headers.get('location')).toBe('/settings?calendar=invalid');
    expect(g.calls).toHaveLength(0);
    configureCalendar({ db, getUserId: session('u_alex'), env, fetch: g.f });
    expect((await calendarCallback(req(state))).headers.get('location')).toBe('/settings?calendar=connected');
    expect(await db.select().from(calendarConnections)).toHaveLength(1);
  });

  it('serves ICS only to plan members and falls back to ICS without write access', async () => {
    const { planId } = await selectedPlan();
    configureCalendar({ db, getUserId: session('u_out'), env });
    expect((await planCalendarIcs(new Request('http://localhost:3000/x'), planId)).status).toBe(404);
    configureCalendar({ db, getUserId: session('u_mark'), env });
    const ics = await planCalendarIcs(new Request('http://localhost:3000/x'), planId);
    expect(ics.headers.get('content-type')).toContain('text/calendar');
    const post = await addPlanToCalendar(new Request('http://localhost:3000/x', { method: 'POST', headers: { origin: 'http://localhost:3000' } }), planId);
    expect((await post.json()).data).toEqual({ mode: 'ics', icsUrl: `/api/plans/${planId}/calendar.ics` });
    const cross = await addPlanToCalendar(new Request('http://localhost:3000/x', { method: 'POST', headers: { origin: 'http://evil.test' } }), planId);
    expect(cross.status).toBe(403);
  });
});
