// T-0128 / IMP-017 — selecting rows in the task table, and acting on them.
//
//   1. Given ten tasks selected in the Task table
//   2. When the user picks "Set priority → High" from the bulk bar
//   3. Then all ten are updated in one batch, a toast confirms the count with
//      Undo, and the selection clears
//
// The batch and the toast sentence are covered in bulkTasksApi.test.mjs and
// bulkTasks.test.mjs. This is the surface: the real grid, really clicked, and
// the real bar with the real pickers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { useMemo, useState, act } from 'react';
import { setupDom, teardownDom, mount, clickText, muteConsoleError, text } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewSrc = () => fs.readFileSync(path.join(root, 'src', 'components', 'TasksTableView.jsx'), 'utf8');

setupDom();

const { TasksTableGrid, TaskBulkBar } = await import('../../src/components/TasksTableView.jsx');
const { groupTasks, headerCells, normalizeTableConfig } = await import('../../src/services/tableViews.js');
const { pruneSelection, selectionAfterClick, BULK_ACTIONS } = await import('../../src/services/bulkTasks.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const TASKS = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i}`, title: `Task ${i}`, status: 'todo', priority: i < 3 ? 'high' : 'low',
  projectId: 'p1', plan: { endDate: '2026-10-01' }, actual: {}, tags: [], assignedTo: [],
}));
const ctx = { projectById: { p1: { id: 'p1', name: 'BRIDGED' } }, memberProfiles: {}, projects: [{ id: 'p1', name: 'BRIDGED' }] };
const config = normalizeTableConfig({ groupBy: 'none' }, ctx);

/** The grid, driven by the same state TasksTableView drives it with. */
function Harness({ tasks = TASKS, onOpen = () => {}, onSelection = () => {} }) {
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);

  const groups = useMemo(() => groupTasks(tasks, config, ctx), [tasks]);
  const orderedIds = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups]);
  const live = useMemo(() => pruneSelection(selected, orderedIds), [selected, orderedIds]);
  onSelection(live);

  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => live.has(id));

  return h(TasksTableGrid, {
    groups,
    header: headerCells(config, ctx),
    config, ctx,
    selected: live,
    allSelected,
    totalRows: orderedIds.length,
    onToggleAll: () => { setSelected(allSelected ? new Set() : new Set(orderedIds)); setAnchor(null); },
    onSelectRow: (id, e) => {
      const next = selectionAfterClick({
        selected: live, anchor, orderedIds, id,
        shiftKey: e.shiftKey, metaKey: e.metaKey || e.ctrlKey,
      });
      setSelected(next.selected);
      setAnchor(next.anchor);
    },
    onOpenTask: onOpen,
    onSort: () => {},
  });
}

const rowBoxes = (ui) => [...ui.container.querySelectorAll('td.tt-pick input')];
const headBox = (ui) => ui.container.querySelector('th.tt-pick input');
const checked = (ui) => rowBoxes(ui).map((b) => b.checked);
const rows = (ui) => [...ui.container.querySelectorAll('tr.tt-row')];

const click = async (el, init = {}) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
};

/* ── the selection column ──────────────────────────────────────────────── */

test('every row has a checkbox, and it says which task it is for', async () => {
  const ui = await mount(h(Harness));
  assert.equal(rowBoxes(ui).length, 10, 'this column did not exist at all before');
  assert.equal(rowBoxes(ui)[0].getAttribute('aria-label'), 'Select Task 0',
    'a bare checkbox means nothing to a screen reader');
  assert.equal(checked(ui).filter(Boolean).length, 0);
  ui.unmount();
});

test('select-all ticks every row, and clicking it again clears them', async () => {
  const ui = await mount(h(Harness));
  await click(headBox(ui));
  assert.deepEqual(checked(ui), Array(10).fill(true));
  assert.match(headBox(ui).getAttribute('aria-label'), /Clear the selection/,
    'the same control cannot keep saying "select all" once everything is selected');

  await click(headBox(ui));
  assert.deepEqual(checked(ui), Array(10).fill(false));
  ui.unmount();
});

test('the header checkbox reflects the rows, not its own past clicks', async () => {
  const ui = await mount(h(Harness));
  await click(headBox(ui));
  await click(rowBoxes(ui)[4]);              // untick one
  assert.equal(headBox(ui).checked, false, 'nine of ten is not "all"');
  ui.unmount();
});

test('a checkbox selects without opening the task', async () => {
  let opened = null;
  const ui = await mount(h(Harness, { onOpen: (t) => { opened = t; } }));
  await click(rowBoxes(ui)[2]);
  assert.equal(opened, null, 'the checkbox is the one thing in the row that does not open it');
  assert.equal(checked(ui)[2], true);
  ui.unmount();
});

