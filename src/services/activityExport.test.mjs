// T-0115 / BUG-031 — the activity log and the WBS as real documents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_COLUMNS, WBS_COLUMNS, activityRow, wbsRow, totalHours,
  buildActivityLogDocument, buildWbsDocument, describeActivityScope,
  taskPercent, groupPercent,
} from './activityExport.js';

const projectById = {
  p1: { id: 'p1', name: 'Bridged', phases: [{ id: 'ph1', name: 'Discovery' }, { id: 'ph2', name: 'Delivery' }] },
};
const taskById = { t1: { id: 't1', title: 'Draft proposal' } };

const activities = [
  { id: 'a1', date: '2026-09-21', projectId: 'p1', phaseId: 'ph1', taskId: 't1',
    comment: 'Wrote the first draft', completionStatus: 'in-progress', hoursSpent: 2.5,
    bottleneckRemarks: 'Waiting on numbers', requestedBy: 'Ace',
    attachments: [{ name: 'draft.pdf', url: 'https://example.com/draft.pdf' }] },
  { id: 'a2', date: '2026-09-20', projectId: 'p1', phaseId: 'ph2', taskId: 'gone',
    taskTitle: 'A task since deleted', comment: 'Tidied up', completionStatus: 'completed', hoursSpent: 1 },
];

// ─── one row ────────────────────────────────────────────────────────────────

test('a row has one cell per column, in the order a person reads them', () => {
  const row = activityRow(activities[0], { projectById, taskById });
  assert.equal(row.length, ACTIVITY_COLUMNS.length);
  assert.deepEqual(row, [
    '2026-09-21', 'Bridged', 'Discovery', 'Draft proposal', 'Wrote the first draft',
    'In progress', 2.5, 'Waiting on numbers', 'Ace', 'https://example.com/draft.pdf',
  ]);
});

test('an entry against a deleted task keeps the name it was logged with', () => {
  const row = activityRow(activities[1], { projectById, taskById });
  assert.equal(row[3], 'A task since deleted',
    'the denormalized snapshot is the whole point of storing it');
});

test('hours are numbers, so a spreadsheet can total them', () => {
  const row = activityRow(activities[0], { projectById, taskById });
  assert.equal(typeof row[6], 'number');
  assert.equal(activityRow({ hoursSpent: '' }, {})[6], 0, 'a blank is zero, not NaN');
  assert.equal(activityRow({ hoursSpent: 'n/a' }, {})[6], 0);
});

test('several attachments are listed, and none is not an empty pipe', () => {
  assert.equal(activityRow({ attachments: [{ url: 'a' }, { url: 'b' }] }, {})[9], 'a | b');
  assert.equal(activityRow({ attachments: [] }, {})[9], '');
  assert.equal(activityRow({}, {})[9], '');
});

test('missing everything still produces a full row', () => {
  const row = activityRow({}, {});
  assert.equal(row.length, ACTIVITY_COLUMNS.length);
  assert.ok(row.every((c) => c !== undefined && c !== null));
});

// ─── the document ───────────────────────────────────────────────────────────

test('the spreadsheet holds every row, flat', () => {
  const doc = buildActivityLogDocument(activities, { projectById, taskById });
  const sheet = doc.sheets[0];
  assert.equal(sheet.name, 'Activity log');
  assert.deepEqual(sheet.columns, ACTIVITY_COLUMNS);
  assert.equal(sheet.rows.length, 2);
});

test('the readable version groups by day, newest first, with each day’s hours', () => {
  const doc = buildActivityLogDocument(activities, { projectById, taskById });
  const headings = doc.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
  assert.deepEqual(headings, ['2026-09-21 · 2.5h', '2026-09-20 · 1h']);
});

test('the subtitle says what is in the file', () => {
  const doc = buildActivityLogDocument(activities, { projectById, taskById, projectName: 'Bridged', from: '2026-09-01' });
  assert.match(doc.subtitle, /Project: Bridged/);
  assert.match(doc.subtitle, /2 entries/);
  assert.match(doc.subtitle, /3\.5h logged/);
});

test('one entry is "1 entry", not "1 entries"', () => {
  const doc = buildActivityLogDocument([activities[0]], { projectById, taskById });
  assert.match(doc.subtitle, /1 entry/);
});

test('an empty log exports a file that says so, rather than a blank one', () => {
  const doc = buildActivityLogDocument([], {});
  assert.match(doc.blocks[0].text, /no activities matching/i);
  assert.equal(doc.sheets[0].rows.length, 0);
  assert.deepEqual(doc.sheets[0].columns, ACTIVITY_COLUMNS, 'the header still tells you what it would hold');
});

