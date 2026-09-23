// The Board hub's toolbar means the same thing on all eight of its tabs, or
// it means nothing. These are the rules it is made of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SCOPES, blockedTaskIds, describeScope, displayStatus, isStuck,
  scopeOf, scopePatch, scopeTasks,
} from './boardScope.js';

const TODAY = '2026-07-20';
const T = (over) => ({ id: 'a', status: 'todo', assignedTo: [], plan: {}, ...over });

test('the three pills are the ones the mockup draws, and each says what it means', () => {
  assert.deepEqual(BOARD_SCOPES.map((s) => s.id), ['all', 'mine', 'stuck']);
  BOARD_SCOPES.forEach((s) => assert.ok(s.hint, `${s.id} has no explanation`));
});

test('All filters nothing at all', () => {
  const tasks = [T({ id: '1' }), T({ id: '2' })];
  assert.equal(scopeTasks(tasks, { scope: 'all', userId: 'me', today: TODAY }).length, 2);
});

test('Mine is who it is assigned to, not who created it', () => {
  const tasks = [
    T({ id: 'mine', assignedTo: ['me'] }),
    T({ id: 'theirs', assignedTo: ['you'], userId: 'me' }),
  ];
  const out = scopeTasks(tasks, { scope: 'mine', userId: 'me', today: TODAY });
  assert.deepEqual(out.map((t) => t.id), ['mine']);
});

test('Mine with nobody signed in shows everything rather than nothing', () => {
  // An empty page the moment auth is a beat behind reads as "you have no
  // work", which is a different and wrong claim.
  const tasks = [T({ id: '1', assignedTo: ['me'] })];
  assert.equal(scopeTasks(tasks, { scope: 'mine', userId: null, today: TODAY }).length, 1);
});

test('Stuck is a logged bottleneck or an open item past its plan date', () => {
  const blocked = new Set(['b']);
  assert.equal(isStuck(T({ id: 'b' }), blocked, TODAY), true, 'somebody wrote down a blocker');
  assert.equal(isStuck(T({ id: 'late', plan: { endDate: '2026-07-01' } }), new Set(), TODAY), true);
  assert.equal(isStuck(T({ id: 'soon', plan: { endDate: '2026-08-01' } }), new Set(), TODAY), false);
});

test('a finished task is never stuck, however late it was', () => {
  const t = T({ id: 'x', status: 'done', plan: { endDate: '2026-01-01' } });
  assert.equal(isStuck(t, new Set(), TODAY), false);
});

test('a bottleneck on a finished task still counts — the note is the fact', () => {
  // A blocker somebody logged is a record of what happened; the task closing
  // afterwards does not unwrite it. The date rule is the one that needs the
  // task to still be open.
  const t = T({ id: 'b', status: 'done' });
  assert.equal(isStuck(t, new Set(['b']), TODAY), true);
});

test('blockedTaskIds ignores an empty remark', () => {
  const ids = blockedTaskIds([
    { taskId: 'a', bottleneckRemarks: 'waiting on legal' },
    { taskId: 'b', bottleneckRemarks: '   ' },
    { taskId: 'c' },
  ]);
  assert.deepEqual([...ids], ['a']);
});

test('a member filter stacks on top of a pill', () => {
  const tasks = [
    T({ id: '1', assignedTo: ['pam'], plan: { endDate: '2026-07-01' } }),
    T({ id: '2', assignedTo: ['rob'], plan: { endDate: '2026-07-01' } }),
  ];
  const out = scopeTasks(tasks, { scope: 'stuck', who: 'pam', today: TODAY });
  assert.deepEqual(out.map((t) => t.id), ['1']);
});

test('the route says which pill is lit, and pressing the lit one clears it', () => {
  assert.equal(scopeOf({}), 'all');
  assert.equal(scopeOf({ onlyMine: true }), 'mine');
  assert.equal(scopeOf({ stuckOnly: true }), 'stuck');
  assert.deepEqual(scopePatch('mine', 'all'), { onlyMine: true, stuckOnly: false });
  assert.deepEqual(scopePatch('mine', 'mine'), { onlyMine: false, stuckOnly: false });
});

test('a filter that is on says so in words', () => {
  assert.equal(describeScope({ scope: 'all' }), null, 'no filter, no sentence');
  assert.match(describeScope({ scope: 'stuck' }), /blocked or past due/);
  assert.match(describeScope({ scope: 'mine', who: 'u1', whoName: 'Pam' }), /Pam only/);
});

// ─── what a task is SHOWN as ────────────────────────────────────────────────

test('an item in progress past its plan date is shown as Stuck', () => {
  const t = T({ id: 'x', status: 'doing', plan: { endDate: '2026-07-01' } });
  const d = displayStatus(t, new Set(), TODAY);
  assert.equal(d.label, 'Stuck');
  assert.equal(d.tone, 'red');
  assert.equal(d.stuck, true);
  // …and the task itself is untouched: this is what to print, not what to save.
  assert.equal(t.status, 'doing');
});

test('in progress and still in time is Working on it', () => {
  const t = T({ status: 'doing', plan: { endDate: '2026-08-01' } });
  assert.equal(displayStatus(t, new Set(), TODAY).label, 'Working on it');
});

test('a logged bottleneck shows Stuck even before the date has gone', () => {
  const t = T({ id: 'b', status: 'doing', plan: { endDate: '2026-08-01' } });
  assert.equal(displayStatus(t, new Set(['b']), TODAY).label, 'Stuck');
});

test('a finished item is Done however late it was', () => {
  const t = T({ status: 'done', plan: { endDate: '2026-01-01' } });
  const d = displayStatus(t, new Set(), TODAY);
  assert.equal(d.label, 'Done');
  assert.equal(d.stuck, false);
});

test('the chip agrees with the Stuck pill, item for item', () => {
  // Three surfaces count stuck items — the chip, the pill and the breadcrumb.
  // They must be the same predicate or the board argues with itself.
  const tasks = [
    T({ id: '1', status: 'doing', plan: { endDate: '2026-07-01' } }),
    T({ id: '2', status: 'todo',  plan: { endDate: '2026-07-01' } }),
    T({ id: '3', status: 'doing', plan: { endDate: '2026-08-01' } }),
    T({ id: '4', status: 'done',  plan: { endDate: '2026-01-01' } }),
  ];
  const shown = tasks.filter((t) => displayStatus(t, new Set(), TODAY).stuck).map((t) => t.id);
  const filtered = scopeTasks(tasks, { scope: 'stuck', today: TODAY }).map((t) => t.id);
  assert.deepEqual(shown, filtered);
});
