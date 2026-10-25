import { test, expect } from '@playwright/test';

test('home shows the phone sign-in and all four Anatomy illustrations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plans with friends, handled.');
  await expect(page.getByText('Plans that make it out of the group chat.')).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toBeVisible();
  await expect(page.getByRole('link', { name: /example/i })).toHaveCount(0);
  const figures = page.locator('.home-figure');
  await expect(figures).toHaveCount(4);
  for (const image of await figures.all()) {
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the demo is clearly labeled, makes no API calls and awards badges once per run', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
  await page.goto('/demo');
  await expect(page).toHaveURL('/try');
  await expect(page.getByText('Demo · fictional friends · no real bookings or posts')).toBeVisible();
  for (let run = 0; run < 2; run++) {
    await page.getByRole('button', { name: /Earlier outings/ }).click();
    await page.getByRole('tab', { name: /Badges/ }).click();
    await expect(page.getByRole('button', { name: /^Out the Door\. Earned/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Again Soon\. Earned/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fresh Air\. 1 of 2/ })).toBeVisible();
    await page.getByRole('button', { name: 'Reset demo' }).click();
    await expect(page.getByRole('heading', { name: 'We’ve got a quest for you.' })).toBeVisible();
  }
  expect(api).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
