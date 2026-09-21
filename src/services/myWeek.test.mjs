// T-0130 / NEW-020 — one person's week, across every workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_WEEK_OFFSET, MIN_WEEK_OFFSET, buildMyWeek, clampOffset, dayLabel,
  isMine, weekOf, weekTitle,
} from './myWeek.js';
import { moveTaskToDay, DAY_UNSCHEDULED } from './workload.js';

const ACE = 'u-ace';
const MIA = 'u-mia';
const TODAY = '2026-09-23';          // a Wednesday
const WORKSPACES = [
  { id: 'ws-1', name: 'BRIDGED', color: '#0051BA' },
  { id: 'ws-2', name: 'AIM', color: '#7B2D8F' },
];

const task = (over = {}) => ({
  id: 't', title: 'A task', status: 'todo', priority: 'medium',
  workspaceId: 'ws-1', assignedTo: [ACE], plan: {}, actual: {}, ...over,
});
const build = (tasks, over = {}) =>
  buildMyWeek({ tasks, userId: ACE, workspaces: WORKSPACES, today: TODAY, weekStart: 1, ...over });

/* ── whose week is it ──────────────────────────────────────────────────── */

test('mine means assigned to me, whoever else is on it', () => {
  assert.equal(isMine(task({ assignedTo: [ACE] }), ACE), true);
  assert.equal(isMine(task({ assignedTo: [MIA, ACE] }), ACE), true);
  assert.equal(isMine(task({ assignedTo: [MIA] }), ACE), false);
  assert.equal(isMine(task({ assignedTo: [] }), ACE), false);
  assert.equal(isMine(task(), null), false);
  assert.equal(isMine(null, ACE), false);
});

test('somebody else’s work is not on my week', () => {
  const week = build([
    task({ id: 'mine', plan: { endDate: TODAY } }),
    task({ id: 'theirs', assignedTo: [MIA], plan: { endDate: TODAY } }),
    task({ id: 'nobody', assignedTo: [], plan: { endDate: TODAY } }),
  ]);
  assert.deepEqual(week.days.flatMap((d) => d.tasks).map((t) => t.id), ['mine']);
});

test('deleted and archived tasks are not work', () => {
  const week = build([
    task({ id: 'gone', deleted: true, plan: { endDate: TODAY } }),
    task({ id: 'filed', archived: true, plan: { endDate: TODAY } }),
  ]);
  assert.equal(week.counts.total, 0);
});

/* ── the week itself ───────────────────────────────────────────────────── */

test('the week honours the week-start preference', () => {
  const monday = weekOf({ today: TODAY, weekStart: 1 });
  assert.equal(monday.days.length, 7);
  assert.equal(monday.start, '2026-09-21');
  assert.equal(monday.end, '2026-09-27');

  const sunday = weekOf({ today: TODAY, weekStart: 0 });
  assert.equal(sunday.start, '2026-09-20');
  assert.equal(sunday.end, '2026-09-26');
});

test('the weekend is shown, not dropped — some people work Saturdays', () => {
  const week = build([task({ plan: { endDate: '2026-09-26' } })]);   // Saturday
  assert.equal(week.days.length, 7);
  const sat = week.days.find((d) => d.date === '2026-09-26');
  assert.equal(sat.tasks.length, 1, 'a five-day grid would hide this task entirely');
  assert.equal(sat.isWeekend, true, 'it can be dimmed — but it is there');
});

test('moving a week forward and back stays within a sane range', () => {
  assert.equal(weekOf({ today: TODAY, offset: 1 }).start, '2026-09-28');
  assert.equal(weekOf({ today: TODAY, offset: -1 }).start, '2026-09-14');
  assert.equal(clampOffset(999), MAX_WEEK_OFFSET);
  assert.equal(clampOffset(-999), MIN_WEEK_OFFSET);
  assert.equal(clampOffset('x'), 0);
  assert.equal(clampOffset(undefined), 0);
});

test('today is marked, and only today', () => {
  const week = build([]);
  assert.deepEqual(week.days.map((d) => d.isToday), [false, false, true, false, false, false, false]);
});

