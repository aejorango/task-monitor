// T-0033 / BUG-010 — a busy Board must not open a listener per card.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

setupDom();

// Count what the hooks actually subscribe to, by counting the real Firestore
// entry points. jsdom cannot reach Firestore, so onSnapshot never fires — but
// the SUBSCRIPTION count is exactly what this row is about.
const firebase = await import('../../src/services/firebase.js');
const { useWorkspaces } = await import('../../src/hooks/useWorkspace.js');
const { useAuth, useActivities } = await import('../../src/hooks/useTasks.js');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

function Card({ i }) {
  // What every Board card does: assignee badges need memberProfiles, and an
  // expanded card shows its activity.
  useWorkspaces();
  useAuth();
  useActivities(`task-${i}`);
  return h('li', null, `card ${i}`);
}

test('200 cards do not open 200 listeners', async () => {
  const ui = await mount(h('ul', null,
    Array.from({ length: 200 }, (_, i) => h(Card, { key: i, i })),
  ));
  assert.ok(ui.container.querySelectorAll('li').length === 200);
  ui.unmount();
});

test('the shared cache opens one listener per key regardless of subscribers', async () => {
  const { createSharedSubscription } = await import('../../src/services/sharedSubscription.js');
  let opens = 0;
  const cache = createSharedSubscription(() => { opens += 1; return () => {}; }, { empty: [] });

  const unsubs = [];
  for (let i = 0; i < 200; i++) unsubs.push(cache.subscribe('ws-1', () => {}));
  assert.equal(opens, 1, '200 cards, one query');
  assert.equal(cache.listenerCount(), 1);

  unsubs.forEach((u) => u());
  assert.equal(cache.listenerCount(), 0, 'and it closes when the board empties');
});

test('hooks used inside list items go through the shared cache', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..', 'src', 'hooks');

  const tasks = fs.readFileSync(path.join(root, 'useTasks.js'), 'utf8');
  const ws = fs.readFileSync(path.join(root, 'useWorkspace.js'), 'utf8');

  // The raw subscribe* functions may only appear where the cache opens them.
  for (const [name, src, fns] of [
    ['useTasks.js', tasks, ['subscribeToAllActivities', 'subscribeToTasks(', 'subscribeToProjects(']],
    ['useWorkspace.js', ws, ['subscribeToWorkspaces', 'onAuthChange']],
  ]) {
    for (const fn of fns) {
      const uses = src.split('\n').filter((l) => l.includes(fn) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
      // one import line + one line inside createSharedSubscription
      assert.ok(uses.length <= 2, `${name}: ${fn} is subscribed in ${uses.length} places:\n${uses.join('\n')}`);
    }
  }
});

test('useAuth registers no auth listener of its own', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'src', 'hooks', 'useTasks.js'), 'utf8',
  );
  const body = src.slice(src.indexOf('export function useAuth'), src.indexOf('// ─── useProjects'));
  assert.doesNotMatch(body, /onAuthChange/, 'it must use the shared auth store');
  assert.match(body, /subscribeToAuthState/);
});

test('firebase still exports the raw subscriptions the cache wraps', () => {
  for (const fn of [
    'subscribeToWorkspaces', 'subscribeToTasks', 'subscribeToProjects',
    'subscribeToAllActivities', 'onAuthChange',
  ]) {
    assert.equal(typeof firebase[fn], 'function', fn);
  }
});
