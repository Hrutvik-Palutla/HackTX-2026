// Google Calendar: per-user OAuth, primary-calendar free/busy, own-calendar events, and ICS fallback.
// Each person authorizes their own calendar; nobody's token reads someone else's calendar.
// Busy intervals only, never event titles. Refresh tokens are encrypted at rest ('oauth' domain).
// Uses Google's documented REST endpoints with fetch (no SDK dependency).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { calendarConnections, calendarEvents, candidates, planOptions, planParticipants, plans, type Db } from '@hacktx/db';
import { AppError, open, seal } from '@hacktx/core';
import type { BusyResult, CalendarPort, Interval, PlanOption } from '@hacktx/contracts';

export const SCOPE_FREEBUSY = 'https://www.googleapis.com/auth/calendar.events.freebusy';
export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events.owned';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const STATE_TTL_MS = 10 * 60_000;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string; stateSecret: string };
type Fetch = typeof fetch;

export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env;
  const stateSecret = env.BETTER_AUTH_SECRET || env.APP_ENCRYPTION_KEY;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !stateSecret) {
    throw new AppError('UNRESOLVED', 'Google Calendar is not configured');
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI, stateSecret };
}

// ---------- OAuth state: signed, short-lived, bound to the account and a one-time browser nonce ----------

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (secret: string, body: string) => b64url(createHmac('sha256', secret).update(`calendar-oauth:${body}`).digest());

export function createOAuthState(cfg: GoogleConfig, userId: string, now = Date.now()) {
  const nonce = b64url(randomBytes(18));
  const body = b64url(JSON.stringify({ u: userId, n: nonce, e: now + STATE_TTL_MS }));
  return { state: `${body}.${sign(cfg.stateSecret, body)}`, nonce };
}

/** Returns the userId the state was issued to, or null if forged, expired, or not this browser's nonce. */
export function verifyOAuthState(cfg: GoogleConfig, state: string, cookieNonce: string | null, now = Date.now()): string | null {
  const [body, sig] = state.split('.');
  if (!body || !sig || !cookieNonce) return null;
  const expected = Buffer.from(sign(cfg.stateSecret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u: string; n: string; e: number };
    if (s.e < now || s.n !== cookieNonce) return null;
    return s.u;
  } catch { return null; }
}

export function authorizationUrl(cfg: GoogleConfig, state: string, opts: { write?: boolean } = {}) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: [SCOPE_FREEBUSY, ...(opts.write ? [SCOPE_EVENTS] : [])].join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true', // incremental: adding write keeps the free/busy grant
    prompt: 'consent', // ensures a refresh token is issued
    state,
  }).toString();
  return url.toString();
}

// ---------- tokens ----------

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; error?: string };

async function tokenRequest(f: Fetch, params: Record<string, string>): Promise<TokenResponse> {
  const res = await f(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    const err = new AppError('PROVIDER', `Google token request failed: ${json.error ?? res.status}`, res.status >= 500);
    (err as AppError & { oauthError?: string }).oauthError = json.error;
    throw err;
  }
  return json;
}

/** Exchange the callback code and store the encrypted refresh token. A grant without a refresh token keeps the old one. */
export async function completeConnection(db: Db, cfg: GoogleConfig, userId: string, code: string, f: Fetch = fetch) {
  const t = await tokenRequest(f, {
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code',
  });
  const granted = (t.scope ?? '').split(' ').filter(Boolean);
  const [existing] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  if (!t.refresh_token && !existing) throw new AppError('PROVIDER', 'Google did not return a refresh token; reconnect with consent');
  const scopes = [...new Set([...(existing?.status === 'connected' ? existing.scopes : []), ...granted])];
  if (!scopes.includes(SCOPE_FREEBUSY)) throw new AppError('INVALID', 'Calendar free/busy access was not granted');
  const refreshTokenEnc = t.refresh_token ? seal('oauth', t.refresh_token) : existing!.refreshTokenEnc;
  await db.insert(calendarConnections).values({ userId, refreshTokenEnc, scopes, status: 'connected' })
    .onConflictDoUpdate({ target: calendarConnections.userId, set: { refreshTokenEnc, scopes, status: 'connected', updatedAt: new Date() } });
  accessCache.set(userId, { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 });
  return { scopes };
}

