import { defineConfig } from 'wxt';
import { loadEnv } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

// Resolve build-time API/Web URLs from WXT_* env vars (see .env.example).
// `wxt build`/`wxt zip` use production mode (reads .env.production); `wxt dev`
// uses development mode. Falls back to localhost so dev works with no config.
function resolveMode(): string {
  const argv = process.argv;
  // Honor an explicit `-m <mode>` / `--mode <mode>` flag (matches WXT/Vite).
  const flagIndex = argv.findIndex((a) => a === '-m' || a === '--mode');
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  if (process.env.NODE_ENV === 'production') return 'production';
  // `wxt build` / `wxt zip` default to production; `wxt` (dev) to development.
  if (argv.includes('build') || argv.includes('zip')) return 'production';
  return 'development';
}
const env = loadEnv(resolveMode(), process.cwd(), 'WXT_');
const API_URL = env.WXT_API_URL || 'http://localhost:4001';
const WEB_URL = env.WXT_WEB_URL || 'http://localhost:4000';
// The local `gcloud run services proxy` listener fronting the IAM-gated
// crm-manager service. This stays a localhost URL even in production builds:
// the proxy is what holds the caller's gcloud identity, so the extension never
// talks to the Cloud Run hostname directly.
const MANAGER_URL = env.WXT_MANAGER_URL || 'http://localhost:8080';
// The flag-chip data source. Separate from API_URL because the chips use
// service-key auth (no cookie) and can therefore read a different stack — the
// clone — while session paths must stay on the host the web app logs into.
const FLAGS_API_URL = env.WXT_FLAGS_API_URL || API_URL;

/**
 * Convert an origin URL into a Chrome host match pattern.
 * Match patterns CANNOT contain a port — `http://localhost:4001/*` is parsed
 * as the literal host "localhost:4001" and never matches a real request to
 * localhost. We must strip the port and emit `<scheme>://<host>/*`.
 */
function toHostMatchPattern(rawUrl: string): string {
  const u = new URL(rawUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

const hostPermissions = Array.from(
  new Set([
    'https://mail.google.com/*',
    toHostMatchPattern(API_URL),
    toHostMatchPattern(WEB_URL),
    toHostMatchPattern(MANAGER_URL),
    toHostMatchPattern(FLAGS_API_URL),
  ]),
);

export default defineConfig({
  extensionApi: 'chrome',
  outDir: 'output',
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
    host_permissions: hostPermissions,
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
