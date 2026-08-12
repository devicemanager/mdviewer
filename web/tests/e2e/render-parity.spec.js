import { test, expect } from '@playwright/test';

test('engine renders the boot fixture with math and task list', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#content h1')).toHaveText('Web Core Boot');
  // marked 18 renders tasks as <li><input type=checkbox disabled> — no
  // task-list-item class (matches native engine output + base CSS).
  await expect(page.locator('#content input[type="checkbox"]')).toHaveCount(2);
  // KaTeX block math rendered (not left as $...$)
  await expect(page.locator('#content .katex')).toHaveCount(1);
});