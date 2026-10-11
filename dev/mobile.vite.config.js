// dev/mobile.vite.config.js — the dev server for dev/mobile.html ONLY.
//
// The phone app reads Firestore through five modules. This config swaps just
// those five for generated stubs that answer from dev/mobileStore.js, so the
// REAL src/mobile/* components render and write against sample data with no
// sign-in. Nothing else is replaced: the pure services, the CSS and every
// component are the shipped ones.
//
//   npx vite --config dev/mobile.vite.config.js --port 5176
//   open http://localhost:5176/dev/mobile.html
//
//   HARNESS=desktop npx vite --config dev/mobile.vite.config.js --port 5178
//   open http://localhost:5178/dev/desktop.html     (the desktop app)
//
// It is a separate config because a stub in the main one would replace
// Firestore for the whole app.

/* global process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// HARNESS=desktop swaps ONLY Firebase itself, so the real hooks — the
// workspace scoping, the merging, the shared listeners — run against the
// store; dev/desktop.html renders the whole desktop app that way.
const DESKTOP = process.env.HARNESS === 'desktop';
const STUBBED = (DESKTOP
  ? ['src/services/firebase.js', 'src/services/aiProxyClient.js']
  : [
    'src/services/firebase.js',
    'src/services/aiProxyClient.js',
    'src/hooks/useTasks.js',
    'src/hooks/useWorkspace.js',
    'src/hooks/useInbox.js',
    'src/hooks/useAiStatus.js',
  ]).map((p) => path.join(root, p));
const PREFIX = '\0mobile-stub:';

/** Every name a module exports, and whether it is a function or a value. */
function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(/^export (?:async )?(function|const|let|class) ([A-Za-z0-9_$]+)/gm)) {
    out.push({ name: m[2], kind: m[1] === 'function' ? 'fn' : 'value' });
  }
  return out;
}

function stubSource(file) {
  const lines = ["import { h } from '/dev/mobileStore.js';"];
  if (file.endsWith('services/firebase.js')) {
    // The pure date helpers it re-exports are real.
    lines.push("export { todayLocal, nextRecurrenceDates } from '/src/services/recurrence.js';");
  }
  for (const { name, kind } of exportsOf(file)) {
    if (kind === 'value') lines.push(`export const ${name} = h.value(${JSON.stringify(name)});`);
    else if (/^use[A-Z]/.test(name)) lines.push(`export function ${name}(...a) { return h.use(${JSON.stringify(name)}, a); }`);
    else lines.push(`export function ${name}(...a) { return h.call(${JSON.stringify(name)}, a); }`);
  }
  return lines.join('\n');
}

function mobileStubs() {
  return {
    name: 'mobile-harness-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(PREFIX) || importer.includes('/dev/mobileStore')) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      const id = r?.id?.split('?')[0];
      return id && STUBBED.includes(id) ? PREFIX + id : null;
    },
    load(id) {
      return id.startsWith(PREFIX) ? stubSource(id.slice(PREFIX.length)) : null;
    },
  };
}

export default defineConfig({
  root,
  plugins: [mobileStubs(), react()],
  base: '/',
  define: { __APP_VERSION__: '"harness"', __BUILD_DATE__: '"harness"' },
});
