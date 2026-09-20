// T-0049 / NEW-001 — a saved view remembers the table, not just the filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMN_BY_ID, DEFAULT_COLUMNS, DEFAULT_TABLE_CONFIG, GROUP_OPTIONS,
  TASK_TABLE_COLUMNS, groupTasks, headerCells, normalizeTableConfig, rowCells,
  sortTasks, tableConfigFields, toggleSort,
} from './tableViews.js';

const CTX = {
  projectById: {
    p1: { id: 'p1', name: 'SBLAF rollout', phases: [{ id: 'ph1', name: 'Discovery' }] },
    p2: { id: 'p2', name: 'Website revamp', phases: [] },
  },
  memberProfiles: { u1: { displayName: 'Ace' }, u2: { email: 'sam@example.com' } },
};

const t = (over) => ({
  id: 'x', title: 'Task', projectId: 'p1', status: 'todo', priority: 'medium',
  plan: {}, actual: {}, tags: [], assignedTo: [], assignedToExternal: [],
  progress: 0, totalHoursLogged: 0, ...over,
});

const TASKS = [
  t({ id: 'a', title: 'Beta', projectId: 'p1', phaseId: 'ph1', status: 'doing', priority: 'high',
      plan: { endDate: '2026-09-20' }, assignedTo: ['u1'], progress: 50, totalHoursLogged: 4 }),
  t({ id: 'b', title: 'Alpha', projectId: 'p2', status: 'todo', priority: 'low',
      plan: { endDate: '2026-09-10' }, assignedToExternal: ['Jordan'] }),
  t({ id: 'c', title: 'Gamma', projectId: 'p1', status: 'done', priority: 'medium', progress: 10 }),
];

// ─── the config ─────────────────────────────────────────────────────────────

test('a blank config falls back to something usable', () => {
  const cfg = normalizeTableConfig(null);
  assert.deepEqual(cfg, DEFAULT_TABLE_CONFIG);
  assert.deepEqual(normalizeTableConfig({}), DEFAULT_TABLE_CONFIG);
});

test('a column that no longer exists is dropped, not rendered as undefined', () => {
  const cfg = normalizeTableConfig({ columns: ['title', 'ancientColumn', 'due'] });
  assert.deepEqual(cfg.columns, ['title', 'due']);
});

test('the task title can never be hidden', () => {
  assert.equal(normalizeTableConfig({ columns: ['due', 'status'] }).columns[0], 'title');
});

test('a config with only the title falls back — that is not a table', () => {
  assert.deepEqual(normalizeTableConfig({ columns: ['title'] }).columns, DEFAULT_COLUMNS);
});

test('duplicate columns collapse', () => {
  assert.deepEqual(normalizeTableConfig({ columns: ['title', 'due', 'due'] }).columns, ['title', 'due']);
});

test('an unknown grouping or sort falls back rather than breaking the page', () => {
  const cfg = normalizeTableConfig({ groupBy: 'by-vibes', sortBy: 'nope', sortDir: 'sideways' });
  assert.equal(cfg.groupBy, 'none');
  assert.equal(cfg.sortBy, DEFAULT_TABLE_CONFIG.sortBy);
  assert.equal(cfg.sortDir, 'asc');
});

test('only the four fields are persisted', () => {
  const fields = tableConfigFields({
    columns: ['title', 'due'], groupBy: 'project', sortBy: 'due', sortDir: 'desc',
    somethingElse: 'from component state', tasks: TASKS,
  });
  assert.deepEqual(Object.keys(fields).sort(), ['columns', 'groupBy', 'sortBy', 'sortDir']);
});

test('the round trip is lossless — reopening gives back the same table', () => {
  const built = { columns: ['title', 'assignee', 'hours'], groupBy: 'status', sortBy: 'hours', sortDir: 'desc' };
  assert.deepEqual(normalizeTableConfig(tableConfigFields(built)), built);
});

// ─── sorting ────────────────────────────────────────────────────────────────

test('sorting by a date puts the earliest first and the undated last', () => {
  const ids = sortTasks(TASKS, { sortBy: 'due', sortDir: 'asc' }, CTX).map((x) => x.id);
  assert.deepEqual(ids, ['b', 'a', 'c'], 'c has no due date and goes last');
});

test('reversing the direction still leaves the undated last', () => {
  const ids = sortTasks(TASKS, { sortBy: 'due', sortDir: 'desc' }, CTX).map((x) => x.id);
  assert.deepEqual(ids, ['a', 'b', 'c'], '"no date" is not "first"');
});

test('status and priority sort by meaning, not alphabetically', () => {
  assert.deepEqual(sortTasks(TASKS, { sortBy: 'status', sortDir: 'asc' }, CTX).map((x) => x.id),
    ['b', 'a', 'c'], 'To do → In progress → Done');
  assert.deepEqual(sortTasks(TASKS, { sortBy: 'priority', sortDir: 'asc' }, CTX).map((x) => x.id),
    ['a', 'c', 'b'], 'High → Medium → Low');
});

