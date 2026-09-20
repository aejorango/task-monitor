// T-0081 / NEW-011 — the data layer behind a read-only share link.
//
// The decisions are in src/services/shareLinks.test.mjs and the rules in
// tests/rules/sharedViews.rules.test.mjs. These hold firebase.js and the rules
// file to the shape of the thing: a snapshot addressed by an unguessable token,
// readable by exactly one `get`, and dead the moment it is switched off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');
const rules = read('firestore.rules');
const module_ = read('src', 'services', 'shareLinks.js');

const bodyOf = (name) => {
  const start = firebase.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = firebase.indexOf('\nexport ', start + 10);
  return firebase.slice(start, next > 0 ? next : undefined);
};

// ─── the document ───────────────────────────────────────────────────────────

test('the token is the document id, so a reader fetches exactly one document', () => {
  assert.match(bodyOf('createShareLink'), /setDoc\(doc\(db, 'sharedViews', token\)/);
  assert.match(bodyOf('getSharedView'), /getDoc\(doc\(db, 'sharedViews', token\)\)/);
});

test('the token comes from the browser’s own randomness, not from Math.random', () => {
  assert.match(module_, /source\.getRandomValues\(new Uint8Array\(n\)\)/);
  assert.doesNotMatch(module_, /Math\.random/);
  assert.match(bodyOf('createShareLink'), /newShareToken\(cryptoBytes\)/);
});

test('what is published is what the pure module built — nothing assembled inline', () => {
  const body = bodyOf('createShareLink');
  assert.match(body, /buildShareLink\(\{/);
  assert.doesNotMatch(body, /assignedTo/, 'the payload is not hand-rolled here');
});

test('a refresh replaces the snapshot and leaves the link alive', () => {
  const body = bodyOf('refreshShareLink');
  assert.match(body, /snapshot: buildSnapshot\(project, tasks\)/);
  assert.doesNotMatch(body, /revoked/);
  assert.doesNotMatch(body, /expiresAt/);
});

test('revoking is a write, so it takes effect for everybody at once', () => {
  assert.match(bodyOf('revokeShareLink'), /revoked: true/);
});

test('opening a dead link and opening a missing one look the same', () => {
  const body = bodyOf('getSharedView');
  assert.match(body, /if \(!snap\.exists\(\)\) return null;/);
  assert.match(body, /return isShareLive\(share\) \? share : null;/);
});

// ─── the rules ──────────────────────────────────────────────────────────────

const block = rules.slice(rules.indexOf('match /sharedViews/'), rules.indexOf('match /webhookDeliveries/'));

test('a stranger can get one, and can never list them', () => {
  assert.match(block, /allow get:\s+if shareIsLive\(resource\.data\)/);
  assert.match(block, /allow list: if false/);
});

test('being live is decided in the rules, not only in the page', () => {
  const fn = rules.slice(rules.indexOf('function shareIsLive'), rules.indexOf('match /sharedViews/'));
  assert.match(fn, /share\.revoked == false/);
  assert.match(fn, /share\.expiresAt == null \|\| share\.expiresAt > request\.time/);
});

test('only an admin publishes, and only in their own name', () => {
  assert.match(block, /allow create: if isWorkspaceAdmin\(request\.resource\.data\.workspaceId\)/);
  assert.match(block, /request\.resource\.data\.createdByUserId == request\.auth\.uid/);
  assert.match(block, /&& shareIsLive\(request\.resource\.data\)/,
    'a link that is born dead is just confusing');
});

test('an update cannot move a link to another workspace or another publisher', () => {
  assert.match(block, /request\.resource\.data\.workspaceId == resource\.data\.workspaceId/);
  assert.match(block, /request\.resource\.data\.createdByUserId == resource\.data\.createdByUserId/);
});

test('this is the only world-readable rule in the file', () => {
  // Any other `allow ... : if true` would be a hole somebody added later.
  const permissive = rules.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /allow [a-z, ]+:\s*if true\s*;/.test(l));
  assert.deepEqual(permissive, [], 'nothing in this app should be readable by everyone');
});

test('the snapshot is a snapshot — the rules never open tasks to the public', () => {
  const tasksBlock = rules.slice(rules.indexOf('match /tasks/{taskId}'), rules.indexOf('match /activities/'));
  assert.doesNotMatch(tasksBlock, /sharedViews/);
  assert.match(tasksBlock, /allow read:\s+if isOwner\(resource\)/);
});

// ─── the module’s own promises ──────────────────────────────────────────────

test('the list of fields that may leave the workspace is written down', () => {
  assert.match(module_, /export const SHARED_TASK_FIELDS = \[/);
  for (const field of ['id', 'title', 'status', 'priority', 'progress', 'startDate', 'endDate', 'phase']) {
    assert.match(module_, new RegExp(`'${field}'`));
  }
});

test('the module stays pure, so what leaves the workspace can be tested', () => {
  const imports = module_.split('\n').filter((l) => l.startsWith('import '));
  assert.deepEqual(imports, [], 'shareLinks.js imports nothing at all');
});
