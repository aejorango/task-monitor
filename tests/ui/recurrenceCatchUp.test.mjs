// T-0084 / NEW-012 — a recurring task comes round on schedule.
//
//   1. Given a weekly task never completed
//   2. When the next week arrives
//   3. Then a new instance exists
//
// The arithmetic is in src/services/recurrenceSchedule.test.mjs. This walks the
// path the app actually takes, and holds the write and the hook to the rules
// that make running it repeatedly safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  catchUpPlan, describeCatchUp, seriesOf,
} from '../../src/services/recurrenceSchedule.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');
const hook = read('src', 'hooks', 'useRecurrenceCatchUp.js');
const module_ = read('src', 'services', 'recurrenceSchedule.js');

const bodyOf = (name) => {
  const start = firebase.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = firebase.indexOf('\nexport ', start + 10);
  return firebase.slice(start, next > 0 ? next : undefined);
};

/** A weekly report, last scheduled for Monday 14 September, never ticked off. */
const weekly = {
  id: 't1', userId: 'u1', workspaceId: 'ws1', title: 'Weekly status report',
  status: 'todo', deleted: false, archived: false,
  plan: { startDate: '2026-09-14', endDate: '2026-09-14' },
  recurrence: { rule: 'weekly', interval: 1, dayOfWeek: 1 },
};

// ─── the acceptance path ────────────────────────────────────────────────────

test('before the next week arrives, nothing is due', () => {
  assert.deepEqual(catchUpPlan([weekly], { today: '2026-09-20' }), [],
    'the 21st has not arrived yet');
});

test('when the next week arrives, an instance is due — without anybody ticking anything', () => {
  const plan = catchUpPlan([weekly], { today: '2026-09-21' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].payload.plan.endDate, '2026-09-21');
  assert.equal(weekly.status, 'todo', 'the old one was never completed');
});

test('once it exists, running again creates nothing', () => {
  const created = catchUpPlan([weekly], { today: '2026-09-21' })[0];
  const nextRun = catchUpPlan(
    [weekly, { ...weekly, id: 't2', recurrenceParentId: 't1', plan: created.payload.plan }],
    { today: '2026-09-21' },
  );
  assert.deepEqual(nextRun, [], 'a second run must be a no-op');
});

test('two devices running it at the same moment agree on the same list', () => {
  const a = catchUpPlan([weekly], { today: '2026-09-21' });
  const b = catchUpPlan([weekly], { today: '2026-09-21' });
  assert.deepEqual(a.map((p) => p.payload.plan), b.map((p) => p.payload.plan));
});

test('the series the app reads is the same one the old on-completion path uses', () => {
  const series = seriesOf([weekly]);
  assert.equal(series.get('t1').anchor.id, 't1');
  // Both paths key on recurrenceParentId + dates, which is what makes them safe
  // to have running at the same time. Since T-0088 the on-completion path
  // applies that key through the shared pure rule rather than its own copy.
  assert.match(firebase, /where\('recurrenceParentId', '==', payload\.recurrenceParentId\)/);
  assert.match(firebase, /alreadySpawned\(payload,/);
  assert.match(module_, /!existingDates\.has\(occurrence\.end\)/);
});

// ─── the write ──────────────────────────────────────────────────────────────

test('the catch-up writes through addTask, so an instance is a real task', () => {
  const body = bodyOf('materialiseRecurrences');
  assert.match(body, /await addTask\(item\.userId \|\| userId, item\.payload\)/);
  assert.doesNotMatch(body, /addDoc\(/, 'a hand-rolled write loses every field added since');
});

test('one series failing does not stop the others coming round', () => {
  const body = bodyOf('materialiseRecurrences');
  assert.match(body, /for \(const item of plan\)/);
  assert.match(body, /catch \(err\) \{/);
  assert.match(body, /console\.warn\('\[recurrence\] could not create an instance', err\)/);
});

test('nothing due means nothing written at all', () => {
  assert.match(bodyOf('materialiseRecurrences'), /if \(!plan\.length\) return \[\];/);
});

test('the instance belongs to the series’ owner, not to whoever ran the catch-up', () => {
  assert.match(module_, /userId: anchor\.userId \|\| null/);
  assert.match(bodyOf('materialiseRecurrences'), /item\.userId \|\| userId/);
});

test('the on-completion path still exists — this is a second way, not a replacement', () => {
  assert.match(firebase, /async function spawnNextRecurrence\(task\)/);
  // Since T-0088 every way of finishing a task reaches it through one helper,
  // so the Board, the activities modal and the task editor cannot disagree.
  assert.match(firebase, /export async function maybeSpawnRecurrence\(before, after\)/);
  assert.match(firebase, /await spawnNextRecurrence\(after\)/);
});

// ─── when it runs ───────────────────────────────────────────────────────────

test('it runs once a day per device, with an interval for an app left open', () => {
  assert.match(hook, /export const CHECK_EVERY_MS = 60 \* 60 \* 1000/);
  assert.match(hook, /if \(!alive \|\| ranFor\.current === today\) return;/);
  assert.match(hook, /ranFor\.current = today;/);
});

test('a failed run is allowed to try again rather than being marked done', () => {
  assert.match(hook, /ranFor\.current = null;/);
});

test('it waits for the tasks to load before deciding nothing is due', () => {
  assert.match(hook, /if \(!Array\.isArray\(list\) \|\| list\.length === 0\) return;/);
});

test('a failure is logged, never shown — the next run does the same job', () => {
  assert.match(hook, /console\.warn\('\[recurrence\] catch-up failed', err\)/);
  assert.doesNotMatch(hook, /toast/, 'nobody needs interrupting about this');
});

test('it is mounted once, for a signed-in approved user', () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /useRecurrenceCatchUp\(tasksForRecurrence, \{ userId \}\)/);
  assert.equal((app.match(/useRecurrenceCatchUp\(/g) || []).length, 1, 'called exactly once');
  assert.match(app, /const \{ tasks: tasksForRecurrence \} = useTasks\(\)/);
});

test('reading the tasks here costs no extra Firestore query', () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /already subscribed to once, app-wide/);
  const shared = read('src', 'hooks', 'useTasks.js');
  assert.match(shared, /createSharedSubscription/);
});

// ─── the honest limit ───────────────────────────────────────────────────────

test('the hook says plainly when a catch-up does not happen', () => {
  assert.match(hook, /a workspace nobody opens for a month catches up\n\/\/ the next time somebody opens it, not before/);
});

test('what it did is said in a sentence, for the log', () => {
  assert.equal(describeCatchUp([{ seriesId: 'a' }]), 'Added 1 recurring task across 1 schedule.');
  assert.match(hook, /describeCatchUp\(created\)/);
});
