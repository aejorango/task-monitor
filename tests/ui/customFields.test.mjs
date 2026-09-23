// T-0074 / MISS-009 — a custom field must reach the board, the table and the
// exported file, not stop at the task editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  assert.match(board, /customChips\.slice\(0, 2\)/, 'a card is not a table — show a few');
});

test('a chip says which field it is, for anyone who cannot see the layout', () => {
  const board = read('src', 'components', 'Board.jsx');
  assert.match(board, /title=\{`\$\{chip\.label\}: \$\{chip\.text\}`\}/);
  assert.match(board, /field-chip-label/);
});

test('both export surfaces hand over the projects, so the columns appear', () => {
  for (const file of ['Board.jsx', 'GanttView.jsx']) {
    const src = read('src', 'components', file);
    const call = src.slice(src.indexOf('buildTaskListDocument('), src.indexOf('buildTaskListDocument(') + 320);
    assert.match(call, /\bprojects,/, `${file} exports without the custom columns`);
  }
});

