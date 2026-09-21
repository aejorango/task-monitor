// T-0137 / NEW-015 — estimated hours against logged hours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateOf, formatHours, formatVariance, loggedOf, normalizeEstimate,
  totalVariance, variance,
} from './effort.js';
import { taskHours, HOURS_PER_TASK } from './workload.js';

const task = (over = {}) => ({ id: 't', status: 'todo', ...over });

/* ── reading the two numbers ───────────────────────────────────────────── */

test('no estimate is null, not zero — they are different facts', () => {
  assert.equal(estimateOf(task()), null);
  assert.equal(estimateOf(task({ estimateHours: null })), null);
  assert.equal(estimateOf(task({ estimateHours: '' })), null);
  assert.equal(estimateOf(task({ estimateHours: 'n/a' })), null);
  assert.equal(estimateOf(task({ estimateHours: -3 })), null, 'negative hours are not a thing');
  assert.equal(estimateOf(task({ estimateHours: 0 })), 0, 'but an explicit zero IS a statement');
  assert.equal(estimateOf(task({ estimateHours: 8 })), 8);
  assert.equal(estimateOf(task({ estimateHours: '8' })), 8);
});

test('nothing logged is genuinely zero hours', () => {
  assert.equal(loggedOf(task()), 0);
  assert.equal(loggedOf(task({ totalHoursLogged: 12 })), 12);
  assert.equal(loggedOf(task({ totalHoursLogged: 'x' })), 0);
});

/* ── what a form field becomes ─────────────────────────────────────────── */

test('an empty field means "no estimate", not "zero hours"', () => {
  assert.equal(normalizeEstimate(''), null);
  assert.equal(normalizeEstimate('   '), null);
  assert.equal(normalizeEstimate(undefined), null);
  assert.equal(normalizeEstimate(null), null);
  assert.equal(normalizeEstimate('0'), 0, 'typing a zero is saying something');
});

test('an estimate is rounded to quarter-hours, like every other hours field', () => {
  assert.equal(normalizeEstimate('2.5'), 2.5);
  assert.equal(normalizeEstimate('2.6'), 2.5);
  assert.equal(normalizeEstimate('2.63'), 2.75);
  assert.equal(normalizeEstimate(-4), null);
  assert.equal(normalizeEstimate('abc'), null);
});

/* ── the acceptance case ───────────────────────────────────────────────── */

test('8 hours estimated, 12 logged, is +4h and +50%', () => {
  const v = variance(task({ estimateHours: 8, totalHoursLogged: 12 }));
  assert.equal(v.estimate, 8);
  assert.equal(v.logged, 12);
  assert.equal(v.delta, 4);
  assert.equal(v.percent, 50);
  assert.equal(v.state, 'over');
  assert.equal(formatVariance(v), '+4h (+50%)');
});

test('coming in under is shown as under, with the sign', () => {
  const v = variance(task({ estimateHours: 8, totalHoursLogged: 6 }));
  assert.equal(v.delta, -2);
  assert.equal(v.percent, -25);
  assert.equal(v.state, 'under');
  assert.equal(formatVariance(v), '−2h (−25%)');
  assert.match(formatVariance(v), /−/, 'the direction must be unmistakable');
});

test('landing exactly on the estimate says so in words', () => {
  const v = variance(task({ estimateHours: 8, totalHoursLogged: 8 }));
  assert.equal(v.delta, 0);
  assert.equal(v.state, 'on');
  assert.equal(formatVariance(v), 'On estimate');
});

/* ── the awkward numbers ───────────────────────────────────────────────── */

test('no estimate means no variance to show', () => {
  const v = variance(task({ totalHoursLogged: 12 }));
  assert.equal(v.estimate, null);
  assert.equal(v.logged, 12, 'the logged hours are still a fact');
  assert.equal(v.delta, null);
  assert.equal(v.state, 'none');
  assert.equal(formatVariance(v), '—');
});

