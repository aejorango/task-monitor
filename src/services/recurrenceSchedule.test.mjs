// T-0084 / NEW-012 — a weekly ritual that nobody ticked off still comes round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HORIZON_DAYS, MAX_PER_RUN, STALE_DAYS, WALK_LIMIT,
  catchUpPlan, describeCatchUp, isRecurring, missingOccurrences, plannedOccurrences,
  seriesIdOf, seriesOf,
} from './recurrenceSchedule.js';

// Sunday 20 September 2026 is the day the audit was written; use it throughout.
const TODAY = '2026-09-20';

const weekly = (over = {}) => ({
  id: 't1', workspaceId: 'ws1', userId: 'u1', title: 'Weekly status report',
  status: 'todo', deleted: false, archived: false,
  plan: { startDate: '2026-09-14', endDate: '2026-09-14' },
  recurrence: { rule: 'weekly', interval: 1, dayOfWeek: 1 },   // Mondays
  ...over,
});

// ─── what counts as a series ────────────────────────────────────────────────

test('a task with a recurrence rule is part of a series; anything else is not', () => {
  assert.equal(isRecurring(weekly()), true);
  assert.equal(isRecurring({ ...weekly(), recurrence: null }), false);
  assert.equal(isRecurring({ ...weekly(), deleted: true }), false);
  assert.equal(isRecurring({ ...weekly(), archived: true }), false);
  assert.equal(isRecurring(null), false);
});

test('the series id is the first instance’s, however far down the chain you are', () => {
  assert.equal(seriesIdOf(weekly()), 't1');
  assert.equal(seriesIdOf(weekly({ id: 't9', recurrenceParentId: 't1' })), 't1');
  assert.equal(seriesIdOf({}), null);
});

test('a series grows from the instance scheduled furthest ahead', () => {
  const series = seriesOf([
    weekly({ id: 'a', plan: { endDate: '2026-09-07' } }),
    weekly({ id: 'c', recurrenceParentId: 'a', plan: { endDate: '2026-09-21' } }),
    weekly({ id: 'b', recurrenceParentId: 'a', plan: { endDate: '2026-09-14' } }),
  ]);
  assert.equal(series.size, 1);
  assert.equal(series.get('a').anchor.id, 'c', 'the latest instance is where the series got to');
  assert.deepEqual([...series.get('a').dates].sort(), ['2026-09-07', '2026-09-14', '2026-09-21']);
});

test('two schedules are two series', () => {
  const series = seriesOf([weekly({ id: 'a' }), weekly({ id: 'b', title: 'Payroll' })]);
  assert.deepEqual([...series.keys()], ['a', 'b']);
});

// ─── the acceptance path ────────────────────────────────────────────────────

test('a weekly task nobody completed still produces next week’s instance', () => {
  const due = plannedOccurrences(weekly(), { today: '2026-09-21' });
  assert.ok(due.length >= 1, 'the series must not die at the first missed week');
  assert.equal(due[0].end, '2026-09-21', 'the Monday after the last one');
});

