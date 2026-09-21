// T-0086 / BUG-012 — Escape belongs to whatever is actually on screen.
//
// TimerWidget is mounted by AppShell for the entire life of the signed-in app.
// It called useModalDialog above its own `if (!running) return null`, so the
// hook's document-CAPTURE Escape handler — which calls stopPropagation() — was
// installed permanently, and every Escape handler registered on window or on
// document in the bubble phase was dead: the ⌘K search dropdown, the Export ▾
// menu, the inbox panel, the Task-table column picker and the tutorial tour.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();

const { default: TimerWidget } = await import('../../src/components/TimerWidget.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');
const { useTimer } = await import('../../src/hooks/useTimer.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

/** Drives the real timer through its own hook — no test-only back door. */
let timer = null;
function TimerControl() {
  timer = useTimer();
  return null;
}
const startTimer = async (task) => { await act(async () => { timer.start(task); }); };
const stopTimer = async () => { await act(async () => { timer.stop(); }); };

const press = async (target = document) => {
  await act(async () => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
};

/** Stands in for the five real consumers, all of which listen on window or on
 *  document in the BUBBLE phase — exactly what a capture-phase
 *  stopPropagation() at document silences. */
function EscapeConsumer({ on, onEscape }) {
  React.useEffect(() => {
    const target = on === 'window' ? window : document;
    const onKey = (e) => { if (e.key === 'Escape') onEscape(); };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [on, onEscape]);
  return h('span', null, 'consumer');
}

const withToasts = (...children) => h(ToastProvider, null,
  h(TimerControl, { key: 'control' }), ...children);

// ─── the bug itself ─────────────────────────────────────────────────────────

test('with no timer running, Escape reaches a window-level handler', async () => {
  let heard = 0;
  const ui = await mount(withToasts(
    h(TimerWidget, { key: 'timer' }),
    h(EscapeConsumer, { key: 'c', on: 'window', onEscape: () => { heard += 1; } }),
  ));

  await press();
  assert.equal(heard, 1, 'the ⌘K dropdown and the tutorial tour listen here');
  ui.unmount();
});

test('with no timer running, Escape reaches a document-bubble handler', async () => {
  let heard = 0;
  const ui = await mount(withToasts(
    h(TimerWidget, { key: 'timer' }),
    h(EscapeConsumer, { key: 'c', on: 'document', onEscape: () => { heard += 1; } }),
  ));

  await press();
  assert.equal(heard, 1, 'the Export menu, the inbox and the column picker listen here');
  ui.unmount();
});

test('a running timer whose stop dialog is shut still lets Escape through', async () => {
  let heard = 0;
  const ui = await mount(withToasts(
    h(TimerWidget, { key: 'timer' }),
    h(EscapeConsumer, { key: 'c', on: 'window', onEscape: () => { heard += 1; } }),
  ));
  await startTimer({ id: 't1', title: 'Write the report' });
  assert.match(ui.container.textContent, /Write the report/, 'the widget is on screen');
  assert.equal(ui.container.querySelector('.modal-backdrop'), null, 'but its dialog is not');

  await press();
  assert.equal(heard, 1);
  await stopTimer();
  ui.unmount();
});

test('once the stop dialog is open Escape closes it and goes no further', async () => {
  let heard = 0;
  const ui = await mount(withToasts(
    h(TimerWidget, { key: 'timer' }),
    h(EscapeConsumer, { key: 'c', on: 'window', onEscape: () => { heard += 1; } }),
  ));
  await startTimer({ id: 't1', title: 'Write the report' });

  const stop = [...ui.container.querySelectorAll('button')].find((b) => /Stop/.test(b.textContent));
  await act(async () => {
    stop.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const dialog = ui.container.querySelector('[role="dialog"]');
  assert.ok(dialog, 'the stop dialog is on screen');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');

  await press();
  assert.equal(ui.container.querySelector('[role="dialog"]'), null, 'Escape closed the dialog');
  assert.equal(heard, 0, 'and the app behind it heard nothing');

  await stopTimer();
  ui.unmount();
});

// ─── and it stays fixed ─────────────────────────────────────────────────────

test('TimerWidget tells the hook when its dialog is actually open', () => {
  const src = read('src', 'components', 'TimerWidget.jsx');
  assert.match(src, /useModalDialog\(\{\s*open: confirmOpen/,
    'an always-mounted component must pass `open`');
});

test('no component calls useModalDialog above its own early return', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.jsx')) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    const call = src.indexOf('useModalDialog({');
    if (call === -1) continue;
    if (/open:/.test(src.slice(call, call + 200))) continue;
    // Everything between the hook call and the end of that component: an
    // early `return null` there means the modal can be absent while the hook
    // is live, and the hook would take Escape away from the whole app.
    const body = src.slice(call, src.indexOf('\n}\n', call));
    // Two spaces: the component's OWN top level. A `return null` deeper than
    // that belongs to a .map() callback and says nothing about the modal.
    if (/^ {2}if \(.*\) return null;/m.test(body)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], 'these must pass `open` to useModalDialog');
});

test('the five Escape consumers still listen where the bug affected them', () => {
  const shell = read('src', 'components', 'AppShell.jsx');
  assert.match(shell, /window\.addEventListener\('keydown', onKey\)/);
  for (const [file, hint] of [
    ['ExportButton.jsx', 'the Export ▾ menu'],
    ['InboxBell.jsx', 'the inbox panel'],
    ['TasksTableView.jsx', 'the Task-table column picker'],
  ]) {
    const src = read('src', 'components', file);
    assert.match(src, /if \(e\.key === 'Escape'\)/, `${hint} closes on Escape`);
    assert.match(src, /document\.addEventListener\('keydown', onKey\)/, `${hint} listens in the bubble phase`);
  }
  const tour = read('src', 'components', 'TutorialGuide.jsx');
  assert.match(tour, /Escape/, 'the tutorial tour closes on Escape');
});
