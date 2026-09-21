// T-0122 / POL-012 — the Dashboard's "Log time" button names its task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logTimeTarget, logTimeLabel, shortTitle } from './logTime.js';

const task = (id, title) => ({ id, title });

test('the most overdue task wins, and the button says so', () => {
  const late = task('a', 'Disbursement report');
  const target = logTimeTarget({
    actionQueue: [{ task: late, isLate: true }, { task: task('b', 'Other'), isLate: true }],
    inProgress: [task('c', 'Something else')],
    tasks: [late],
  });
  assert.equal(target.task, late);
  assert.equal(target.reason, 'overdue');

  const btn = logTimeLabel(target);
  assert.match(btn.label, /Disbursement report/, 'the title must be on the button face, not only in a tooltip');
  assert.match(btn.title, /most overdue/);
  assert.match(btn.title, /pick a different task/i, 'the choice must be presented as changeable');
  assert.equal(btn.disabled, false);
});

test('a task due today is named as due today, not as overdue', () => {
  const due = task('a', 'Weekly pack');
  const target = logTimeTarget({ actionQueue: [{ task: due, isLate: false }], tasks: [due] });
  assert.equal(target.reason, 'due-today');
  assert.match(logTimeLabel(target).title, /due today/);
});

test('with nothing late or due, the task in progress is used', () => {
  const doing = task('c', 'Policy review');
  const target = logTimeTarget({ actionQueue: [], inProgress: [doing], tasks: [doing, task('d', 'Idle')] });
  assert.equal(target.task, doing);
  assert.equal(target.reason, 'in-progress');
  assert.match(logTimeLabel(target).label, /Policy review/);
});

// The bug this module exists for: the old handler ended in `|| filtered[0]`,
// so with nothing overdue and nothing in progress it silently chose whichever
// task happened to sort first and logged the user's hours against it.
test('with no reason to choose, no task is chosen', () => {
  const tasks = [task('x', 'Alphabetically first'), task('y', 'Second')];
  const target = logTimeTarget({ actionQueue: [], inProgress: [], tasks });
  assert.equal(target.task, null, 'an arbitrary task is not a choice');
  assert.equal(target.reason, 'choose');

  const btn = logTimeLabel(target);
  assert.equal(btn.label, 'Log time');
  assert.equal(btn.disabled, false, 'it still works — it opens the picker');
  assert.match(btn.title, /Pick a task/);
});

test('with no tasks at all the button is disabled and says why', () => {
  const btn = logTimeLabel(logTimeTarget({ actionQueue: [], inProgress: [], tasks: [] }));
  assert.equal(btn.disabled, true);
  assert.match(btn.title, /Add a task first/);
});

test('an empty call is safe', () => {
  const target = logTimeTarget();
  assert.equal(target.task, null);
  assert.equal(target.reason, 'empty');
  assert.equal(logTimeLabel(null).label, 'Log time');
  assert.equal(logTimeLabel(undefined).disabled, false);
});

test('a queue entry with no task is skipped rather than believed', () => {
  const doing = task('c', 'Policy review');
  const target = logTimeTarget({ actionQueue: [null, {}], inProgress: [doing], tasks: [doing] });
  assert.equal(target.task, doing);
});

test('a long title is cut at a word boundary and never at full length', () => {
  const long = 'Reconcile the September disbursement ledger against the bank statement';
  const cut = shortTitle(long);
  assert.ok(cut.length <= 33, cut);
  assert.ok(cut.endsWith('…'));
  assert.ok(long.startsWith(cut.slice(0, -1).trim()), 'the cut must be a prefix of the real title');
  assert.doesNotMatch(cut, / …$/, 'no dangling space before the ellipsis');
});

test('a short title is left exactly as it is', () => {
  assert.equal(shortTitle('Board pack'), 'Board pack');
  assert.equal(shortTitle(''), '(untitled task)');
  assert.equal(shortTitle(null), '(untitled task)');
});

test('the full title, not the cut one, is what the tooltip carries', () => {
  const long = 'Reconcile the September disbursement ledger against the bank statement';
  const btn = logTimeLabel({ task: task('a', long), reason: 'overdue' });
  assert.ok(btn.title.includes(long), 'the tooltip is not a button face — it has room');
  assert.ok(!btn.label.includes(long));
});
