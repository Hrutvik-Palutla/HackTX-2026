import { test, expect } from '@playwright/test';

test('home offers a public example before asking for a phone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Make plans. Keep the group chat.');
  await page.getByRole('link', { name: 'Try an example', exact: true }).click();
  await expect(page).toHaveURL(/\/try$/);
  await expect(page.getByLabel('Phone number')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('old preview links converge on the same interactive example', async ({ page }) => {
  for (const path of ['/plans?preview=1', '/friends?preview=1', '/login?preview=1', '/plans/friday?preview=1', '/studio?preview=1']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/try$/);
    await expect(page.getByRole('heading', { name: 'Friday after 6', exact: true })).toBeVisible();
  }
});

test('reduced motion still disables animated feedback on the example', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/try');
  const duration = await page.getByRole('button', { name: 'Choose A', exact: true }).evaluate(el => getComputedStyle(el).transitionDuration);
  expect(duration.split(',').every(value => parseFloat(value) <= 0.01)).toBe(true);
});
