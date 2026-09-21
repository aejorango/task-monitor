// T-0090 / BUG-014 — the Gantt row a due-only task actually renders.
//
//   1. Given a task with plan.endDate set and plan.startDate empty
//   2. When the Gantt page renders it
//   3. Then a single-day marker appears on its due date, and dragging its left
//      edge sets a real plan.startDate
//
// The arithmetic is in src/services/ganttGeometry.test.mjs. This renders the
// real row and drives a real pointer drag over it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();

const { GanttRow } = await import('../../src/components/GanttView.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const source = read('src', 'components', 'GanttView.jsx');
const css = read('src', 'App.css');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const DAY_WIDTH = 36;
const RANGE = { min: new Date(2026, 8, 21), max: new Date(2026, 9, 21) };  // 21 Sep → 21 Oct
const TODAY = new Date(2026, 8, 21);

const dueOnly = {
  id: 't1', title: 'Draft proposal', status: 'todo',
  plan: { startDate: null, endDate: '2026-09-25' },
};
const ranged = {
  id: 't2', title: 'Write the report', status: 'todo',
  plan: { startDate: '2026-09-21', endDate: '2026-09-25' },
};

/** Every plan write a rendered row makes, newest last. */
const writes = [];

const renderRow = (task) => mount(h(ToastProvider, null, h(GanttRow, {
  task,
  onSavePlan: (id, patch) => { writes.push([id, patch]); },
  project: { id: 'p1', name: 'Bridged', color: '#4f46e5' },
  phaseName: 'Discovery',
  range: RANGE,
  zoomConf: { id: 'day', dayWidth: DAY_WIDTH },
  totalWidth: 31 * DAY_WIDTH, phaseWidth: 120, taskWidth: 200, rowWidth: 1400,
  today: TODAY,
})));

const barOf = (ui) => ui.container.querySelector('.gantt-bar.plan');

/** A real pointer drag on `el`, from x0 to x1, in window-level events. */
const drag = async (el, x0, x1) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x0 }));
  });
  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: x1 }));
  });
  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: x1 }));
  });
};

// ─── the bar exists at all ──────────────────────────────────────────────────

test('a task with only a due date gets a bar, not a blank track', async () => {
  const ui = await renderRow(dueOnly);
  const bar = barOf(ui);
  assert.ok(bar, 'this row used to render a title and nothing else');
  ui.unmount();
});

test('the bar is exactly one day column wide, on the due date', async () => {
  const ui = await renderRow(dueOnly);
  const bar = barOf(ui);
  assert.equal(bar.style.width, `${DAY_WIDTH}px`);
  assert.equal(bar.style.left, `${4 * DAY_WIDTH}px`, 'the 25th, four columns after the 21st');
  ui.unmount();
});

test('it is marked as a milestone so it reads as a marker, not a range', async () => {
  const ui = await renderRow(dueOnly);
  assert.ok(barOf(ui).classList.contains('milestone'));
  ui.unmount();
});

test('a real range is still a range, and not marked as a milestone', async () => {
  const ui = await renderRow(ranged);
  const bar = barOf(ui);
  assert.equal(bar.style.width, `${5 * DAY_WIDTH}px`);
  assert.equal(bar.classList.contains('milestone'), false);
  ui.unmount();
});

test('a task with no plan dates at all still draws no plan bar', async () => {
  const ui = await renderRow({ id: 't3', title: 'Someday', status: 'todo', plan: {}, actual: { startDate: '2026-09-22' } });
  assert.equal(barOf(ui), null, 'it earns a row for its actual bar, not a pretend plan');
  ui.unmount();
});

// ─── and it says what it is ─────────────────────────────────────────────────

test('the bar is honest about the start date the user never set', async () => {
  const ui = await renderRow(dueOnly);
  const bar = barOf(ui);
  assert.match(bar.getAttribute('title'), /Due 2026-09-25 · no start date yet — drag the left edge to set one/);
  assert.match(bar.getAttribute('aria-label'), /Draft proposal — Due 2026-09-25/,
    'a screen reader gets the task name with it');
  ui.unmount();
});

test('a real range says what it is', async () => {
  const ui = await renderRow(ranged);
  assert.equal(barOf(ui).getAttribute('title'), 'Plan: 2026-09-21 → 2026-09-25');
  ui.unmount();
});

// ─── dragging it ────────────────────────────────────────────────────────────

