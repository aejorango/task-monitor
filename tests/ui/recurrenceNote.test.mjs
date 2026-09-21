// T-0124 / POL-014 — the note under the recurrence controls, as a user reads it.
//
//   1. Given the recurrence editor is switched on
//   2. When the user reads the note beneath it
//   3. Then it describes both the on-completion path and the catch-up path,
//      including the stated limit
//
// tests/ui/copy.test.mjs guards the same sentence as source text. This renders
// the real component and reads what is actually on screen, because the note is
// conditional — a guard that only reads the file would pass on a paragraph the
// user never sees.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError, text } from './dom.mjs';

setupDom();

const { RecurrenceEditor } = await import('../../src/components/TaskEditor.jsx');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const WEEKLY = { rule: 'weekly', interval: 1, dayOfWeek: 2, until: '' };

const editor = (value) => mount(h(RecurrenceEditor, { value, onChange() {} }));
const note = (ui) => {
  const p = [...ui.container.querySelectorAll('p')]
    .find((el) => /created|appears/i.test(el.textContent));
  return p ? p.textContent.replace(/\s+/g, ' ').trim() : null;
};

test('switched off, there is no note to read', async () => {
  const ui = await editor(null);
  assert.equal(note(ui), null);
  ui.unmount();
});

test('switched on, the note names both ways an occurrence appears', async () => {
  const ui = await editor(WEEKLY);
  const copy = note(ui);
  assert.ok(copy, 'the note is what a user reads before trusting recurrence');

  // (1) spawnNextRecurrence, on marking the task done.
  assert.match(copy, /created when you mark this done/i);
  // (2) useRecurrenceCatchUp, for the occurrence nobody ticked off. The old
  // sentence stopped at (1), which reads as "a weekly ritual nobody completes
  // simply stops" — the opposite of what a schedule is for.
  assert.match(copy, /if it is missed/i);
  ui.unmount();
});

test('the note states the limit rather than leaving it to be discovered', async () => {
  const ui = await editor(WEEKLY);
  const copy = note(ui);
  // The catch-up runs in the app, not on a cloud schedule.
  assert.match(copy, /next time somebody opens the app/i);
  // HORIZON_DAYS = 0: it appears on its own day, not a week early.
  assert.match(copy, /on the day it is next due/i);
  ui.unmount();
});

test('the note is plain language — no jargon, no file names, no code', async () => {
  const ui = await editor(WEEKLY);
  const copy = note(ui);
  for (const word of ['instance', 'auto-created', 'materialise', 'catch-up', 'hook', '.js']) {
    assert.ok(!copy.toLowerCase().includes(word.toLowerCase()),
      `"${word}" is implementation vocabulary: ${copy}`);
  }
  ui.unmount();
});

test('the note appears for every rule, not only the weekly default', async () => {
  for (const rule of ['daily', 'weekly', 'monthly']) {
    const ui = await editor({ ...WEEKLY, rule });
    assert.match(note(ui) || '', /if it is missed/i, `missing for ${rule}`);
    ui.unmount();
  }
});

test('turning recurrence on brings the note with it', async () => {
  // The same component, driven the way the editor drives it.
  let value = null;
  const ui = await mount(h(RecurrenceEditor, { value, onChange(v) { value = v; } }));
  assert.equal(note(ui), null);

  const box = ui.container.querySelector('input[type="checkbox"]');
  await act(async () => {
    // A real click: React routes checkbox onChange off the click event, and
    // assigning `.checked` directly is skipped because React tracks the
    // previous value on the node (the same reason typeInto exists).
    box.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.ok(value, 'ticking the box must produce a recurrence');

  await ui.render(h(RecurrenceEditor, { value, onChange() {} }));
  assert.match(note(ui) || '', /if it is missed/i);
  assert.match(text(ui.container), /Recurring task/);
  ui.unmount();
});