/** Revoke at Google (best effort) and delete the stored token. */
export async function disconnect(db: Db, userId: string, f: Fetch = fetch) {
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  accessCache.delete(userId);
  if (!c) return;
  await f(`${REVOKE_URL}?token=${encodeURIComponent(open('oauth', c.refreshTokenEnc))}`, { method: 'POST' }).catch(() => {});
  await db.delete(calendarConnections).where(eq(calendarConnections.userId, userId));
}

export async function connectionStatus(db: Db, userId: string) {
  const [c] = await db.select({ status: calendarConnections.status, scopes: calendarConnections.scopes })
    .from(calendarConnections).where(eq(calendarConnections.userId, userId));
  return { connected: c?.status === 'connected', canWriteEvents: c?.status === 'connected' && c.scopes.includes(SCOPE_EVENTS) };
}

const accessCache = new Map<string, { token: string; until: number }>();

async function accessToken(db: Db, cfg: GoogleConfig, userId: string, f: Fetch): Promise<string | null> {
  const hit = accessCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.token;
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  if (!c || c.status !== 'connected') return null;
  try {
    const t = await tokenRequest(f, {
      refresh_token: open('oauth', c.refreshTokenEnc), client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token',
    });
    accessCache.set(userId, { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 });
    return t.access_token;
  } catch (e) {
    if ((e as { oauthError?: string }).oauthError === 'invalid_grant') { // user revoked, or the 7-day Testing-mode grant expired
      await db.update(calendarConnections).set({ status: 'revoked', updatedAt: new Date() }).where(eq(calendarConnections.userId, userId));
      return null;
    }
    throw e;
  }
}

// ---------- events and ICS ----------

export type OutingEvent = { title: string; startAt: string; endAt: string; timeZone: string; location: string | null; description: string };

/** Stable per plan+user: Google event IDs allow [a-v0-9], 5-1024 chars; hex qualifies. */
export const eventIdFor = (planId: string, userId: string) => createHash('sha256').update(`${planId}:${userId}`).digest('hex').slice(0, 40);
export const icsUidFor = (planId: string, userId: string) => `${eventIdFor(planId, userId)}@sidequest`;

/** The selected option as calendar details. Booking state is stated honestly in the description. */
export async function outingEvent(db: Db, planId: string): Promise<{ event: OutingEvent; versionId: string } | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan?.selectedOptionId) return null;
  const [opt] = await db.select().from(planOptions).where(eq(planOptions.id, plan.selectedOptionId));
  if (!opt) return null;
  const o = opt.payload as PlanOption;
  if (!o.startAt || !o.endAt) return null; // A theater suggestion is not a scheduled screening.
  const [cand] = o.candidateIds[0] ? await db.select().from(candidates).where(eq(candidates.id, o.candidateIds[0])) : [];
  const address = (cand?.payload as { address?: string | null; venueName?: string } | undefined);
  const status = plan.mode === 'test' ? 'TEST plan: nothing has been booked.'
    : plan.status === 'booked' ? 'Booked: see the group chat for the confirmation.'
    : 'Not booked yet: check the group chat before heading out.';
  return {
    versionId: opt.versionId,
    event: {
      title: o.title,
      startAt: o.startAt,
      endAt: o.endAt,
      timeZone: o.timeZone,
      location: [address?.venueName, address?.address].filter(Boolean).join(', ') || null,
      description: `${status}\nPlanned with SideQuest.`,
    },
  };
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);

