// T-0058 / NEW-003 — the weekly grid, on screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, clickText, muteConsoleError } from './dom.mjs';

const window = setupDom();
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};
globalThis.URL.createObjectURL = window.URL.createObjectURL;
globalThis.Blob = window.Blob;

const { default: TimesheetView } = await import('../../src/components/TimesheetView.jsx');
const { weekLabel, weekDays } = await import('../../src/services/timesheet.js');
const { todayLocal } = await import('../../src/services/recurrence.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

test('it opens on the current week', async () => {
  const ui = await mount(h(TimesheetView, {}));
  assert.match(text(ui.container), new RegExp(weekLabel(weekDays(todayLocal(), 1))));
  ui.unmount();
});

test('an empty week says what to do, not "no data"', async () => {
  const ui = await mount(h(TimesheetView, {}));
  assert.match(text(ui.container), /No hours logged this week/);
  assert.match(text(ui.container), /Log time from a task/);
  ui.unmount();
});

test('you can walk back and forward through weeks', async () => {
  const ui = await mount(h(TimesheetView, {}));
  const thisWeek = weekLabel(weekDays(todayLocal(), 1));
  await clickText(ui.container, 'Previous week');
  assert.doesNotMatch(text(ui.container), new RegExp(thisWeek));
  await clickText(ui.container, 'This week');
  assert.match(text(ui.container), new RegExp(thisWeek));
  ui.unmount();
});

test('"This week" only appears when you are somewhere else', async () => {
  const ui = await mount(h(TimesheetView, {}));
  const labels = () => [...ui.container.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(!labels().some((l) => l === 'This week'), 'we are already here');
  await clickText(ui.container, 'Next week');
  assert.ok(labels().some((l) => l === 'This week'));
  ui.unmount();
});

test('the project filter is a dropdown with a clear default', async () => {
  const ui = await mount(h(TimesheetView, {}));
  const select = [...ui.container.querySelectorAll('select')]
    .find((s) => [...s.options].some((o) => o.textContent === 'All projects'));
  assert.ok(select);
  assert.equal(select.value, 'all');
  ui.unmount();
});

test('the timesheet can be exported', async () => {
  const ui = await mount(h(TimesheetView, {}));
  assert.ok([...ui.container.querySelectorAll('button')].some((b) => /Export/.test(b.textContent)));
  ui.unmount();
});

test('it is in the Reports hub, on its own route', async () => {
  const { VIEW_REGISTRY, hubForView } = await import('../../src/services/views.js');
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  assert.ok(VIEW_REGISTRY.find((v) => v.id === 'timesheet' && v.label === 'Timesheet'));
  assert.equal(hubForView('timesheet')?.id, 'reports');
  assert.match(app, /route\.view === 'timesheet'/);
});

test('⌘K can reach it', async () => {
  const { buildCommands } = await import('../../src/services/commandPalette.js');
  assert.ok(buildCommands('timesheet').some((c) => c.payload?.view === 'timesheet'));
});

test('the week start preference is respected, not hardcoded', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TimesheetView.jsx'), 'utf8');
  assert.match(src, /settings\.weekStart \?\? 1/);
  assert.match(src, /weekDays\(anchor, weekStart\)/);
});