test('a plain click on the row still opens the task', async () => {
  let opened = null;
  const ui = await mount(h(Harness, { onOpen: (t) => { opened = t; } }));
  await click(rows(ui)[3]);
  assert.equal(opened?.id, 't3', 'selection must not take the row click away');
  assert.equal(checked(ui).filter(Boolean).length, 0);
  ui.unmount();
});

// The two gestures the audit asked for.
test('shift-click selects the range between two rows', async () => {
  let opened = null;
  const ui = await mount(h(Harness, { onOpen: (t) => { opened = t; } }));
  await click(rowBoxes(ui)[2]);                                // anchor
  await click(rows(ui)[6], { shiftKey: true });

  assert.deepEqual(checked(ui), [false, false, true, true, true, true, true, false, false, false]);
  assert.equal(opened, null, 'a shift-click extends the selection, it does not open a task');
  ui.unmount();
});

test('cmd-click picks out individual rows and leaves the rest alone', async () => {
  const ui = await mount(h(Harness));
  await click(rowBoxes(ui)[1]);
  await click(rows(ui)[5], { metaKey: true });
  await click(rows(ui)[8], { ctrlKey: true });
  assert.deepEqual(
    checked(ui).map((c, i) => (c ? i : null)).filter((i) => i !== null),
    [1, 5, 8],
  );
  ui.unmount();
});

test('a selected row is marked as selected, not only ticked', async () => {
  const ui = await mount(h(Harness));
  await click(rowBoxes(ui)[0]);
  assert.ok(rows(ui)[0].classList.contains('is-selected'));
  assert.ok(!rows(ui)[1].classList.contains('is-selected'));
  ui.unmount();
});

test('a selection does not survive the rows leaving the table', async () => {
  let live = null;
  const ui = await mount(h(Harness, { onSelection: (s) => { live = s; } }));
  await click(headBox(ui));
  assert.equal(live.size, 10);

  // A project filter change, as the page does it.
  await ui.render(h(Harness, { tasks: TASKS.slice(0, 3), onSelection: (s) => { live = s; } }));
  assert.equal(live.size, 3, 'acting on rows nobody can see is the one thing this must not do');
  ui.unmount();
});

/* ── the bulk bar ──────────────────────────────────────────────────────── */

const bar = (props = {}) => mount(h(TaskBulkBar, {
  count: 10, busy: false, members: ['u-ace', 'u-mia'],
  nameFor: (uid) => ({ 'u-ace': 'Ace Jorango', 'u-mia': 'Mia Santos' }[uid] || uid),
  onClear() {}, onRun() {}, ...props,
}));

test('the bar offers every action the runner knows about', async () => {
  const ui = await bar();
  const labels = [...ui.container.querySelectorAll('button')].map((b) => b.textContent.replace(' ▾', '').trim());
  for (const action of BULK_ACTIONS) {
    assert.ok(labels.includes(action.label), `the bar does not offer ${action.label}`);
  }
  assert.match(text(ui.container), /10 selected/);
  ui.unmount();
});

// The acceptance case.
test('Set priority → High runs that action with that value', async () => {
  const calls = [];
  const ui = await bar({ onRun: (...args) => calls.push(args) });
  await clickText(ui.container, 'Set priority');
  await clickText(ui.container, 'High');
  assert.deepEqual(calls, [['priority', 'high']]);
  assert.equal(ui.container.querySelector('.dropdown-menu'), null, 'the menu closes behind the choice');
  ui.unmount();
});

test('status choices are the words on the board, not the values underneath', async () => {
  const calls = [];
  const ui = await bar({ onRun: (...args) => calls.push(args) });
  await clickText(ui.container, 'Set status');
  const items = [...ui.container.querySelectorAll('.dropdown-item')].map((b) => b.textContent);
  assert.deepEqual(items, ['To Do', 'In Progress', 'Done']);
  assert.ok(!items.includes('todo'), 'nobody picks a value from the database');

  await clickText(ui.container, 'In Progress');
  assert.deepEqual(calls, [['status', 'doing']]);
  ui.unmount();
});

test('people are picked by name, and "Nobody" is one of the choices', async () => {
  const calls = [];
  const ui = await bar({ onRun: (...args) => calls.push(args) });
  await clickText(ui.container, 'Assign to');
  const items = [...ui.container.querySelectorAll('.dropdown-item')].map((b) => b.textContent);
  assert.deepEqual(items, ['Ace Jorango', 'Mia Santos', 'Nobody']);
  assert.ok(!items.some((i) => /u-/.test(i)), 'an account id must never be on screen');

  await clickText(ui.container, 'Mia Santos');
  assert.deepEqual(calls, [['assignee', 'u-mia']]);
  ui.unmount();
});

