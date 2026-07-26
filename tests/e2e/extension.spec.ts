import { readFile } from 'node:fs/promises';
import type { BrowserContext, Download, Page, TestInfo } from '@playwright/test';
import { MESSAGE_TYPES } from '../../lib/constants';
import type { CaptureMode } from '../../lib/types';
import { expect, test } from './fixtures';

type FixtureName = 'test-complex' | 'test-simple';

interface StartPickerOptions {
  preview?: boolean;
  restoreEditedContent?: boolean;
}

interface PngDimensions {
  height: number;
  width: number;
}

function pngDimensions(buffer: Buffer): PngDimensions {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) };
}

function storedZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    expect(method).toBe(0);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    entries.set(
      buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'),
      buffer.subarray(dataStart, dataEnd),
    );
    offset = dataEnd;
  }
  return entries;
}

async function openWxtFixture(page: Page, extensionId: string, fixture: FixtureName): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/${fixture}.html`);
  await expect(page.locator('html[data-fixture-ready="true"]')).toBeAttached();
}

async function startPicker(
  context: BrowserContext,
  targetPage: Page,
  extensionId: string,
  mode: CaptureMode,
  options: StartPickerOptions = {},
): Promise<void> {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: '网页滚动截图工具' })).toBeVisible();
    await popup.locator(`[data-mode="${mode}"]`).click();
    if (options.preview) await popup.locator('#preview').check();
    if (options.restoreEditedContent === false) await popup.locator('#restore-edits').uncheck();
    await targetPage.bringToFront();
    await popup.locator('#start-pick').click();
  } finally {
    await popup.close();
  }
}

async function expectWorkflow(page: Page, targetText?: string): Promise<void> {
  const host = page.locator('#element-shot-workflow-host');
  await expect(host).toBeAttached();
  for (const selector of ['[data-select]', '[data-edit]', '[data-hide]', '[data-capture]']) {
    await expect(host.locator(selector)).toBeVisible();
  }
  if (targetText) await expect(host).toContainText(targetText);
}

async function clickWorkflow(page: Page, selector: string): Promise<void> {
  await page.locator('#element-shot-workflow-host').locator(selector).click();
}

async function expectHighlightMatches(page: Page, selector: string): Promise<void> {
  await expect.poll(() => page.evaluate((targetSelector) => {
    const host = document.querySelector<HTMLDivElement>('#element-shot-picker-host');
    const highlight = host?.shadowRoot?.querySelector<HTMLElement>('.highlight');
    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!highlight || !target) return false;
    const highlightRect = highlight.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return (
      Math.abs(highlightRect.left - targetRect.left) < 2 &&
      Math.abs(highlightRect.top - targetRect.top) < 2 &&
      Math.abs(highlightRect.width - targetRect.width) < 2 &&
      Math.abs(highlightRect.height - targetRect.height) < 2
    );
  }, selector)).toBe(true);
}

function captureDownload(page: Page): Promise<Download> {
  return Promise.race([
    page.waitForEvent('download'),
    page.locator('#element-shot-status-host[data-element-shot-status="error"]')
      .waitFor({ state: 'attached' })
      .then(async () => {
        const message = await page.locator('#element-shot-status-host')
          .evaluate((host) => host.shadowRoot?.textContent?.trim() ?? '未知截图错误');
        throw new Error(`Screenshot Suite capture failed: ${message}`);
      }),
  ]);
}

async function saveDownload(
  download: Download,
  testInfo: TestInfo,
  extension: 'png' | 'zip' = 'png',
): Promise<Buffer> {
  expect(download.suggestedFilename()).toMatch(new RegExp(`^element-shot-.*\\.${extension}$`));
  const outputPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(outputPath);
  return await readFile(outputPath);
}

async function confirmDownload(
  page: Page,
  testInfo: TestInfo,
  extension: 'png' | 'zip' = 'png',
): Promise<Buffer> {
  const downloadPromise = captureDownload(page);
  await clickWorkflow(page, '[data-capture]');
  return await saveDownload(await downloadPromise, testInfo, extension);
}

test('popup has no overflow and omits non-configurable restoration settings', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: '网页滚动截图工具' })).toBeVisible();
    await expect(popup.getByRole('button', { name: '选择元素' })).toBeVisible();
    await expect(popup.locator('body')).toContainText('手动滚动截图');
    await expect(popup.locator('body')).not.toContainText('截图后恢复滚动位置');
    await expect(popup.locator('body')).not.toContainText('恢复隐藏元素');
    const layout = await popup.locator('body').evaluate((body) => ({
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.bodyClientHeight);
  } finally {
    await popup.close();
  }
});

test('popup language setting persists and changes the interface locale', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: '网页滚动截图工具' })).toBeVisible();
    await popup.locator('#language').selectOption('en');
    await expect(popup.getByRole('heading', { name: 'Screenshot Suite' })).toBeVisible();
    await expect(popup.locator('#language')).toHaveValue('en');
    await expect(popup.locator('body')).toContainText('Preview before download');
    await popup.reload();
    await expect(popup.getByRole('heading', { name: 'Screenshot Suite' })).toBeVisible();
    await expect(popup.locator('#language')).toHaveValue('en');
  } finally {
    await popup.close();
  }
});

test('popup persists preview setting when reopened', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#preview').check();
    await expect(popup.locator('#preview')).toBeChecked();
    await popup.reload();
    await expect(popup.locator('#preview')).toBeChecked();
    await popup.locator('#preview').uncheck();
    await popup.reload();
    await expect(popup.locator('#preview')).not.toBeChecked();
  } finally {
    await popup.close();
  }
});

test('popup resolves browser language to a concrete locale and shows project links', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#language')).not.toHaveValue('browser');
    await expect(popup.locator('.brand-mark')).toHaveAttribute('src', /icon\/48\.png/);
    await expect(popup.locator('.brand-links a[title="GitHub 地址"]')).toHaveAttribute('href', 'https://github.com/SublimeCT/element-screenshot-extension');
    await expect(popup.locator('.brand-links a').nth(1)).toHaveAttribute(
      'href',
      'https://sublimect.github.io/element-screenshot-extension',
    );
  } finally {
    await popup.close();
  }
});

test('injects the picker and cancels it with Escape', async ({ context, extensionId, page }) => {
  await page.route('https://element-shot.test/**', async (route) => {
    await route.fulfill({
      body: '<!doctype html><html><body><main id="web-target">Web target</main></body></html>',
      contentType: 'text/html; charset=utf-8',
    });
  });
  await page.goto('https://element-shot.test/injection.html');
  await startPicker(context, page, extensionId, 'region');
  await expect(page.locator('#element-shot-picker-host')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('#element-shot-picker-host')).not.toBeAttached();
});

test('normalizes missing settings before opening the full-page workflow', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    const response = await popup.evaluate(async (type) => {
      const extensionChrome = globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      };
      return await extensionChrome.chrome.runtime.sendMessage({ mode: 'fullPage', type });
    }, MESSAGE_TYPES.START_PICK_REQUEST);
    expect(response).toEqual({ ok: true });
  } finally {
    await popup.close();
  }
  await expectWorkflow(page);
  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png).height).toBeGreaterThan(1000);
  await expect(page.locator('#element-shot-status-host[data-element-shot-status="error"]')).not.toBeAttached();
});

test('all screenshot modes expose the required workflow toolbar before capture', async ({ context, extensionId, page }) => {
  await openWxtFixture(page, extensionId, 'test-simple');

  await startPicker(context, page, extensionId, 'region');
  await expectWorkflow(page, '请选择一个截图区域');
  await page.keyboard.press('Escape');

  await startPicker(context, page, extensionId, 'fullPage');
  await expectWorkflow(page);
  await page.keyboard.press('Escape');

  await startPicker(context, page, extensionId, 'custom');
  await expectWorkflow(page, '整页');
  await page.keyboard.press('Escape');

  await startPicker(context, page, extensionId, 'element');
  await expectWorkflow(page, '请选择一个截图元素');
  await page.keyboard.press('Escape');

  await startPicker(context, page, extensionId, 'focus');
  await expectWorkflow(page, '请选择一个截图元素');
  await page.keyboard.press('Escape');

  await startPicker(context, page, extensionId, 'allScrollable');
  await expectWorkflow(page, '已选 3 个可滚动元素');
  await page.keyboard.press('Escape');
});

test('element capture keeps the clicked node and restores its scroll parent', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const metrics = await page.locator('#simple-target .row').first().evaluate((element) => {
    const row = element as HTMLElement;
    return {
      height: Math.round(row.getBoundingClientRect().height * window.devicePixelRatio),
      scrollTop: 96,
      width: Math.round(row.getBoundingClientRect().width * window.devicePixelRatio),
    };
  });
  await page.locator('#simple-target').evaluate((element) => {
    (element as HTMLElement).scrollTop = 96;
    const row = element.querySelector<HTMLElement>('.row');
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await startPicker(context, page, extensionId, 'element');
  await page.locator('#simple-target .row').first().dispatchEvent('click');
  await expectWorkflow(page, 'div.row');
  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png)).toEqual({ height: metrics.height, width: metrics.width });
  await expect(page.locator('#simple-target')).toHaveJSProperty('scrollTop', metrics.scrollTop);
});

test('element capture establishes its size after the scroll parent first reveals it', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const target = page.locator('#simple-target .row').first();
  await startPicker(context, page, extensionId, 'element');
  await target.click();
  await expectWorkflow(page, 'div.row');
  const expectedWidth = await target.evaluate((element) =>
    Math.round(element.getBoundingClientRect().width * window.devicePixelRatio),
  );
  await page.locator('#simple-target').evaluate((element) => {
    const parent = element as HTMLElement;
    const row = parent.querySelector<HTMLElement>('.row')!;
    parent.scrollTop = 96;
    const resizeWhenCaptureStarts = (): void => {
      if (parent.scrollTop > 1) return;
      row.style.height = '72px';
      parent.removeEventListener('scroll', resizeWhenCaptureStarts);
    };
    parent.addEventListener('scroll', resizeWhenCaptureStarts);
  });

  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png)).toEqual({ height: 72, width: expectedWidth });
  await expect(page.locator('#element-shot-status-host[data-element-shot-status="error"]'))
    .not.toBeAttached();
  await expect(page.locator('#simple-target')).toHaveJSProperty('scrollTop', 96);
});

test('focus capture isolates the selected subtree with CSS and restores ancestors', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const originalStyles = await page.evaluate(() => {
    const outer = document.createElement('div');
    outer.id = 'focus-outer';
    outer.style.cssText = 'height: 180px; overflow: hidden; border: 3px solid #263c73;';
    const middle = document.createElement('div');
    middle.id = 'focus-middle';
    middle.style.cssText = 'height: 140px; overflow-y: auto;';
    const target = document.createElement('article');
    target.id = 'focus-target';
    target.style.cssText = 'width: 320px; height: 1200px; overflow: visible; background: linear-gradient(#f9d66d 0 25%, #b9dfd0 25% 50%, #f6a58d 50% 75%, #263c73 75%);';
    target.innerHTML = '<h2>Focus target</h2>';
    middle.append(target);
    outer.append(middle);
    document.querySelector('main')?.append(outer);
    return {
      outer: outer.getAttribute('style'),
      middle: middle.getAttribute('style'),
      targetHeight: Math.round(target.getBoundingClientRect().height * window.devicePixelRatio),
      targetWidth: Math.round(target.getBoundingClientRect().width * window.devicePixelRatio),
    };
  });
  await startPicker(context, page, extensionId, 'focus');
  await page.locator('#focus-target').dispatchEvent('click');
  await expectWorkflow(page, 'article#focus-target');
  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png)).toEqual({ height: originalStyles.targetHeight, width: originalStyles.targetWidth });
  await expect(page.locator('#focus-outer')).toHaveAttribute('style', originalStyles.outer!);
  await expect(page.locator('#focus-middle')).toHaveAttribute('style', originalStyles.middle!);
  await expect(page.locator('style[data-element-shot-focus="true"]')).not.toBeAttached();
  await expect(page.locator('#focus-outer')).toHaveAttribute('style', originalStyles.outer!);
});

test('arrow keys move the selected target to its parent and first child', async ({ context, extensionId, page }) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await startPicker(context, page, extensionId, 'element');
  await page.locator('#static-target').dispatchEvent('click');
  await expectWorkflow(page, 'article#static-target');
  await page.keyboard.press('ArrowUp');
  await expectWorkflow(page, 'main');
  await page.keyboard.press('ArrowDown');
  await expectWorkflow(page, 'nav');
});

test('region workflow header can be dragged and remains inside the viewport', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await startPicker(context, page, extensionId, 'region');
  await expectWorkflow(page, '请选择一个截图区域');
  const host = page.locator('#element-shot-workflow-host');
  const handle = host.locator('[data-drag-handle]');
  const before = await host.boundingBox();
  const handleBox = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + 30, handleBox!.y + 18);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 260, handleBox!.y - 180, { steps: 8 });
  await page.mouse.up();
  const after = await host.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y)).toBeGreaterThan(100);
  const viewport = page.viewportSize()!;
  expect(after!.x).toBeGreaterThanOrEqual(0);
  expect(after!.y).toBeGreaterThanOrEqual(0);
  expect(after!.x + after!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(after!.y + after!.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.screenshot({ path: testInfo.outputPath('draggable-region-toolbar.png') });
  await page.keyboard.press('Escape');
});

test('region capture waits for confirmation and captures exactly one selected region', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await startPicker(context, page, extensionId, 'region');
  let downloadCount = 0;
  const onDownload = (): void => { downloadCount += 1; };
  page.on('download', onDownload);
  await page.locator('#static-target').click({ position: { x: 285, y: 105 } });
  await expectWorkflow(page, '整页');
  await expectHighlightMatches(page, 'html');
  await page.waitForTimeout(250);
  expect(downloadCount).toBe(0);
  page.off('download', onDownload);

  await clickWorkflow(page, '[data-select]');
  await page.locator('#simple-target').click({ position: { x: 2, y: 2 } });
  await expectWorkflow(page, 'section#simple-target');
  await expectHighlightMatches(page, '#simple-target');
  const expected = await page.locator('#simple-target').evaluate((element) => {
    const target = element as HTMLElement;
    return { height: target.scrollHeight, width: target.clientWidth };
  });
  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png)).toEqual(expected);
  await expect(page.locator('#element-shot-workflow-host')).not.toBeAttached();
});

test('region capture keeps a deterministic size without failing on later geometry reads', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const target = page.locator('#simple-target');
  await startPicker(context, page, extensionId, 'region');
  await target.click({ position: { x: 2, y: 2 } });
  await expectWorkflow(page, 'section#simple-target');
  const expected = await target.evaluate((element) => {
    const scrollable = element as HTMLElement;
    scrollable.style.transformOrigin = 'top left';
    scrollable.addEventListener('scroll', () => {
      scrollable.style.transform = scrollable.scrollTop <= 1
        ? 'scale(0.8)'
        : 'scale(0.9)';
    });
    return {
      height: Math.round(scrollable.scrollHeight * 0.9 * window.devicePixelRatio),
      width: Math.round(scrollable.clientWidth * 0.9 * window.devicePixelRatio),
    };
  });

  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png)).toEqual(expected);
  await expect(page.locator('#element-shot-status-host[data-element-shot-status="error"]'))
    .not.toBeAttached();
});

test('full-page capture captures the selected root target and restores window scroll', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await page.evaluate(() => window.scrollTo(0, 120));
  const originalScrollY = await page.evaluate(() => window.scrollY);
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  await startPicker(context, page, extensionId, 'fullPage');
  await expectWorkflow(page, '整页');
  const highlightMatchesTarget = await page.evaluate(() => {
    const host = document.querySelector<HTMLDivElement>('#element-shot-picker-host');
    const highlight = host?.shadowRoot?.querySelector<HTMLElement>('.highlight');
    const target = document.documentElement;
    if (!highlight || !target) return false;
    const a = highlight.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2;
  });
  expect(highlightMatchesTarget).toBe(true);
  const png = await confirmDownload(page, testInfo);
  const dimensions = pngDimensions(png);
  expect(dimensions.height).toBe(Math.round(pageHeight * dimensions.width / viewportWidth));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originalScrollY);
});

test('full-page mode captures the scrollable descendant selected by root fallback', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await page.evaluate(() => {
    document.documentElement.style.cssText = 'height: 100%; overflow: hidden;';
    document.body.style.cssText = 'height: 100%; margin: 0; overflow: hidden;';
    document.body.innerHTML = `
      <div id="fallback-scroll" style="width: 300px; height: 180px; overflow-y: auto">
        <div style="height: 600px">Fallback target</div>
      </div>
    `;
  });
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollHeight === document.documentElement.clientHeight,
  )).toBe(true);
  await startPicker(context, page, extensionId, 'fullPage');
  await expectWorkflow(page, 'div#fallback-scroll');
  await expectHighlightMatches(page, '#fallback-scroll');
  const expected = await page.locator('#fallback-scroll').evaluate((element) => {
    const target = element as HTMLElement;
    return {
      height: Math.round(target.scrollHeight * window.devicePixelRatio),
      width: Math.round(target.clientWidth * window.devicePixelRatio),
    };
  });
  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png)).toEqual(expected);
});

test('captures a tall non-scroll container by scrolling the page around it', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await page.evaluate(() => {
    const target = document.createElement('article');
    target.id = 'tall-static-target';
    target.style.cssText = 'width: 320px; height: 1200px; overflow: visible; margin-top: 36px; background: linear-gradient(#f9d66d 0 25%, #b9dfd0 25% 50%, #f6a58d 50% 75%, #263c73 75%);';
    target.innerHTML = '<h2 style="padding: 24px">Tall non-scroll container</h2>';
    document.querySelector('main')?.append(target);
  });
  const expected = await page.locator('#tall-static-target').evaluate((element) => {
    const target = element as HTMLElement;
    const rect = target.getBoundingClientRect();
    return {
      height: Math.round(rect.height * window.devicePixelRatio),
      width: Math.round(rect.width * window.devicePixelRatio),
    };
  });
  await startPicker(context, page, extensionId, 'element');
  await page.locator('#tall-static-target').click({ position: { x: 310, y: 1150 } });
  await expectWorkflow(page, 'article#tall-static-target');
  const originalScrollY = await page.evaluate(() => window.scrollY);
  const downloadPromise = captureDownload(page);
  await clickWorkflow(page, '[data-capture]');
  await expect(page.locator('#element-shot-workflow-host')).not.toBeAttached();
  await expect(page.locator('style[data-element-shot-scrollbars="true"]')).toBeAttached();
  const png = await saveDownload(await downloadPromise, testInfo);
  expect(pngDimensions(png)).toEqual(expected);
  await expect(page.locator('style[data-element-shot-scrollbars="true"]')).not.toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originalScrollY);
});

test('manual capture edits directly, previews hidden elements, and restores both states', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const target = page.locator('#simple-target');
  const originalHtml = await target.evaluate((element) => element.innerHTML);
  const originalHiddenStyle = await page.locator('#fixed-obstruction').getAttribute('style');
  await startPicker(context, page, extensionId, 'custom');
  await expectWorkflow(page, '整页');
  await page.locator('#static-target').click({ position: { x: 285, y: 105 } });
  await expectWorkflow(page, '整页');
  await clickWorkflow(page, '[data-select]');
  await page.locator('#simple-target .row').first().click();
  await expectWorkflow(page, 'section#simple-target');

  await clickWorkflow(page, '[data-edit]');
  await expect(page.locator('#element-shot-editor-host')).not.toBeAttached();
  await expect(target).toHaveAttribute('contenteditable', 'true');
  await target.fill('Edited content');
  await clickWorkflow(page, '[data-hide]');
  await expectWorkflow(page, 'section#simple-target');
  await page.locator('#fixed-obstruction').click();
  await expect(page.locator('#element-shot-workflow-host')).toContainText('完成选择 (1)');
  await expect(target).toContainText('Edited content');
  await expect(page.locator('#fixed-obstruction')).toHaveCSS('opacity', '0.35');
  await expect(page.locator('#fixed-obstruction')).toHaveCSS('visibility', 'visible');
  await clickWorkflow(page, '[data-hide]');

  const downloadPromise = captureDownload(page);
  await clickWorkflow(page, '[data-capture]');
  await expect(page.locator('#element-shot-workflow-host')).not.toBeAttached();
  await expect(target).toHaveCSS('outline-style', 'solid');
  await expect(target).toHaveCSS('outline-offset', '3px');
  await expect(page.locator('style[data-element-shot-scrollbars="true"]')).toBeAttached();
  await expect(page.locator('#fixed-obstruction')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('#fixed-obstruction')).toHaveCSS('opacity', '0');
  await page.mouse.move(1000, 400);
  await page.mouse.down();
  await page.mouse.up();
  const png = await saveDownload(await downloadPromise, testInfo);
  expect(pngDimensions(png).width).toBeGreaterThan(100);
  await expect(target).toHaveJSProperty('innerHTML', originalHtml);
  await expect(target).not.toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('#fixed-obstruction')).toHaveCSS('visibility', 'visible');
  expect(await page.locator('#fixed-obstruction').getAttribute('style')).toBe(originalHiddenStyle);
  await expect(page.locator('#element-shot-editor-host')).not.toBeAttached();
});

test('manual mode never accepts a target when no scrollable ancestor exists', async ({
  context,
  extensionId,
  page,
}) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    for (const selector of ['#simple-target', '#secondary-scroll-target']) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.style.overflow = 'hidden';
    }
  });

  await startPicker(context, page, extensionId, 'custom');
  await expectWorkflow(page, '请选择一个可滚动区域');
  const workflow = page.locator('#element-shot-workflow-host');
  await expect(workflow.locator('[data-capture]')).toBeDisabled();
  await page.locator('#static-target').click();
  await expect(workflow).toContainText('请选择一个可滚动区域');
  await expect(workflow.locator('[data-capture]')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#element-shot-picker-host');
    const highlight = host?.shadowRoot?.querySelector<HTMLElement>('.highlight');
    return highlight?.style.display;
  })).toBe('none');
  await page.keyboard.press('Escape');
});

test('manual scroll capture stitches initial and settled positions by actual distance', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const target = page.locator('#simple-target');
  const metrics = await target.evaluate((element) => {
    const scrollable = element as HTMLElement;
    return {
      dpr: window.devicePixelRatio,
      width: scrollable.clientWidth,
    };
  });
  await startPicker(context, page, extensionId, 'custom');
  await target.click({ position: { x: 2, y: 2 } });
  await expectWorkflow(page, 'section#simple-target');
  const pageScrollBeforeCapture = await page.evaluate(() => window.scrollY);
  const initialScrollTop = await target.evaluate((element) => (element as HTMLElement).scrollTop);

  const downloadPromise = captureDownload(page);
  await clickWorkflow(page, '[data-capture]');
  await expect(page.locator('#element-shot-workflow-host')).not.toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeCapture);
  await page.waitForTimeout(700);
  await target.evaluate((element) => { (element as HTMLElement).scrollTop = 96; });
  await expect.poll(() => target.evaluate((element) => (element as HTMLElement).scrollTop)).toBe(96);
  await page.waitForTimeout(750);
  await target.evaluate((element) => { (element as HTMLElement).scrollTop = 192; });
  await expect.poll(() => target.evaluate((element) => (element as HTMLElement).scrollTop)).toBe(192);
  await page.waitForTimeout(750);
  await page.keyboard.press('KeyQ');

  const png = await saveDownload(await downloadPromise, testInfo);
  expect(pngDimensions(png)).toEqual({
    height: Math.round((240 + 192 - initialScrollTop) * metrics.dpr),
    width: Math.round(metrics.width * metrics.dpr),
  });
  await expect.poll(() => target.evaluate((element) => (element as HTMLElement).scrollTop))
    .toBe(initialScrollTop);
  await expect(target).toHaveCSS('outline-style', 'none');
  await expect(page.locator('style[data-element-shot-scrollbars="true"]')).not.toBeAttached();
});

test('manual scroll capture uses the visible intersection of a partially clipped target', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const target = page.locator('#simple-target');
  await target.evaluate((element) => {
    const scrollable = element as HTMLElement;
    const documentTop = scrollable.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, documentTop + 40);
  });
  await startPicker(context, page, extensionId, 'custom');
  await target.evaluate((element) => (element as HTMLElement).click());
  await expectWorkflow(page, 'section#simple-target');
  const initialScrollTop = await target.evaluate((element) =>
    (element as HTMLElement).scrollTop,
  );

  const downloadPromise = captureDownload(page);
  await clickWorkflow(page, '[data-capture]');
  const captureArea = await target.evaluate((element) => {
    const scrollable = element as HTMLElement;
    const rect = scrollable.getBoundingClientRect();
    const top = Math.max(0, rect.top + scrollable.clientTop);
    const bottom = Math.min(
      window.innerHeight,
      rect.top + scrollable.clientTop + scrollable.clientHeight,
    );
    return {
      height: Math.round((bottom - top) * window.devicePixelRatio),
      width: Math.round(scrollable.clientWidth * window.devicePixelRatio),
    };
  });
  expect(captureArea.height).toBeLessThan(240);
  await page.waitForTimeout(700);
  await target.evaluate((element) => { (element as HTMLElement).scrollTop = 96; });
  await expect.poll(() => target.evaluate((element) => (element as HTMLElement).scrollTop))
    .toBe(96);
  await page.waitForTimeout(750);
  await page.keyboard.press('KeyQ');

  const png = await saveDownload(await downloadPromise, testInfo);
  expect(pngDimensions(png)).toEqual({
    height: captureArea.height + 96 - initialScrollTop,
    width: captureArea.width,
  });
  await expect(page.locator('#element-shot-status-host[data-element-shot-status="error"]'))
    .not.toBeAttached();
});

test('manual scroll capture finishes automatically at the target bottom', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const target = page.locator('#simple-target');
  await startPicker(context, page, extensionId, 'custom');
  await target.click({ position: { x: 2, y: 2 } });
  await expectWorkflow(page, 'section#simple-target');
  const initialScrollTop = await target.evaluate((element) => (element as HTMLElement).scrollTop);
  const expectedHeight = await target.evaluate((element) => {
    const scrollable = element as HTMLElement;
    return Math.round((scrollable.scrollHeight - scrollable.scrollTop) * window.devicePixelRatio);
  });
  const downloadPromise = captureDownload(page);
  await clickWorkflow(page, '[data-capture]');
  await expect(page.locator('#element-shot-workflow-host')).not.toBeAttached();
  await page.waitForTimeout(700);
  await target.evaluate((element) => { (element as HTMLElement).scrollTop = 120; });
  await expect.poll(() => target.evaluate((element) => (element as HTMLElement).scrollTop)).toBe(120);
  await page.waitForTimeout(750);
  await target.evaluate((element) => {
    const scrollable = element as HTMLElement;
    scrollable.scrollTop = scrollable.scrollHeight - scrollable.clientHeight;
  });
  const png = await saveDownload(await downloadPromise, testInfo);
  expect(pngDimensions(png).height).toBe(expectedHeight);
  await expect.poll(() => target.evaluate((element) => (element as HTMLElement).scrollTop))
    .toBe(initialScrollTop);
});

test('all-scrollable mode highlights all candidates and zips only the remaining selection', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const originalScrollY = await page.evaluate(() => window.scrollY);
  const expectedPrimaryDimensions = await page.locator('#simple-target').evaluate((element) => {
    const target = element as HTMLElement;
    return { height: target.scrollHeight, width: target.clientWidth };
  });
  await startPicker(context, page, extensionId, 'allScrollable');
  await expectWorkflow(page, '已选 3 个可滚动元素');
  await expect.poll(() => page.locator('#element-shot-picker-host').evaluate((host) =>
    host.shadowRoot?.querySelectorAll('.multi-highlight').length ?? 0,
  )).toBe(3);
  await expect.poll(() => page.locator('#element-shot-picker-host').evaluate((host) =>
    host.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll<HTMLElement>('.multi-highlight'))
      .filter((highlight) => highlight.dataset.selected === 'true').length : 0,
  )).toBe(3);

  await page.locator('#secondary-scroll-target .secondary-row').first().click();
  await expectWorkflow(page, '已选 2 个可滚动元素');
  await expect.poll(() => page.locator('#element-shot-picker-host').evaluate((host) =>
    host.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll<HTMLElement>('.multi-highlight'))
      .filter((highlight) => highlight.dataset.selected === 'true').length : 0,
  )).toBe(2);

  const zip = await confirmDownload(page, testInfo, 'zip');
  const entries = storedZipEntries(zip);
  expect([...entries.keys()]).toEqual(['scrollable-01.png', 'scrollable-02.png']);
  expect(pngDimensions(entries.get('scrollable-01.png')!).height).toBeGreaterThan(1000);
  expect(pngDimensions(entries.get('scrollable-02.png')!)).toEqual(expectedPrimaryDimensions);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originalScrollY);
});

test('all-scrollable ZIP count matches every initially recognized target', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await startPicker(context, page, extensionId, 'allScrollable');
  await expectWorkflow(page, '已选 3 个可滚动元素');
  const zip = await confirmDownload(page, testInfo, 'zip');
  expect([...storedZipEntries(zip).keys()]).toEqual([
    'scrollable-01.png',
    'scrollable-02.png',
    'scrollable-03.png',
  ]);
});

test('preview opens a real rendered PNG tab', async ({ context, extensionId, page }) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await startPicker(context, page, extensionId, 'fullPage', { preview: true });
  await expectWorkflow(page);
  await clickWorkflow(page, '[data-capture]');
  await expect.poll(() => context.pages().some((candidate) => candidate.url().includes('/preview.html'))).toBe(true);
  const preview = context.pages().find((candidate) => candidate.url().includes('/preview.html'));
  expect(preview).toBeDefined();
  await preview?.waitForLoadState('domcontentloaded');
  await expect.poll(async () => await preview?.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(1000);
  await expect.poll(async () => await preview?.locator('img').evaluate((image) => (image as HTMLImageElement).naturalHeight)).toBeGreaterThan(1000);
  await preview?.close();
});

test('region capture resolves a static element to its first scrollable ancestor', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await startPicker(context, page, extensionId, 'region');
  await page.locator('#static-target').click({ position: { x: 285, y: 105 } });
  await expectWorkflow(page, '整页');
  await expectHighlightMatches(page, 'html');
  const png = await confirmDownload(page, testInfo);
  const dimensions = pngDimensions(png);
  expect(dimensions.width).toBeGreaterThanOrEqual(1100);
  expect(dimensions.height).toBeGreaterThan(1000);
  await expect(page.locator('#element-shot-status-host[data-element-shot-status="error"]')).not.toBeAttached();
});

test('region mode rejects a static element when it has no scrollable ancestor', async ({
  context,
  extensionId,
  page,
}) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    for (const selector of ['#simple-target', '#secondary-scroll-target']) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.style.overflow = 'hidden';
    }
  });

  await startPicker(context, page, extensionId, 'region');
  const workflow = page.locator('#element-shot-workflow-host');
  await page.locator('#static-target').click();
  await expect(workflow).toContainText('请选择一个截图区域');
  await expect(workflow.locator('[data-capture]')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#element-shot-picker-host');
    const highlight = host?.shadowRoot?.querySelector<HTMLElement>('.highlight');
    return highlight?.style.display;
  })).toBe('none');
  await page.keyboard.press('Escape');
});

test('handles transformed nested ancestors', async ({ context, extensionId, page }, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-complex');
  const metrics = await page.locator('#complex-target').evaluate((element) => {
    const target = element as HTMLElement;
    const rect = target.getBoundingClientRect();
    return { dpr: window.devicePixelRatio, height: target.scrollHeight, scale: rect.height / target.offsetHeight, width: target.clientWidth * rect.width / target.offsetWidth };
  });
  await startPicker(context, page, extensionId, 'region');
  await page.locator('#complex-target').click();
  await expectWorkflow(page, 'section#complex-target');
  const png = await confirmDownload(page, testInfo);
  expect(pngDimensions(png)).toEqual({
    height: Math.round(metrics.height * metrics.scale * metrics.dpr),
    width: Math.round(metrics.width * metrics.dpr),
  });
});

test.describe('high-DPI', () => {
  test.use({ deviceScaleFactor: 2 });

  test('exports physical pixels at DPR 2', async ({ context, extensionId, page }, testInfo) => {
    await openWxtFixture(page, extensionId, 'test-simple');
    const metrics = await page.locator('#simple-target').evaluate((element) => {
      const target = element as HTMLElement;
      const rect = target.getBoundingClientRect();
      return { dpr: window.devicePixelRatio, height: target.scrollHeight, scale: rect.height / target.offsetHeight, width: target.clientWidth * rect.width / target.offsetWidth };
    });
    await startPicker(context, page, extensionId, 'region');
    await page.locator('#simple-target').click();
    await expectWorkflow(page, 'section#simple-target');
    const png = await confirmDownload(page, testInfo);
    expect(pngDimensions(png)).toEqual({
      height: Math.round(metrics.height * metrics.scale * metrics.dpr),
      width: Math.round(metrics.width * metrics.dpr),
    });
  });
});

test('restores hidden preview and visibility when capture fails', async ({ context, extensionId, page }) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const hiddenTarget = page.locator('#fixed-obstruction');
  const originalStyle = await hiddenTarget.getAttribute('style');
  await startPicker(context, page, extensionId, 'element');
  await page.locator('#static-target').click({ position: { x: 285, y: 105 } });
  await clickWorkflow(page, '[data-hide]');
  await hiddenTarget.click();
  await expect(hiddenTarget).toHaveCSS('opacity', '0.35');
  await clickWorkflow(page, '[data-hide]');
  await page.locator('#static-target').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await clickWorkflow(page, '[data-capture]');
  await expect(page.locator('#element-shot-status-host[data-element-shot-status="error"]')).toBeAttached();
  expect(await hiddenTarget.getAttribute('style')).toBe(originalStyle);
  await expect(hiddenTarget).toHaveCSS('visibility', 'visible');
  await expect(hiddenTarget).toHaveCSS('opacity', '1');
});

test('restores hidden preview and visibility when automatic capture is interrupted', async ({
  context,
  extensionId,
  page,
}) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const hiddenTarget = page.locator('#static-target');
  const originalStyle = await hiddenTarget.getAttribute('style');
  const originalScrollY = await page.evaluate(() => window.scrollY);
  await startPicker(context, page, extensionId, 'fullPage');
  await clickWorkflow(page, '[data-hide]');
  await hiddenTarget.click({ position: { x: 285, y: 105 } });
  await expect(hiddenTarget).toHaveCSS('opacity', '0.35');
  await clickWorkflow(page, '[data-hide]');
  await clickWorkflow(page, '[data-capture]');
  await expect(page.locator('#element-shot-workflow-host')).not.toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('#element-shot-status-host[data-element-shot-status="error"]')).toContainText('截图已中断');
  expect(await hiddenTarget.getAttribute('style')).toBe(originalStyle);
  await expect(hiddenTarget).toHaveCSS('visibility', 'visible');
  await expect(hiddenTarget).toHaveCSS('opacity', '1');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originalScrollY);
});
