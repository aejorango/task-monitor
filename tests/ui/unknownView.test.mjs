// T-0109 / BUG-025 — a hash that names no page must not claim to be one.
//
//   1. Given a hash pointing at a view that does not exist
//   2. When the shell renders
//   3. Then the topbar does not claim to be another page, and the content area
//      offers a way back to the Dashboard
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();

const { RENDERABLE_VIEWS, isKnownView } = await import('../../src/components/AppShell.jsx');
const { default: NotFoundView } = await import('../../src/components/NotFoundView.jsx');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

// ─── which views exist ──────────────────────────────────────────────────────

test('every view App.jsx renders inside the shell is a known view', () => {
  const app = read('src', 'App.jsx');
  const shellPart = app.slice(app.indexOf('<Suspense fallback={<ViewSpinner />}>'));
  const rendered = [...shellPart.matchAll(/route\.view === '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(rendered.length > 15, `expected the full branch list, saw ${rendered.length}`);

  const unknown = rendered.filter((v) => !isKnownView(v));
  assert.deepEqual(unknown, [],
    'a rendered view missing from RENDERABLE_VIEWS would show the not-found card over a real page');
});

test('every known view is actually rendered somewhere', () => {
  const app = read('src', 'App.jsx');
  const rendered = new Set([...app.matchAll(/route\.view === '([a-z-]+)'/g)].map((m) => m[1]));
  const orphans = RENDERABLE_VIEWS.map((v) => v.id).filter((id) => !rendered.has(id));
  assert.deepEqual(orphans, [],
    'a sidebar entry with no branch is a link to a blank page');
});

test('a hash nobody recognises is not a known view', () => {
  assert.equal(isKnownView('nonsense'), false);
  assert.equal(isKnownView(''), false);
  assert.equal(isKnownView(undefined), false);
  assert.equal(isKnownView('dashboard'), true);
  assert.equal(isKnownView('invite'), true, 'it renders in the shell without a sidebar entry');
});

// ─── the topbar ─────────────────────────────────────────────────────────────

test('the topbar falls back to the app name, not to the first list entry', () => {
  const shell = read('src', 'components', 'AppShell.jsx');
  assert.match(shell, /\|\| \{ id: route\.view, label: 'Task Monitor' \}/);
  assert.doesNotMatch(shell, /VIEWS\.find\(\(v\) => v\.id === route\.view\) \|\| VIEWS\[0\]/,
    'VIEWS[0] is Ask AI, and the list order is cosmetic');
});

test('the first entry of the list is still Ask AI — so the old fallback really was wrong', () => {
  assert.equal(RENDERABLE_VIEWS[0].id, 'ask-ai',
    'this test documents why the fallback had to change, not a requirement on the order');
});

// ─── the card ───────────────────────────────────────────────────────────────

test('the not-found card names the page and offers a way back', async () => {
  const routes = [];
  const ui = await mount(h(NotFoundView, { view: 'nonsense', navigate: (r) => routes.push(r) }));

  assert.match(ui.container.textContent, /That page does not exist/);
  assert.match(ui.container.textContent, /no page called nonsense/);

  const button = [...ui.container.querySelectorAll('button')]
    .find((b) => /Go to the Dashboard/.test(b.textContent));
  assert.ok(button, 'a blank screen with no way out reads as a crash');

  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(routes, [{ view: 'dashboard', projectFilter: 'all' }]);
  ui.unmount();
});

test('it still reads sensibly with no view name to show', async () => {
  const ui = await mount(h(NotFoundView, { navigate() {} }));
  assert.match(ui.container.textContent, /That page does not exist/);
  assert.doesNotMatch(ui.container.textContent, /no page called\s*\./);
  ui.unmount();
});

test('App renders it for exactly the unknown views', () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /\{!isKnownView\(route\.view\) && <NotFoundView view=\{route\.view\} navigate=\{navigate\} \/>\}/);
});