test('a due date is a date field, and clearing it is offered too', async () => {
  const calls = [];
  const ui = await bar({ onRun: (...args) => calls.push(args) });
  await clickText(ui.container, 'Set due date');
  const field = ui.container.querySelector('#bulk-due-date');
  assert.ok(field, 'a date is picked, never typed as free text');
  assert.equal(field.type, 'date');
  assert.ok(ui.container.querySelector('label[for="bulk-due-date"]'), 'the field needs a label');

  await act(async () => {
    Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value').set.call(field, '2026-11-01');
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await clickText(ui.container, 'Apply');
  assert.deepEqual(calls, [['dueDate', '2026-11-01']]);
  ui.unmount();
});

test('clearing the due date is its own choice, not an empty Apply', async () => {
  const calls = [];
  const ui = await bar({ onRun: (...args) => calls.push(args) });
  await clickText(ui.container, 'Set due date');
  await clickText(ui.container, 'Clear the date');
  assert.deepEqual(calls, [['dueDate', '']]);
  ui.unmount();
});

test('a tag is typed by name, and the # is not required', async () => {
  const calls = [];
  const ui = await bar({ onRun: (...args) => calls.push(args) });
  await clickText(ui.container, 'Add tag');
  const field = ui.container.querySelector('#bulk-tag');
  assert.ok(field);
  await act(async () => {
    Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value').set.call(field, '#client');
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await clickText(ui.container, 'Add #client');
  assert.deepEqual(calls, [['addTag', 'client']]);
  ui.unmount();
});

test('an empty tag cannot be applied', async () => {
  const ui = await bar();
  await clickText(ui.container, 'Add tag');
  const button = [...ui.container.querySelectorAll('button')].find((b) => /^Add #/.test(b.textContent));
  assert.equal(button.disabled, true, 'a button that would do nothing must not be pressable');
  ui.unmount();
});

test('Delete needs no value and is marked as destructive', async () => {
  const calls = [];
  const ui = await bar({ onRun: (...args) => calls.push(args) });
  const button = [...ui.container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete');
  assert.ok(button.classList.contains('btn-danger'));
  await click(button);
  assert.deepEqual(calls, [['delete', undefined]], 'the confirmation is the page’s job, not the bar’s');
  ui.unmount();
});

test('while a bulk write is in flight nothing else can be started', async () => {
  const ui = await bar({ busy: true });
  const actions = [...ui.container.querySelectorAll('button')]
    .filter((b) => !/Clear$/.test(b.textContent.trim()));
  assert.ok(actions.length >= 6);
  assert.ok(actions.every((b) => b.disabled), 'a second bulk action mid-write is a race');
  ui.unmount();
});

test('only one picker is open at a time', async () => {
  const ui = await bar();
  await clickText(ui.container, 'Set status');
  await clickText(ui.container, 'Set priority');
  assert.equal(ui.container.querySelectorAll('.dropdown-menu').length, 1,
    'two open menus over a table is how the wrong action gets applied');
  ui.unmount();
});

/* ── how the page wires the three together ─────────────────────────────── */

// The sequencing moved into hooks/useBulkTasks.js so it could be driven by a
// test rather than only read as source — see tests/ui/bulkTasksFlow.test.mjs
// for the whole acceptance sentence, end to end.
test('the page does not keep its own copy of the sequencing', () => {
  const src = viewSrc();
  assert.match(src, /useBulkTasks\(\{ orderedIds, byId, toast, ask, nameFor \}\)/);
  assert.doesNotMatch(src, /await bulkUpdateTasks\(/,
    'committing belongs in the hook, which a test can hand a recorder');
  assert.doesNotMatch(src, /bulkPlan\(/, 'and so does planning');
});

test('the bar reads its vocabulary from the runner’s module', () => {
  const src = viewSrc();
  assert.match(src, /BULK_ACTIONS\.map\(\(action\) =>/,
    'a hand-written list in the bar is how it comes to offer what the runner cannot do');
  assert.match(src, /from '\.\.\/services\/bulkTasks'/);
});

test('shift-clicking a row does not drag a text selection across the table', () => {
  // Shift-click is the browser's own "extend the text selection" gesture, so
  // taking a range came with half the table highlighted behind it.
  const src = viewSrc();
  assert.match(src, /onMouseDown=\{\(e\) => \{ if \(e\.shiftKey\) e\.preventDefault\(\); \}\}/,
    'the row must refuse the text-selection half of the gesture');

  const css = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');
  assert.match(css, /\.tt-table \.tt-row \{ user-select: none/,
    'and the rows must not be drag-selectable in the first place');
});
