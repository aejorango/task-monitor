// T-0141 / NEW-025 — a promoted subtask that is still a subtask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHILD_OF, MAX_DEPTH, canParent, childrenOf, descendantsOf,
  explainRollup, parentIdOf, rollup,
} from './taskTree.js';

const task = (id, over = {}) => ({
  id, title: id, status: 'todo', progress: 0, subtasks: [], links: [],
  totalHoursLogged: 0, ...over,
});
const childOf = (id, parentId, over = {}) =>
  task(id, { links: [{ targetId: parentId, type: CHILD_OF }], ...over });

/* ── reading the link ──────────────────────────────────────────────────── */

test('a child points at its parent through the links array', () => {
  assert.equal(parentIdOf(childOf('b', 'a')), 'a');
  assert.equal(parentIdOf(task('a')), null);
  assert.equal(parentIdOf(undefined), null);
});

test('other link types are not parenthood', () => {
  assert.equal(parentIdOf(task('b', { links: [{ targetId: 'a', type: 'related-to' }] })), null);
  assert.equal(parentIdOf(task('b', { links: [{ targetId: 'a', type: 'blocks' }] })), null);
});

test('children are the tasks that claim this one', () => {
  const all = [task('a'), childOf('b', 'a'), childOf('c', 'a'), childOf('d', 'other')];
  assert.deepEqual(childrenOf(task('a'), all).map((t) => t.id), ['b', 'c']);
});

test('a deleted or archived child is not underneath anything', () => {
  const all = [childOf('b', 'a'), childOf('c', 'a', { deleted: true }), childOf('d', 'a', { archived: true })];
  assert.deepEqual(childrenOf(task('a'), all).map((t) => t.id), ['b']);
});

/* ── the acceptance case ───────────────────────────────────────────────── */

test('a parent’s progress includes the subtask that was promoted out of it', () => {
  // Before: three checklist items, one ticked → 33%.
  const before = task('a', {
    subtasks: [{ id: 's1', done: true }, { id: 's2', done: false }, { id: 's3', done: false }],
  });
  assert.equal(rollup(before, [before]).progress, 33);

  // s3 is promoted: two lines left plus one task under it. Still three units.
  const after = task('a', { subtasks: [{ id: 's1', done: true }, { id: 's2', done: false }] });
  const child = childOf('c', 'a');
  const r = rollup(after, [after, child]);
  assert.equal(r.units, 3, 'promoting must not shrink the denominator');
  assert.equal(r.progress, 33, 'nor change the answer');
  assert.equal(r.hasChildren, true);
  assert.equal(r.childCount, 1);
});

test('finishing the promoted child moves the parent on', () => {
  const parent = task('a', { subtasks: [{ id: 's1', done: true }, { id: 's2', done: false }] });
  const child = childOf('c', 'a', { status: 'done' });
  assert.equal(rollup(parent, [parent, child]).progress, 67, '2 of 3');
});

test('a parent carries the hours logged underneath it', () => {
  const parent = task('a', { totalHoursLogged: 2 });
  const child = childOf('c', 'a', { totalHoursLogged: 5 });
  const grandchild = childOf('g', 'c', { totalHoursLogged: 1 });
  assert.equal(rollup(parent, [parent, child, grandchild]).hours, 8,
    'a two-level tree must not under-report');
});

/* ── when nothing rolls up ─────────────────────────────────────────────── */

test('a plain task keeps its own stated progress', () => {
  const t = task('a', { progress: 40 });
  const r = rollup(t, [t]);
  assert.equal(r.progress, 40);
  assert.equal(r.source, 'own');
  assert.equal(r.hasChildren, false);
  assert.equal(explainRollup(r), null, 'nothing to explain');
});

test('a done task reads 100% however its progress field was left', () => {
  const t = task('a', { status: 'done', progress: 40 });
  assert.equal(rollup(t, [t]).progress, 100);
});