export function buildIcs(uid: string, e: OutingEvent, now = new Date()) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SideQuest//HackTX//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(e.startAt)}`,
    `DTEND:${icsDate(e.endAt)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    `DESCRIPTION:${icsText(e.description)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export async function isPlanMember(db: Db, planId: string, userId: string) {
  const [p] = await db.select({ organizer: plans.organizerUserId }).from(plans).where(eq(plans.id, planId));
  if (!p) return false;
  if (p.organizer === userId) return true;
  const [m] = await db.select({ id: planParticipants.id }).from(planParticipants)
    .where(and(eq(planParticipants.planId, planId), eq(planParticipants.userId, userId)));
  return !!m;
}

// ---------- CalendarPort ----------

export class GoogleCalendar implements CalendarPort {
  constructor(private readonly db: Db, private readonly cfg: GoogleConfig, private readonly f: Fetch = fetch) {}

  /** Busy intervals from the user's own primary calendar. Never throws for a missing/failed calendar: unknown stays unknown. */
  async getBusy(userId: string, window: Interval): Promise<BusyResult> {
    const fetchedAt = new Date().toISOString();
    let token: string | null;
    try { token = await accessToken(this.db, this.cfg, userId, this.f); } catch { return { busy: [], fetchedAt, status: 'error' }; }
    if (!token) return { busy: [], fetchedAt, status: 'disconnected' };
    const res = await this.f(`${API}/freeBusy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: window.startAt, timeMax: window.endAt, items: [{ id: 'primary' }] }),
    }).catch(() => null);
    if (!res?.ok) return { busy: [], fetchedAt, status: 'error' };
    const json = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> };
    const cal = json.calendars?.primary;
    if (!cal || cal.errors?.length) return { busy: [], fetchedAt, status: 'error' };
    return {
      busy: (cal.busy ?? []).map((b) => ({ startAt: new Date(b.start).toISOString(), endAt: new Date(b.end).toISOString() })),
      fetchedAt, status: 'ok',
    };
  }

  /** Create or update this plan's event in the user's own primary calendar (stable ID, so no duplicates). */
  async upsertOwnEvent(userId: string, planId: string, versionId: string): Promise<{ eventId: string }> {
    if (!(await isPlanMember(this.db, planId, userId))) throw new AppError('NOT_FOUND', 'Not found');
    const found = await outingEvent(this.db, planId);
    if (!found) throw new AppError('UNRESOLVED', 'Plan has no selected option yet');
    if (found.versionId !== versionId) throw new AppError('STALE_PLAN', 'The selected outing changed. Reload before adding it to your calendar.');
    const { canWriteEvents } = await connectionStatus(this.db, userId);
    const token = canWriteEvents ? await accessToken(this.db, this.cfg, userId, this.f) : null;
    if (!token) throw new AppError('UNRESOLVED', 'Calendar write access is not connected');
    const id = eventIdFor(planId, userId);
    const e = found.event;
    const [existing] = await this.db.select().from(calendarEvents).where(and(eq(calendarEvents.planId, planId), eq(calendarEvents.userId, userId)));
    if (existing?.versionId === versionId && existing.syncStatus === 'synced' && existing.providerEventId) return { eventId: existing.providerEventId };
    const availability = await this.getBusy(userId, { startAt: e.startAt, endAt: e.endAt });
    if (availability.status !== 'ok') throw new AppError('UNRESOLVED', 'Calendar availability could not be rechecked. Download the calendar file and review the time.');
    if (availability.busy.some(b => Date.parse(b.startAt) < Date.parse(e.endAt) && Date.parse(b.endAt) > Date.parse(e.startAt))) throw new AppError('UNRESOLVED', 'Your calendar now has a conflict. Review the time or update the plan first.');
    const body = JSON.stringify({
      id, summary: e.title, description: e.description, ...(e.location ? { location: e.location } : {}),
      start: { dateTime: e.startAt, timeZone: e.timeZone }, end: { dateTime: e.endAt, timeZone: e.timeZone },
    });
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    let res = await this.f(`${API}/calendars/primary/events`, { method: 'POST', headers, body });
    if (res.status === 409) res = await this.f(`${API}/calendars/primary/events/${id}`, { method: 'PUT', headers, body }); // already created: update
    if (!res.ok) throw new AppError('PROVIDER', `Google event write failed (${res.status})`, res.status >= 500);
    await this.db.insert(calendarEvents).values({ planId, userId, versionId, providerEventId: id, icsUid: icsUidFor(planId, userId), syncStatus: 'synced' })
      .onConflictDoUpdate({ target: [calendarEvents.planId, calendarEvents.userId], set: { versionId, providerEventId: id, syncStatus: 'synced', updatedAt: new Date() } });
    return { eventId: id };
  }
}
