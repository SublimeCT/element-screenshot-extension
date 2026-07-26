// Standalone demo recorder for the 6 capture modes.
//
// This script is fully isolated from the test suite:
//   - It does NOT import from or modify tests/, fixtures, or any spec file.
//   - It only READS the prebuilt e2e artifact (dist/chrome-mv3-e2e) and the
//     WXT unlisted test pages it ships (test-simple.html / test-complex.html).
//   - All output (screenshots, videos, downloads) goes under ./demo/.
//
// Run with:  node scripts/record-modes.mjs
// Prereq:    pnpm build:e2e   (so dist/chrome-mv3-e2e is fresh)

import { chromium, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve('.');
const EXTENSION_PATH = path.join(ROOT, 'dist/chrome-mv3-e2e');
const OUT = path.join(ROOT, 'demo');
const SHOTS = path.join(OUT, 'screenshots');
const VIDEOS = path.join(OUT, 'videos');
const DOWNLOADS = path.join(OUT, 'downloads');
const RAW_VIDEOS = path.join(OUT, '_raw_videos'); // transient; deleted at the end

// Screenshots are captured at the viewport size, so this drives both the
// screenshot dimensions (1280x800) and the recorded video (same size, to keep
// the video framing identical to the step screenshots without distortion).
const VIEWPORT = { width: 1280, height: 800 };
// Delay between every visible step so the recording is watchable.
const STEP_MS = 750;
const CAPTURE_MS = 900;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Playwright's chromium records WebM; we transcode to MP4 (H.264) for universal
// browser playback (incl. Safari/iOS) and discard the WebM intermediate.
async function transcodeToMp4(srcWebm, destMp4) {
  const { stderr } = await execFileAsync('ffmpeg', [
    '-y', '-i', srcWebm,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    destMp4,
  ], { maxBuffer: 1 << 26 });
  if (stderr) process.stderr.write(stderr);
}

// Mirror of tests/e2e/extension.spec.ts helpers, kept self-contained here so
// nothing in tests/ is touched.
async function startPicker(context, targetPage, extensionId, mode) {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('h1').first().waitFor();
    await popup.locator(`[data-mode="${mode}"]`).click();
    await delay(STEP_MS);
    await targetPage.bringToFront();
    await popup.locator('#start-pick').click();
  } finally {
    await popup.close();
  }
}

function workflowHost(page) {
  return page.locator('#element-shot-workflow-host');
}

async function clickWorkflow(page, selector) {
  await workflowHost(page).locator(selector).click();
}

async function waitForWorkflow(page, text) {
  const host = workflowHost(page);
  await host.waitFor({ state: 'attached' });
  for (const sel of ['[data-select]', '[data-edit]', '[data-hide]', '[data-capture]']) {
    await host.locator(sel).waitFor({ state: 'visible' });
  }
  // The toolbar renders inside a shadow root, so use Playwright's text matcher
  // which pierces shadow boundaries (host.textContent would be empty).
  if (text) {
    await expect(host).toContainText(text, { timeout: 8000 });
  }
}

