// T-0138 / NEW-017 — work-in-progress limits and column ageing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AGEING_DAYS, WIP_STATUSES, ageing, ageingDaysFor, columnState,
  limitFor, normalizeLimit, normalizeLimits, warnOnDrop,
} from './wipLimits.js';

const project = (wipLimits, rest = {}) => ({ id: 'p1', name: 'BRIDGED', wipLimits, ...rest });

/* ── reading a limit ───────────────────────────────────────────────────── */

test('a project with no limits has none', () => {
  assert.equal(limitFor(undefined, 'doing'), null);
  assert.equal(limitFor({}, 'doing'), null);
  assert.equal(limitFor(project({}), 'doing'), null);
  assert.equal(limitFor(project({ todo: 5 }), 'doing'), null);
});

// A column you may put nothing in is a column you should delete, so 0 reads as
// "no limit" rather than "always breached".
test('zero and nonsense are not limits', () => {
  assert.equal(limitFor(project({ doing: 0 }), 'doing'), null);
  assert.equal(limitFor(project({ doing: -2 }), 'doing'), null);
  assert.equal(limitFor(project({ doing: 'three' }), 'doing'), null);
  assert.equal(limitFor(project({ doing: null }), 'doing'), null);
});

test('a limit is a whole number of tasks', () => {
  assert.equal(limitFor(project({ doing: 3 }), 'doing'), 3);
  assert.equal(limitFor(project({ doing: '3' }), 'doing'), 3);
  assert.equal(limitFor(project({ doing: 3.7 }), 'doing'), 3, 'you cannot have 3.7 tasks');
});

test('what the editor stores', () => {
  assert.equal(normalizeLimit(''), null);
  assert.equal(normalizeLimit('   '), null);
  assert.equal(normalizeLimit(0), null);
  assert.equal(normalizeLimit('4'), 4);
  assert.equal(normalizeLimit(100000), 999, 'a limit nobody could reach is not a limit');
});

test('the stored map keeps only real limits, and only real columns', () => {
  assert.deepEqual(normalizeLimits({ todo: 5, doing: 0, done: '', nonsense: 9 }), { todo: 5 });
  assert.deepEqual(normalizeLimits(), {});
  assert.deepEqual(WIP_STATUSES, ['todo', 'doing', 'done']);
});

/* ── the acceptance case ───────────────────────────────────────────────── */

test('a limit of 3 holding 5 reads "5 / 3" and is over', () => {
  const s = columnState(project({ doing: 3 }), 'doing', 5);
  assert.equal(s.text, '5 / 3');
  assert.equal(s.over, true);
  assert.equal(s.at, false);
  assert.match(s.title, /2 over the limit of 3/);
});

test('exactly at the limit is marked, but is not over it', () => {
  const s = columnState(project({ doing: 3 }), 'doing', 3);
  assert.equal(s.text, '3 / 3');
  assert.equal(s.at, true);
  assert.equal(s.over, false);
  assert.match(s.title, /at the limit/);
});

test('under the limit is just under it', () => {
  const s = columnState(project({ doing: 3 }), 'doing', 1);
  assert.equal(s.text, '1 / 3');
  assert.equal(s.over, false);
  assert.equal(s.at, false);
  assert.match(s.title, /1 of 3 allowed/);
});

// The state the board was in before this row: a count with nothing to compare
// it to.
test('a column with no limit shows a bare count, as it always did', () => {
  const s = columnState(project({}), 'doing', 5);
  assert.equal(s.text, '5');
  assert.equal(s.limit, null);
  assert.equal(s.over, false);
  assert.equal(s.title, '5 tasks');
  assert.equal(columnState(project({}), 'doing', 1).title, '1 task');
});

test('an empty column is not "over" anything', () => {
  assert.equal(columnState(project({ doing: 3 }), 'doing', 0).over, false);
  assert.equal(columnState(project({ doing: 3 }), 'doing', 0).text, '0 / 3');
});

/* ── the drop ──────────────────────────────────────────────────────────── */

