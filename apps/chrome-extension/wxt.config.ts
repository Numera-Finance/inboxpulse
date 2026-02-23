import { defineConfig } from 'wxt';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

export default defineConfig({
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:done'(wxt) {
      // InboxSDK requires pageWorld.js to be accessible as a web-accessible resource.
      // Copy it from node_modules into the build output directory.
      const outDir = wxt.config.outDir;
      const src = resolve(wxt.config.root, 'node_modules/@inboxsdk/core/pageWorld.js');
      const dest = resolve(outDir, 'pageWorld.js');

      if (existsSync(src)) {
        mkdirSync(resolve(outDir), { recursive: true });
        copyFileSync(src, dest);
        console.log('[InboxSDK] Copied pageWorld.js to output directory');
      } else {
        console.warn('[InboxSDK] pageWorld.js not found at', src);
      }
    },
  },
  manifest: {
    name: 'CRM Sidebar for Gmail',
    description: 'View CRM customer data alongside Gmail conversations',
    version: '0.1.0',
    permissions: ['activeTab', 'storage', 'scripting'],
    host_permissions: ['https://mail.google.com/*', 'http://localhost:4001/*', 'http://localhost:4000/*'],
    action: {
      default_title: 'CRM Sidebar for Gmail',
      default_icon: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
      },
    },
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-48.png',
    },
    web_accessible_resources: [
      {
        resources: ['pageWorld.js', 'icons/*', 'chunks/*', 'assets/*'],
        matches: ['https://mail.google.com/*'],
      },
    ],
  },
  runner: {
    startUrls: ['https://mail.google.com/'],
  },
});