test('the hours total is rounded, not a floating-point tail', () => {
  assert.equal(totalHours([{ hoursSpent: 0.1 }, { hoursSpent: 0.2 }]), 0.3);
  assert.equal(totalHours([]), 0);
});

test('a scope with no project and no dates still reads as a sentence', () => {
  const s = describeActivityScope({ count: 3, hours: 6 });
  assert.match(s, /All projects/);
  assert.doesNotMatch(s, /undefined|null/);
});

// ─── WBS ────────────────────────────────────────────────────────────────────

const project = projectById.p1;
const tasks = [
  { id: 't1', title: 'Draft proposal', phaseId: 'ph1', status: 'done', totalHoursLogged: 4, plan: { startDate: '2026-09-14', endDate: '2026-09-18' } },
  { id: 't2', title: 'Build it', phaseId: 'ph2', status: 'doing', progress: 40, totalHoursLogged: 6, plan: { startDate: '2026-09-21', endDate: '2026-09-30' } },
  { id: 't3', title: 'Loose end', status: 'todo', totalHoursLogged: 0 },
];

test('a WBS row has one cell per column', () => {
  const row = wbsRow(tasks[0], { phaseName: 'Discovery' });
  assert.equal(row.length, WBS_COLUMNS.length);
  assert.deepEqual(row, ['Discovery', 'Draft proposal', 'Done', '', '2026-09-14', '2026-09-18', 100, 4]);
});

test('phases keep the project’s own order — that order is the plan', () => {
  const doc = buildWbsDocument(project, tasks);
  const headings = doc.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
  assert.match(headings[0], /^Discovery/);
  assert.match(headings[1], /^Delivery/);
  assert.match(headings[2], /^No phase/, 'a task with no phase is named, not dropped');
});

test('a task whose phase was deleted still appears', () => {
  const doc = buildWbsDocument(project, [{ id: 'x', title: 'Orphan', phaseId: 'ph-gone', status: 'todo' }]);
  const rows = doc.sheets[0].rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 'No phase');
});

test('progress is the same arithmetic the page shows', () => {
  assert.equal(taskPercent({ status: 'done', progress: 10 }), 100, 'done is done');
  assert.equal(taskPercent({ status: 'doing', progress: 40 }), 40);
  assert.equal(taskPercent({ status: 'todo' }), 0);
  assert.equal(taskPercent({ status: 'doing', progress: 150 }), 100, 'clamped');
  assert.equal(groupPercent(tasks), Math.round((100 + 40 + 0) / 3));
  assert.equal(groupPercent([]), 0, 'an empty phase is 0%, not NaN');
});

test('the summary block leads with the numbers a manager asks for', () => {
  const doc = buildWbsDocument(project, tasks);
  const kv = doc.blocks.find((b) => b.type === 'keyValues');
  assert.deepEqual(kv.pairs, [
    ['Project', 'Bridged'], ['Tasks', '3'], ['Complete', '47%'], ['Hours logged', '10'],
  ]);
});

test('every task reaches the spreadsheet, under its phase', () => {
  const doc = buildWbsDocument(project, tasks);
  assert.deepEqual(doc.sheets[0].columns, WBS_COLUMNS);
  assert.deepEqual(doc.sheets[0].rows.map((r) => [r[0], r[1]]), [
    ['Discovery', 'Draft proposal'], ['Delivery', 'Build it'], ['No phase', 'Loose end'],
  ]);
});

test('a project with no tasks exports a file that says so', () => {
  const doc = buildWbsDocument(project, []);
  assert.ok(doc.blocks.some((b) => b.type === 'paragraph' && /no tasks yet/.test(b.text)));
  assert.equal(doc.sheets[0].rows.length, 0);
});

test('an empty phase says so rather than showing an empty table', () => {
  const doc = buildWbsDocument(project, [tasks[0]]);
  const idx = doc.blocks.findIndex((b) => b.type === 'heading' && /^Delivery/.test(b.text));
  assert.equal(doc.blocks[idx + 1].type, 'paragraph');
  assert.match(doc.blocks[idx + 1].text, /Nothing in this phase yet/);
});

test('people are named, from the workspace profiles', () => {
  const row = wbsRow(
    { title: 'x', assignedTo: ['u1'], assignedToExternal: ['A contractor'] },
    { memberProfiles: { u1: { displayName: 'Mia' } } },
  );
  assert.equal(row[3], 'Mia, A contractor');
});