// A percentage of zero is not a number. "+Infinity%" and "+0%" would both be
// lies, so the hours are shown and the percentage is not.
test('hours logged against a zero-hour estimate give hours but no percentage', () => {
  const v = variance(task({ estimateHours: 0, totalHoursLogged: 5 }));
  assert.equal(v.delta, 5);
  assert.equal(v.percent, null);
  assert.equal(v.state, 'over');
  assert.equal(formatVariance(v), '+5h');
});

test('zero estimated and zero logged is on estimate, not a division by zero', () => {
  const v = variance(task({ estimateHours: 0, totalHoursLogged: 0 }));
  assert.equal(v.delta, 0);
  assert.equal(v.percent, null);
  assert.equal(formatVariance(v), 'On estimate');
});

test('an estimate with nothing logged yet is fully under', () => {
  const v = variance(task({ estimateHours: 8 }));
  assert.equal(v.delta, -8);
  assert.equal(v.percent, -100);
  assert.equal(formatVariance(v), '−8h (−100%)');
});

test('fractions do not leak floating-point noise onto the screen', () => {
  const v = variance(task({ estimateHours: 0.3, totalHoursLogged: 0.1 }));
  assert.equal(v.delta, -0.2, 'not -0.19999999999999998');
  assert.equal(formatHours(1 / 3), '0.33h');
});

test('a missing task does not throw', () => {
  const v = variance(undefined);
  assert.equal(v.state, 'none');
  assert.equal(v.logged, 0);
  assert.equal(formatVariance(null), '—');
  assert.equal(formatHours(null), '—');
  assert.equal(formatHours('x'), '—');
});

/* ── a whole list ──────────────────────────────────────────────────────── */

test('a project rolls up to one line', () => {
  const t = totalVariance([
    task({ estimateHours: 8, totalHoursLogged: 12 }),
    task({ estimateHours: 4, totalHoursLogged: 2 }),
  ]);
  assert.equal(t.estimate, 12);
  assert.equal(t.logged, 14);
  assert.equal(t.delta, 2);
  assert.equal(t.percent, 17);
  assert.equal(t.state, 'over');
  assert.equal(t.unestimated, 0);
});

// The honest part: hours logged against tasks nobody estimated inflate the
// total overrun, so the count of unestimated tasks travels with it.
test('unestimated tasks are counted, so the roll-up can be read honestly', () => {
  const t = totalVariance([
    task({ estimateHours: 8, totalHoursLogged: 8 }),
    task({ totalHoursLogged: 20 }),
  ]);
  assert.equal(t.estimate, 8);
  assert.equal(t.logged, 28);
  assert.equal(t.unestimated, 1, '20 of those hours are against nothing');
  assert.equal(t.estimated, 1);
});

test('a list where nobody estimated anything has no variance at all', () => {
  const t = totalVariance([task({ totalHoursLogged: 5 }), task()]);
  assert.equal(t.state, 'none');
  assert.equal(t.estimated, 0);
  assert.equal(t.percent, null);
});

test('an empty list is a shape, not a crash', () => {
  assert.deepEqual(totalVariance([]), {
    estimate: 0, logged: 0, delta: 0, percent: null,
    state: 'none', estimated: 0, unestimated: 0,
  });
  assert.equal(totalVariance().estimated, 0);
});

/* ── the workload grid uses the estimate ───────────────────────────────── */

// The audit's other half: the planner assumed a flat four hours a task. That
// assumption stays as the FALLBACK, and has to be explicit.
test('a task with an estimate weighs its estimate, less what is already logged', () => {
  assert.equal(taskHours(task({ estimateHours: 10, totalHoursLogged: 4 })), 6);
  assert.equal(taskHours(task({ estimateHours: 8 })), 8);
});

test('a task with no estimate falls back to the documented default', () => {
  assert.equal(taskHours(task()), HOURS_PER_TASK);
  assert.equal(HOURS_PER_TASK, 4, 'the number the audit quotes');
  assert.equal(taskHours(task({ estimateHours: null })), HOURS_PER_TASK);
});

test('work already done is not work still to do', () => {
  assert.equal(taskHours(task({ estimateHours: 3, totalHoursLogged: 9 })), 0,
    'an overrun does not make a task weigh negative');
  assert.equal(taskHours(task({ status: 'done', estimateHours: 40 })), 0);
});
