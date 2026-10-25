import { test, expect, type Page, type Route } from '@playwright/test';

const city = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };
const profile = { id: 'own', name: 'Alex', phoneE164: '+15125550100', phoneVerified: true, avatarUrl: null, city, interests: [], calendarConnected: false, onboardingComplete: true };
const people = [{ id: 'own', name: 'Alex', avatarUrl: null }, { id: 'mel', name: 'Mel', avatarUrl: null }];
const option = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, versionId: 'v', label, title: `Option ${label} place`, candidateIds: [id], startAt: null, endAt: null, timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown', fit: 'needs_clarification', uncertainties: [], publicExplanation: '', sourceIds: [], ...extra });
const plan = {
  id: 'p', request: 'Friday plan', status: 'voting', mode: 'live', revision: 3, timeZone: 'America/Chicago', participants: people, activeVersionId: 'v', decision: null,
  options: [option('a', 'A', { startAt: '2026-10-31T02:15:00Z', estimatedPerPerson: { amountMinor: 1499, currency: 'USD' }, priceKind: 'listed', fit: 'fits_known_constraints', sourceIds: ['s1'] }), option('b', 'B', { uncertainties: ['Start time not listed'], sourceIds: ['s2'] })],
  votes: [{ userId: 'mel', versionId: 'v', acceptableOptionIds: ['a'], favoriteOptionId: 'a', noneAcceptable: false }],
  sources: [{ id: 's1', url: 'https://drafthouse.com/austin', title: 'Showtimes', fetchedAt: '2026-10-25T13:05:00Z' }, { id: 's2', url: 'javascript:alert(1)', title: 'Unsafe' }],
};
async function app(page: Page, overrides: Record<string, (route: Route) => Promise<void>>, data: Record<string, unknown> = {}) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const custom = overrides[`${route.request().method()} ${path}`];
    if (custom) return custom(route);
    if (path === '/api/auth/get-session') return route.fulfill({ json: { user: { id: 'own', name: 'Alex' }, session: { id: 's' } } });
    const defaults: Record<string, unknown> = { '/api/me': profile, '/api/plans/p': plan, '/api/plans/p/chat': { linkedGroupChat: false, messages: [] }, ...data };
    return route.fulfill(path in defaults ? { json: { data: defaults[path] } } : { status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found', retryable: false }, requestId: 't' } });
  });
}

test('options show sources beside each option, explicit unknowns and a truthful tally', async ({ page }) => {
  let vote: any;
  await app(page, { 'PUT /api/plans/p/vote': async r => { vote = r.request().postDataJSON(); await r.fulfill({ json: { data: {} } }); } });
  await page.goto('/plans/p');
  const a = page.getByRole('article', { name: /Option A/ });
  await expect(a.getByRole('link', { name: /drafthouse\.com/ })).toHaveAttribute('href', 'https://drafthouse.com/austin');
  await expect(a).toContainText('$14.99');
  await expect(a).toContainText('listed price');
  await expect(a).toContainText('1 of 2 can do this');
  const b = page.getByRole('article', { name: /Option B/ });
  await expect(b).toContainText('Time unknown');
  await expect(b).toContainText('price unknown');
  await expect(b).toContainText('Start time not listed');
  await expect(b.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Your vote is needed')).toBeVisible();
  await page.getByLabel('A. Option A place').check();
  await page.getByLabel('My favorite').first().check();
  await page.getByRole('button', { name: 'Save vote' }).click();
  await expect.poll(() => vote).toEqual({ versionId: 'v', acceptableOptionIds: ['a'], favoriteOptionId: 'a', noneAcceptable: false });
});

test('agreed plan offers own-calendar add and ICS download without claiming a reservation', async ({ page }) => {
  let adds = 0;
  const agreed = { ...plan, status: 'selected', decision: { optionId: 'a', attendeeUserIds: ['own', 'mel'], recordedAt: '2026-10-25T14:00:00Z' } };
  await app(page, { 'POST /api/plans/p/calendar': async r => { adds++; await r.fulfill({ json: { data: { mode: 'ics', icsUrl: '/api/plans/p/calendar.ics' } } }); } }, { '/api/plans/p': agreed, '/api/plans/p/quest': null, '/api/plans/p/common-ground': null });
  await page.goto('/plans/p');
  const card = page.locator('#agreed');
  await expect(card).toContainText('Option A place');
  await expect(card).toContainText('Alex, Mel');
  await expect(card).toContainText('doesn’t reserve the venue');
  await expect(card.getByRole('link', { name: 'Download calendar file' })).toHaveAttribute('href', '/api/plans/p/calendar.ics');
  expect(adds).toBe(0);
  await card.getByRole('button', { name: 'Add to my calendar' }).click();
  await expect(card.getByRole('status')).toContainText('isn’t connected for adding events');
  expect(adds).toBe(1);
});

test('manual availability is saved privately as UTC intervals in the plan time zone', async ({ page }) => {
  let saved: any;
  await app(page, { 'PUT /api/plans/p/private': async r => { saved = r.request().postDataJSON(); await r.fulfill({ json: { data: { id: 'f' } } }); } }, { '/api/plans/p/private': { ownerUserId: 'own', facts: [], messages: [] } });
  await page.goto('/plans/p/private');
  await page.getByLabel('Day', { exact: true }).fill('2026-10-30');
  await page.getByLabel('From', { exact: true }).fill('19:00');
  await page.getByLabel('To', { exact: true }).fill('22:30');
  await page.getByRole('button', { name: 'Save my times' }).click();
  await expect.poll(() => saved).toBeTruthy();
  expect(saved).toEqual({ expectedRevision: 3, fact: { kind: 'availability', value: {
    window: { startAt: '2026-10-30T05:00:00Z', endAt: '2026-10-31T05:00:00Z' },
    available: [{ startAt: '2026-10-31T00:00:00Z', endAt: '2026-10-31T03:30:00Z' }], unavailable: [], certainty: 'explicit' } } });
});

test('chat announces only messages that arrive after the first load', async ({ page }) => {
  const first = { id: 'm1', scope: 'group', from: { id: 'mel', name: 'Mel' }, text: 'Old message', at: '2026-10-25T13:00:00Z', source: 'messages', deliveryStatus: null };
  let messages = [first];
  await app(page, { 'GET /api/plans/p/chat': async r => r.fulfill({ json: { data: { linkedGroupChat: false, messages } } }) });
  await page.goto('/plans/p');
  await expect(page.getByLabel('Group messages')).toContainText('Old message');
  const live = page.locator('[aria-live="polite"]');
  await expect(live).toHaveText('');
  messages = [first, { ...first, id: 'm2', from: 'agent' as never, text: 'New options are ready' }];
  await expect(live).toHaveText('Sid: New options are ready', { timeout: 8000 });
});
