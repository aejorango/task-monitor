// The comment thread's query shape, pinned against the real rules engine.
//
// Same family as `activities.rules.test.mjs`, and the same trap: the rule on
// `taskComments` tests `workspaceId` (or `projectId`), and the listener used
// to ask only `where('taskId','==',id)`. Rules are not filters — Firestore
// refuses the WHOLE query the moment one document it could return fails the
// rule — and `listenerError` answers any refusal with an empty list, so the
// thread reads "No comments yet" and a comment somebody has just posted never
// turns up. The fix is to ask on the axis the rule guards.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const ACE = 'ace-uid';
const OUTSIDER = 'outsider-uid';
const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const TASK = 'task-1';

const email = (uid) => `${uid}@example.com`;

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [ACE, OUTSIDER]) {
      await setDoc(doc(db, `users/${uid}`), userDoc({ email: email(uid) }));
    }
    await setDoc(doc(db, `workspaces/${WS}`), {
      createdByUserId: ACE, name: 'Ace workspace',
      members: [ACE], acl: { [ACE]: 'owner' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, `workspaces/${OTHER_WS}`), {
      createdByUserId: OUTSIDER, name: 'Someone else',
      members: [OUTSIDER], acl: { [OUTSIDER]: 'owner' },
      archived: false, deleted: false,
    });

    await setDoc(doc(db, 'taskComments/c1'), comment({ body: 'First' }));
    await setDoc(doc(db, 'taskComments/c2'), comment({ body: 'Second' }));
    // The row that makes a bare taskId query unsafe. A task id is unique in
    // practice, but the rules engine cannot know that — and neither can a
    // reviewer reading the query, which is the point.
    await setDoc(doc(db, 'taskComments/c3'), comment({
      workspaceId: OTHER_WS, userId: OUTSIDER, body: 'Not yours',
    }));
  });
});

function comment(over = {}) {
  return {
    taskId: TASK, userId: ACE, workspaceId: WS, projectId: null,
    body: 'A note', deleted: false, ...over,
  };
}

test('the thread’s query asks on the axis the rule guards', async () => {
  const db = await as(ACE, { email: email(ACE) });
  const snap = await assertSucceeds(getDocs(query(
    collection(db, 'taskComments'),
    where('workspaceId', '==', WS),
    where('taskId', '==', TASK),
  )));
  assert.deepEqual(snap.docs.map((d) => d.data().body).sort(), ['First', 'Second']);
});

test('dropping the workspaceId clause gets the whole thread refused', async () => {
  // Not "fewer comments" — none at all, and `listenerError` turns that into an
  // empty list with only a console warning. This is what made a posted
  // comment appear to vanish.
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(getDocs(query(
    collection(db, 'taskComments'),
    where('taskId', '==', TASK),
  )));
});

test('an outsider cannot read the thread by naming the workspace', async () => {
  const db = await as(OUTSIDER, { email: email(OUTSIDER) });
  await assertFails(getDocs(query(
    collection(db, 'taskComments'),
    where('workspaceId', '==', WS),
    where('taskId', '==', TASK),
  )));
});
