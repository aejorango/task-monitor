// T-0074 / MISS-009 — a custom field must reach the board, the table and the
// exported file, not stop at the task editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  columnCatalogue, groupOptions, groupTasks, headerCells, normalizeTableConfig,
  rowCells, sortTasks, tableConfigFields,
} from '../../src/services/tableViews.js';
import { buildTaskListDocument, exportColumns, taskRow } from '../../src/services/taskExport.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const projects = [{
  id: 'p1', name: 'SBLAF rollout',
  customFields: [
    { id: 'f1', name: 'Client', type: 'select', options: ['Acme', 'Globex'] },
    { id: 'f2', name: 'Contract value', type: 'number' },
  ],
}];
const projectById = { p1: projects[0] };
const ctx = { projects, projectById, memberProfiles: {} };

const task = (over = {}) => ({
  id: 't1', title: 'Disbursement report', projectId: 'p1', status: 'doing',
  priority: 'high', plan: {}, actual: {}, tags: [],
  customValues: { f1: 'Acme', f2: '250000' },
  ...over,
});

// ─── the table ──────────────────────────────────────────────────────────────

test('a project’s fields are offered as columns alongside the built-in ones', () => {
  const ids = columnCatalogue(ctx).list.map((c) => c.id);
  assert.ok(ids.includes('title'), 'the built-ins are still there');
  assert.ok(ids.includes('custom:f1'));
  assert.ok(ids.includes('custom:f2'));
});

test('with no projects loaded the catalogue is just the built-ins', () => {
  assert.equal(columnCatalogue({}).list.length, columnCatalogue({ projects: [] }).list.length);
});

test('a custom column can be shown, and renders the task’s value', () => {
  const cfg = normalizeTableConfig({ columns: ['title', 'custom:f1'] }, ctx);
  assert.deepEqual(cfg.columns, ['title', 'custom:f1']);
  const cells = rowCells(task(), cfg, ctx);
  assert.deepEqual(cells.map((c) => c.text), ['Disbursement report', 'Acme']);
});

test('a custom column is dropped when its project is gone, and the view still opens', () => {
  const cfg = normalizeTableConfig({ columns: ['title', 'custom:gone'] }, ctx);
  assert.ok(!cfg.columns.includes('custom:gone'));
  assert.ok(cfg.columns.includes('title'));
});

test('the header names the field, and a number column is right-aligned', () => {
  const cfg = normalizeTableConfig({ columns: ['title', 'custom:f1', 'custom:f2'] }, ctx);
  const header = headerCells(cfg, ctx);
  assert.deepEqual(header.map((h) => h.label), ['Task', 'Client', 'Contract value']);
  assert.equal(header[2].align, 'right');
});

test('sorting by a custom number column compares numbers, not text', () => {
  const rows = [
    task({ id: 'a', title: 'A', customValues: { f2: '90' } }),
    task({ id: 'b', title: 'B', customValues: { f2: '1000' } }),
  ];
  const sorted = sortTasks(rows, { sortBy: 'custom:f2', sortDir: 'asc' }, ctx);
  assert.deepEqual(sorted.map((t) => t.id), ['a', 'b'], '90 before 1000');
});

test('a task with nothing in the sorted field goes last, not first', () => {
  const rows = [
    task({ id: 'blank', title: 'A', customValues: {} }),
    task({ id: 'filled', title: 'B', customValues: { f1: 'Acme' } }),
  ];
  const asc = sortTasks(rows, { sortBy: 'custom:f1', sortDir: 'asc' }, ctx);
  assert.deepEqual(asc.map((t) => t.id), ['filled', 'blank']);
});

test('a select field can be grouped by — the question a custom field usually answers', () => {
  const values = groupOptions(ctx).map((g) => g.value);
  assert.ok(values.includes('custom:f1'), 'Client should be groupable');
  assert.ok(!values.includes('custom:f2'), 'a number field would make one group per value');
});

