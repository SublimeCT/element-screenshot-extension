// Browser smoke-test for the landing mode pages (no extension involved).
// Run while a static server serves public/ at http://localhost:8090.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8090/landing';
const EXPECTED_STEPS = {
  region: 4, element: 4, focus: 4, fullPage: 3, custom: 8, allScrollable: 4,
};

const failedRequests = [];
const consoleErrors = [];

async function check() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // 1) Landing cards link to the right pages.
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  const links = await page.locator('.mode-link').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')));
  console.log('mode links:', links.join(', '));

  // 2) Visit each detail page; count steps + result, confirm video + sources.
  for (const [mode, n] of Object.entries(EXPECTED_STEPS)) {
    await page.goto(`${BASE}/${mode}.html`, { waitUntil: 'domcontentloaded' });
    // let i18n apply
    await page.waitForTimeout(400);
    const stepCount = await page.locator('.step-card').count();
    const resultCount = await page.locator('#result .step-fig').count();
    const videoSrcs = await page.locator('video source').evaluateAll((s) =>
      s.map((el) => el.getAttribute('src')));
    const h1 = (await page.locator('h1').first().innerText()).trim();
    const titleOk = stepCount === n && resultCount === 1 && videoSrcs.length === 1;
    console.log(`${mode.padEnd(14)} steps=${stepCount}(want ${n}) result=${resultCount} videoSources=${videoSrcs.length} h1="${h1}" ${titleOk ? '✓' : '✗'}`);
  }

  // 3) i18n switching on the region detail page (zh → en → ar incl. RTL).
  await page.goto(`${BASE}/region.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const zhTitle = await page.title();
  const zhCaption = (await page.locator('.step-cap').first().innerText()).trim();

  await page.locator('[data-lang-switch]').selectOption('en');
  await page.waitForTimeout(500);
  const enTitle = await page.title();
  const enCaption = (await page.locator('.step-cap').first().innerText()).trim();
  const dirAfterEn = await page.evaluate(() => document.documentElement.dir);

  await page.locator('[data-lang-switch]').selectOption('ar');
  await page.waitForTimeout(500);
  const dirAfterAr = await page.evaluate(() => document.documentElement.dir);
  const arTitle = await page.title();

  console.log('\ni18n:');
  console.log('  zh title:', zhTitle);
  console.log('  en title:', enTitle, '| dir:', dirAfterEn);
  console.log('  en caption differs from zh:', enCaption !== zhCaption ? '✓' : '✗ (same)');
  console.log('  ar title:', arTitle, '| dir:', dirAfterAr, dirAfterAr === 'rtl' ? '✓ rtl' : '✗ not rtl');

  // 4) Trigger lazy load on first step image and confirm it loads.
  await page.goto(`${BASE}/custom.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.locator('.step-fig img').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const naturalW = await page.locator('.step-fig img').first().evaluate((img) => img.naturalWidth);
  console.log(`\nlazy image naturalWidth: ${naturalW} ${naturalW > 0 ? '✓' : '✗'}`);

  await browser.close();
}

check().then(() => {
  console.log('\nfailed requests:', failedRequests.length ? failedRequests : 'none');
  console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');
  process.exit(failedRequests.length || consoleErrors.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
