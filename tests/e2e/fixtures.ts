import { chromium, test as base, type BrowserContext } from '@playwright/test';
import path from 'node:path';

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ deviceScaleFactor }, use, testInfo) => {
    const extensionPath = path.resolve('dist/chrome-mv3-e2e');
    const scaleFactor = deviceScaleFactor ?? 1;
    const context = await chromium.launchPersistentContext(
      testInfo.outputPath('browser-profile'),
      {
        acceptDownloads: true,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          ...(scaleFactor === 1
            ? []
            : [`--force-device-scale-factor=${scaleFactor}`]),
        ],
        channel: 'chromium',
        deviceScaleFactor: scaleFactor,
        headless: true,
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
