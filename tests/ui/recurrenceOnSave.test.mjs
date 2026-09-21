// T-0088 / BUG-013 — finishing a recurring task means the same thing whichever
// button you press.
//
//   1. Given a weekly recurring task open in the task editor
//   2. When the user sets Status to Done and saves
//   3. Then exactly one next occurrence exists, with shifted plan dates, reset
//      subtasks and the same recurrenceParentId — and saving twice still makes one
//
// Before this row only setTaskStatus (the Board's drag-and-drop and the
// activities modal's dropdown) spawned the next instance. The task editor's
// Save wrote the status itself and spawned nothing, so whether a weekly task
// came round depended on which button you happened to use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  shouldSpawnRecurrence, alreadySpawned, buildNextRecurrenceTask,
} from '../../src/services/recurrence.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');
const editor = read('src', 'components', 'TaskEditor.jsx');

/** A weekly status report, due Monday 14 September, not yet finished. */
const weekly = {
  id: 't1', userId: 'u1', workspaceId: 'ws1', title: 'Weekly status report',
  status: 'doing', deleted: false, archived: false,
  plan: { startDate: '2026-09-14', endDate: '2026-09-14' },
  subtasks: [{ id: 's1', text: 'Collect the numbers', done: true }],
  dependsOn: ['t0'],
  recurrence: { rule: 'weekly', interval: 1, dayOfWeek: 1 },
};

/** What the editor hands maybeSpawnRecurrence after Save. */
const savedAsDone = (patch = {}) => ({ ...weekly, status: 'done', ...patch });

// ─── the gate ───────────────────────────────────────────────────────────────

test('setting Status to Done in the editor spawns the next occurrence', () => {
  assert.equal(shouldSpawnRecurrence(weekly, savedAsDone()), true);
});

test('saving a finished recurring task again spawns nothing', () => {
  const done = savedAsDone();
  assert.equal(shouldSpawnRecurrence(done, { ...done, title: 'Retitled' }), false,
    'editing a task that was already done must not make an occurrence each time');
});

test('a save that does not finish the task spawns nothing', () => {
  assert.equal(shouldSpawnRecurrence(weekly, { ...weekly, priority: 'high' }), false);
  assert.equal(shouldSpawnRecurrence(weekly, { ...weekly, status: 'todo' }), false);
});

test('a task with no recurrence rule spawns nothing, however it is finished', () => {
  const once = { ...weekly, recurrence: null };
  assert.equal(shouldSpawnRecurrence(once, { ...once, status: 'done' }), false);
});

test('finishing a task while deleting or archiving it spawns nothing', () => {
  assert.equal(shouldSpawnRecurrence(weekly, savedAsDone({ deleted: true })), false);
  assert.equal(shouldSpawnRecurrence(weekly, savedAsDone({ archived: true })), false);
});

// ─── what gets created ──────────────────────────────────────────────────────

test('the occurrence has shifted dates, a clean checklist and the series id', () => {
  const payload = buildNextRecurrenceTask(savedAsDone());
  assert.equal(payload.plan.endDate, '2026-09-21', 'one week on, on the same weekday');
  assert.equal(payload.plan.startDate, '2026-09-21');
  assert.deepEqual(payload.subtasks, [{ id: 's1', text: 'Collect the numbers', done: false }],
    'the checklist starts unticked');
  assert.deepEqual(payload.dependsOn, [], 'last week’s blockers do not carry over');
  assert.equal(payload.recurrenceParentId, 't1', 'same series');
  assert.equal(payload.workspaceId, 'ws1', 'without this it never appears on the Board');
});

test('the occurrence uses the dates the user just typed, not the ones they opened', () => {
  // The user moved the due date to Wednesday the 16th in the same save that
  // finished the task. The weekly rule still lands on a Monday, but it is
  // measured from the 16th — so the 28th, not the 21st the modal opened with.
  const payload = buildNextRecurrenceTask(savedAsDone({
    plan: { startDate: '2026-09-16', endDate: '2026-09-16' },
  }));
  assert.equal(payload.plan.endDate, '2026-09-28');
  assert.notEqual(payload.plan.endDate, buildNextRecurrenceTask(savedAsDone()).plan.endDate,
    'building from the stale task would have given a different, wrong week');
});

test('a rule that has run out makes nothing', () => {
  const payload = buildNextRecurrenceTask(savedAsDone({
    recurrence: { rule: 'weekly', interval: 1, dayOfWeek: 1, until: '2026-09-15' },
  }));
  assert.equal(payload, null);
});

// ─── saving twice still makes one ───────────────────────────────────────────

test('the second save finds the occurrence the first one made', () => {
  const payload = buildNextRecurrenceTask(savedAsDone());
  const board = [weekly];
  assert.equal(alreadySpawned(payload, board), false, 'nothing there yet');

  const created = { id: 't2', ...payload };
  assert.equal(alreadySpawned(payload, [...board, created]), true,
    'the same occurrence must not be created twice');
});

test('the dedup key is the series plus the due date, so the catch-up pass agrees', () => {
  const payload = buildNextRecurrenceTask(savedAsDone());
  const created = { id: 't2', ...payload };

  assert.equal(alreadySpawned(payload, [{ ...created, recurrenceParentId: 'other' }]), false,
    'another series does not count');
  assert.equal(alreadySpawned(payload, [{ ...created, plan: { startDate: '2026-09-28', endDate: '2026-09-28' } }]), false,
    'next week’s occurrence does not count as this one');
  assert.equal(alreadySpawned(payload, [{ ...created, deleted: true }]), false,
    'a deleted occurrence must be re-creatable');
});

test('an original instance counts as its own series, so it is never duplicated', () => {
  // The first instance has no recurrenceParentId — it IS the parent.
  const payload = buildNextRecurrenceTask({ ...weekly, status: 'done', plan: { startDate: '2026-09-07', endDate: '2026-09-07' } });
  assert.equal(payload.plan.endDate, '2026-09-14');
  assert.equal(alreadySpawned(payload, [weekly]), true,
    'the 14th is already on the board as the task being completed');
});

// ─── and both paths really call it ──────────────────────────────────────────

test('setTaskStatus goes through the shared helper', () => {
  assert.match(firebase, /await maybeSpawnRecurrence\(task, \{ \.\.\.task, status: nextStatus \}\)/);
  assert.doesNotMatch(firebase, /if \(nextStatus === 'done' && task\.recurrence\)/,
    'the spawn must not live inside one caller any more');
});

test('the task editor goes through the same helper, with the saved task', () => {
  assert.match(editor, /await maybeSpawnRecurrence\(task, \{/,
    'Save must spawn the next occurrence too');
  assert.match(editor, /maybeSpawnRecurrence,/, 'imported from firebase.js');
  const call = editor.slice(editor.indexOf('await maybeSpawnRecurrence(task, {'));
  for (const field of ['status,', 'recurrence,', 'subtasks,', 'plan:']) {
    assert.ok(call.slice(0, 900).includes(field), `the saved ${field} must reach the spawn`);
  }
});

test('the helper never lets a failed spawn lose the save that caused it', () => {
  const start = firebase.indexOf('export async function maybeSpawnRecurrence(');
  assert.ok(start > 0);
  const body = firebase.slice(start, firebase.indexOf('\n}', start));
  assert.match(body, /try \{/, 'a spawn that throws must be caught');
  assert.match(body, /return null;/);
});

test('the on-completion path and the catch-up pass share one dedup rule', () => {
  assert.match(firebase, /alreadySpawned\(payload,/,
    'spawnNextRecurrence must use the pure rule, not its own copy');
});
