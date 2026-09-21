// T-0089 / BUG-014 — a task with only a due date draws a bar.
//
//   1. Given a task with plan.endDate set and plan.startDate empty
//   2. When the Gantt renders it
//   3. Then a single-day marker appears on its due date, and dragging its left
//      edge sets a real plan.startDate
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectivePlan, planBar, dragOrigin, dragTo, dragPatch, planLabel,
  daysBetween, shiftIso, isoOf, parseISO,
} from './ganttGeometry.js';

const DUE_ONLY = { id: 't1', plan: { endDate: '2026-09-25' } };
const RANGE_MIN = '2026-09-21';
const DAY = 36;

// ─── the plan a task actually has ───────────────────────────────────────────

test('a task with only a due date is a one-day milestone on that date', () => {
  assert.deepEqual(effectivePlan(DUE_ONLY), {
    startDate: '2026-09-25', endDate: '2026-09-25', isMilestone: true, derived: 'start',
  });
});

test('a task with only a start date is a milestone too', () => {
  assert.deepEqual(effectivePlan({ plan: { startDate: '2026-09-25' } }), {
    startDate: '2026-09-25', endDate: '2026-09-25', isMilestone: true, derived: 'end',
  });
});

test('a task with both dates keeps the range the user set', () => {
  assert.deepEqual(effectivePlan({ plan: { startDate: '2026-09-21', endDate: '2026-09-25' } }), {
    startDate: '2026-09-21', endDate: '2026-09-25', isMilestone: false, derived: null,
  });
});

test('both dates on the same day is a milestone, and nothing is derived', () => {
  const span = effectivePlan({ plan: { startDate: '2026-09-25', endDate: '2026-09-25' } });
  assert.equal(span.isMilestone, true);
  assert.equal(span.derived, null);
});

test('a backwards range draws the due date rather than a negative bar', () => {
  const span = effectivePlan({ plan: { startDate: '2026-09-30', endDate: '2026-09-25' } });
  assert.deepEqual(span, { startDate: '2026-09-25', endDate: '2026-09-25', isMilestone: true, derived: 'both' });
});

test('a task with no plan at all has no plan bar', () => {
  assert.equal(effectivePlan({ plan: {} }), null);
  assert.equal(effectivePlan({ actual: { startDate: '2026-09-21' } }), null);
  assert.equal(effectivePlan(null), null);
});

// ─── where the bar goes ─────────────────────────────────────────────────────

test('the due-only task gets a bar exactly one day column wide', () => {
  const bar = planBar(DUE_ONLY, { rangeMin: RANGE_MIN, dayWidth: DAY });
  assert.equal(bar.width, DAY, 'one day, not zero and not blank');
  assert.equal(bar.left, 4 * DAY, 'the 25th is four columns after the 21st');
  assert.equal(bar.isMilestone, true);
});

test('a five-day plan is five columns wide, inclusive of both ends', () => {
  const bar = planBar({ plan: { startDate: '2026-09-21', endDate: '2026-09-25' } }, { rangeMin: RANGE_MIN, dayWidth: DAY });
  assert.equal(bar.width, 5 * DAY);
  assert.equal(bar.left, 0);
});

test('a bar before the left edge of the chart gets a negative offset, not null', () => {
  const bar = planBar({ plan: { endDate: '2026-09-19' } }, { rangeMin: RANGE_MIN, dayWidth: DAY });
  assert.equal(bar.left, -2 * DAY, 'the chart clips it; the geometry does not hide it');
});

test('no plan means no bar', () => {
  assert.equal(planBar({ plan: {} }, { rangeMin: RANGE_MIN, dayWidth: DAY }), null);
});

// ─── dragging it ────────────────────────────────────────────────────────────

test('a due-only task can be dragged — the old code refused', () => {
  assert.deepEqual(dragOrigin(DUE_ONLY, RANGE_MIN), { startDay: 4, endDay: 4 });
});

test('dragging the left edge of a milestone gives it a real start date', () => {
  const origin = dragOrigin(DUE_ONLY, RANGE_MIN);
  const next = dragTo('resize-left', origin, -3);
  assert.deepEqual(next, { startDay: 1, endDay: 4 });

  const patch = dragPatch(DUE_ONLY, RANGE_MIN, next);
  assert.deepEqual(patch, { 'plan.startDate': '2026-09-22', 'plan.endDate': '2026-09-25' },
    'the acceptance criterion: a start date that did not exist before');
});

