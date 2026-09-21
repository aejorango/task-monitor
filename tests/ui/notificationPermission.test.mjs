// T-0111 / BUG-027 — the permission badge stops polling.
//
//   1. Given the Settings page is open and untouched for a minute
//   2. When nothing changes
//   3. Then the component does not re-render, and granting permission from the
//      browser UI still updates the badge
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

// A stand-in browser: Notification.permission plus a Permissions API whose
// `change` event we can fire by hand, the way the browser does when the user
// grants from site settings or from another tab.
let listeners = [];
let statusObj = null;
beforeEach(() => {
  listeners = [];
  globalThis.Notification = { permission: 'default' };
  statusObj = {
    state: 'prompt',
    addEventListener: (type, fn) => { if (type === 'change') listeners.push(fn); },
    removeEventListener: (type, fn) => { listeners = listeners.filter((f) => f !== fn); },
  };
  Object.defineProperty(window.navigator, 'permissions', {
    value: { query: async () => statusObj }, configurable: true,
  });
});

const fresh = () => import(`../../src/hooks/useNotifications.js?case=${Math.random()}`);

/** Counts its own renders, so "does not re-render" is testable. */
function Probe({ useHook, onRender }) {
  const { permission } = useHook();
  onRender(permission);
  return h('span', null, permission);
}

test('it reports the current permission on mount', async () => {
  const { useNotificationPermission } = await fresh();
  const seen = [];
  const ui = await mount(h(Probe, { useHook: useNotificationPermission, onRender: (p) => seen.push(p) }));
  assert.equal(ui.container.textContent, 'default');
  ui.unmount();
});

test('nothing happening means no re-render — the whole point', async () => {
  const { useNotificationPermission } = await fresh();
  const seen = [];
  const ui = await mount(h(Probe, { useHook: useNotificationPermission, onRender: (p) => seen.push(p) }));
  const after = seen.length;

  // Well past the old 1.5-second interval.
  await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
  assert.equal(seen.length, after,
    'Settings is the largest component in the app; it was committing every 1.5 s with no input');
  ui.unmount();
});

test('granting from the browser UI still updates it', async () => {
  const { useNotificationPermission } = await fresh();
  const ui = await mount(h(Probe, { useHook: useNotificationPermission, onRender: () => {} }));
  await act(async () => { await Promise.resolve(); });

  globalThis.Notification.permission = 'granted';
  await act(async () => { listeners.forEach((fn) => fn()); });
  assert.equal(ui.container.textContent, 'granted');
  ui.unmount();
});

test('coming back to the tab re-reads it, for browsers with no Permissions API', async () => {
  Object.defineProperty(window.navigator, 'permissions', { value: undefined, configurable: true });
  const { useNotificationPermission } = await fresh();
  const ui = await mount(h(Probe, { useHook: useNotificationPermission, onRender: () => {} }));
  assert.equal(ui.container.textContent, 'default');

  globalThis.Notification.permission = 'denied';
  await act(async () => { window.dispatchEvent(new window.Event('focus')); });
  assert.equal(ui.container.textContent, 'denied', 'a permission is changed in browser chrome');
  ui.unmount();
});

test('a browser with no Notification API at all says so, and does not crash', async () => {
  delete globalThis.Notification;
  const { useNotificationPermission } = await fresh();
  const ui = await mount(h(Probe, { useHook: useNotificationPermission, onRender: () => {} }));
  assert.equal(ui.container.textContent, 'unsupported');
  ui.unmount();
});

test('it unsubscribes on unmount', async () => {
  const { useNotificationPermission } = await fresh();
  const ui = await mount(h(Probe, { useHook: useNotificationPermission, onRender: () => {} }));
  await act(async () => { await Promise.resolve(); });
  assert.equal(listeners.length, 1);
  ui.unmount();
  assert.equal(listeners.length, 0, 'a listener per mount is a leak on a page people revisit');
});

test('refresh() is there for a component that just asked for permission itself', async () => {
  const { useNotificationPermission } = await fresh();
  let refresh;
  function R() { const s = useNotificationPermission(); refresh = s.refresh; return h('span', null, s.permission); }
  const ui = await mount(h(R));
  globalThis.Notification.permission = 'granted';
  await act(async () => { refresh(); });
  assert.equal(ui.container.textContent, 'granted');
  ui.unmount();
});

// ─── and the polling is really gone ─────────────────────────────────────────

test('Settings no longer polls for the permission', () => {
  const src = read('src', 'components', 'SettingsView.jsx');
  assert.doesNotMatch(src, /setInterval\(\(\) => setNotifPerm\(/);
  assert.doesNotMatch(src, /getNotificationPermission\(\), 1500\)/);
  assert.match(src, /const \{ permission: notifPerm, refresh: refreshNotifPerm \} = useNotificationPermission\(\);/);
});

test('no component polls the notification permission on an interval', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))) {
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    if (/setInterval\([^;]*[Pp]ermission/s.test(src)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], 'use useNotificationPermission()');
});

test('both call sites share the one hook', () => {
  const hooks = read('src', 'hooks', 'useNotifications.js');
  assert.match(hooks, /export function useNotificationPermission\(\)/);
  assert.match(hooks, /const \{ permission, refresh \} = useNotificationPermission\(\);/,
    'useOverdueScan must use it too, or the two can disagree');
  assert.doesNotMatch(hooks, /status\.onchange = update;/, 'the inline copy is gone');
});
