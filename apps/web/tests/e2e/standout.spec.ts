import { test, expect, type Page, type Route } from '@playwright/test';

test('voice uploads normalize a normal 22050Hz recording into supported mono 16000Hz WAV', async ({ page }) => {
  let sampleRate = 0;
  await app(page, { 'POST /api/drops/voice': async route => {
    const payload = route.request().postDataBuffer()!; const riff = payload.indexOf(Buffer.from('RIFF'));
    sampleRate = payload.readUInt32LE(riff + 24);
    await route.fulfill({ json: { data: { text: 'I want to try stargazing' } } });
  } });
  const wave = Buffer.alloc(44 + 22050 * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(22050, 24); wave.writeUInt32LE(44100, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
  await page.goto('/plans'); await page.getByText('Add a photo or voice note', { exact: true }).click();
  await page.getByLabel('Voice note (under 2 minutes and 8 MB)').setInputFiles({ name: 'note.wav', mimeType: 'audio/wav', buffer: wave });
  await expect(page.getByLabel('Something you enjoy or want to try')).toHaveValue('I want to try stargazing');
  expect(sampleRate).toBe(16000);
});

const city = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };
const profile = { id: 'own', name: 'Alex', phoneE164: '+15125550100', phoneVerified: true, avatarUrl: null, city, interests: [], calendarConnected: false, onboardingComplete: true };
const ground = { id: '11111111-1111-4111-8111-111111111111', theme: 'Night-sky photo walk', searchQuery: 'Austin stargazing photography walk', why: [{ id: 'chip1', name: 'Mel', ownerId: 'mel', label: 'Night photography', evidence: 'I love night photography', kind: 'interest', confirmed: true, shared: true }] };
test('old demo link opens the no-account example', async ({ page }) => {
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/try$/);
  await expect(page.getByRole('heading', {name: 'Friday after 6', exact: true})).toBeVisible();
  await expect(page.getByText('Example group. Changes stay in this browser.', {exact:false})).toBeVisible();
});
async function app(page: Page, overrides: Record<string, (route: Route) => Promise<void>>) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const custom = overrides[`${route.request().method()} ${path}`];
    if (custom) return custom(route);
    if (path === '/api/auth/get-session') return route.fulfill({ json: { user: { id: profile.id, name: profile.name }, session: { id: 'test-session' } } });
    const defaults: Record<string, unknown> = { '/api/me': profile, '/api/friends': { friends: [{ id: 'mel', name: 'Mel', avatarUrl: null }], requests: [] }, '/api/plans': [], '/api/drops': [], '/api/studio/runs': [], '/api/plans/p/messages': [], '/api/plans/p/chat': {messages: [], linkedGroupChat: false} };
    return route.fulfill({ status: path in defaults ? 200 : 404, json: path in defaults ? { data: defaults[path] } : { error: { code: 'NOT_FOUND', message: 'Not found', retryable: false }, requestId: 'test' } });
  });
}

test('interest extraction remains private until the owner confirms and saves sharing', async ({ page }) => {
  let saved: any;
  const drop = { id: 'drop1', note: 'I love stargazing', url: null, chips: [{ id: 'chip1', label: 'Stargazing', evidence: 'I love stargazing', kind: 'interest', confirmed: false, shared: false }] };
  await app(page, { 'POST /api/drops': async r => r.fulfill({ json: { data: drop } }), 'PATCH /api/drops/drop1': async r => { saved = r.request().postDataJSON(); await r.fulfill({ json: { data: { ...drop, ...saved } } }); } });
  await page.goto('/plans');
  await page.getByLabel('Something you enjoy or want to try').fill(drop.note);
  await page.getByRole('button', { name: 'Find my interests', exact: true }).click();
  const sharing = page.getByLabel('Let my connected friends use this interest and quote in their group plans');
  await expect(sharing).toBeDisabled(); await expect(sharing).not.toBeChecked();
  await page.getByLabel('This describes me').check(); await sharing.check();
  await page.getByRole('button', { name: 'Save sharing choices' }).click();
  await expect(page.getByRole('status')).toContainText('Sharing choices saved');
  expect(saved.chips[0]).toMatchObject({ id: 'chip1', confirmed: true, shared: true });
});

test('common ground displays evidence and is bound to the created plan request', async ({ page }) => {
  let created: any;
  await app(page, { 'POST /api/common-ground': async r => r.fulfill({ json: { data: ground } }), 'POST /api/plans': async r => { created = r.request().postDataJSON(); await r.fulfill({ json: { data: { id: 'p' } } }); } });
  await page.goto('/plans'); await page.getByLabel('Mel', { exact: true }).check();
  await page.getByRole('button', { name: 'Find ideas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Night-sky photo walk', exact: true })).toBeVisible();
  await expect(page.getByText('“I love night photography”')).toBeVisible();
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  await expect.poll(() => created?.commonGroundId).toBe(ground.id);
  expect(created.participantUserIds).toEqual(['mel']);
});