test('the catch-up walks forward through missed weeks rather than stalling', () => {
  // Last instance was five weeks ago and was never ticked off.
  const stale = weekly({ plan: { startDate: '2026-08-17', endDate: '2026-08-17' } });
  const due = plannedOccurrences(stale, { today: TODAY });
  assert.deepEqual(due.map((d) => d.end),
    ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
});

test('an occurrence appears on the day it is due, not a week early', () => {
  assert.equal(HORIZON_DAYS, 0, 'a schedule that runs ahead of itself is clutter');
  // The Monday after the last instance is the 21st: nothing on the 20th…
  assert.deepEqual(plannedOccurrences(weekly(), { today: '2026-09-20' }), []);
  // …and there it is on the 21st.
  assert.deepEqual(plannedOccurrences(weekly(), { today: '2026-09-21' }).map((d) => d.end),
    ['2026-09-21']);
});

test('an occurrence too far in the past is skipped, and the series still catches up', () => {
  const ancient = weekly({ plan: { startDate: '2025-01-06', endDate: '2025-01-06' } });
  const due = plannedOccurrences(ancient, { today: TODAY, staleDays: STALE_DAYS });
  assert.ok(due.length > 0, 'a dormant series should come back to life');
  for (const occurrence of due) {
    assert.ok(occurrence.end >= '2026-08-21', `${occurrence.end} is older than the stale cutoff`);
  }
});

test('a series dormant beyond what the walk covers stays asleep rather than looping', () => {
  // WALK_LIMIT steps of a daily schedule is a little under 14 years.
  const forgotten = weekly({
    recurrence: { rule: 'daily', interval: 1 },
    plan: { startDate: '2000-01-01', endDate: '2000-01-01' },
  });
  const due = plannedOccurrences(forgotten, { today: TODAY });
  assert.ok(Array.isArray(due), 'it returns, which is the point');
  assert.ok(WALK_LIMIT >= 1000, 'the walk must cover years, not weeks');
});

test('one run never creates more than a handful', () => {
  const ancient = weekly({ plan: { startDate: '2025-01-06', endDate: '2025-01-06' } });
  assert.ok(plannedOccurrences(ancient, { today: TODAY }).length <= MAX_PER_RUN);
});

test('a series that has ended produces nothing', () => {
  const ended = weekly({ recurrence: { rule: 'weekly', interval: 1, dayOfWeek: 1, until: '2026-09-15' } });
  assert.deepEqual(plannedOccurrences(ended, { today: TODAY }), []);
});

test('a task with no recurrence produces nothing', () => {
  assert.deepEqual(plannedOccurrences({ ...weekly(), recurrence: null }, { today: TODAY }), []);
});

test('daily and monthly schedules work the same way', () => {
  const daily = weekly({ recurrence: { rule: 'daily', interval: 1 },
    plan: { startDate: '2026-09-18', endDate: '2026-09-18' } });
  assert.deepEqual(plannedOccurrences(daily, { today: TODAY, horizonDays: 3 }).map((d) => d.end),
    ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']);
  assert.deepEqual(plannedOccurrences(daily, { today: TODAY }).map((d) => d.end),
    ['2026-09-19', '2026-09-20'], 'by default, only up to today');

  const monthly = weekly({ recurrence: { rule: 'monthly', interval: 1, dayOfMonth: 25 },
    plan: { startDate: '2026-08-25', endDate: '2026-08-25' } });
  assert.deepEqual(plannedOccurrences(monthly, { today: '2026-09-25' }).map((d) => d.end),
    ['2026-09-25']);
});

// ─── not creating one twice ─────────────────────────────────────────────────

test('an occurrence that already exists is not created again', () => {
  const dates = new Set(['2026-09-21']);
  assert.deepEqual(missingOccurrences(weekly(), dates, { today: '2026-09-21' }), []);
});

test('only the missing ones are created', () => {
  const stale = weekly({ plan: { endDate: '2026-08-31' } });
  const dates = new Set(['2026-09-07', '2026-09-21']);
  assert.deepEqual(missingOccurrences(stale, dates, { today: '2026-09-21' }).map((d) => d.end),
    ['2026-09-14']);
});

// ─── the plan a workspace gets ──────────────────────────────────────────────

test('the plan carries a real task payload, in the right workspace', () => {
  const plan = catchUpPlan([weekly()], { today: '2026-09-21' });
  assert.equal(plan.length, 1);
  const { payload, seriesId } = plan[0];
  assert.equal(seriesId, 't1');
  assert.equal(plan[0].userId, 'u1', 'the series owner, not whoever ran the catch-up');
  assert.equal(payload.recurrenceParentId, 't1');
  assert.equal(payload.workspaceId, 'ws1', 'without this the instance is invisible on the Board');
  assert.equal(payload.title, 'Weekly status report');
  assert.deepEqual(payload.plan, { startDate: '2026-09-21', endDate: '2026-09-21' });
  assert.deepEqual(payload.recurrence, weekly().recurrence, 'the copy keeps the schedule');
});

test('a task that runs over several days keeps its length in every instance', () => {
  const threeDays = weekly({ plan: { startDate: '2026-09-12', endDate: '2026-09-14' } });
  const plan = catchUpPlan([threeDays], { today: '2026-09-21' });
  assert.deepEqual(plan[0].payload.plan, { startDate: '2026-09-19', endDate: '2026-09-21' });
});

test('each instance of a catch-up has its own dates — never the same one twice', () => {
  const stale = weekly({ plan: { endDate: '2026-08-24' } });
  const ends = catchUpPlan([stale], { today: '2026-09-21' }).map((p) => p.payload.plan.endDate);
  assert.deepEqual(ends, ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
  assert.equal(new Set(ends).size, ends.length, 'a duplicate date would be a duplicate task');
});

test('the checklist starts unticked and last time’s blockers do not carry over', () => {
  const withWork = weekly({
    subtasks: [{ id: 's1', text: 'Pull the numbers', done: true }],
    dependsOn: ['t-other'],
  });
  const { payload } = catchUpPlan([withWork], { today: '2026-09-21' })[0];
  assert.deepEqual(payload.subtasks, [{ id: 's1', text: 'Pull the numbers', done: false }]);
  assert.deepEqual(payload.dependsOn, []);
});

test('a workspace with nothing recurring has nothing to do', () => {
  assert.deepEqual(catchUpPlan([{ id: 'x', title: 'One-off' }], { today: TODAY }), []);
  assert.deepEqual(catchUpPlan([], { today: TODAY }), []);
  assert.deepEqual(catchUpPlan(), []);
});

test('a series that is already up to date has nothing to do', () => {
  const upToDate = [
    weekly({ id: 'a', plan: { endDate: '2026-09-14' } }),
    weekly({ id: 'b', recurrenceParentId: 'a', plan: { endDate: '2026-09-21' } }),
  ];
  assert.deepEqual(catchUpPlan(upToDate, { today: TODAY }), []);
});

test('what happened is said in a sentence', () => {
  assert.equal(describeCatchUp([]), 'Nothing was due.');
  assert.equal(
    describeCatchUp([{ seriesId: 'a' }, { seriesId: 'a' }, { seriesId: 'b' }]),
    'Added 3 recurring tasks across 2 schedules.',
  );
  assert.equal(describeCatchUp([{ seriesId: 'a' }]), 'Added 1 recurring task across 1 schedule.');
});
