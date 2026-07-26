import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  outDir: 'dist',
  // WXT copies every file from publicDir verbatim into the extension. Keep the
  // extension's runtime assets separate from public/, which is deployed as the
  // marketing site and must never be considered part of the extension build.
  publicDir: 'extension-public',
  hooks: {
    'entrypoints:found': (wxt, entrypoints) => {
      if (wxt.config.mode === 'development' || wxt.config.mode === 'e2e') {
        return;
      }

      for (let index = entrypoints.length - 1; index >= 0; index -= 1) {
        if (entrypoints[index].name.startsWith('test-')) {
          entrypoints.splice(index, 1);
        }
      }
    },
  },
  manifest: ({ mode }) => ({
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'zh_CN',
    permissions: ['activeTab', 'scripting'],
    action: {
      default_title: '__MSG_actionTitle__',
    },
    // Playwright cannot invoke Chrome's toolbar action to grant activeTab.
    // This permission exists only in the isolated E2E artifact so that
    // captureVisibleTab can run; production remains on activeTab + scripting.
    ...(mode === 'e2e' ? { host_permissions: ['<all_urls>'] } : {}),
  }),
});