test('numbers sort as numbers', () => {
  const tasks = [t({ id: 'a', totalHoursLogged: 9 }), t({ id: 'b', totalHoursLogged: 10 })];
  assert.deepEqual(sortTasks(tasks, { sortBy: 'hours', sortDir: 'asc' }, CTX).map((x) => x.id), ['a', 'b']);
});

test('ties break by title, so the order never shuffles', () => {
  const tasks = [t({ id: 'z', title: 'Zed' }), t({ id: 'a', title: 'Ay' })];
  assert.deepEqual(sortTasks(tasks, { sortBy: 'status' }, CTX).map((x) => x.id), ['a', 'z']);
});

test('clicking the same header flips it; a new one starts ascending', () => {
  let cfg = normalizeTableConfig({ sortBy: 'due', sortDir: 'asc' });
  cfg = toggleSort(cfg, 'due');
  assert.deepEqual([cfg.sortBy, cfg.sortDir], ['due', 'desc']);
  cfg = toggleSort(cfg, 'project');
  assert.deepEqual([cfg.sortBy, cfg.sortDir], ['project', 'asc']);
  assert.equal(toggleSort(cfg, 'not-a-column').sortBy, 'project', 'unknown column changes nothing');
});

// ─── grouping ───────────────────────────────────────────────────────────────

test('no grouping is one group with everything in it', () => {
  const groups = groupTasks(TASKS, { groupBy: 'none' }, CTX);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, null, 'no heading to render');
  assert.equal(groups[0].tasks.length, 3);
});

test('grouping by project names each group and counts it', () => {
  const groups = groupTasks(TASKS, { groupBy: 'project', sortBy: 'title' }, CTX);
  assert.deepEqual(groups.map((g) => g.label), ['SBLAF rollout (2)', 'Website revamp (1)']);
});

test('grouping by status reads in workflow order, not alphabetical', () => {
  const groups = groupTasks(TASKS, { groupBy: 'status' }, CTX);
  assert.deepEqual(groups.map((g) => g.key), ['To do', 'In progress', 'Done']);
});

test('grouping by assignee gathers the unassigned under a readable heading', () => {
  const groups = groupTasks(TASKS, { groupBy: 'assignee' }, CTX);
  const labels = groups.map((g) => g.key);
  assert.ok(labels.includes('Ace'));
  assert.ok(labels.includes('Jordan'));
  assert.ok(labels.includes('Unassigned'));
});

test('sorting still applies inside each group', () => {
  const groups = groupTasks(TASKS, { groupBy: 'project', sortBy: 'title', sortDir: 'asc' }, CTX);
  const sblaf = groups.find((g) => g.key.startsWith('SBLAF'));
  assert.deepEqual(sblaf.tasks.map((x) => x.title), ['Beta', 'Gamma']);
});

test('an empty task list groups to nothing rather than throwing', () => {
  assert.deepEqual(groupTasks([], { groupBy: 'project' }, CTX), []);
  assert.deepEqual(groupTasks([], { groupBy: 'none' }, CTX), [{ key: 'all', label: null, tasks: [] }]);
});

// ─── rendering ──────────────────────────────────────────────────────────────

test('a row has exactly the view’s columns, in order', () => {
  const cells = rowCells(TASKS[0], { columns: ['title', 'due', 'progress'] }, CTX);
  assert.deepEqual(cells.map((c) => c.id), ['title', 'due', 'progress']);
  assert.equal(cells[0].text, 'Beta');
  assert.equal(cells[1].text, '2026-09-20');
  assert.equal(cells[2].text, '50%');
  assert.equal(cells[2].align, 'right', 'numbers line up');
});

test('every column renders something, never a blank or "undefined"', () => {
  const cells = rowCells(t({}), { columns: TASK_TABLE_COLUMNS.map((c) => c.id) }, CTX);
  assert.equal(cells.length, TASK_TABLE_COLUMNS.length);
  for (const c of cells) {
    assert.ok(c.text !== '' && c.text !== undefined && c.text !== null, c.id);
    assert.doesNotMatch(String(c.text), /undefined|\[object/, c.id);
  }
});

test('the header marks which column is sorted and which way', () => {
  const head = headerCells({ columns: ['title', 'due'], sortBy: 'due', sortDir: 'desc' });
  assert.equal(head[0].sorted, null);
  assert.equal(head[1].sorted, 'desc');
  assert.equal(head[1].label, 'Due');
});

test('every column and group option has a human label', () => {
  for (const c of TASK_TABLE_COLUMNS) {
    assert.ok(c.label && c.label[0] === c.label[0].toUpperCase(), c.id);
    assert.equal(typeof c.value, 'function');
    assert.equal(typeof c.text, 'function');
  }
  for (const g of GROUP_OPTIONS) assert.ok(g.label && g.value);
  assert.ok(Object.keys(COLUMN_BY_ID).length === TASK_TABLE_COLUMNS.length);
});
