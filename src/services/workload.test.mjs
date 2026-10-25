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
    'Ace Jorango, 14–20 Sep 2026: 2 tasks, about 50 hours — more than a full week — all estimated',
  );
  assert.match(describeCell(ace, weeks[2], ace.cells['2026-09-28']), /nothing planned$/);
});

// T-0137: tasks can carry a real estimate now, so the grid has to say when the
// number it is showing is an assumption instead. A manager trusting a full-week
// bar deserves to know it was four-hours-a-task all the way down.
test('the cell says whether its hours are estimates or the flat assumption', () => {
  const row = { userId: ACE, name: 'Ace Jorango' };
  const week = weeks[0];
  const cell = (tasks, hours) => ({ tasks, hours, level: 'ok' });

  assert.match(
    describeCell(row, week, cell([{ estimateHours: 8 }, { estimateHours: 4 }], 12)),
    /all estimated$/,
  );
  assert.match(
    describeCell(row, week, cell([{}, {}], 8)),
    /none estimated, counted at 4h each$/,
  );
  assert.match(
    describeCell(row, week, cell([{ estimateHours: 8 }, {}], 12)),
    /1 of them not estimated, counted at 4h each$/,
  );
  // A zero or unusable estimate is not an estimate.
  assert.match(
    describeCell(row, week, cell([{ estimateHours: 0 }], 4)),
    /none estimated/,
  );
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

// ── One week: planned against actual ────────────────────────────────────────
import { weekWorkload, planDays } from './workload.js';

const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];  // Mon–Sun

test('a plan is spread over its weekdays; an all-weekend plan keeps its own days', () => {
  assert.deepEqual(planDays({ plan: { startDate: '2026-10-23', endDate: '2026-10-26' } }), ['2026-10-23', '2026-10-26'],
    'Fri → Mon is two working days, not four');
  assert.deepEqual(planDays({ plan: { endDate: '2026-10-21' } }), ['2026-10-21'], 'a due date alone is a one-day plan');
  assert.deepEqual(planDays({ plan: { startDate: '2026-10-24', endDate: '2026-10-25' } }), ['2026-10-24', '2026-10-25']);
  assert.equal(planDays({ plan: {} }), null, 'no dates, no plan');
});

test('planned hours: the share of a task\'s estimate that falls in the week', () => {
  const tasks = [
    // 10 weekdays Mon 12 Oct → Fri 23 Oct; 5 of them in this week → half of 20h.
    { id: 'a', assignedTo: ['ann'], estimateHours: 20, plan: { startDate: '2026-10-12', endDate: '2026-10-23' } },
    // Due Wed of this week, no start: all 6h land here.
    { id: 'b', assignedTo: ['ann'], estimateHours: 6, plan: { endDate: '2026-10-21' } },
    // Outside the week entirely.
    { id: 'c', assignedTo: ['ann'], estimateHours: 9, plan: { endDate: '2026-11-02' } },
    // Shared by two: 8h split evenly.
    { id: 'd', assignedTo: ['ann', 'bob'], estimateHours: 8, plan: { endDate: '2026-10-22' } },
    // No estimate: assumed at 4h, and counted as assumed.
    { id: 'e', assignedTo: ['bob'], plan: { endDate: '2026-10-20' } },
    // Finished still counts toward the PLAN.
    { id: 'f', assignedTo: ['bob'], estimateHours: 2, status: 'done', plan: { endDate: '2026-10-19' } },
    // No dates: belongs to no week, reported as undated.
    { id: 'g', assignedTo: ['bob'], estimateHours: 5 },
  ];
  const w = weekWorkload(tasks, [], { days: WEEK, members: ['ann', 'bob', 'cy'] });
  const ann = w.rows.find((r) => r.uid === 'ann');
  const bob = w.rows.find((r) => r.uid === 'bob');
  assert.equal(ann.planned, 10 + 6 + 4);
  assert.equal(bob.planned, 4 + 4 + 2);
  assert.equal(bob.assumed, 1);
  assert.equal(bob.undated, 1);
  assert.deepEqual(ann.items.find((i) => i.task.id === 'a'), { task: tasks[0], hours: 10, estimate: 20, estimated: true, daysIn: 5, daysTotal: 10, sharedBy: 1 });
  assert.deepEqual(w.idle.map((r) => r.uid), ['cy'], 'nothing planned or logged: listed, not drawn');
  assert.equal(w.totals.capacity, 3 * 40);
});

test('actual hours: what each person logged inside the week, on the tasks shown', () => {
  const tasks = [{ id: 'a', assignedTo: ['ann'], estimateHours: 4, plan: { endDate: '2026-10-21' } }];
  const acts = [
    { taskId: 'a', userId: 'ann', date: '2026-10-20', hoursSpent: 3 },
    { taskId: 'a', userId: 'ann', date: '2026-10-22', hoursSpent: 2.5 },
    { taskId: 'a', userId: 'bob', date: '2026-10-21', hoursSpent: 1 },     // bob helped
    { taskId: 'a', userId: 'ann', date: '2026-10-26', hoursSpent: 9 },     // next week
    { taskId: 'zz', userId: 'ann', date: '2026-10-20', hoursSpent: 7 },    // a task this view does not show
  ];
  const w = weekWorkload(tasks, acts, { days: WEEK, members: ['ann', 'bob'] });
  const ann = w.rows.find((r) => r.uid === 'ann');
  assert.equal(ann.actual, 5.5);
  assert.equal(ann.variance, 1.5, 'actual minus planned');
  assert.deepEqual(ann.logs.map((l) => [l.task.id, l.hours, l.entries]), [['a', 5.5, 2]]);
  assert.equal(w.rows.find((r) => r.uid === 'bob').actual, 1, 'logged by someone not assigned still counts for them');
  assert.equal(w.totals.actual, 6.5);
});

test('work nobody owns is its own row, last, and is not counted against anyone\'s capacity', () => {
  const tasks = [{ id: 'u', estimateHours: 6, plan: { endDate: '2026-10-21' } }, { id: 'a', assignedTo: ['ann'], estimateHours: 2, plan: { endDate: '2026-10-21' } }];
  const w = weekWorkload(tasks, [], { days: WEEK, members: ['ann'] });
  assert.deepEqual(w.rows.map((r) => r.uid), ['ann', UNASSIGNED]);
  assert.equal(w.rows[1].name, 'Not assigned');
  assert.equal(w.totals.planned, 2);
  assert.equal(w.totals.unassigned, 6);
  assert.equal(w.totals.capacity, 40);
});
