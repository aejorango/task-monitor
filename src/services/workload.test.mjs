// T-0078 / NEW-005 — the workload grid, and what a drop means.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAPACITY_HOURS, HOURS_PER_TASK, LOAD_LABEL, UNASSIGNED,
  buildWorkload, describeCell, loadLevel, moveTaskPlan, ownersOf, planningWeeks,
  taskHours, weekKeyOf,
} from './workload.js';

// Monday 14 September 2026 onwards.
const weeks = planningWeeks({ from: '2026-09-16', count: 3, weekStart: 1 });

const ACE = 'u-ace';
const MIA = 'u-mia';
const memberProfiles = {
  [ACE]: { displayName: 'Ace Jorango' },
  [MIA]: { displayName: 'Mia Santos' },
};

const task = (over = {}) => ({
  id: 't1', title: 'A task', status: 'todo',
  assignedTo: [ACE], plan: { startDate: null, endDate: '2026-09-18' },
  ...over,
});

// ─── the columns ────────────────────────────────────────────────────────────

test('the planner starts with the week you are in and runs forward', () => {
  assert.equal(weeks.length, 3);
  assert.deepEqual(weeks.map((w) => w.start), ['2026-09-14', '2026-09-21', '2026-09-28']);
  assert.equal(weeks[0].end, '2026-09-20');
  assert.equal(weeks[0].days.length, 7);
});

test('a week is labelled the way a person reads a date', () => {
  assert.equal(weeks[0].label, '14–20 Sep 2026');
});

test('the week start preference is honoured', () => {
  const sundays = planningWeeks({ from: '2026-09-16', count: 2, weekStart: 0 });
  assert.deepEqual(sundays.map((w) => w.start), ['2026-09-13', '2026-09-20']);
});

test('a date finds its week, and a date outside the window finds none', () => {
  assert.equal(weekKeyOf('2026-09-18', weeks), '2026-09-14');
  assert.equal(weekKeyOf('2026-09-28', weeks), '2026-09-28');
  assert.equal(weekKeyOf('2026-12-01', weeks), null);
  assert.equal(weekKeyOf(null, weeks), null);
});

// ─── what a task weighs ─────────────────────────────────────────────────────

test('a task with no estimate still weighs something, so a count makes a bar', () => {
  assert.equal(taskHours(task()), HOURS_PER_TASK);
});

test('hours already logged come off what is left to do', () => {
  assert.equal(taskHours(task({ estimateHours: 10, totalHoursLogged: 4 })), 6);
  assert.equal(taskHours(task({ estimateHours: 3, totalHoursLogged: 9 })), 0,
    'over-run work is not negative work');
});

test('a finished task weighs nothing', () => {
  assert.equal(taskHours(task({ status: 'done', estimateHours: 40 })), 0);
});

test('an unassigned task belongs to the unassigned lane, not to nobody', () => {
  assert.deepEqual(ownersOf(task({ assignedTo: [] })), [UNASSIGNED]);
  assert.deepEqual(ownersOf(task({ assignedTo: [ACE, MIA] })), [ACE, MIA]);
});

// ─── how full is full ───────────────────────────────────────────────────────

test('the load level is a word, and every word is explained', () => {
  assert.equal(loadLevel(0), 'free');
  assert.equal(loadLevel(20), 'ok');
  assert.equal(loadLevel(36), 'full');
  assert.equal(loadLevel(60), 'over');
  for (const level of ['free', 'ok', 'full', 'over']) {
    assert.ok(LOAD_LABEL[level], `${level} has no plain-language label`);
  }
});

test('a smaller capacity fills up sooner', () => {
  assert.equal(loadLevel(20, DEFAULT_CAPACITY_HOURS), 'ok');
  assert.equal(loadLevel(20, 20), 'full');
  assert.equal(loadLevel(20, 10), 'over');
});

// ─── the grid ───────────────────────────────────────────────────────────────

const grid = () => buildWorkload([
  task({ id: 'a', assignedTo: [ACE], plan: { endDate: '2026-09-18' }, estimateHours: 30 }),
  task({ id: 'b', assignedTo: [ACE], plan: { endDate: '2026-09-17' }, estimateHours: 20 }),
  task({ id: 'c', assignedTo: [MIA], plan: { endDate: '2026-09-23' }, estimateHours: 8 }),
  task({ id: 'd', assignedTo: [], plan: { endDate: '2026-09-24' }, estimateHours: 5 }),
  task({ id: 'e', assignedTo: [ACE], plan: { endDate: null } }),
  task({ id: 'f', assignedTo: [ACE], plan: { endDate: '2027-01-01' } }),
  task({ id: 'g', assignedTo: [ACE], status: 'done', plan: { endDate: '2026-09-18' } }),
], { weeks, members: [ACE, MIA], memberProfiles });

test('everybody in the workspace gets a row, even with nothing on', () => {
  const empty = buildWorkload([], { weeks, members: [ACE, MIA], memberProfiles });
  assert.deepEqual(empty.rows.map((r) => r.name), ['Ace Jorango', 'Mia Santos']);
  assert.equal(empty.rows[0].total, 0);
});

test('tasks land in the week they are due, under the person carrying them', () => {
  const { rows } = grid();
  const ace = rows.find((r) => r.userId === ACE);
  assert.deepEqual(ace.cells['2026-09-14'].tasks.map((t) => t.id), ['a', 'b']);
  assert.equal(ace.cells['2026-09-14'].hours, 50);
  assert.equal(ace.cells['2026-09-14'].level, 'over');
});

