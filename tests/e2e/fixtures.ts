import { chromium, test as base, type BrowserContext } from '@playwright/test';
import path from 'node:path';

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ deviceScaleFactor }, use) => {
    const extensionPath = path.resolve('dist/chrome-mv3-e2e');
    const scaleFactor = deviceScaleFactor ?? 1;
    const context = await chromium.launchPersistentContext(
      '',
      {
        acceptDownloads: true,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          // captureVisibleTab follows Chromium's browser-surface scale, so the
          // surface must match the emulated JS DPR on Retina and non-Retina hosts.
          `--force-device-scale-factor=${scaleFactor}`,
        ],
        // Keep this aligned with Playwright's official extension guide:
        // https://playwright.dev/docs/chrome-extensions
        // Do not replace the persistent Chromium context with Chrome/Edge or
        // a regular browser context; side-loaded extensions are unsupported.
        channel: 'chromium',
        deviceScaleFactor: scaleFactor,
        headless: false,
        locale: 'zh-CN',
        viewport: { height: 800, width: 1100 },
      },
    );

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
  },
});

export const expect = test.expect;