/* ── the acceptance case ───────────────────────────────────────────────── */

test('tasks from two workspaces land on their days, each naming its workspace', () => {
  const week = build([
    task({ id: 'a', title: 'Ledger', workspaceId: 'ws-1', plan: { endDate: '2026-09-22' } }),
    task({ id: 'b', title: 'Board pack', workspaceId: 'ws-2', plan: { endDate: '2026-09-24' } }),
  ]);

  const tue = week.days.find((d) => d.date === '2026-09-22');
  const thu = week.days.find((d) => d.date === '2026-09-24');
  assert.deepEqual(tue.tasks.map((t) => t.id), ['a']);
  assert.deepEqual(thu.tasks.map((t) => t.id), ['b']);

  // The point of the screen is that they are mixed, so each card has to say
  // which workspace it came from.
  assert.equal(tue.tasks[0].workspaceName, 'BRIDGED');
  assert.equal(thu.tasks[0].workspaceName, 'AIM');
  assert.equal(tue.tasks[0].workspaceColor, '#0051BA');
});

test('a workspace the list does not know is still named something', () => {
  const week = build([task({ workspaceId: 'ws-unknown', plan: { endDate: TODAY } })]);
  const cell = week.days.find((d) => d.date === TODAY);
  assert.equal(cell.tasks[0].workspaceName, 'Another workspace');
  assert.doesNotMatch(cell.tasks[0].workspaceName, /ws-/, 'never an id on a card');
});

/* ── the rails either side ─────────────────────────────────────────────── */

test('a task with no due date goes to the rail, not into hiding', () => {
  const week = build([task({ id: 'someday', title: 'Archive cleanup' })]);
  assert.deepEqual(week.unscheduled.map((t) => t.id), ['someday']);
  assert.equal(week.counts.onDays, 0);
  assert.equal(week.counts.unscheduled, 1);
});

test('a finished task with no date is not waiting for a day', () => {
  const week = build([task({ id: 'done', status: 'done' })]);
  assert.equal(week.unscheduled.length, 0);
});

test('something still unfinished from before the week did not stop existing', () => {
  const week = build([
    task({ id: 'late', plan: { endDate: '2026-09-10' } }),
    task({ id: 'closed', status: 'done', plan: { endDate: '2026-09-10' } }),
  ]);
  assert.deepEqual(week.overdue.map((t) => t.id), ['late']);
  assert.equal(week.counts.overdue, 1);
});

test('the most overdue comes first', () => {
  const week = build([
    task({ id: 'b', plan: { endDate: '2026-09-15' } }),
    task({ id: 'a', plan: { endDate: '2026-09-02' } }),
  ]);
  assert.deepEqual(week.overdue.map((t) => t.id), ['a', 'b']);
});

test('a task due after this week is simply not in it', () => {
  const week = build([task({ id: 'later', plan: { endDate: '2026-11-01' } })]);
  assert.equal(week.counts.total, 0, 'next month is not this week, and is not overdue either');
});

/* ── order within a day ────────────────────────────────────────────────── */

test('within a day: unfinished first, then priority, then title', () => {
  const on = (id, over) => task({ id, plan: { endDate: TODAY }, ...over });
  const week = build([
    on('done-high', { status: 'done', priority: 'high' }),
    on('low', { priority: 'low', title: 'Zebra' }),
    on('high', { priority: 'high', title: 'Apple' }),
    on('medium', { priority: 'medium', title: 'Mango' }),
  ]);
  assert.deepEqual(
    week.days.find((d) => d.date === TODAY).tasks.map((t) => t.id),
    ['high', 'medium', 'low', 'done-high'],
  );
});

test('a day counts what is finished on it', () => {
  const week = build([
    task({ id: 'a', status: 'done', plan: { endDate: TODAY } }),
    task({ id: 'b', plan: { endDate: TODAY } }),
  ]);
  const day = week.days.find((d) => d.date === TODAY);
  assert.equal(day.done, 1);
  assert.equal(day.tasks.length, 2);
  assert.equal(week.counts.done, 1);
});

