import { test, expect } from '@playwright/test';

test('visitors can vote, confirm, try activities and repair a time without an account or API calls', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/**', route => { calls.push(route.request().url()); return route.fulfill({ status: 401, json: { error: 'Example must not need APIs' } }); });
  await page.goto('/try');
  await expect(page.getByLabel('Phone number')).toHaveCount(0);
  const confirm = page.getByRole('button', { name: 'Confirm this plan', exact: true }); await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Choose B', exact: true }).click();
  await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByText('Confirmed: Tacos + live music.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Things to do', exact: true }).click();
  await page.getByLabel('We did this').first().click(); await expect(page.getByText('1 of 5 complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Time', exact: true }).click();
  await page.getByRole('combobox', { name: 'Start time', exact: true }).selectOption('18:30');
  await expect(page.getByText('Mel can’t make 6:30. Try 7 PM.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Places', exact: true }).click();
  await expect(page.getByText('0 of 3 have voted.', { exact: true })).toBeVisible(); await expect(confirm).toBeDisabled();
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('example chat commands change only the local example and identify unsupported replies', async ({ page }) => {
  await page.goto('/try');
  await page.getByLabel('Message the example group', { exact: true }).fill('vote for C');
  await page.getByRole('button', { name: 'Send example message' }).click();
  await expect(page.getByLabel('Example group messages')).toContainText('Marked option C as your example vote.');
  await page.getByLabel('Message the example group', { exact: true }).fill('Can you book a restaurant?');
  await page.getByRole('button', { name: 'Send example message' }).click();
  await expect(page.getByLabel('Example group messages')).toContainText('This example supports');
  await expect(page.getByRole('link', { name: 'Use with my friends', exact: true })).toHaveAttribute('href', '/signup?next=/plans');
});