test('a finished task does not keep taking up somebody’s week', () => {
  const { rows } = grid();
  const ids = rows.find((r) => r.userId === ACE).cells['2026-09-14'].tasks.map((t) => t.id);
  assert.ok(!ids.includes('g'));
});

test('an unassigned task shows in its own lane, last', () => {
  const { rows } = grid();
  assert.equal(rows[rows.length - 1].userId, UNASSIGNED);
  assert.equal(rows[rows.length - 1].name, 'Not assigned');
  assert.deepEqual(rows[rows.length - 1].cells['2026-09-21'].tasks.map((t) => t.id), ['d']);
});

test('the unassigned lane is hidden when there is nothing in it', () => {
  const { rows } = buildWorkload([task()], { weeks, members: [ACE], memberProfiles });
  assert.ok(!rows.some((r) => r.userId === UNASSIGNED));
});

test('a task with no due date is handed back, not silently dropped', () => {
  const { unscheduled } = grid();
  assert.deepEqual(unscheduled.map((t) => t.id), ['e']);
});

test('a task due beyond the window is neither placed nor called unscheduled', () => {
  const { rows, unscheduled } = grid();
  assert.ok(!unscheduled.some((t) => t.id === 'f'));
  const everywhere = rows.flatMap((r) => Object.values(r.cells)).flatMap((c) => c.tasks);
  assert.ok(!everywhere.some((t) => t.id === 'f'));
});

test('a task on two people counts for both — that is what shared work costs', () => {
  const { rows } = buildWorkload(
    [task({ id: 'x', assignedTo: [ACE, MIA], estimateHours: 6 })],
    { weeks, members: [ACE, MIA], memberProfiles },
  );
  assert.equal(rows.find((r) => r.userId === ACE).total, 6);
  assert.equal(rows.find((r) => r.userId === MIA).total, 6);
});

test('each week has a total across everybody', () => {
  const { byWeekTotals } = grid();
  assert.equal(byWeekTotals['2026-09-14'], 50);
  assert.equal(byWeekTotals['2026-09-21'], 13);
  assert.equal(byWeekTotals['2026-09-28'], 0);
});

test('a deleted or archived task is not somebody’s workload', () => {
  const { rows } = buildWorkload([
    task({ id: 'x', deleted: true }),
    task({ id: 'y', archived: true }),
  ], { weeks, members: [ACE], memberProfiles });
  assert.equal(rows.find((r) => r.userId === ACE).total, 0);
});

test('a cell describes itself in a sentence, for a tooltip and a screen reader', () => {
  const { rows } = grid();
  const ace = rows.find((r) => r.userId === ACE);
  assert.equal(
    describeCell(ace, weeks[0], ace.cells['2026-09-14']),
    'Ace Jorango, 14–20 Sep 2026: 2 tasks, about 50 hours — more than a full week',
  );
  assert.match(describeCell(ace, weeks[2], ace.cells['2026-09-28']), /nothing planned$/);
});

// ─── what a drop means ──────────────────────────────────────────────────────

test('dropping on another person hands it to them', () => {
  assert.deepEqual(moveTaskPlan(task(), { toUserId: MIA }), { assignedTo: [MIA] });
});

test('dropping on the person who already has it changes nothing', () => {
  assert.equal(moveTaskPlan(task(), { toUserId: ACE }), null);
});

test('dropping in the unassigned lane takes it off everybody', () => {
  assert.deepEqual(moveTaskPlan(task(), { toUserId: UNASSIGNED }), { assignedTo: [] });
  assert.equal(moveTaskPlan(task({ assignedTo: [] }), { toUserId: UNASSIGNED }), null);
});

test('dropping in another week keeps the weekday — a Friday stays a Friday', () => {
  // 2026-09-18 is a Friday; the next week's Friday is 2026-09-25.
  const patch = moveTaskPlan(task(), { toWeek: weeks[1] });
  assert.equal(patch['plan.endDate'], '2026-09-25');
});

test('a task with a run of days keeps its length when it moves', () => {
  const patch = moveTaskPlan(
    task({ plan: { startDate: '2026-09-16', endDate: '2026-09-18' } }),
    { toWeek: weeks[1] },
  );
  assert.equal(patch['plan.endDate'], '2026-09-25');
  assert.equal(patch['plan.startDate'], '2026-09-23', 'three days long before, three days long after');
});

test('a task with no due date at all lands at the end of the week it was dropped in', () => {
  const patch = moveTaskPlan(task({ plan: { endDate: null } }), { toWeek: weeks[0] });
  assert.equal(patch['plan.endDate'], '2026-09-20');
  assert.equal(patch['plan.startDate'], undefined, 'nothing to preserve, so nothing invented');
});

test('dropping in the week it is already in changes nothing', () => {
  assert.equal(moveTaskPlan(task(), { toWeek: weeks[0] }), null);
});

test('a move across both a person and a week does both in one patch', () => {
  const patch = moveTaskPlan(task(), { toUserId: MIA, toWeek: weeks[2] });
  assert.deepEqual(patch, { 'plan.endDate': '2026-10-02', assignedTo: [MIA] });
});

test('a drop on nothing is not a write', () => {
  assert.equal(moveTaskPlan(null, { toUserId: MIA }), null);
  assert.equal(moveTaskPlan(task(), {}), null);
});