test('dropping a sixth into a column of five with a limit of three warns', () => {
  const msg = warnOnDrop(project({ doing: 3 }), 'doing', 5, { columnLabel: 'In Progress' });
  assert.ok(msg);
  assert.match(msg, /In Progress now has 6 tasks/);
  assert.match(msg, /3 over your limit of 3/);
});

test('the drop that takes a column exactly to its limit does not warn', () => {
  assert.equal(warnOnDrop(project({ doing: 3 }), 'doing', 2), null, 'landing on 3 of 3 is allowed');
  assert.ok(warnOnDrop(project({ doing: 3 }), 'doing', 3), 'landing on 4 of 3 is not');
});

test('a column with no limit never warns', () => {
  assert.equal(warnOnDrop(project({}), 'doing', 99), null);
  assert.equal(warnOnDrop(undefined, 'doing', 99), null);
});

// The reason the message is a message: a hard block on a personal board is an
// annoyance, not a discipline.
test('the warning suggests, and does not forbid', () => {
  const msg = warnOnDrop(project({ doing: 1 }), 'doing', 1, { columnLabel: 'In Progress' });
  assert.match(msg, /usually faster/);
  assert.doesNotMatch(msg, /cannot|not allowed|blocked|denied/i);
});

/* ── ageing ────────────────────────────────────────────────────────────── */

const TODAY = '2026-09-23';
const doing = (startDate) => ({ id: 't', status: 'doing', actual: { startDate } });

test('a card counts its days since it started', () => {
  const a = ageing(doing('2026-09-21'), { today: TODAY });
  assert.equal(a.days, 2);
  assert.equal(a.stale, false);
  assert.match(a.title, /In progress for 2 days/);
});

test('past the threshold it is stale, and says how long', () => {
  const a = ageing(doing('2026-09-15'), { today: TODAY, days: 5 });
  assert.equal(a.days, 8);
  assert.equal(a.stale, true);
  assert.match(a.title, /longer than 5/);
});

test('the day it crosses the threshold counts', () => {
  assert.equal(ageing(doing('2026-09-18'), { today: TODAY, days: 5 }).stale, true, 'exactly 5');
  assert.equal(ageing(doing('2026-09-19'), { today: TODAY, days: 5 }).stale, false, '4');
});

test('only work in progress ages', () => {
  // A task in To Do has not started; a done task has stopped.
  assert.equal(ageing({ status: 'todo', actual: { startDate: '2026-01-01' } }, { today: TODAY }).stale, false);
  assert.equal(ageing({ status: 'done', actual: { startDate: '2026-01-01' } }, { today: TODAY }).stale, false);
});

test('a task in progress with no start date cannot be aged', () => {
  const a = ageing({ status: 'doing', actual: {} }, { today: TODAY });
  assert.equal(a.days, null);
  assert.equal(a.stale, false);
  assert.equal(a.title, null, 'a badge with nothing behind it is worse than no badge');
});

test('a start date in the future is not negative days', () => {
  assert.equal(ageing(doing('2026-12-01'), { today: TODAY }).days, null);
});

test('missing arguments are safe', () => {
  assert.equal(ageing(null, { today: TODAY }).stale, false);
  assert.equal(ageing(doing('2026-09-21')).stale, false, 'no today, no verdict');
  assert.equal(ageing(doing('nonsense'), { today: TODAY }).days, null);
});

test('the threshold comes from the project, with a documented default', () => {
  assert.equal(ageingDaysFor(undefined), DEFAULT_AGEING_DAYS);
  assert.equal(ageingDaysFor({ wipAgeingDays: 10 }), 10);
  assert.equal(ageingDaysFor({ wipAgeingDays: 0 }), DEFAULT_AGEING_DAYS, 'zero days would flag everything');
  assert.equal(ageingDaysFor({ wipAgeingDays: 'soon' }), DEFAULT_AGEING_DAYS);
  assert.equal(ageingDaysFor({ wipAgeingDays: 10000 }), 365);
});
