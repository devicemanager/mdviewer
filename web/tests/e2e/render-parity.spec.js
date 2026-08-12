import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = name => readFileSync(join(__dirname, '../fixtures', name), 'utf8');

test('boot smoke: chrome loads and shows empty state before any file', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#toolbar')).toBeVisible();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#content h1')).toHaveCount(0);
});

test('engine renders math and task list from a fixture', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file-input', {
    name: 'boot.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Web Core Boot\n\nHello from the shared web core.\n\n- [ ] A task\n- [x] Done\n\n$$x^2$$')
  });
  await expect(page.locator('#content h1')).toHaveText('Web Core Boot');
  // marked 18 renders tasks as <li><input type=checkbox disabled> — no
  // task-list-item class (matches native engine output + base CSS).
  await expect(page.locator('#content input[type="checkbox"]')).toHaveCount(2);
  // KaTeX block math rendered (not left as $...$)
  await expect(page.locator('#content .katex')).toHaveCount(1);
});

test('renders a file opened through the file input', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file-input', {
    name: 'test-all-elements.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(fixture('test-all-elements.md'))
  });
  await expect(page.locator('#content h1').first()).toHaveText('Markdown All-Elements Test');
});

test('renders a markdown file dropped onto the window', async ({ page }) => {
  await page.goto('/');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.evaluateHandle(dt => {
    dt.items.add(new File([`# Dropped\n\nHello.`], 'dropped.md', { type: 'text/markdown' }));
  }, dataTransfer);
  await page.dispatchEvent('body', 'drop', { dataTransfer });
  await expect(page.locator('#content h1')).toHaveText('Dropped');
});