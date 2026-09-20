// T-0050 / NEW-001 — the configurable task table, rendered.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, clickText, text, muteConsoleError } from './dom.mjs';

const window = setupDom();
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};
globalThis.URL.createObjectURL = window.URL.createObjectURL;
globalThis.Blob = window.Blob;

const { default: TasksTableView } = await import('../../src/components/TasksTableView.jsx');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

test('the page renders with its toolbar even with no data', async () => {
  const ui = await mount(h(TasksTableView, {}));
  const shown = text(ui.container);
  assert.match(shown, /Task table/);
  assert.match(shown, /Group by/);
  assert.match(shown, /Columns \(\d+\)/);
  ui.unmount();
});

test('an empty workspace says what to do, not "0 results"', async () => {
  const ui = await mount(h(TasksTableView, {}));
  assert.match(text(ui.container), /No tasks yet/);
  assert.match(text(ui.container), /Add one on the Kanban board/);
  ui.unmount();
});

test('the grouping control offers every option by name', async () => {
  const ui = await mount(h(TasksTableView, {}));
  const select = [...ui.container.querySelectorAll('select')]
    .find((s) => [...s.options].some((o) => o.textContent === 'No grouping'));
  assert.ok(select, 'no grouping control');
  const labels = [...select.options].map((o) => o.textContent);
  assert.deepEqual(labels, ['No grouping', 'Project', 'Phase', 'Status', 'Priority', 'Assigned to']);
  ui.unmount();
});

test('the column picker lists every column and protects the title', async () => {
  const ui = await mount(h(TasksTableView, {}));
  await clickText(ui.container, 'Columns');
  const rows = [...ui.container.querySelectorAll('.tt-column-row')];
  assert.ok(rows.length >= 13, `expected all columns, saw ${rows.length}`);

  const titleRow = rows.find((r) => r.textContent.includes('Task'));
  assert.equal(titleRow.querySelector('input').disabled, true, 'the title cannot be hidden');
  assert.match(titleRow.textContent, /always shown/);
  ui.unmount();
});

test('the picker explains itself and offers a way back to the default', async () => {
  const ui = await mount(h(TasksTableView, {}));
  await clickText(ui.container, 'Columns');
  const shown = text(ui.container);
  assert.match(shown, /Tick what to show/);
  assert.match(shown, /Reset to the default columns/);
  ui.unmount();
});

test('ticking a column changes the count on the button', async () => {
  const ui = await mount(h(TasksTableView, {}));
  const countOf = () => Number(/Columns \((\d+)\)/.exec(text(ui.container))[1]);
  const before = countOf();
  await clickText(ui.container, 'Columns');
  const row = [...ui.container.querySelectorAll('.tt-column-row')].find((r) => r.textContent.includes('Hours'));
  const { act } = await import('react');
  await act(async () => {
    row.querySelector('input').click();
  });
  assert.equal(countOf(), before + 1);
  ui.unmount();
});

test('the toolbar offers both saving the arrangement and exporting it', async () => {
  const ui = await mount(h(TasksTableView, {}));
  const buttons = [...ui.container.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(buttons.some((b) => /Save as view/.test(b)));
  assert.ok(buttons.some((b) => /Export/.test(b)));
  ui.unmount();
});

// ─── wiring ─────────────────────────────────────────────────────────────────

const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

test('the view is in the sidebar under Reports', () => {
  assert.match(shell, /id: 'tasks-table',\s+label: 'Task table'/);
  assert.match(shell, /childIds: \['tasks-table', 'table'/);
});

test('the route renders it and passes the saved view through', () => {
  assert.match(app, /route\.view === 'tasks-table'/);
  assert.match(app, /savedViewId=\{route\.savedViewId\}/,
    'without this, opening a saved view would not restore its table');
});

test('a saved view restores its own columns when reopened', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TasksTableView.jsx'), 'utf8');
  assert.match(src, /views\.find\(\(v\) => v\.id === savedViewId\)/);
  assert.match(src, /normalizeTableConfig\(savedView\)/);
  assert.match(src, /if \(seenView !== savedViewId\)/,
    'switching between two saved views must swap the table');
});

test('saving writes only the four table fields', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TasksTableView.jsx'), 'utf8');
  assert.match(src, /updateSavedView\(savedView\.id, tableConfigFields\(config\)\)/);
  assert.match(src, /\.\.\.tableConfigFields\(config\),/);
});

test('the sidebar link carries the saved view id into the route', () => {
  assert.match(shell, /savedViewId:\s+v\.id,/);
});