test('the left edge never passes the due date', () => {
  const origin = dragOrigin(DUE_ONLY, RANGE_MIN);
  assert.deepEqual(dragTo('resize-left', origin, 9), { startDay: 4, endDay: 4 },
    'a bar cannot end before it begins');
});

test('the right edge never passes the start date', () => {
  const origin = dragOrigin({ plan: { startDate: '2026-09-21', endDate: '2026-09-25' } }, RANGE_MIN);
  assert.deepEqual(dragTo('resize-right', origin, -9), { startDay: 0, endDay: 0 });
});

test('moving a milestone keeps it one day long', () => {
  const origin = dragOrigin(DUE_ONLY, RANGE_MIN);
  const next = dragTo('move', origin, 7);
  assert.deepEqual(next, { startDay: 11, endDay: 11 });
  assert.deepEqual(dragPatch(DUE_ONLY, RANGE_MIN, next), {
    'plan.startDate': '2026-10-02', 'plan.endDate': '2026-10-02',
  });
});

test('a drag that changes nothing writes nothing', () => {
  const both = { plan: { startDate: '2026-09-21', endDate: '2026-09-25' } };
  assert.equal(dragPatch(both, RANGE_MIN, dragOrigin(both, RANGE_MIN)), null);
});

test('a milestone dropped back where it started still writes, because it gains a start date', () => {
  const patch = dragPatch(DUE_ONLY, RANGE_MIN, dragOrigin(DUE_ONLY, RANGE_MIN));
  assert.deepEqual(patch, { 'plan.startDate': '2026-09-25', 'plan.endDate': '2026-09-25' },
    'plan.startDate was empty, so this is a real change');
});

test('the patch uses dotted paths, so the actual dates survive', () => {
  const patch = dragPatch(DUE_ONLY, RANGE_MIN, { startDay: 1, endDay: 4 });
  assert.deepEqual(Object.keys(patch), ['plan.startDate', 'plan.endDate']);
  assert.ok(!('plan' in patch), 'a whole-object write would wipe nothing here, but would elsewhere');
});

// ─── what it says ───────────────────────────────────────────────────────────

test('the tooltip is honest about a date the user never set', () => {
  assert.match(planLabel(effectivePlan(DUE_ONLY)), /no start date yet — drag the left edge/);
  assert.match(planLabel(effectivePlan({ plan: { startDate: '2026-09-25' } })), /no due date yet — drag the right edge/);
  assert.match(planLabel(effectivePlan({ plan: { startDate: '2026-09-21', endDate: '2026-09-25' } })), /2026-09-21 → 2026-09-25/);
  assert.match(planLabel(effectivePlan({ plan: { startDate: '2026-09-25', endDate: '2026-09-25' } })), /one day/);
  assert.equal(planLabel(null), '');
});

// ─── the date arithmetic underneath ─────────────────────────────────────────

test('dates are handled as local days, never as UTC instants', () => {
  assert.equal(isoOf(parseISO('2026-01-01')), '2026-01-01', 'a Manila morning is not the day before');
  assert.equal(daysBetween('2026-09-21', '2026-09-25'), 4);
  assert.equal(daysBetween('2026-09-25', '2026-09-21'), -4);
  assert.equal(shiftIso('2026-09-30', 1), '2026-10-01', 'month boundary');
  assert.equal(shiftIso('2026-12-31', 1), '2027-01-01', 'year boundary');
});

test('a daylight-saving jump does not lose or gain a day', () => {
  // Nothing in Asia/Manila, but the app is not only run there.
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(shiftIso('2026-03-07', 2), '2026-03-09');
});

test('rubbish in gives null, not a crash or an Invalid Date', () => {
  assert.equal(parseISO('not-a-date'), null);
  assert.equal(daysBetween('2026-09-21', null), null);
  assert.equal(shiftIso(null, 1), null);
  assert.equal(dragPatch({}, null, { startDay: 0, endDay: 0 }), null);
});
