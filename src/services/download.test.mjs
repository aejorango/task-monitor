// T-0014 / BUG-007 — every deliverable is stamped with the user's own day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mimeFor, safeFileName, stampedName } from './download.js';
import { todayLocal } from './recurrence.js';

test('a filename is <name>-YYYY-MM-DD.<ext>', () => {
  assert.equal(stampedName('task-monitor-activities', 'csv', '2026-09-12'),
    'task-monitor-activities-2026-09-12.csv');
});

test('the stamp is the local day, not the UTC day', () => {
  // At 07:00 in Asia/Manila (UTC+8) it is still the previous day in UTC. The
  // export must carry the day the user is living in.
  const utcWouldBe = new Date().toISOString().slice(0, 10);
  const ours = stampedName('x', 'csv').match(/(\d{4}-\d{2}-\d{2})/)[1];
  assert.equal(ours, todayLocal());
  if (todayLocal() !== utcWouldBe) {
    assert.notEqual(ours, utcWouldBe, 'this is the whole bug');
  }
});

test('project names with spaces and punctuation become safe filenames', () => {
  assert.equal(stampedName('Q3 Report: Sales/Marketing', 'csv', '2026-09-12'),
    'Q3-Report-Sales-Marketing-2026-09-12.csv');
  assert.equal(safeFileName('  hello   world  '), 'hello-world');
  assert.equal(safeFileName('///'), 'export');
  assert.equal(safeFileName('', 'fallback'), 'fallback');
});

test('a name never ends up with a leading or doubled separator', () => {
  assert.equal(safeFileName('--weird--name--'), 'weird-name');
  assert.equal(safeFileName('.hidden'), 'hidden');
});

test('a very long project name is truncated, not rejected', () => {
  const name = stampedName('a'.repeat(300), 'csv', '2026-09-12');
  assert.ok(name.length < 120);
  assert.ok(name.endsWith('-2026-09-12.csv'));
});

test('the extension is normalised and defaulted', () => {
  assert.ok(stampedName('x', '.CSV', '2026-09-12').endsWith('.csv'));
  assert.ok(stampedName('x', '', '2026-09-12').endsWith('.txt'));
});

test('every format we offer has a real media type', () => {
  for (const ext of ['csv', 'json', 'md', 'txt', 'html', 'pdf', 'docx', 'xlsx', 'pptx']) {
    assert.notEqual(mimeFor(ext), 'application/octet-stream', ext);
  }
  assert.equal(mimeFor('weird'), 'application/octet-stream');
});
