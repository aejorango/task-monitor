// T-0024 / IMP-007 — a clone with no .env must get instructions, not a blank page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();
const { default: SetupRequiredView } = await import('../../src/components/SetupRequiredView.jsx');
const { readFirebaseConfig } = await import('../../src/services/firebaseConfig.js');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

test('with no .env the screen names all six variables and what to do', async () => {
  const { missing } = readFirebaseConfig({});
  const ui = await mount(h(SetupRequiredView, { missing }));
  const shown = text(ui.container);

  assert.match(shown, /connect a Firebase project/i);
  assert.match(shown, /console\.firebase\.google\.com/);
  assert.match(shown, /\.env\.example/);
  for (const key of [
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_SENDER_ID', 'VITE_FIREBASE_APP_ID',
  ]) {
    assert.match(shown, new RegExp(key), `${key} not named on the setup screen`);
  }
  ui.unmount();
});

test('a partially filled .env names only what is still needed', async () => {
  const { missing } = readFirebaseConfig({
    VITE_FIREBASE_API_KEY: 'AIzaSyReal',
    VITE_FIREBASE_AUTH_DOMAIN: 'real.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'real',
    VITE_FIREBASE_STORAGE_BUCKET: 'real.appspot.com',
    VITE_FIREBASE_SENDER_ID: '1234',
  });
  const ui = await mount(h(SetupRequiredView, { missing }));
  const shown = text(ui.container);
  assert.match(shown, /Still needed/);
  assert.match(shown, /VITE_FIREBASE_APP_ID/);
  assert.doesNotMatch(shown, /VITE_FIREBASE_API_KEY/);
  ui.unmount();
});

test('an unedited .env.example says so rather than "not set"', async () => {
  const { missing } = readFirebaseConfig({ VITE_FIREBASE_PROJECT_ID: 'your-project-id' });
  const ui = await mount(h(SetupRequiredView, { missing }));
  assert.match(text(ui.container), /still the example value/);
  ui.unmount();
});

test('the screen renders something, whatever it is handed', async () => {
  for (const missing of [[], undefined]) {
    const ui = await mount(h(SetupRequiredView, { missing }));
    assert.ok(text(ui.container).length > 50);
    ui.unmount();
  }
});

// ─── the boot guard ─────────────────────────────────────────────────────────

const mainSrc = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'src', 'main.jsx'), 'utf8',
);

test('main.jsx checks the config before anything imports Firebase', () => {
  const checkAt = mainSrc.indexOf('readFirebaseConfig(import.meta.env)');
  const importAt = mainSrc.indexOf("import('./services/firebase.js')");
  assert.ok(checkAt > -1, 'the guard must exist');
  assert.ok(importAt > checkAt,
    'services/firebase.js calls initializeApp() at module scope — importing it first is the bug');
});

test('Firebase is imported dynamically, not at the top of main.jsx', () => {
  const staticImports = mainSrc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^import\s[^(]*\sfrom\s/.test(l));
  assert.ok(!staticImports.some((l) => /services\/firebase\.js/.test(l)),
    'a static import runs before the guard can stop it');
  assert.ok(!staticImports.some((l) => /App\.jsx/.test(l)),
    'App.jsx pulls in Firebase transitively');
});

// ─── the one-command launcher ───────────────────────────────────────────────

test('npm start runs the app and the bridge together', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf8',
  ));
  assert.equal(pkg.scripts.start, 'node scripts/start.mjs');

  const launcher = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'scripts', 'start.mjs'), 'utf8',
  );
  assert.match(launcher, /vite/, 'must start the web app');
  assert.match(launcher, /bridge\/server\.mjs/, 'must start the AI bridge');
  assert.match(launcher, /SIGINT/, 'Ctrl-C must take both down, not orphan one');
  assert.match(launcher, /optional: true/, 'the bridge is optional — the app runs without AI');
});

test('the launcher adds no dependency', () => {
  const launcher = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'scripts', 'start.mjs'), 'utf8',
  );
  for (const line of launcher.split('\n')) {
    const m = /^import .*from ['"]([^'"]+)['"]/.exec(line.trim());
    if (m) assert.match(m[1], /^node:/, `${m[1]} is a dependency; keep the launcher zero-dep`);
  }
});