test('Studio saves a new recipe version with edited instructions and limits', async ({ page }) => {
  let recipe = { id: 'local-outing', version: 1, model: 'muse-spark-1.3', systemInstruction: 'Use grounded options.', allowedTools: ['read_plan'], limits: { maxTurns: 4, maxTools: 4, maxSearches: 4 }, outputSchemaVersion: 1 };
  let saved: any;
  await app(page, { 'GET /api/studio/templates': async r => r.fulfill({ json: { data: [recipe] } }), 'PUT /api/studio/templates/local-outing': async r => { saved = r.request().postDataJSON(); recipe = { ...recipe, ...saved, version: 2 }; await r.fulfill({ json: { data: recipe } }); } });
  await page.goto('/studio'); await page.locator('summary').filter({ hasText: 'local-outing' }).click();
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Find surprising grounded outdoor outings.');
  await page.getByRole('spinbutton', { name: 'maxSearches', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save new recipe version' }).click();
  await expect(page.locator('summary').filter({ hasText: 'local-outing' })).toContainText('version 2');
  expect(saved).toMatchObject({ expectedVersion: 1, systemInstruction: 'Find surprising grounded outdoor outings.', limits: { maxSearches: 1 } });
});

test('quest completion is shown as shared persistent progress', async ({ page }) => {
  let quest = { id: 'q', title: 'Night explorers', runId: 'r', challenges: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `Challenge ${i}`, kind: i < 3 ? 'photo' : 'riddle', challenge: 'Find a pattern together', hint: 'Look around', completedBy: null as string | null, completedAt: null as string | null })) };
  await app(page, { 'GET /api/plans/p': async r => r.fulfill({ json: { data: { id: 'p', request: 'Night walk', status: 'selected', mode: 'test', revision: 0, activeVersionId: 'v', options: [], participants: [{ id: 'own', name: 'Alex', avatarUrl: null }], votes: [], sources: [] } } }), 'GET /api/plans/p/quest': async r => r.fulfill({ json: { data: quest } }), 'GET /api/plans/p/common-ground': async r => r.fulfill({ json: { data: ground } }), 'PATCH /api/plans/p/quest': async r => { const b = r.request().postDataJSON(); quest = { ...quest, challenges: quest.challenges.map(c => c.id === b.challengeId ? { ...c, completedBy: 'own', completedAt: '2026-10-25T05:00:00Z' } : c) }; await r.fulfill({ json: { data: quest } }); } });
  await page.goto('/plans/p'); await page.getByText('Photo challenges and riddles (optional)', {exact:true}).click(); await expect(page.getByText('0 / 5 complete')).toBeVisible();
  await page.getByLabel('We did this').first().click();
  await expect(page.getByText('1 / 5 complete')).toBeVisible(); await expect(page.getByLabel('Completed by you')).toBeChecked();
});

test('the plan shows linked chat, keeps private notes out of the group and requires an explicit send destination', async ({ page }) => {
  let posted: any;
  const chat = { linkedGroupChat: true, messages: [{ id: 'one', scope: 'group', from: { id: 'mel', name: 'Mel' }, text: 'Hello from Messages', at: '2026-10-25T05:00:00Z', source: 'messages', deliveryStatus: null }, { id: 'private', scope: 'private', from: { id: 'own', name: 'Alex' }, text: 'Private note must not appear in group', at: '2026-10-25T05:00:00Z', source: 'website', deliveryStatus: null }] };
  await app(page, { 'GET /api/plans/p': async r => r.fulfill({ json: { data: { id: 'p', request: 'Friday plan', status: 'voting', mode: 'test', revision: 0, activeVersionId: 'v', options: [], participants: [], votes: [], sources: [] } } }), 'GET /api/plans/p/chat': async r => r.fulfill({ json: { data: chat } }), 'POST /api/plans/p/messages': async r => { posted = r.request().postDataJSON(); await r.fulfill({ json: { data: { messageId: 'new' } } }); } });
  await page.goto('/plans/p');
  await expect(page.getByLabel('Group messages')).toContainText('Hello from Messages');
  await expect(page.getByText('Private note must not appear in group')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Website', exact: true })).toBeChecked();
  await page.getByLabel('Message the group', { exact: true }).fill('Sid, move it to 7');
  await page.getByRole('radio', { name: 'Linked Messages group', exact: true }).check();
  await page.getByRole('button', { name: 'Send to linked group', exact: true }).click();
  await expect.poll(() => posted?.destination).toBe('linked_chat'); expect(posted.scope).toBe('group');
  await expect(page.getByText('Queued for the linked Messages group.', { exact: true })).toBeVisible();
});
