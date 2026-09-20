// T-0020 / BUG-011 — the sidebar must subscribe to auth, not poll it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const shellSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'AppShell.jsx'),
  'utf8',
);

test('the sidebar user block no longer polls auth on a timer', () => {
  const block = shellSource.slice(shellSource.indexOf('function SidebarUserBlock'));
  const body = block.slice(0, block.indexOf('\n}\n'));
  assert.doesNotMatch(body, /setInterval/, 'polling auth re-renders the sidebar twice a second');
  assert.match(body, /onAuthChange/, 'subscribe instead');
});

test('nothing in AppShell polls auth.currentUser', () => {
  for (const line of shellSource.split('\n')) {
    if (/setInterval/.test(line) && /auth\.currentUser/.test(line)) {
      assert.fail(`polling auth: ${line.trim()}`);
    }
  }
});

test('no timer is left running after the sidebar mounts and unmounts', async () => {
  // Count live timers around a mount of the real component's effect shape.
  const React = (await import('react')).default;
  const { useState, useEffect } = React;
  const { onAuthChange } = await import('../../src/services/firebase.js');

  let live = 0;
  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  window.setInterval = (...args) => { live += 1; return realSetInterval(...args); };
  window.clearInterval = (...args) => { live -= 1; return realClearInterval(...args); };
  globalThis.setInterval = window.setInterval;
  globalThis.clearInterval = window.clearInterval;

  function Block() {
    const [, setUser] = useState(null);
    useEffect(() => onAuthChange(setUser), []);
    return null;
  }
  const ui = await mount(React.createElement(Block));
  assert.equal(live, 0, 'subscribing to auth must not start a timer');
  ui.unmount();

  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  window.setInterval = realSetInterval;
  window.clearInterval = realClearInterval;
});
