// T-0075 / NEW-004 — the data layer behind mentions and the inbox.
//
// The pure decisions are tested in src/services/mentions.test.mjs and the rules
// against the emulator in tests/rules/notifications.rules.test.mjs. These hold
// firebase.js to using them: the notices are raised where the message is
// written, and never in a way that could lose the message itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');

const bodyOf = (name) => {
  const start = firebase.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = firebase.indexOf('\nexport ', start + 10);
  return firebase.slice(start, next > 0 ? next : undefined);
};

test('the data layer decides nothing itself — it asks the pure module', () => {
  assert.match(firebase,
    /import \{ noticesForAssignment, noticesForComment, watchersOf \} from '\.\/mentions'/);
});

test('a comment raises the notices it earns', () => {
  const body = bodyOf('addTaskComment');
  assert.match(body, /raiseNotices\(noticesForComment\(\{/);
  assert.match(body, /authorId: userId/);
  assert.match(body, /watchers: audience\.watchers \|\| watchersOf\(taskObj\)/);
});

test('a comment is saved even when there is nobody to tell', () => {
  const body = bodyOf('addTaskComment');
  assert.match(body, /if \(audience\) \{/, 'no audience must not mean no comment');
  assert.ok(body.indexOf('addDoc(taskCommentsRef') < body.indexOf('raiseNotices'),
    'the message is written first; telling people comes after');
  assert.match(body, /return written;/);
});

test('a notice that cannot be written never takes the message down with it', () => {
  const body = bodyOf('raiseNotices');
  assert.match(body, /\.catch\(\(err\) => console\.warn\('could not raise a notice', err\)\)/);
});

test('an assignment tells whoever was just put on the task', () => {
  assert.match(bodyOf('notifyAssignment'),
    /raiseNotices\(noticesForAssignment\(\{ task, before, after, byUserId, byName \}\)\)/);
});

test('the inbox can be read and cleared', () => {
  assert.match(firebase, /export function subscribeToMyNotifications\(userId, callback/);
  assert.match(firebase, /export async function markNotificationRead\(noticeId\)/);
  assert.match(firebase, /export async function markAllNotificationsRead\(notices = \[\]\)/);
});

test('clearing the inbox is one write, not one per row', () => {
  const body = bodyOf('markAllNotificationsRead');
  assert.match(body, /const batch = writeBatch\(db\)/);
  assert.match(body, /unread\.forEach/);
  assert.match(body, /if \(!unread\.length\) return null;/, 'an empty inbox must not write at all');
});

test('the inbox query is bounded at the server and has its index', () => {
  assert.match(firebase, /orderBy\('at', 'desc'\),\s*\n\s*limit\(max\)/);
  const indexes = JSON.parse(read('firestore.indexes.json'));
  const has = indexes.indexes.some((i) => i.collectionGroup === 'notifications'
    && i.fields.some((f) => f.fieldPath === 'userId')
    && i.fields.some((f) => f.fieldPath === 'at' && f.order === 'DESCENDING'));
  assert.ok(has, 'the notifications query needs a composite index');
});

test('an automation notice is the same shape as a person’s, so one inbox shows both', () => {
  const runner = read('functions', 'automations.js');
  const block = runner.slice(runner.indexOf("collection('notifications')"), runner.indexOf("case 'webhook'"));
  assert.match(block, /kind: 'automation'/);
  assert.match(block, /taskTitle: task\?\.title \|\| ''/);
  assert.match(block, /read: false/);
});

test('the rules let a member tell a teammate, and nothing more', () => {
  const rules = read('firestore.rules');
  const fn = rules.slice(rules.indexOf('function isNoticeForTeammate()'), rules.indexOf('match /notifications/'));
  assert.match(fn, /isWorkspaceMember\(n\.workspaceId\)/);
  assert.match(fn, /n\.fromUserId == request\.auth\.uid/);
  assert.match(fn, /n\.read == false/);
  assert.match(fn, /n\.kind in \['mention', 'comment', 'assignment'\]/,
    'a browser must not be able to forge an automation notice');
  assert.match(fn, /n\.text\.size\(\) <= 300/);

  const block = rules.slice(rules.indexOf('match /notifications/'));
  assert.match(block.slice(0, 600), /allow delete: if false/);
});
