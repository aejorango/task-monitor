// T-0061 / NEW-008 — say what happened, and let it be taken back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, clickText, muteConsoleError } from './dom.mjs';

setupDom();
const { ToastProvider, useToast } = await import('../../src/components/Toast.jsx');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

/** Mount the provider and hand the toast API back. */
async function withToast() {
  let api = null;
  function Probe() { api = useToast(); return null; }
  const ui = await mount(h(ToastProvider, null, h(Probe)));
  return { ui, api: () => api };
}

test('nothing is shown until something is said', async () => {
  const { ui } = await withToast();
  assert.equal(ui.container.querySelectorAll('.toast').length, 0);
  ui.unmount();
});

test('a message appears, with its tone', async () => {
  const { ui, api } = await withToast();
  const { act } = await import('react');
  await act(async () => { api().success('Task deleted.'); });
  assert.match(text(ui.container), /Task deleted\./);
  assert.ok(ui.container.querySelector('.toast-success'));
  ui.unmount();
});

test('an error is announced to a screen reader, a confirmation is not interrupted', async () => {
  const { ui, api } = await withToast();
  const { act } = await import('react');
  await act(async () => { api().error('Could not save.'); api().success('Saved.'); });
  assert.ok(ui.container.querySelector('[role="alert"]'), 'errors interrupt');
  assert.ok(ui.container.querySelector('[role="status"]'), 'confirmations do not');
  ui.unmount();
});

test('an Undo button appears only when there is something to undo', async () => {
  const { ui, api } = await withToast();
  const { act } = await import('react');
  await act(async () => { api().success('Saved.'); });
  assert.equal(ui.container.querySelectorAll('.toast-undo').length, 0);
  await act(async () => { api().success('Deleted.', { undo: () => {} }); });
  assert.equal(ui.container.querySelectorAll('.toast-undo').length, 1);
  ui.unmount();
});

test('pressing Undo runs the action and clears the toast', async () => {
  const { ui, api } = await withToast();
  const { act } = await import('react');
  let undone = 0;
  await act(async () => { api().success('Deleted.', { undo: () => { undone += 1; } }); });
  await clickText(ui.container, 'Undo');
  assert.equal(undone, 1);
  assert.equal(ui.container.querySelectorAll('.toast').length, 0);
  ui.unmount();
});

test('an undo that fails says so rather than silently doing nothing', async () => {
  const { ui, api } = await withToast();
  const { act } = await import('react');
  await act(async () => {
    api().success('Deleted.', { undo: () => { throw new Error('nope'); } });
  });
  await clickText(ui.container, 'Undo');
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.match(text(ui.container), /could not be undone/);
  ui.unmount();
});

test('a toast can be dismissed by hand', async () => {
  const { ui, api } = await withToast();
  const { act } = await import('react');
  await act(async () => { api().info('Something.'); });
  const close = ui.container.querySelector('.toast-close');
  assert.equal(close.getAttribute('aria-label'), 'Dismiss');
  await act(async () => { close.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.equal(ui.container.querySelectorAll('.toast').length, 0);
  ui.unmount();
});

test('an undo toast stays around longer than a plain one', async () => {
  const { TOAST_MS, UNDO_MS } = await import('../../src/components/Toast.jsx');
  assert.ok(UNDO_MS > TOAST_MS, 'you have to notice it, then decide');
});

test('the stack does not grow without limit', async () => {
  const { ui, api } = await withToast();
  const { act } = await import('react');
  await act(async () => { for (let i = 0; i < 12; i += 1) api().info(`Message ${i}`); });
  assert.ok(ui.container.querySelectorAll('.toast').length <= 4);
  ui.unmount();
});

test('useToast outside a provider does nothing rather than throwing', async () => {
  let api = null;
  function Probe() { api = useToast(); return null; }
  const ui = await mount(h(Probe));
  assert.doesNotThrow(() => api.success('x'));
  ui.unmount();
});

// ─── the delete paths ───────────────────────────────────────────────────────

for (const [file, kind] of [
  ['TaskEditor.jsx', 'task'],
  ['ProjectsView.jsx', 'project'],
  ['MinutesView.jsx', 'minute'],
]) {
  test(`deleting a ${kind} offers Undo instead of asking first`, () => {
    const src = fs.readFileSync(path.join(root, 'src', 'components', file), 'utf8');
    assert.match(src, new RegExp(`restoreDeleted\\('${kind}'`), `${file} has no undo`);
    assert.match(src, /toast\.success\(/, file);
  });
}

test('deleting a task no longer stops to ask', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TaskEditor.jsx'), 'utf8');
  const fn = src.slice(src.indexOf('const remove = async'), src.indexOf('const saveAsTemplate'));
  assert.doesNotMatch(fn, /confirm\(/, 'an Undo toast beats a dialog nobody reads');
  assert.match(fn, /undo:/);
});

test('the provider is mounted once, around the app', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  assert.equal((app.match(/<ToastProvider>/g) || []).length, 1);
});
