import { test, expect } from '@playwright/test';

test('home shows the phone sign-in and all four Anatomy illustrations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plans with friends, handled.');
  await expect(page.getByLabel('Mobile number')).toBeVisible();
  await expect(page.getByRole('link', { name: /example/i })).toHaveCount(0);
  const figures = page.locator('.home-figure');
  await expect(figures).toHaveCount(4);
  for (const image of await figures.all()) {
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('old mock example URLs return to the real home page', async ({ page }) => {
  for (const path of ['/try', '/demo']) {
    await page.goto(path);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Plans with friends, handled.' })).toBeVisible();
  }
});
