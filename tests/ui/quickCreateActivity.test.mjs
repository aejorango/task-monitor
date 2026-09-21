// T-0093 / BUG-016 — ⌘K → "Log an activity" opens the picker.
//
//   1. Given the user types "log hours" in ⌘K
//   2. When they run the "Log an activity" command
//   3. Then the Work Performed page opens with its task picker already showing
//
// The palette half is in tests/ui/commandPalette.test.mjs. This is the
// receiving end: the real page, the real event.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

setupDom();

const { default: WorkPerformedView } = await import('../../src/components/WorkPerformedView.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');
const { requestQuickCreate } = await import('../../src/hooks/useQuickCreate.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const render = () => mount(h(ToastProvider, null, h(WorkPerformedView, { projectFilter: 'all' })));
const pickerIn = (ui) => [...ui.container.querySelectorAll('[role="dialog"]')]
  .find((d) => /Log activity/.test(d.textContent));

test('the page opens with no picker showing', async () => {
  const ui = await render();
  assert.equal(pickerIn(ui), undefined);
  ui.unmount();
});

test('the quick-create request opens the task picker', async () => {
  const ui = await render();
  await act(async () => { requestQuickCreate('activity', ''); });

  const picker = pickerIn(ui);
  assert.ok(picker, 'this is what did nothing before: the page opened and stayed still');
  assert.match(picker.textContent, /Pick the task you worked on/);
  ui.unmount();
});

test('a request for something else leaves the page alone', async () => {
  const ui = await render();
  await act(async () => { requestQuickCreate('task', 'draft the brief'); });
  assert.equal(pickerIn(ui), undefined, 'the board owns that one');
  ui.unmount();
});

test('asking twice reopens it after it is closed', async () => {
  const ui = await render();
  await act(async () => { requestQuickCreate('activity', ''); });
  assert.ok(pickerIn(ui));

  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(pickerIn(ui), undefined, 'Escape closes it');

  await act(async () => { requestQuickCreate('activity', ''); });
  assert.ok(pickerIn(ui), 'and the command still works the second time');
  ui.unmount();
});
