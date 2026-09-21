// T-0137 / NEW-015 — estimates versus actual hours, where they are shown.
//
//   1. Given a task estimated at 8 hours with 12 logged
//   2. When the user views the Task table or the status report
//   3. Then it shows 12h against 8h and a +50% variance, and the workload grid
//      uses the estimate rather than the flat default
//
// The arithmetic is in src/services/effort.test.mjs. These hold the surfaces to
// it, and hold the new field to the app's own rules about writing one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { columnCatalogue, rowCells, normalizeTableConfig } from '../../src/services/tableViews.js';
import { effortBlocks } from '../../src/services/statusReport.js';
import { buildWorkload, planningWeeks, taskHours, HOURS_PER_TASK } from '../../src/services/workload.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const ACE = 'u-ace';
const ctx = { projectById: { p1: { name: 'BRIDGED' } }, memberProfiles: {}, projects: [{ id: 'p1', name: 'BRIDGED' }] };

// The acceptance task.
const OVERRUN = {
  id: 't1', title: 'Reconcile the ledger', status: 'doing', priority: 'high',
  projectId: 'p1', assignedTo: [ACE], plan: { endDate: '2026-09-25' }, actual: {},
  estimateHours: 8, totalHoursLogged: 12,
};

/* ── the task table ────────────────────────────────────────────────────── */

const cellText = (task, columnId) => {
  const config = normalizeTableConfig({ columns: ['title', columnId] }, ctx);
  const cell = rowCells(task, config, ctx).find((c) => c.id === columnId);
  assert.ok(cell, `no ${columnId} cell — is the column in the catalogue?`);
  return cell.text;
};

test('Estimate and Variance are columns you can pick', () => {
  const ids = columnCatalogue(ctx).list.map((c) => c.id);
  assert.ok(ids.includes('estimate'), 'the estimate has to be visible next to the hours');
  assert.ok(ids.includes('variance'));
  assert.ok(ids.includes('hours'), 'and the logged hours it is compared against');
});

test('8 hours estimated with 12 logged reads as 12h against 8h, +50%', () => {
  assert.equal(cellText(OVERRUN, 'hours'), '12');
  assert.equal(cellText(OVERRUN, 'estimate'), '8h');
  assert.equal(cellText(OVERRUN, 'variance'), '+4h (+50%)');
});

test('a task nobody estimated shows a dash, not a zero', () => {
  const plain = { ...OVERRUN, estimateHours: undefined };
  assert.equal(cellText(plain, 'estimate'), '—');
  assert.equal(cellText(plain, 'variance'), '—', '"−12h (−100%)" against no estimate is a lie');
  assert.equal(cellText(plain, 'hours'), '12', 'the hours are still a fact');
});

test('sorting puts the unestimated last rather than treating them as zero', () => {
  const col = columnCatalogue(ctx).byId;
  const estimated = col.estimate.value({ estimateHours: 4 });
  const not = col.estimate.value({});
  assert.ok(not > estimated, 'an unestimated task is not the cheapest task');

  const varNone = col.variance.value({});
  const varUnder = col.variance.value({ estimateHours: 8, totalHoursLogged: 1 });
  assert.ok(varNone < varUnder, 'and it is not the biggest underrun either');
});

/* ── the status report ─────────────────────────────────────────────────── */

const digestOf = (tasks) => ({
  taskIndex: tasks.map((t) => ({ id: t.id, title: t.title, project: 'BRIDGED', task: t })),
});
const flatten = (blocks) => JSON.stringify(blocks);

test('the report shows the total, the variance and how many were estimated', () => {
  const text = flatten(effortBlocks(digestOf([OVERRUN])));
  assert.match(text, /Effort against estimate/);
  assert.match(text, /8h/);
  assert.match(text, /12h/);
  assert.match(text, /\+4h \(\+50%\)/);
  assert.match(text, /Tasks estimated/);
});

test('the report names the tasks that overran, worst first', () => {
  const small = { ...OVERRUN, id: 't2', title: 'Small overrun', estimateHours: 10, totalHoursLogged: 11 };
  const text = flatten(effortBlocks(digestOf([small, OVERRUN])));
  assert.ok(text.indexOf('Reconcile the ledger') < text.indexOf('Small overrun'),
    'the worst overrun is the one a manager needs to see first');
});

// Honesty: hours logged against tasks nobody estimated inflate the overrun, so
// a total that hides that is a misleading total.
test('the report says when some tasks have no estimate at all', () => {
  const text = flatten(effortBlocks(digestOf([
    OVERRUN,
    { id: 't3', title: 'Unestimated', totalHoursLogged: 20 },
  ])));
  assert.match(text, /1 task has no estimate/);
  assert.match(text, /count towards the total logged but not towards the total estimated/);
});

