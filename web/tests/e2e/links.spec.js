import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function openFixture(page, name) {
  await page.goto('/');
  await page.setInputFiles('#file-input', {
    name,
    mimeType: 'text/markdown',
    buffer: readFileSync(join(__dirname, '../fixtures', name))
  });
}

test('external http link opens a new tab', async ({ page, context }) => {
  await openFixture(page, 'test-links.md');
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#content a[href="https://example.com"]').click()
  ]);
  expect(newPage.url()).toBe('https://example.com/');
  await newPage.close();
});

test('mailto link is routed as external (no popup possible in headless)', async ({ page }) => {
  // Stub window.open BEFORE the page loads so we can observe the router's intent.
  await page.addInitScript(() => {
    window.open = (url) => { window.__lastOpen = url; return null; };
  });
  await openFixture(page, 'test-links.md');
  await page.locator('#content a[href^="mailto:"]').click();
  await expect.poll(() => page.evaluate(() => window.__lastOpen)).toBe('mailto:test@example.com');
});

test('javascript: href is neutralized by DOMPurify (no executable link)', async ({ page }) => {
  await openFixture(page, 'test-links.md');
  let dialog = null;
  page.on('dialog', d => { dialog = d; d.dismiss(); });
  await expect(page.locator('#content a[href^="javascript:"]')).toHaveCount(0);
  // The anchor survives sanitization but its href is stripped.
  const href = await page.locator('#content a').filter({ hasText: 'Bad scheme' }).getAttribute('href');
  expect(href).toBeNull();
  await expect.poll(() => dialog).toBeNull();
});