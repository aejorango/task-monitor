// T-0047 / MISS-003 — the task list, as a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_COLUMNS, buildTaskListDocument, describeScope, taskRow } from './taskExport.js';
import { toMarkdown } from './exporters.js';

const PROJECTS = {
  p1: { id: 'p1', name: 'SBLAF rollout', phases: [{ id: 'ph1', name: 'Discovery' }] },
  p2: { id: 'p2', name: 'Website revamp', phases: [] },
};
const PROFILES = { u1: { displayName: 'Ace' }, u2: { email: 'sam@example.com' } };

const TASK = {
  id: 't1', title: 'Disbursement report', projectId: 'p1', phaseId: 'ph1',
  status: 'doing', priority: 'high', progress: 40, totalHoursLogged: 6.5,
  plan: { startDate: '2026-09-14', endDate: '2026-09-18' },
  actual: { startDate: '2026-09-15', endDate: null },
  assignedTo: ['u1', 'u2'], assignedToExternal: ['Jordan'],
  tags: ['finance', 'urgent'], requestedBy: 'Ace',
};

// Cells are looked up by COLUMN NAME rather than by index: the positional
// version broke the moment a column was inserted in the middle, which says
// nothing about whether the export is right.
const cellsOf = (task, opts = {}) => {
  const row = taskRow(task, { projectById: PROJECTS, memberProfiles: PROFILES, ...opts });
  assert.equal(row.length, TASK_COLUMNS.length, 'a row must have one cell per column');
  return Object.fromEntries(TASK_COLUMNS.map((name, i) => [name, row[i]]));
};

test('a row carries every column, in words rather than codes', () => {
  const c = cellsOf(TASK);
  assert.equal(c.Task, 'Disbursement report');
  assert.equal(c.Project, 'SBLAF rollout');
  assert.equal(c.Phase, 'Discovery');
  assert.equal(c.Status, 'In progress', 'not "doing"');
  assert.equal(c.Priority, 'High', 'not "high"');
  assert.equal(c['Assigned to'], 'Ace, sam@example.com, Jordan', 'names, never uids');
  assert.equal(c['Due (plan)'], '2026-09-18');
  assert.equal(c.Progress, 40);
  assert.equal(c['Hours logged'], 6.5);
  assert.equal(c.Tags, 'finance, urgent');
});

test('a done task reads as 100% however its progress field was left', () => {
  const c = cellsOf({ ...TASK, status: 'done', progress: 40 });
  assert.equal(c.Status, 'Done');
  assert.equal(c.Progress, 100);
});

// T-0137: the file is where a manager compares what it cost with what it was
// meant to cost, so both numbers have to be in it.
test('the estimate and the variance travel with the task', () => {
  const c = cellsOf({ ...TASK, estimateHours: 4 });
  assert.equal(c['Estimate (hours)'], 4, 'a number, so a spreadsheet can sum the column');
  assert.equal(c['Hours logged'], 6.5);
  assert.equal(c.Variance, '+2.5h (+63%)');
});

test('an unestimated task exports a blank estimate, not a zero', () => {
  const c = cellsOf(TASK);
  assert.equal(c['Estimate (hours)'], '', '0 would claim somebody estimated it at nothing');
  assert.equal(c.Variance, '—');
});

test('a bare task exports without holes or "undefined"', () => {
  const row = taskRow({ id: 'x' }, {});
  assert.equal(row.length, TASK_COLUMNS.length);
  assert.equal(row[0], '(untitled)');
  assert.ok(row.every((v) => v !== undefined && v !== null));
  assert.equal(toMarkdown({ blocks: [] }).includes('undefined'), false);
});

test('an unassigned task has an empty owner, not a uid', () => {
  const row = taskRow({ ...TASK, assignedTo: ['unknown-uid'], assignedToExternal: [] }, { projectById: PROJECTS });
  assert.equal(row[5], '');
  assert.doesNotMatch(row.join('|'), /unknown-uid/);
});

test('the subtitle says exactly which tasks are in the file', () => {
  assert.equal(
    describeScope({ projectName: 'SBLAF rollout', statusFilter: 'doing', tagFilter: 'finance', count: 3 }),
    'Project: SBLAF rollout · Status: In progress · Tag: finance · 3 tasks',
  );
  assert.equal(describeScope({ count: 1 }), 'All projects · 1 task');
  assert.equal(describeScope({ statusFilter: 'all', count: 0 }), 'All projects · 0 tasks');
});

test('the document groups by project for reading and stays flat for Excel', () => {
  const doc = buildTaskListDocument(
    [TASK, { ...TASK, id: 't2', title: 'Homepage copy', projectId: 'p2' }],
    { projectById: PROJECTS, memberProfiles: PROFILES },
  );
  const md = toMarkdown(doc);
  assert.match(md, /## SBLAF rollout \(1\)/);
  assert.match(md, /## Website revamp \(1\)/);

  assert.equal(doc.sheets.length, 1);
  assert.deepEqual(doc.sheets[0].columns, TASK_COLUMNS);
  assert.equal(doc.sheets[0].rows.length, 2, 'the sheet is flat — people sort it themselves');
});

test('tasks with no project are grouped under a readable heading', () => {
  const doc = buildTaskListDocument([{ id: 'x', title: 'Loose end' }], { projectById: PROJECTS });
  assert.match(toMarkdown(doc), /## No project \(1\)/);
});

test('an empty list produces a file that says so rather than an empty one', () => {
  const doc = buildTaskListDocument([], { projectById: PROJECTS });
  assert.match(toMarkdown(doc), /no tasks matching the current filters/);
  assert.equal(doc.sheets[0].rows.length, 0);
  assert.deepEqual(doc.sheets[0].columns, TASK_COLUMNS, 'the headings are still there');
});

test('project groups come out in a stable order', () => {
  const doc = buildTaskListDocument(
    [{ id: 'a', projectId: 'p2', title: 'W' }, { id: 'b', projectId: 'p1', title: 'S' }],
    { projectById: PROJECTS },
  );
  const headings = doc.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
  assert.deepEqual(headings, ['SBLAF rollout (1)', 'Website revamp (1)']);
});
