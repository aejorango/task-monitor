// T-0054 / MISS-005 — a task list must reach a spreadsheet, and a backup must
// actually back everything up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, 'src', 'components', f), 'utf8');

test('the Gantt page can export the tasks it is showing', () => {
  const src = read('GanttView.jsx');
  assert.match(src, /<ExportButton \{\.\.\.exportProps\} \/>/);
  assert.match(src, /build: \(\) => buildTaskListDocument\(rows,/,
    'it must export the rows on the chart, not every task');
  assert.match(src, /kind: 'table'/, 'a task list is a spreadsheet, not a report');
});

test('the Gantt export is named for the project it is filtered to', () => {
  const src = read('GanttView.jsx');
  assert.match(src, /\$\{projectById\[projectFilter\]\.name\}-timeline/);
});

test('the Board export applies the same filters the user is looking at', () => {
  const src = read('Board.jsx');
  assert.match(src, /buildTaskListDocument\(filtered,/);
  assert.match(src, /statusFilter: initialStatusFilter/);
  assert.match(src, /tagFilter,/);
});

// ─── the backup ─────────────────────────────────────────────────────────────

const settings = read('SettingsView.jsx');

test('the backup covers every collection, not three of them', () => {
  const call = settings.slice(settings.indexOf('onClick={() => exportData({'), settings.indexOf('Backup everything'));
  for (const collection of [
    'workspaces', 'projects', 'tasks', 'activities', 'goals', 'minutes', 'templates',
  ]) {
    assert.match(call, new RegExp(`\\b${collection}\\b`), `the backup omits ${collection}`);
  }
});

test('the backup says what is in it, so a restore can be checked', () => {
  const fn = settings.slice(settings.indexOf('function exportData'));
  assert.match(fn, /counts: Object\.fromEntries/);
  assert.match(fn, /version: 2/, 'a format version, so a later reader knows what it has');
});

test('Firestore timestamps come out readable, not as SDK internals', () => {
  const fn = settings.slice(settings.indexOf('function exportData'));
  assert.match(fn, /typeof v\.toDate === 'function'/);
  assert.match(fn, /toISOString\(\)/);
});

test('the backup is labelled as a backup, not as the way to get data out', () => {
  assert.match(settings, /Backup everything \(\.json\)/);
  assert.match(settings, /Everything in this workspace, as one file you can keep/);
});