async function shot(page, dir, name) {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

// Trigger capture and wait for the resulting download, returning the Download.
async function captureDownload(page) {
  const downloadPromise = page.waitForEvent('download');
  await clickWorkflow(page, '[data-capture]');
  return downloadPromise;
}

async function saveDownload(download, mode, label) {
  const suggested = download.suggestedFilename();
  const ext = path.extname(suggested) || '.png';
  const dest = path.join(DOWNLOADS, `${mode}-${label}${ext}`);
  await download.saveAs(dest);
  return dest;
}

// Show the captured image in-page by navigating to the saved file, then take a
// full-page screenshot so the whole result is visible (Chrome scales a large
// standalone image to fit the viewport).
async function showResult(page, dir, filePath) {
  await page.goto('file://' + filePath);
  await page.waitForLoadState('domcontentloaded');
  await delay(STEP_MS);
  return shot(page, dir, '05-result');
}

// ---------------------------------------------------------------------------
// Per-mode flows. Each returns the list of screenshot files it produced.
// ---------------------------------------------------------------------------

async function modeRegion(context, page, extensionId, dir) {
  await page.goto(`chrome-extension://${extensionId}/test-simple.html`);
  await page.locator('html[data-fixture-ready="true"]').waitFor();
  await delay(STEP_MS);
  await shot(page, dir, '01-page-loaded');

  await startPicker(context, page, extensionId, 'region');
  await waitForWorkflow(page, '请选择一个截图区域');
  await delay(STEP_MS);
  await shot(page, dir, '02-toolbar');

  // Region mode uses the nearest scrollable ancestor → clicking inside
  // #simple-target locks onto #simple-target itself (a scroll container).
  await page.locator('#simple-target').click({ position: { x: 30, y: 30 } });
  await waitForWorkflow(page, 'section#simple-target');
  await delay(STEP_MS);
  await shot(page, dir, '03-highlight');

  const download = await captureDownload(page);
  await delay(CAPTURE_MS);
  const saved = await saveDownload(await download, 'region', 'capture');
  await shot(page, dir, '04-captured');
  await showResult(page, dir, saved);
}

async function modeElement(context, page, extensionId, dir) {
  await page.goto(`chrome-extension://${extensionId}/test-simple.html`);
  await page.locator('html[data-fixture-ready="true"]').waitFor();
  await delay(STEP_MS);
  await shot(page, dir, '01-page-loaded');

  await startPicker(context, page, extensionId, 'element');
  await waitForWorkflow(page, '请选择一个截图元素');
  await delay(STEP_MS);
  await shot(page, dir, '02-toolbar');

  // Element mode keeps the exact clicked node and scrolls its scroll parent.
  await page.locator('#simple-target .row').first().click();
  await waitForWorkflow(page, 'div.row');
  await delay(STEP_MS);
  await shot(page, dir, '03-highlight');

  const download = await captureDownload(page);
  await delay(CAPTURE_MS);
  const saved = await saveDownload(await download, 'element', 'capture');
  await shot(page, dir, '04-captured');
  await showResult(page, dir, saved);
}

async function modeFocus(context, page, extensionId, dir) {
  await page.goto(`chrome-extension://${extensionId}/test-simple.html`);
  await page.locator('html[data-fixture-ready="true"]').waitFor();
  await delay(STEP_MS);

  // Inject a tall target wrapped in height/overflow-constraining ancestors,
  // identical in spirit to the focus scenario in the spec.
  await page.evaluate(() => {
    const main = document.querySelector('main');
    const outer = document.createElement('div');
    outer.id = 'focus-outer';
    outer.style.cssText = 'height:180px; overflow:hidden; border:3px solid #263c73; margin-top:24px;';
    const middle = document.createElement('div');
    middle.id = 'focus-middle';
    middle.style.cssText = 'height:140px; overflow-y:auto;';
    const target = document.createElement('article');
    target.id = 'focus-target';
    target.style.cssText =
      'width:320px; height:1200px; overflow:visible; background:linear-gradient(#f9d66d 0 25%,#b9dfd0 25% 50%,#f6a58d 50% 75%,#263c73 75%);';
    target.innerHTML =
      '<h2 style="font:700 28px/1 Georgia; color:#18211d; margin:24px">Focus target</h2>';
    middle.append(target);
    outer.append(middle);
    main?.append(outer);
  });
  await delay(STEP_MS);
  await shot(page, dir, '01-page-loaded');

  await startPicker(context, page, extensionId, 'focus');
  await waitForWorkflow(page, '请选择一个截图元素');
  await delay(STEP_MS);
  await shot(page, dir, '02-toolbar');

  // #focus-target lives inside overflow:hidden / overflow-y:auto ancestors, so
  // a real pointer click is intercepted by overlapping siblings. Dispatch the
  // click event directly (same approach as the focus scenario in the spec).
  await page.locator('#focus-target').dispatchEvent('click');
  await waitForWorkflow(page, 'article#focus-target');
  await delay(STEP_MS);
  await shot(page, dir, '03-highlight');

  const download = await captureDownload(page);
  await delay(CAPTURE_MS);
  const saved = await saveDownload(await download, 'focus', 'capture');
  await shot(page, dir, '04-captured');
  await showResult(page, dir, saved);
}

async function modeFullPage(context, page, extensionId, dir) {
  await page.goto(`chrome-extension://${extensionId}/test-simple.html`);
  await page.locator('html[data-fixture-ready="true"]').waitFor();
  await delay(STEP_MS);
  await shot(page, dir, '01-page-loaded');

  await startPicker(context, page, extensionId, 'fullPage');
  await waitForWorkflow(page);
  await delay(STEP_MS);
  await shot(page, dir, '02-toolbar-root-highlight');

  const download = await captureDownload(page);
  await delay(CAPTURE_MS + 400); // full page stitches multiple frames
  const saved = await saveDownload(await download, 'fullPage', 'capture');
  await shot(page, dir, '03-captured');
  await showResult(page, dir, saved);
}

async function modeCustom(context, page, extensionId, dir) {
  await page.goto(`chrome-extension://${extensionId}/test-simple.html`);
  await page.locator('html[data-fixture-ready="true"]').waitFor();
  await delay(STEP_MS);
  await shot(page, dir, '01-page-loaded');

  await startPicker(context, page, extensionId, 'custom');
  await waitForWorkflow(page, '整页');
  await delay(STEP_MS);
  await shot(page, dir, '02-toolbar');

  // Re-select the scroll container for a tidy manual-scroll demo.
  await page.locator('#simple-target').click({ position: { x: 30, y: 30 } });
  await waitForWorkflow(page, 'section#simple-target');
  await delay(STEP_MS);
  await shot(page, dir, '03-highlight');

  // Confirm → enters manual mode; toolbar disappears, target gets an outline.
  const downloadPromise = page.waitForEvent('download');
  await clickWorkflow(page, '[data-capture]');
  await workflowHost(page).waitFor({ state: 'detached' });
  await delay(STEP_MS);
  await shot(page, dir, '04-manual-mode');

  // Scroll the target step by step; each stop appends a frame to the video.
  const target = page.locator('#simple-target');
  for (const [i, top] of [80, 176, 272].entries()) {
    await target.evaluate((el, v) => {
      el.scrollTop = v;
    }, top);
    await delay(CAPTURE_MS);
    await shot(page, dir, `05-scroll-${i + 1}`);
  }

  // End manual capture with any key → triggers the stitched download.
  await page.keyboard.press('KeyQ');
  const download = await downloadPromise;
  const saved = await saveDownload(download, 'custom', 'capture');
  await shot(page, dir, '06-captured');
  await showResult(page, dir, saved);
}

async function modeAllScrollable(context, page, extensionId, dir) {
  await page.goto(`chrome-extension://${extensionId}/test-simple.html`);
  await page.locator('html[data-fixture-ready="true"]').waitFor();
  await delay(STEP_MS);
  await shot(page, dir, '01-page-loaded');

  await startPicker(context, page, extensionId, 'allScrollable');
  await waitForWorkflow(page, '已选');
  await delay(STEP_MS);
  await shot(page, dir, '02-multi-highlight');

  // Deselect one candidate to show the toggle interaction in the recording.
  await page.locator('#secondary-scroll-target .secondary-row').first().click();
  await delay(STEP_MS);
  await shot(page, dir, '03-after-deselect');

  const download = await captureDownload(page);
  await delay(CAPTURE_MS + 600); // serial capture of each scrollable element
  const saved = await saveDownload(await download, 'allScrollable', 'capture');
  await shot(page, dir, '04-captured');
  // ZIP result — nothing to render inline; screenshot the restored page.
  await delay(STEP_MS);
  await shot(page, dir, '05-final-page');
  return saved;
}

const MODES = [
  { key: '01-region', fn: modeRegion, label: '区域截图 (region)' },
  { key: '02-element', fn: modeElement, label: '元素截图 (element)' },
  { key: '03-focus', fn: modeFocus, label: '聚焦截图 (focus)' },
  { key: '04-fullPage', fn: modeFullPage, label: '整页截图 (fullPage)' },
  { key: '05-custom', fn: modeCustom, label: '手动滚动截图 (custom)' },
  { key: '06-allScrollable', fn: modeAllScrollable, label: '批量截图 (allScrollable)' },
];

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });
  await mkdir(VIDEOS, { recursive: true });
  await mkdir(DOWNLOADS, { recursive: true });
  await mkdir(RAW_VIDEOS, { recursive: true });

  const context = await chromium.launchPersistentContext('', {
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--force-device-scale-factor=1',
    ],
    channel: 'chromium',
    deviceScaleFactor: 1,
    headless: false,
    locale: 'zh-CN',
    recordVideo: { dir: RAW_VIDEOS, size: VIEWPORT },
    viewport: VIEWPORT,
  });

  let extensionId;
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    extensionId = new URL(serviceWorker.url()).host;
  } catch {
    throw new Error('Could not resolve extensionId; is dist/chrome-mv3-e2e built?');
  }

  const results = [];

  for (const { key, fn, label } of MODES) {
    const dir = path.join(SHOTS, key);
    await mkdir(dir, { recursive: true });
    const page = await context.newPage();
    const video = page.video();
    let status = 'ok';
    let errorText;
    const started = Date.now();
    try {
      console.log(`\n▶ Recording ${key} — ${label}`);
      await fn(context, page, extensionId, dir);
    } catch (error) {
      status = 'failed';
      errorText = error?.stack || String(error);
      console.error(`  ✗ ${key} failed:`, errorText);
      try {
        await shot(page, dir, '99-error');
      } catch {
        // ignore screenshot failure during error handling
      }
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    try {
      await page.close();
      const finalVideo = path.join(VIDEOS, `${key}.mp4`);
      if (video) {
        const rawWebm = path.join(RAW_VIDEOS, `${key}.webm`);
        await video.saveAs(rawWebm);
        await transcodeToMp4(rawWebm, finalVideo);
      }
    } catch (error) {
      status = status === 'ok' ? 'video-error' : status;
      console.error(`  ✗ ${key} video save failed:`, error?.message || error);
    }
    console.log(`  ✓ ${key} done (${elapsed}s) [${status}]`);
    results.push({ key, label, status, elapsed, errorText });
  }

  await context.close();
  await rm(RAW_VIDEOS, { recursive: true, force: true });

  console.log('\n================ SUMMARY ================');
  for (const r of results) {
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.key} ${r.label} — ${r.elapsed}s [${r.status}]`);
  }
  console.log(`\nScreenshots → ${SHOTS}`);
  console.log(`Videos      → ${VIDEOS}`);
  console.log(`Downloads   → ${DOWNLOADS}`);

  const failed = results.filter((r) => r.status !== 'ok');
  if (failed.length) {
    console.error(`\n${failed.length} mode(s) failed.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
