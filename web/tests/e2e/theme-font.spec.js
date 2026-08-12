import { test, expect } from '@playwright/test';

test('theme toggle swaps stylesheet and persists across reload', async ({ page }) => {
  await page.goto('/');
  const initialHref = await page.locator('#theme-css').getAttribute('href');
  await page.locator('#btn-theme').click();
  const after = await page.locator('#theme-css').getAttribute('href');
  expect(after).not.toBe(initialHref);
  await page.reload();
  expect(await page.locator('#theme-css').getAttribute('href')).toBe(after);
});

test('font-size slider persists across reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#font-size').evaluate(el => { el.value = 20; el.dispatchEvent(new Event('input')); });
  await page.reload();
  await expect(page.locator('#font-size')).toHaveValue('20');
  const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size').trim());
  expect(rootFont).toBe('20px');
});