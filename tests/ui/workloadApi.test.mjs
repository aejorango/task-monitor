// T-0078 / NEW-005 — the data layer behind the workload planner.
//
// The arithmetic is tested in src/services/workload.test.mjs. This holds
// firebase.js to applying a move the way the planner means it: one write of the
// patch the pure module produced, and a notice for whoever just inherited the
// task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');
const workload = read('src', 'services', 'workload.js');

const bodyOf = (name) => {
  const start = firebase.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = firebase.indexOf('\nexport ', start + 10);
  return firebase.slice(start, next > 0 ? next : undefined);
};

test('a move is one function, so a drag cannot forget half of it', () => {
  const body = bodyOf('applyTaskMove');
  assert.match(body, /await updateTask\(task\.id, patch\)/);
  assert.match(body, /if \(patch\.assignedTo\) \{/);
  assert.match(body, /await notifyAssignment\(\{/);
});

test('a move that changes nothing writes nothing', () => {
  assert.match(bodyOf('applyTaskMove'),
    /if \(!task\?\.id \|\| !patch \|\| !Object\.keys\(patch\)\.length\) return null;/);
});

test('the notice is raised after the write, never instead of it', () => {
  const body = bodyOf('applyTaskMove');
  assert.ok(body.indexOf('updateTask(task.id, patch)') < body.indexOf('notifyAssignment'));
});

test('the planner decides nothing in the data layer — the pure module does', () => {
  assert.doesNotMatch(firebase, /plan\.endDate.*weekday/i);
  assert.match(workload, /export function moveTaskPlan/);
  assert.match(workload, /import \{ memberLabel \} from '\.\/invites'/);
  const imports = workload.split('\n').filter((l) => l.startsWith('import '));
  assert.deepEqual(imports.map((l) => l.split("'")[1]), ['./invites', './recurrence', './timesheet'],
    'the planner module must stay pure — no Firebase, no network');
});

test('the patch uses the dotted paths updateTask expects, not a whole plan object', () => {
  // Writing `plan: { endDate }` would wipe plan.startDate.
  assert.match(workload, /patch\['plan\.endDate'\] = nextDue/);
  assert.match(workload, /patch\['plan\.startDate'\] = addDaysISO\(nextDue, -span\)/);
  assert.doesNotMatch(workload, /patch\.plan =/);
});

test('the grid is bounded by the window it shows, not by the whole collection', () => {
  assert.match(workload, /const key = weekKeyOf\(due, weeks\)/);
  assert.match(workload, /continue;\s+\/\/ outside the window/);
});

test('every load level has a sentence a person can read', () => {
  assert.match(workload, /export const LOAD_LABEL = \{/);
  for (const level of ['free', 'ok', 'full', 'over']) {
    assert.match(workload, new RegExp(`${level}: '`), `${level} has no label`);
  }
  assert.match(workload, /export function describeCell/);
});
