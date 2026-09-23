// T-0137 / NEW-015 — estimates versus actual hours, where they are shown.
//
//   1. Given a task estimated at 8 hours with 12 logged
//   2. When the user views the status report or the workload
//   3. Then it shows 12h against 8h and a +50% variance, and the workload grid
//      uses the estimate rather than the flat default
//
// The arithmetic is in src/services/effort.test.mjs. These hold the surfaces to
// it, and hold the new field to the app's own rules about writing one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { estimateOf, loggedOf, variance, formatVariance, formatHours } from '../../src/services/effort.js';
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

/* ── the arithmetic behind every surface ───────────────────────────────
   These used to run through the Task table's column catalogue. The table
   was deleted in T-0152, so they ask `services/effort.js` directly — the
   module the remaining surfaces (the status report, the workload, the
   variance page) all read. The claims are unchanged. */

test('8 hours estimated with 12 logged reads as 12h against 8h, +50%', () => {
  assert.equal(formatHours(loggedOf(OVERRUN)), '12h');
  assert.equal(formatHours(estimateOf(OVERRUN)), '8h');
  assert.equal(formatVariance(variance(OVERRUN)), '+4h (+50%)');
});

test('a task nobody estimated shows a dash, not a zero', () => {
  const plain = { ...OVERRUN, estimateHours: undefined };
  assert.equal(estimateOf(plain), null, 'not estimated is NOT an estimate of zero');
  assert.equal(variance(plain).state, 'none');
  assert.equal(formatVariance(variance(plain)), '—', '"−12h (−100%)" against no estimate is a lie');
  assert.equal(loggedOf(plain), 12, 'the hours are still a fact');
});

test('a percentage against a zero estimate is refused, not printed', () => {
  const zero = { ...OVERRUN, estimateHours: 0 };
  assert.ok(!/%/.test(formatVariance(variance(zero))),
    '"+Infinity%" and "+0%" are both lies — show the hours, not the rate');
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
  // `te-lbl` since T-0160 ported the editor to the Board Explorer design;
  // what matters is unchanged — a real <label>, bound to the field by id.
  assert.match(editor, /<label className="te-lbl" htmlFor="te-estimate">Estimated hours<\/label>/);
  assert.match(editor, /type="number" min="0" step="0\.25"/, 'quarter-hours, like every hours field');
  assert.match(editor, /Leave blank if you have not estimated it/,
    'blank vs zero is the whole distinction — it has to be said');
});

test('the editor writes it through the one normaliser, on both save paths', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  // Three WRITE paths — the create (the editor opens on an unsaved task now),
  // the dotted update patch and the recurrence's whole-object save — plus the
  // live preview that updates as you type. Four call sites, one normaliser.
  const uses = [...editor.matchAll(/normalizeEstimate\(estimate\)/g)];
  assert.equal(uses.length, 4, 'every save path and the preview must agree');
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
  for (const file of ['statusReport.js']) {
    assert.match(read('src', 'services', file), /from '\.\/effort'/);
  }
});

test('the variance reads the denormalised counter, not the activity list', () => {
  // The activity list loads asynchronously, so summing it would render
  // "−8h (−100%)" for a moment on a task that has in fact overrun.
  const editor = read('src', 'components', 'TaskEditor.jsx');
  assert.match(editor, /totalHoursLogged: task\.totalHoursLogged \?\? loggedHours/);
});
