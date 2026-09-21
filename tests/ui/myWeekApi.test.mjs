// T-0130 / NEW-020 — the data layer behind My Week.
//
// The pure bucketing is in src/services/myWeek.test.mjs. These hold the read
// path to the thing that makes it affordable: My Week is a screen somebody
// leaves open all day, so it must not be built on the subscription that
// downloads every task in every workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');
const hooks = read('src', 'hooks', 'useTasks.js');

const bodyOf = (src, name) => {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next > 0 ? next : undefined);
};

test('the filter is at the server, not in the callback', () => {
  const body = bodyOf(firebase, 'subscribeToMyTasksAcrossWorkspaces');
  assert.match(body, /where\('workspaceId', '==', wsId\)/);
  assert.match(body, /where\('assignedTo', 'array-contains', userId\)/,
    'filtering after the download does not save a single read');
});

test('that query has its composite index', () => {
  // Rule 4: add the entry here, not by clicking the link Firestore prints, or
  // the next environment breaks.
  const indexes = JSON.parse(read('firestore.indexes.json'));
  const has = indexes.indexes.some((i) => i.collectionGroup === 'tasks'
    && i.fields.some((f) => f.fieldPath === 'workspaceId' && f.order === 'ASCENDING')
    && i.fields.some((f) => f.fieldPath === 'assignedTo' && f.arrayConfig === 'CONTAINS'));
  assert.ok(has, 'workspaceId + assignedTo array-contains needs an entry in firestore.indexes.json');
});

test('the week does not paint one workspace at a time', () => {
  const body = bodyOf(firebase, 'subscribeToMyTasksAcrossWorkspaces');
  assert.match(body, /if \(seenInitial\.size < workspaceIds\.length\) return;/,
    'firing before every listener has reported once shows a half-built week');
});

test('deleted and archived tasks never reach the caller', () => {
  const body = bodyOf(firebase, 'subscribeToMyTasksAcrossWorkspaces');
  assert.match(body, /\.filter\(\(t\) => !t\.deleted && !t\.archived\)/);
});

test('a listener that fails does not hang the whole week', () => {
  const body = bodyOf(firebase, 'subscribeToMyTasksAcrossWorkspaces');
  assert.match(body, /listenerError\('myTasksAcrossWorkspaces'/);
  assert.match(body, /byWs\[wsId\] = \[\]; seenInitial\.add\(wsId\); fire\(\);/,
    'one workspace refusing the read must not leave the other six waiting forever');
});

test('no workspaces, or no user, is answered without subscribing to anything', () => {
  const body = bodyOf(firebase, 'subscribeToMyTasksAcrossWorkspaces');
  assert.match(body, /if \(!workspaceIds\?\.length \|\| !userId\) \{ callback\(\[\]\); return \(\) => \{\}; \}/);
});

test('the hook uses the bounded subscription, not the workspace-wide one', () => {
  const body = bodyOf(hooks, 'useMyTasksAcrossWorkspaces');
  assert.match(body, /subscribeToMyTasksAcrossWorkspaces\(ids, userId,/);
  assert.doesNotMatch(body, /subscribeToTasksAcrossWorkspaces\(/,
    'that one downloads every task in every workspace — see the comment above the hook');
  // And the reason is written down, so the next person does not "simplify" it.
  const why = hooks.slice(hooks.indexOf('Every task assigned to the signed-in person'),
    hooks.indexOf('export function useMyTasksAcrossWorkspaces'));
  assert.match(why.replace(/\n\s*\*\s?/g, ' '), /The filter is at the server/);
});

test('the hook unsubscribes', () => {
  assert.match(bodyOf(hooks, 'useMyTasksAcrossWorkspaces'), /return \(\) => unsub\(\);/);
});

test('waiting for the workspace list is not the same as having no workspaces', () => {
  const body = bodyOf(hooks, 'useMyTasksAcrossWorkspaces');
  assert.match(body, /setLoading\(Boolean\(!ready \|\| wsLoading\)\);/,
    'otherwise My Week flashes "nothing assigned to you" every time it opens');
});

test('what a drop means still lives in one module', () => {
  const workload = read('src', 'services', 'workload.js');
  assert.match(workload, /export function moveTaskToDay\(task, day\)/);
  assert.match(workload, /export const DAY_UNSCHEDULED/);
  // myWeek.js buckets; it must not also decide what a write is.
  const myWeek = read('src', 'services', 'myWeek.js');
  assert.doesNotMatch(myWeek, /'plan\.endDate'/,
    'two modules writing plan.endDate is how a drop comes to mean two things');
});

test('neither pure module reaches for Firebase or the clock', () => {
  for (const file of ['myWeek.js', 'workload.js']) {
    const src = read('src', 'services', file);
    assert.doesNotMatch(src, /from '\.\/firebase'/, `${file} must stay testable under node --test`);
    assert.doesNotMatch(src, /new Date\(\)\.toISOString/, `${file} must not stamp the UTC day`);
  }
});
