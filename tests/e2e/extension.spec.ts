import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { MESSAGE_TYPES } from '../../lib/constants';
import { expect, test } from './fixtures';

interface ElementMetrics {
  clientWidth: number;
  dpr: number;
  originalScrollTop: number;
  scaleX: number;
  scaleY: number;
  scrollHeight: number;
}

interface PngDimensions {
  height: number;
  width: number;
}

type FixtureName = 'test-complex' | 'test-simple';

function pngDimensions(buffer: Buffer): PngDimensions {
  const signature = buffer.subarray(0, 8).toString('hex');
  expect(signature).toBe('89504e470d0a1a0a');
  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

async function elementMetrics(page: Page, selector: string): Promise<ElementMetrics> {
  return await page.locator(selector).evaluate((element) => {
    const target = element as HTMLElement;
    const rect = target.getBoundingClientRect();
    return {
      clientWidth: target.clientWidth,
      dpr: window.devicePixelRatio,
      originalScrollTop: target.scrollTop,
      scaleX: rect.width / target.offsetWidth,
      scaleY: rect.height / target.offsetHeight,
      scrollHeight: target.scrollHeight,
    };
  });
}

async function openWxtFixture(
  page: Page,
  extensionId: string,
  fixtureName: FixtureName,
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/${fixtureName}.html`);
  await expect(page.locator('html[data-fixture-ready="true"]')).toBeAttached();
}

async function startPicker(
  context: BrowserContext,
  targetPage: Page,
  extensionId: string,
): Promise<void> {
  const extensionPage = await context.newPage();
  try {
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(
      extensionPage.getByRole('heading', { name: 'Element Shot' }),
    ).toBeVisible();
    await targetPage.bringToFront();

    const response = await extensionPage.evaluate(async (type) => {
      const extensionChrome = (
        globalThis as typeof globalThis & {
          chrome: {
            runtime: {
              sendMessage(message: { type: string }): Promise<unknown>;
            };
          };
        }
      ).chrome;
      return await extensionChrome.runtime.sendMessage({ type });
    }, MESSAGE_TYPES.START_PICK_REQUEST);
    expect(response).toEqual({ ok: true });
  } finally {
    await extensionPage.close();
  }

  await expect(targetPage.locator('#element-shot-picker-host')).toBeAttached();
}

async function captureTarget(
  context: BrowserContext,
  page: Page,
  extensionId: string,
  selector: string,
  testInfo: TestInfo,
  clickPosition: { x: number; y: number } = { x: 24, y: 24 },
): Promise<Buffer> {
  await startPicker(context, page, extensionId);
  await page.locator(selector).hover();

  const runtimeErrors: string[] = [];
  const recordConsoleError = (message: { text(): string; type(): string }): void => {
    if (message.type() === 'error') {
      runtimeErrors.push(message.text());
    }
  };
  const recordPageError = (error: Error): void => {
    runtimeErrors.push(error.message);
  };
  page.on('console', recordConsoleError);
  page.on('pageerror', recordPageError);

  const resultPromise = Promise.race([
    page.waitForEvent('download').then((download) => ({
      download,
      kind: 'download' as const,
    })),
    page
      .locator('#element-shot-status-host[data-element-shot-status="error"]')
      .waitFor({ state: 'attached' })
      .then(async () => ({
        kind: 'error' as const,
        message: await page
          .locator('#element-shot-status-host[data-element-shot-status="error"]')
          .evaluate((host) => host.shadowRoot?.textContent?.trim() ?? ''),
      })),
  ]);

  await page.locator(selector).click({ position: clickPosition });
  const result = await resultPromise.finally(() => {
    page.off('console', recordConsoleError);
    page.off('pageerror', recordPageError);
  });
  if (result.kind === 'error') {
    const details = [result.message, ...runtimeErrors].filter(Boolean).join('\n');
    throw new Error(`Element Shot capture failed:\n${details}`);
  }

  const { download } = result;
  expect(download.suggestedFilename()).toMatch(/^element-shot-.*\.png$/);

  const outputPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(outputPath);
  return await readFile(outputPath);
}

async function samplePngPixels(
  context: BrowserContext,
  buffer: Buffer,
  coordinates: Array<{ x: number; y: number }>,
): Promise<number[][]> {
  const decoderPage = await context.newPage();
  try {
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
    return await decoderPage.evaluate(
      async ({ coordinates, dataUrl }) => {
        const image = new Image();
        const loaded = new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => reject(new Error('PNG decode failed')), {
            once: true,
          });
        });
        image.src = dataUrl;
        await loaded;

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context2d = canvas.getContext('2d');
        if (!context2d) {
          throw new Error('Canvas context unavailable');
        }
        context2d.drawImage(image, 0, 0);
        return coordinates.map(({ x, y }) =>
          Array.from(context2d.getImageData(x, y, 1, 1).data),
        );
      },
      { coordinates, dataUrl },
    );
  } finally {
    await decoderPage.close();
  }
}

test('renders the popup without layout overflow', async ({
  context,
  extensionId,
}, testInfo) => {
  const popupPage = await context.newPage();
  try {
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(
      popupPage.getByRole('heading', { name: 'Element Shot' }),
    ).toBeVisible();
    await expect(
      popupPage.getByRole('button', { name: '选择元素' }),
    ).toBeVisible();

    const layout = await popupPage.locator('.popup-shell').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(layout).toEqual({ clientWidth: 320, scrollWidth: 320 });

    await popupPage
      .locator('.popup-shell')
      .screenshot({ path: testInfo.outputPath('popup.png') });
  } finally {
    await popupPage.close();
  }
});

test('injects the picker into an active web page', async ({
  context,
  extensionId,
  page,
}) => {
  await page.route('https://element-shot.test/**', async (route) => {
    await route.fulfill({
      body: '<!doctype html><html><body><main id="web-target">Web target</main></body></html>',
      contentType: 'text/html; charset=utf-8',
    });
  });
  await page.goto('https://element-shot.test/injection.html');

  await startPicker(context, page, extensionId);
  await expect(page.locator('#element-shot-picker-host')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('#element-shot-picker-host')).not.toBeAttached();
});

test('captures a complete scroll container and restores page state', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const metrics = await elementMetrics(page, '#simple-target');
  const fixedVisibilityBefore = await page
    .locator('#fixed-obstruction')
    .evaluate((element) => (element as HTMLElement).style.visibility);

  const png = await captureTarget(
    context,
    page,
    extensionId,
    '#simple-target',
    testInfo,
  );
  expect(pngDimensions(png)).toEqual({
    height: Math.round(metrics.scrollHeight * metrics.scaleY * metrics.dpr),
    width: Math.round(metrics.clientWidth * metrics.scaleX * metrics.dpr),
  });

  const colors = await samplePngPixels(
    context,
    png,
    Array.from({ length: 9 }, (_, index) => ({ x: 16, y: index * 64 + 24 })),
  );
  expect(colors).toEqual([
    [249, 214, 109, 255],
    [185, 223, 208, 255],
    [246, 165, 141, 255],
    [249, 214, 109, 255],
    [185, 223, 208, 255],
    [246, 165, 141, 255],
    [249, 214, 109, 255],
    [185, 223, 208, 255],
    [246, 165, 141, 255],
  ]);

  await expect(page.locator('#simple-target')).toHaveJSProperty(
    'scrollTop',
    metrics.originalScrollTop,
  );
  await expect(page.locator('#fixed-obstruction')).toHaveCSS('visibility', 'visible');
  expect(
    await page
      .locator('#fixed-obstruction')
      .evaluate((element) => (element as HTMLElement).style.visibility),
  ).toBe(fixedVisibilityBefore);
});

test('captures a non-scrolling element in a single frame', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-simple');
  const rect = await page.locator('#static-target').evaluate((element) => {
    const value = element.getBoundingClientRect();
    return { height: value.height, width: value.width, dpr: window.devicePixelRatio };
  });

  const png = await captureTarget(
    context,
    page,
    extensionId,
    '#static-target',
    testInfo,
    { x: 285, y: 110 },
  );
  expect(pngDimensions(png)).toEqual({
    height: Math.round(rect.height * rect.dpr),
    width: Math.round(rect.width * rect.dpr),
  });
});

test('handles transformed nested ancestors without changing scale', async ({
  context,
  extensionId,
  page,
}, testInfo) => {
  await openWxtFixture(page, extensionId, 'test-complex');
  const metrics = await elementMetrics(page, '#complex-target');

  const png = await captureTarget(
    context,
    page,
    extensionId,
    '#complex-target',
    testInfo,
  );
  expect(metrics.scaleX).toBeCloseTo(0.8, 2);
  expect(metrics.scaleY).toBeCloseTo(0.8, 2);
  expect(pngDimensions(png)).toEqual({
    height: Math.round(metrics.scrollHeight * metrics.scaleY * metrics.dpr),
    width: Math.round(metrics.clientWidth * metrics.scaleX * metrics.dpr),
  });
  await expect(page.locator('#complex-target')).toHaveJSProperty(
    'scrollTop',
    metrics.originalScrollTop,
  );
  await expect(page.locator('#sticky-obstruction')).toHaveCSS('visibility', 'visible');
});

test.describe('high-DPI', () => {
  test.use({ deviceScaleFactor: 2 });

  test('exports physical pixels at DPR 2', async ({
    context,
    extensionId,
    page,
  }, testInfo) => {
    await openWxtFixture(page, extensionId, 'test-simple');
    const metrics = await elementMetrics(page, '#simple-target');
    expect(metrics.dpr).toBe(2);

    const png = await captureTarget(
      context,
      page,
      extensionId,
      '#simple-target',
      testInfo,
    );
    expect(pngDimensions(png)).toEqual({
      height: Math.round(metrics.scrollHeight * metrics.scaleY * metrics.dpr),
      width: Math.round(metrics.clientWidth * metrics.scaleX * metrics.dpr),
    });
  });
});
