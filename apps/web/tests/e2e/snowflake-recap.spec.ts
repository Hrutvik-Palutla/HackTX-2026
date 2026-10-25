import { test, expect } from '@playwright/test';

test('recap sends only selected group IDs after consent and keeps evidence links', async ({ page }) => {
  let calls = 0;
  const id = '11111111-1111-4111-8111-111111111111';
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: { user: { id: 'own', name: 'Alex' }, session: { id: 's' } } }));
  await page.route('**/api/me', route => route.fulfill({ json: { data: { id: 'own', name: 'Alex', interests: [], city: { label: 'Austin, Texas, United States' }, onboardingComplete: true } } }));
  await page.route('**/api/plans/friday', route => route.fulfill({ json: { data: { id: 'friday', request: 'Friday', status: 'voting', revision: 1, mode: 'test', participants: [], options: [], votes: [], sources: [] } } }));
  await page.route('**/api/plans/friday/chat', route => route.fulfill({ json: { data: { linkedGroupChat: false, messages: [{ id, scope: 'group', from: { id: 'own', name: 'Alex' }, text: 'Could we start after 7 pm?', at: '2026-10-25T10:00:00Z', source: 'website', deliveryStatus: null }, { id: 'private', scope: 'private', from: 'agent', text: 'My private budget', at: '2026-10-25T10:00:00Z', source: 'website', deliveryStatus: null }] } } }));
  await page.route('**/api/plans/friday/chat/recap', route => {
    calls++; expect(route.request().postDataJSON()).toEqual({ consent: true, messageIds: [id] });
    return route.fulfill({ json: { data: { model: 'test-cortex', generatedAt: '2026-10-25T10:00:00Z', items: [{ kind: 'concern', text: 'A later start was requested.', evidence: [{ messageId: id, quote: 'after 7 pm' }] }] } } });
  });
  await page.goto('/plans/friday');
  await page.getByText('Catch up on the conversation', { exact: true }).click();
  const panel = page.locator('.chat-recap');
  await expect(panel).not.toContainText('My private budget');
  await expect(panel.getByRole('button')).toBeDisabled();
  await panel.getByLabel('Message 1: Could we start after 7 pm?').check();
  await expect(panel.getByRole('button')).toBeDisabled(); expect(calls).toBe(0);
  await panel.getByLabel('Send the selected message text', { exact: false }).check();
  await panel.getByRole('button', { name: 'Summarize 1 selected messages' }).click();
  await expect(panel).toContainText('A later start was requested.');
  await expect(panel.getByRole('link', { name: '“after 7 pm”' })).toHaveAttribute('href', `#chat-message-${id}`);
  await expect(page.locator(`#chat-message-${id}`)).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/snowflake-recap-${test.info().project.name}.png`, fullPage: true });
});