test('dragging the left edge of a due-only task gives it a start date', async () => {
  writes.length = 0;
  const ui = await renderRow(dueOnly);
  const handle = ui.container.querySelector('.gantt-handle-left');
  assert.ok(handle, 'the milestone has a left handle to grab');

  // Three day columns to the left.
  await drag(handle, 500, 500 - 3 * DAY_WIDTH);

  const [id, patch] = writes.at(-1);
  assert.equal(id, 't1');
  assert.deepEqual(patch, { 'plan.startDate': '2026-09-22', 'plan.endDate': '2026-09-25' },
    'the acceptance criterion: a plan.startDate where there was none');
  ui.unmount();
});

test('the left edge cannot be dragged past the due date', async () => {
  writes.length = 0;
  const ui = await renderRow(dueOnly);
  await drag(ui.container.querySelector('.gantt-handle-left'), 500, 500 + 5 * DAY_WIDTH);
  assert.deepEqual(writes.at(-1)[1], { 'plan.startDate': '2026-09-25', 'plan.endDate': '2026-09-25' });
  ui.unmount();
});

test('moving a milestone keeps it one day long', async () => {
  writes.length = 0;
  const ui = await renderRow(dueOnly);
  await drag(barOf(ui), 500, 500 + 7 * DAY_WIDTH);
  assert.deepEqual(writes.at(-1)[1], { 'plan.startDate': '2026-10-02', 'plan.endDate': '2026-10-02' });
  ui.unmount();
});

test('a range dropped back where it started writes nothing', async () => {
  writes.length = 0;
  const ui = await renderRow(ranged);
  await drag(barOf(ui), 500, 500);
  assert.equal(writes.length, 0, 'an accidental click must not cost a write');
  ui.unmount();
});

test('the bar follows the pointer while the drag is still going', async () => {
  const ui = await renderRow(dueOnly);
  const bar = barOf(ui);
  await act(async () => {
    ui.container.querySelector('.gantt-handle-left')
      .dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 500 }));
  });
  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 500 - 2 * DAY_WIDTH }));
  });
  assert.equal(barOf(ui).style.width, `${3 * DAY_WIDTH}px`, 'two columns wider than the one it started at');
  await act(async () => { window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 500 - 2 * DAY_WIDTH })); });
  ui.unmount();
});

// ─── and it stays fixed ─────────────────────────────────────────────────────

test('the row no longer refuses to drag a task without both plan dates', () => {
  assert.doesNotMatch(source, /if \(!planStart \|\| !planEnd\) return;/,
    'that line is what made a due-only row unfixable by dragging');
  assert.match(source, /const origin = dragOrigin\(task, rangeMin\);/);
});

test('the committed drag goes through the real write by default', () => {
  assert.match(source, /onSavePlan = updateTask,/,
    'the seam exists for the harness; the app still writes for real');
  // The commit reads the task and the drag from refs since T-0134, so the
  // listeners need installing only once per gesture — but it is still one
  // dragPatch handed to onSavePlan.
  assert.match(source, /await onSavePlan\(current\.id, patch\);/);
  assert.match(source, /const patch = dragPatch\(current, rangeMin,/);
});

test('the geometry is the pure module, not a second copy in the component', () => {
  assert.match(source, /from '\.\.\/services\/ganttGeometry'/);
  assert.doesNotMatch(source, /liveStart && liveEnd \? \(diffDays/,
    'the inline geometry that needed both dates is gone');
});

test('a milestone stays visible and grabbable at month zoom', () => {
  const block = css.slice(css.indexOf('.gantt-bar.plan.milestone {'));
  assert.match(block, /min-width: \d+px/, 'a six-pixel day column would otherwise be unclickable');
  assert.doesNotMatch(block.slice(0, 300), /transform: rotate/,
    'a rotated diamond moves the resize handles away from where a user reaches for them');
});

// ─── T-0091: the docs carry it too ──────────────────────────────────────────

test('CLAUDE.md records the rule, so a future change does not undo it', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /ganttGeometry/, 'the module belongs in the file map');
  assert.match(claude, /one-day milestone/, 'the rule itself, in one line');
});

test('the README lists the two new suites and the harness', () => {
  const readme = read('README.md');
  assert.match(readme, /src\/services\/ganttGeometry\.test\.mjs/);
  assert.match(readme, /tests\/ui\/ganttMilestone\.test\.mjs/);
  assert.match(readme, /\/dev\/gantt\.html/);
});

test('the changelog records both halves of the fix', () => {
  const log = read('CHANGELOG.md');
  assert.match(log, /T-0089 — Gantt draws an empty row/);
  assert.match(log, /T-0090 — Gantt draws an empty row/);
});
