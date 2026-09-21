// T-0127 / IMP-017 — bulk actions on the task table, as a plan.
//
// Medium risk: this is a multi-document write path. Everything about what it
// will write is decided here, where it can be checked without touching data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_LIMIT, BULK_ACTIONS, PRIORITIES, bulkAction, bulkPatch, bulkPlan,
  chunkWrites, confirmFor, describeBulk, inversePatch, pruneSelection,
  rangeIds, selectionAfterClick,
} from './bulkTasks.js';
import { statusStamps } from './taskStatus.js';

const TODAY = '2026-09-22';
const task = (over = {}) => ({
  id: 't1', title: 'A task', status: 'todo', priority: 'medium',
  plan: {}, actual: {}, tags: [], assignedTo: [], ...over,
});

/* ── the vocabulary ────────────────────────────────────────────────────── */

test('every action says what kind of value it needs, so nothing is typed free-hand', () => {
  assert.ok(BULK_ACTIONS.length >= 6);
  for (const a of BULK_ACTIONS) {
    assert.ok(a.id && a.label, JSON.stringify(a));
    assert.ok(a.valueKind, `${a.id} does not say what to ask for`);
    assert.doesNotMatch(a.label, /id|uid|JSON|\{/i, 'a label is plain language');
  }
  assert.deepEqual(
    BULK_ACTIONS.map((a) => a.id),
    ['status', 'priority', 'assignee', 'dueDate', 'addTag', 'delete'],
    'the audit named these six',
  );
  assert.equal(bulkAction('delete').danger, true);
  assert.equal(bulkAction('nope'), null);
});

/* ── one task at a time ────────────────────────────────────────────────── */

test('a status change takes its stamps from taskStatus, not from here', () => {
  const t = task({ status: 'todo' });
  const patch = bulkPatch(t, 'status', 'done', { today: TODAY });
  const expected = statusStamps('done', { today: TODAY, current: {} });
  assert.equal(patch.status, 'done');
  assert.equal(patch.progress, expected.progress);
  assert.equal(patch['actual.startDate'], expected.actualStartDate);
  assert.equal(patch['actual.endDate'], expected.actualEndDate);
});

test('an existing actual start survives being closed in bulk', () => {
  const t = task({ status: 'doing', actual: { startDate: '2026-09-01' } });
  const patch = bulkPatch(t, 'status', 'done', { today: TODAY });
  assert.equal(patch['actual.startDate'], '2026-09-01', 'it did not start today');
  assert.equal(patch['actual.endDate'], TODAY);
});

test('an unknown status is refused rather than written', () => {
  assert.equal(bulkPatch(task(), 'status', 'archived', { today: TODAY }), null);
  assert.equal(bulkPatch(task(), 'status', '', { today: TODAY }), null);
});

test('priority only accepts the three that exist', () => {
  assert.deepEqual(bulkPatch(task(), 'priority', 'high'), { priority: 'high' });
  assert.equal(bulkPatch(task(), 'priority', 'urgent'), null);
  for (const p of PRIORITIES) {
    assert.ok(bulkPatch(task({ priority: 'x' }), 'priority', p));
  }
});

test('assigning replaces, and an empty value really means nobody', () => {
  assert.deepEqual(bulkPatch(task(), 'assignee', 'u-mia'), { assignedTo: ['u-mia'] });
  assert.deepEqual(
    bulkPatch(task({ assignedTo: ['u-ace'] }), 'assignee', ''),
    { assignedTo: [] },
    'clearing an assignment is an action, not a missing value',
  );
  assert.equal(bulkPatch(task({ assignedTo: ['u-mia'] }), 'assignee', 'u-mia'), null);
});

test('a due date is written into plan without replacing the rest of the plan', () => {
  const patch = bulkPatch(task({ plan: { startDate: '2026-09-01', endDate: '2026-09-10' } }), 'dueDate', '2026-10-01');
  assert.deepEqual(patch, { 'plan.endDate': '2026-10-01' });
  assert.ok('plan.endDate' in patch, 'a dotted key merges; a whole `plan` object would drop startDate');
});

test('clearing a due date is allowed, and setting the same one is not a write', () => {
  assert.deepEqual(bulkPatch(task({ plan: { endDate: '2026-10-01' } }), 'dueDate', ''), { 'plan.endDate': null });
  assert.equal(bulkPatch(task({ plan: { endDate: '2026-10-01' } }), 'dueDate', '2026-10-01'), null);
});

test('a tag is added to what is there, never over it', () => {
  assert.deepEqual(bulkPatch(task({ tags: ['client'] }), 'addTag', 'urgent'), { tags: ['client', 'urgent'] });
  assert.deepEqual(bulkPatch(task(), 'addTag', '#hash'), { tags: ['hash'] }, 'the # is how people type it');
  assert.equal(bulkPatch(task({ tags: ['client'] }), 'addTag', 'client'), null);
  assert.equal(bulkPatch(task(), 'addTag', '   '), null);
});

// No hard deletes: activities reference tasks.
test('delete is a soft delete', () => {
  assert.deepEqual(bulkPatch(task(), 'delete'), { deleted: true });
  assert.equal(bulkPatch(task({ deleted: true }), 'delete'), null);
});

test('an unknown action writes nothing at all', () => {
  assert.equal(bulkPatch(task(), 'setEverything', 'yes'), null);
  assert.equal(bulkPatch(null, 'priority', 'high'), null);
});

/* ── the plan ──────────────────────────────────────────────────────────── */

const ten = Array.from({ length: 10 }, (_, i) =>
  task({ id: `t${i}`, priority: i < 3 ? 'high' : 'low' }));

// The acceptance case.
test('ten selected tasks set to High produce one batch of exactly the changes needed', () => {
  const plan = bulkPlan(ten, 'priority', 'high', { today: TODAY });
  assert.equal(plan.changed, 7, 'three were already High');
  assert.equal(plan.skipped, 3);
  assert.equal(plan.batches, 1, 'ten tasks is one commit');
  assert.ok(plan.writes.every((w) => w.patch.priority === 'high'));
  assert.deepEqual(plan.writes.map((w) => w.id), ['t3','t4','t5','t6','t7','t8','t9']);
});

test('undo carries the values from before the write, not the action', () => {
  const plan = bulkPlan(ten, 'priority', 'high', { today: TODAY });
  assert.equal(plan.undo.length, plan.writes.length);
  assert.ok(plan.undo.every((u) => u.patch.priority === 'low'),
    'an undo built from the action alone could not know they were Low');
});

test('undo restores every field a status change touched', () => {
  const t = task({ id: 'a', status: 'doing', progress: 40, actual: { startDate: '2026-09-01' } });
  const plan = bulkPlan([t], 'status', 'done', { today: TODAY });
  assert.deepEqual(plan.undo[0].patch, {
    status: 'doing',
    progress: 40,
    'actual.startDate': '2026-09-01',
    'actual.endDate': null,
  });
});

test('undoing a tag restores the list, rather than removing the tag by name', () => {
  const t = task({ id: 'a', tags: ['client', 'q3'] });
  const plan = bulkPlan([t], 'addTag', 'urgent');
  assert.deepEqual(plan.undo[0].patch, { tags: ['client', 'q3'] });
  // The restored list must be a copy — writing it back must not depend on the
  // live task object, which has moved on by then.
  t.tags.push('mutated');
  assert.deepEqual(plan.undo[0].patch.tags, ['client', 'q3']);
});

test('undoing a delete puts it back', () => {
  const plan = bulkPlan([task({ id: 'a' })], 'delete');
  assert.deepEqual(plan.writes[0].patch, { deleted: true });
  assert.deepEqual(plan.undo[0].patch, { deleted: false });
});

test('a plan that changes nothing writes nothing and commits nothing', () => {
  const plan = bulkPlan(ten.slice(0, 3), 'priority', 'high');
  assert.equal(plan.changed, 0);
  assert.equal(plan.skipped, 3);
  assert.equal(plan.batches, 0, 'an empty batch is still a round trip');
  assert.deepEqual(plan.writes, []);
});

test('an empty selection is safe', () => {
  const plan = bulkPlan([], 'delete');
  assert.deepEqual(plan, { writes: [], undo: [], changed: 0, skipped: 0, batches: 0 });
  assert.deepEqual(bulkPlan(undefined, 'delete').writes, []);
});

/* ── batching ──────────────────────────────────────────────────────────── */

test('more writes than a batch holds are split under the Firestore limit', () => {
  const many = Array.from({ length: 950 }, (_, i) => task({ id: `t${i}`, priority: 'low' }));
  const plan = bulkPlan(many, 'priority', 'high');
  assert.equal(plan.changed, 950);
  assert.equal(plan.batches, 3);

  const chunks = chunkWrites(plan.writes);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.length), [400, 400, 150]);
  assert.ok(chunks.every((c) => c.length <= BATCH_LIMIT));
  assert.ok(BATCH_LIMIT < 500, 'Firestore refuses 500; the app commits in 400s');
  assert.equal(chunks.flat().length, 950, 'nothing is dropped at a boundary');
});

