import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  outDir: 'dist',
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
    name: 'Element Full Screenshot',
    description: 'Capture the complete content of a selected scrollable element.',
    permissions: ['activeTab', 'scripting'],
    action: {
      default_title: 'Element Shot',
    },
    // Playwright cannot invoke Chrome's toolbar action to grant activeTab.
    // This permission exists only in the isolated E2E artifact so that
    // captureVisibleTab can run; production remains on activeTab + scripting.
    ...(mode === 'e2e' ? { host_permissions: ['<all_urls>'] } : {}),
  }),
});