// Somebody decided. The app does not argue with them.
test('a parent marked done is done, whatever is underneath it', () => {
  const parent = task('a', { status: 'done', subtasks: [{ id: 's1', done: false }] });
  const child = childOf('c', 'a');
  assert.equal(rollup(parent, [parent, child]).progress, 100);
});

test('subtasks alone still work exactly as before', () => {
  const t = task('a', { subtasks: [{ id: '1', done: true }, { id: '2', done: false }] });
  const r = rollup(t, [t]);
  assert.equal(r.progress, 50);
  assert.equal(r.source, 'subtasks');
  assert.equal(r.hasChildren, false);
});

test('children alone work too', () => {
  const parent = task('a');
  const kids = [childOf('b', 'a', { status: 'done' }), childOf('c', 'a')];
  const r = rollup(parent, [parent, ...kids]);
  assert.equal(r.progress, 50);
  assert.equal(r.source, 'children');
});

test('the explanation says where the number came from', () => {
  const parent = task('a', { subtasks: [{ id: '1', done: true }, { id: '2', done: false }] });
  const child = childOf('c', 'a', { status: 'done' });
  assert.equal(explainRollup(rollup(parent, [parent, child])),
    'From 1/2 subtasks and 1/1 task under it');
  assert.match(explainRollup(rollup(parent, [parent])), /^From 1\/2 subtasks$/);
});

/* ── the guard the audit asked for ─────────────────────────────────────── */

// Data that should not exist, but a rollup that recurses forever on it takes
// the editor down with it.
test('a two-task cycle does not hang the rollup', () => {
  const a = childOf('a', 'b');
  const b = childOf('b', 'a');
  const r = rollup(a, [a, b]);
  assert.equal(r.childCount, 1);
  assert.ok(Number.isFinite(r.hours));
  assert.deepEqual(descendantsOf(a, [a, b]).map((t) => t.id), ['b'],
    'each task is visited once, so the walk terminates');
});

test('a longer cycle terminates too', () => {
  const a = childOf('a', 'c');
  const b = childOf('b', 'a');
  const c = childOf('c', 'b');
  assert.equal(descendantsOf(a, [a, b, c]).length, 2, 'b and c, and then it stops');
});

test('a task that is its own parent is survivable', () => {
  const a = childOf('a', 'a');
  assert.deepEqual(childrenOf(a, [a]), [], 'a task is not inside itself');
  assert.equal(rollup(a, [a]).childCount, 0);
});

test('a very deep chain stops at the documented depth', () => {
  const chain = [task('t0')];
  for (let i = 1; i <= MAX_DEPTH + 5; i++) chain.push(childOf(`t${i}`, `t${i - 1}`));
  const found = descendantsOf(chain[0], chain);
  assert.ok(found.length <= MAX_DEPTH, `walked ${found.length} levels`);
});

test('a diamond counts each task once', () => {
  const a = task('a');
  const b = childOf('b', 'a');
  const c = childOf('c', 'a');
  // d claims b as its parent; nothing claims it twice, but the walk must still
  // not double it if the shape ever changes.
  const d = childOf('d', 'b');
  const found = descendantsOf(a, [a, b, c, d]).map((t) => t.id);
  assert.deepEqual(found.sort(), ['b', 'c', 'd']);
});

/* ── refusing a bad link ───────────────────────────────────────────────── */

test('a task cannot be put inside itself', () => {
  const a = task('a');
  const r = canParent(a, a, [a]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot be inside itself/);
});

test('a task cannot be adopted by something already beneath it', () => {
  const a = task('a');
  const b = childOf('b', 'a');
  const r = canParent(b, a, [a, b]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /already sits above this one/);
});

test('an ordinary parenting is allowed', () => {
  const a = task('a');
  const b = task('b');
  assert.deepEqual(canParent(a, b, [a, b]), { ok: true, reason: null });
});

test('nothing to link is refused in plain language', () => {
  assert.match(canParent(null, task('b'), []).reason, /Nothing to link/);
});