test('an exact multiple does not produce a trailing empty batch', () => {
  const chunks = chunkWrites(Array.from({ length: 800 }, (_, i) => ({ id: `t${i}`, patch: {} })));
  assert.deepEqual(chunks.map((c) => c.length), [400, 400]);
});

/* ── selection ─────────────────────────────────────────────────────────── */

const ROWS = ['a', 'b', 'c', 'd', 'e'];

test('a range is the same either way round', () => {
  assert.deepEqual(rangeIds(ROWS, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeIds(ROWS, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeIds(ROWS, 'c', 'c'), ['c']);
  assert.deepEqual(rangeIds(ROWS, 'c', 'zz'), [], 'a row that is not there selects nothing');
});

test('a plain click selects one row and drops the rest', () => {
  const first = selectionAfterClick({ orderedIds: ROWS, id: 'b' });
  assert.deepEqual([...first.selected], ['b']);
  assert.equal(first.anchor, 'b');

  const second = selectionAfterClick({ ...first, orderedIds: ROWS, id: 'd' });
  assert.deepEqual([...second.selected], ['d']);
});

test('clicking the only selected row clears the selection', () => {
  const state = selectionAfterClick({ orderedIds: ROWS, id: 'b' });
  const after = selectionAfterClick({ ...state, orderedIds: ROWS, id: 'b' });
  assert.equal(after.selected.size, 0);
  assert.equal(after.anchor, null);
});

test('cmd-click adds and removes one row at a time', () => {
  let s = selectionAfterClick({ orderedIds: ROWS, id: 'a' });
  s = selectionAfterClick({ ...s, orderedIds: ROWS, id: 'c', metaKey: true });
  s = selectionAfterClick({ ...s, orderedIds: ROWS, id: 'e', metaKey: true });
  assert.deepEqual([...s.selected].sort(), ['a', 'c', 'e']);

  s = selectionAfterClick({ ...s, orderedIds: ROWS, id: 'c', metaKey: true });
  assert.deepEqual([...s.selected].sort(), ['a', 'e']);
});

test('shift-click takes the range from the anchor', () => {
  let s = selectionAfterClick({ orderedIds: ROWS, id: 'b' });
  s = selectionAfterClick({ ...s, orderedIds: ROWS, id: 'd', shiftKey: true });
  assert.deepEqual([...s.selected].sort(), ['b', 'c', 'd']);
  assert.equal(s.anchor, 'b', 'shift must not move the anchor, or the next range starts elsewhere');

  // A second shift-click measures from the same anchor, not from the last row.
  s = selectionAfterClick({ ...s, orderedIds: ROWS, id: 'e', shiftKey: true });
  assert.deepEqual([...s.selected].sort(), ['b', 'c', 'd', 'e']);
});

test('shift with nothing to measure from behaves like cmd, not like a crash', () => {
  const s = selectionAfterClick({ orderedIds: ROWS, id: 'c', shiftKey: true });
  assert.deepEqual([...s.selected], ['c']);
  assert.equal(s.anchor, 'c');
});

test('a selection is pruned to what is still on screen', () => {
  const kept = pruneSelection(new Set(['a', 'b', 'zz']), ROWS);
  assert.deepEqual([...kept].sort(), ['a', 'b'], 'a filter change must not hide a live selection');
  assert.equal(pruneSelection(new Set(), ROWS).size, 0);
});

/* ── what the user is told ─────────────────────────────────────────────── */

test('the sentence names the value the way a person picked it', () => {
  const plan = { changed: 7, skipped: 3 };
  assert.match(describeBulk('status', 'doing', plan), /In Progress/);
  assert.match(describeBulk('priority', 'high', plan), /High priority/);
  assert.match(describeBulk('addTag', 'client', plan), /#client/);
});

test('an assignee is named, never shown as an account id', () => {
  const nameFor = (uid) => ({ 'u-mia': 'Mia Santos' }[uid] || uid);
  const line = describeBulk('assignee', 'u-mia', { changed: 4, skipped: 0 }, { nameFor });
  assert.match(line, /Mia Santos/);
  assert.doesNotMatch(line, /u-mia/, 'nobody is shown a uid');
  assert.match(describeBulk('assignee', '', { changed: 2, skipped: 0 }), /unassigned/);
});

test('one task is not called "1 tasks"', () => {
  assert.match(describeBulk('delete', null, { changed: 1, skipped: 0 }), /^1 task deleted/);
  assert.match(describeBulk('delete', null, { changed: 2, skipped: 0 }), /^2 tasks deleted/);
});

test('the tasks that were skipped are accounted for, not silently dropped', () => {
  const line = describeBulk('priority', 'high', { changed: 7, skipped: 3 });
  assert.match(line, /7 tasks/);
  assert.match(line, /3 already/, '"7 updated" out of ten selected needs explaining');
  assert.doesNotMatch(describeBulk('priority', 'high', { changed: 7, skipped: 0 }), /already/);
});

test('only delete asks first, and it says where they go', () => {
  assert.equal(confirmFor('priority', 5), null);
  const ask = confirmFor('delete', 5);
  assert.match(ask.title, /Delete 5 tasks\?/);
  assert.match(ask.message, /Trash/, 'a soft delete is recoverable — say so');
  assert.equal(ask.danger, true);
  assert.notEqual(ask.confirmLabel, 'OK');
  assert.match(confirmFor('delete', 1).title, /1 task\?/);
});

/* ── inversePatch on its own ───────────────────────────────────────────── */

test('an inverse of an unknown field falls back to null rather than undefined', () => {
  // undefined is not writable to Firestore; null is.
  const back = inversePatch(task(), { somethingNew: 'x' });
  assert.equal(back.somethingNew, null);
  assert.equal(inversePatch(null, { a: 1 }), null);
  assert.equal(inversePatch(task(), null), null);
});
