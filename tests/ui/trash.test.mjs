// T-0057 / MISS-008 — "this can be restored" must be true.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();
const { default: TrashView } = await import('../../src/components/TrashView.jsx');
const firebase = await import('../../src/services/firebase.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

test('an empty trash explains itself rather than showing nothing', async () => {
  const ui = await mount(h(TrashView, {}));
  const shown = text(ui.container);
  assert.match(shown, /Trash is empty/);
  assert.match(shown, /Anything you delete shows up here, and can be put back/);
  ui.unmount();
});

test('the page says what deleting actually means', async () => {
  const ui = await mount(h(TrashView, {}));
  assert.match(text(ui.container), /Nothing is lost until you say so/);
  ui.unmount();
});

test('the data layer can read back what was soft-deleted', () => {
  assert.equal(typeof firebase.subscribeToDeleted, 'function');
  assert.equal(typeof firebase.restoreDeleted, 'function');
  assert.equal(typeof firebase.deleteForever, 'function');
});

test('restoring is the exact inverse of deleting', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'services', 'firebase.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function restoreDeleted'));
  assert.match(fn.slice(0, 400), /deleted: false/);
  assert.match(fn.slice(0, 400), /updatedAt: serverTimestamp\(\)/);
});

test('a task can never be removed for good — activities point at it', async () => {
  assert.equal(firebase.CAN_DELETE_FOREVER.includes('task'), false);
  await assert.rejects(() => firebase.deleteForever('task', 'x'),
    /activity log refers to it/);
});

test('the refusal explains why, not just that', async () => {
  try {
    await firebase.deleteForever('task', 'x');
    assert.fail('should have refused');
  } catch (err) {
    assert.match(err.message, /It stays in Trash\./);
    assert.doesNotMatch(err.message, /Cannot permanently/);
  }
});

test('an unknown kind is refused rather than guessed at', async () => {
  await assert.rejects(() => firebase.restoreDeleted('workspace', 'x'), /Cannot restore/);
  await assert.rejects(() => firebase.deleteForever('workspace', 'x'), /Cannot permanently/);
});

test('deleting forever asks first, inline, not with a browser confirm', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TrashView.jsx'), 'utf8');
  assert.doesNotMatch(src, /window\.confirm|[^.]\bconfirm\(/);
  assert.match(src, /Remove for good\?/);
  assert.match(src, /Yes, delete/);
  assert.match(src, /Cancel/);
});

test('a task row says why it cannot be purged, instead of hiding the button', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TrashView.jsx'), 'utf8');
  assert.match(src, /Kept — the activity log refers to it/);
});

test('Trash is in the sidebar and on a route', () => {
  const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  assert.match(shell, /id: 'trash',\s+label: 'Trash'/);
  assert.match(app, /route\.view === 'trash'/);
});

test('only Trash hard-deletes, and only three kinds', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'services', 'firebase.js'), 'utf8');
  const deleteDocCalls = src.split('\n').filter((l) => /\bdeleteDoc\(/.test(l) && !l.trim().startsWith('//'));
  // presence (a heartbeat, not user data) and deleteForever. Nothing else.
  assert.ok(deleteDocCalls.length <= 3, `hard deletes found:\n${deleteDocCalls.join('\n')}`);
  assert.deepEqual(firebase.CAN_DELETE_FOREVER, ['project', 'minute', 'goal']);
});