/* ── labels ────────────────────────────────────────────────────────────── */

test('a day column is titled in plain language', () => {
  const l = dayLabel('2026-09-23', TODAY);
  assert.equal(l.weekday, 'Wed');
  assert.equal(l.date, 'Sep 23');
  assert.equal(l.isToday, true);
  assert.equal(l.isWeekend, false);
  assert.equal(dayLabel('2026-09-27', TODAY).isWeekend, true);
  assert.deepEqual(dayLabel('', TODAY), { weekday: '', date: '', isToday: false, isWeekend: false });
});

test('the heading says "This week" rather than making you read dates', () => {
  assert.equal(weekTitle(weekOf({ today: TODAY, offset: 0 }), TODAY), 'This week');
  assert.equal(weekTitle(weekOf({ today: TODAY, offset: 1 }), TODAY), 'Next week');
  assert.equal(weekTitle(weekOf({ today: TODAY, offset: -1 }), TODAY), 'Last week');
  assert.match(weekTitle(weekOf({ today: TODAY, offset: 3 }), TODAY), /Oct \d+ – Oct \d+/);
  assert.equal(weekTitle(null, TODAY), '');
});

/* ── what a drop means ─────────────────────────────────────────────────── */

// The acceptance case: "dragging one to another day writes plan.endDate while
// preserving its duration".
test('dropping on a day sets the due date and keeps the duration', () => {
  const t = task({ plan: { startDate: '2026-09-21', endDate: '2026-09-23' } });
  assert.deepEqual(moveTaskToDay(t, '2026-09-25'), {
    'plan.endDate': '2026-09-25',
    'plan.startDate': '2026-09-23',      // still a three-day task
  });
});

test('a task with only a due date gets only a due date', () => {
  assert.deepEqual(
    moveTaskToDay(task({ plan: { endDate: '2026-09-23' } }), '2026-09-25'),
    { 'plan.endDate': '2026-09-25' },
  );
});

// The bug the Calendar's inline copy has: it returns early on `!oldEnd`, so the
// tasks most in need of a day are exactly the ones it will not give one to.
test('a task with NO date can be dropped on a day — that is what the rail is for', () => {
  assert.deepEqual(moveTaskToDay(task(), '2026-09-25'), { 'plan.endDate': '2026-09-25' });
});

test('dropping back on the rail takes the date off again', () => {
  assert.deepEqual(
    moveTaskToDay(task({ plan: { endDate: '2026-09-23' } }), DAY_UNSCHEDULED),
    { 'plan.endDate': null },
  );
  // A start with no end is a plan that began and will never finish.
  assert.deepEqual(
    moveTaskToDay(task({ plan: { startDate: '2026-09-21', endDate: '2026-09-23' } }), DAY_UNSCHEDULED),
    { 'plan.endDate': null, 'plan.startDate': null },
  );
});

test('a drop that changes nothing writes nothing', () => {
  assert.equal(moveTaskToDay(task({ plan: { endDate: '2026-09-23' } }), '2026-09-23'), null);
  assert.equal(moveTaskToDay(task(), DAY_UNSCHEDULED), null, 'already on the rail');
  assert.equal(moveTaskToDay(null, '2026-09-23'), null);
  assert.equal(moveTaskToDay(task(), null), null);
});

test('dragging backwards works the same as forwards', () => {
  const t = task({ plan: { startDate: '2026-09-22', endDate: '2026-09-24' } });
  assert.deepEqual(moveTaskToDay(t, '2026-09-21'), {
    'plan.endDate': '2026-09-21',
    'plan.startDate': '2026-09-19',
  });
});

/* ── nothing at all ────────────────────────────────────────────────────── */

test('an empty week is a shape, not a crash', () => {
  const week = build([]);
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.unscheduled, []);
  assert.deepEqual(week.overdue, []);
  assert.deepEqual(week.counts, { total: 0, onDays: 0, done: 0, unscheduled: 0, overdue: 0 });
  assert.ok(buildMyWeek().days.length >= 1, 'no arguments at all must still return a week');
});