test('the section is silent when nobody has estimated anything', () => {
  // An Effort section that is all dashes reads as a broken feature rather than
  // an unused one.
  const blocks = effortBlocks(digestOf([{ id: 't4', title: 'Plain', totalHoursLogged: 5 }]));
  assert.deepEqual(blocks, []);
  assert.deepEqual(effortBlocks(undefined), []);
});

test('a report where nothing overran says so rather than showing an empty table', () => {
  const text = flatten(effortBlocks(digestOf([
    { id: 't5', title: 'Came in early', estimateHours: 8, totalHoursLogged: 6 },
  ])));
  assert.match(text, /Nothing has overrun its estimate/);
});

/* ── the workload grid ─────────────────────────────────────────────────── */

const weeks = planningWeeks({ from: '2026-09-21', count: 2, weekStart: 1 });

test('the grid weighs a task by its estimate when there is one', () => {
  const { rows } = buildWorkload(
    [{ id: 'a', assignedTo: [ACE], estimateHours: 30, status: 'todo', plan: { endDate: '2026-09-23' } }],
    { weeks, members: [ACE], memberProfiles: { [ACE]: { displayName: 'Ace' } } },
  );
  const cell = rows.find((r) => r.userId === ACE).cells[weeks[0].key];
  assert.equal(cell.hours, 30, 'not the flat four');
});

test('and falls back to the documented default when there is not', () => {
  const { rows } = buildWorkload(
    [{ id: 'a', assignedTo: [ACE], status: 'todo', plan: { endDate: '2026-09-23' } }],
    { weeks, members: [ACE], memberProfiles: { [ACE]: { displayName: 'Ace' } } },
  );
  assert.equal(rows.find((r) => r.userId === ACE).cells[weeks[0].key].hours, HOURS_PER_TASK);
  assert.equal(taskHours({ status: 'todo' }), 4, 'the number the audit quotes');
});

/* ── writing the field ─────────────────────────────────────────────────── */

test('the editor offers a plain number field, and says what blank means', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  assert.match(editor, /<label className="pe-lbl" htmlFor="te-estimate">Estimated hours<\/label>/);
  assert.match(editor, /type="number" min="0" step="0\.25"/, 'quarter-hours, like every hours field');
  assert.match(editor, /Leave blank if you have not estimated it/,
    'blank vs zero is the whole distinction — it has to be said');
});

test('the editor writes it through the one normaliser, on both save paths', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  // Two WRITE paths (the dotted patch and the whole-object save) plus the live
  // preview that updates as you type — three call sites, one normaliser.
  const uses = [...editor.matchAll(/normalizeEstimate\(estimate\)/g)];
  assert.equal(uses.length, 3, 'the two save paths and the preview must all agree');
  assert.match(editor, /estimateHours:\s+normalizeEstimate\(estimate\),\n\s*'plan\.startDate'/);
  assert.match(editor, /estimateHours: normalizeEstimate\(estimate\),\n\s*plan:/);
  assert.doesNotMatch(editor, /estimateHours:\s*Number\(/, 'no second parser');
});

test('a create stores it, and stores "not estimated" as null rather than 0', () => {
  const firebase = read('src', 'services', 'firebase.js');
  assert.match(firebase, /estimateHours: normalizeEstimate\(task\.estimateHours\)/);
  assert.match(firebase, /import \{ normalizeEstimate \} from '\.\/effort'/);
});

test('the timesheet compares the week, and does not invent a per-person estimate', () => {
  const ts = read('src', 'components', 'TimesheetView.jsx');
  assert.match(ts, /totalVariance\(touched\)/);
  assert.match(ts, /days\.includes\(a\.date\)/, 'scoped to this week, not to all time');
  assert.doesNotMatch(ts, /<th[^>]*>Estimate/,
    'estimates live on tasks; a per-person estimate column would be a made-up number');
  assert.match(ts, /effort\.estimated > 0 &&/, 'and it stays out of the way when unused');
});

test('the whole feature goes through one module', () => {
  for (const [file, dir] of [
    ['TaskEditor.jsx', 'components'], ['TimesheetView.jsx', 'components'],
  ]) {
    const src = read('src', dir, file);
    assert.match(src, /from '\.\.\/services\/effort'/, `${file} must not do the arithmetic itself`);
  }
  for (const file of ['tableViews.js', 'statusReport.js']) {
    assert.match(read('src', 'services', file), /from '\.\/effort'/);
  }
});

test('the variance reads the denormalised counter, not the activity list', () => {
  // The activity list loads asynchronously, so summing it would render
  // "−8h (−100%)" for a moment on a task that has in fact overrun.
  const editor = read('src', 'components', 'TaskEditor.jsx');
  assert.match(editor, /totalHoursLogged: task\.totalHoursLogged \?\? loggedHours/);
});