test('grouping by a custom field puts the tasks under their own value', () => {
  const rows = [
    task({ id: 'a', customValues: { f1: 'Acme' } }),
    task({ id: 'b', customValues: { f1: 'Globex' } }),
    task({ id: 'c', customValues: {} }),
  ];
  const groups = groupTasks(rows, { groupBy: 'custom:f1' }, ctx);
  assert.deepEqual(groups.map((g) => g.label).sort(), ['Acme (1)', 'Globex (1)', '— (1)'].sort());
});

test('a saved view keeps its custom column and its custom grouping', () => {
  const stored = tableConfigFields(
    { columns: ['title', 'custom:f1'], groupBy: 'custom:f1', sortBy: 'custom:f2', sortDir: 'desc' },
    ctx,
  );
  assert.deepEqual(stored, {
    columns: ['title', 'custom:f1'], groupBy: 'custom:f1', sortBy: 'custom:f2', sortDir: 'desc',
  });
  // …and reopening it gives the same table back.
  assert.deepEqual(normalizeTableConfig(stored, ctx), stored);
});

// ─── the export ─────────────────────────────────────────────────────────────

test('the exported columns end with the project’s own fields', () => {
  const cols = exportColumns(projects);
  assert.equal(cols[cols.length - 2], 'Client');
  assert.equal(cols[cols.length - 1], 'Contract value');
  assert.equal(cols[0], 'Task', 'the built-in columns keep their order');
});

test('each row carries the custom values, in the same column order', () => {
  const row = taskRow(task(), { projectById, projects });
  const cols = exportColumns(projects);
  assert.equal(row.length, cols.length);
  assert.equal(row[cols.indexOf('Client')], 'Acme');
  assert.equal(row[cols.indexOf('Contract value')], '250000');
});

test('an export without projects is unchanged — no stray empty columns', () => {
  assert.equal(taskRow(task(), { projectById }).length, exportColumns().length);
});

test('the spreadsheet sheet uses the same columns as the rows', () => {
  const doc = buildTaskListDocument([task()], { projectById, projects });
  const sheet = doc.sheets[0];
  assert.deepEqual(sheet.columns ?? sheet.header ?? sheet.headers, exportColumns(projects));
});

// ─── the board ──────────────────────────────────────────────────────────────

test('a board card renders the project’s fields as chips', () => {
  const board = read('src', 'components', 'Board.jsx');
  assert.match(board, /import \{ taskChips \} from '\.\.\/services\/customFields'/);
  assert.match(board, /const customChips = taskChips\(task, project\)/);
  assert.match(board, /className="field-chip"/);
  assert.match(board, /customChips\.slice\(0, 3\)/, 'a card is not a table — show a few');
});

test('a chip says which field it is, for anyone who cannot see the layout', () => {
  const board = read('src', 'components', 'Board.jsx');
  assert.match(board, /title=\{`\$\{chip\.label\}: \$\{chip\.text\}`\}/);
  assert.match(board, /field-chip-label/);
});

test('all three export surfaces hand over the projects, so the columns appear', () => {
  for (const file of ['Board.jsx', 'GanttView.jsx', 'TasksTableView.jsx']) {
    const src = read('src', 'components', file);
    const call = src.slice(src.indexOf('buildTaskListDocument('), src.indexOf('buildTaskListDocument(') + 320);
    assert.match(call, /\bprojects,/, `${file} exports without the custom columns`);
  }
});

test('the table page reads its columns from the catalogue, not from a fixed list', () => {
  const src = read('src', 'components', 'TasksTableView.jsx');
  assert.match(src, /const columns = columnCatalogue\(ctx\)\.list/);
  assert.match(src, /const grouping = groupOptions\(ctx\)/);
  assert.doesNotMatch(src, /TASK_TABLE_COLUMNS/, 'a fixed list cannot include a custom field');
});
