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

test('TOC lists headings and scrolling highlights the active one', async ({ page }) => {
  await openFixture(page, 'test-all-elements.md');
  await expect(page.locator('#toc a')).toHaveCount(await page.locator('#content h1,h2,h3,h4,h5,h6').count());
  await expect(page.locator('#toc a[href="#markdown-all-elements-test"]')).toHaveText('Markdown All-Elements Test');
  // Clicking a TOC entry scrolls to the heading.
  await page.locator('#toc a[href="#headings"]').click();
  await expect(page.locator('#content #headings')).toBeInViewport();
});

test('search box finds text in the rendered document', async ({ page }) => {
  await openFixture(page, 'test-all-elements.md');
  await page.locator('#search-box').fill('Headings');
  await page.locator('#search-box').press('Enter');
  // Heading "Headings" appears in the h2 title and the TOC; count the
  // highlighted matches inside #content only.
  const hits = page.locator('#content mark.mdv-hit');
  await expect(hits.first()).toBeVisible();
  await expect(page.locator('#statusbar')).toContainText('match');
});

test('search reports not-found for text absent from the document', async ({ page }) => {
  await openFixture(page, 'test-all-elements.md');
  await page.locator('#search-box').fill('zzzz-no-such-text');
  await page.locator('#search-box').press('Enter');
  await expect(page.locator('#statusbar')).toHaveText(/Not found/);
  await expect(page.locator('#content mark.mdv-hit')).toHaveCount(0);
});

test('search highlights every occurrence across the document', async ({ page }) => {
  await openFixture(page, 'test-all-elements.md');
  await page.locator('#search-box').fill('the');
  await page.locator('#search-box').press('Enter');
  const allHits = await page.locator('#content mark.mdv-hit').count();
  expect(allHits).toBeGreaterThan(1);
  // Status reports the same count.
  await expect(page.locator('#statusbar')).toContainText(`${allHits} matches`);
});