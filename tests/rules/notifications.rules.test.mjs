// T-0075 / NEW-004 — a notice can only be raised for somebody you already
// share a workspace with, and only in your own name.
import { test, before, after, beforeEach } from 'node:test';
import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const ACE = 'ace-uid';
const MIA = 'mia-uid';
const OUTSIDER = 'outsider-uid';
const WS = 'ws-1';

const email = (uid) => `${uid}@example.com`;

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [ACE, MIA, OUTSIDER]) {
      await setDoc(doc(db, 'users', uid), userDoc({ email: email(uid) }));
    }
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: ACE, name: 'WS',
      members: [ACE, MIA], acl: { [ACE]: 'owner', [MIA]: 'editor' },
      archived: false, deleted: false,
    });
    // One notice already waiting for Mia.
    await setDoc(doc(db, 'notifications', 'n1'), {
      userId: MIA, workspaceId: WS, kind: 'mention', source: 'person',
      fromUserId: ACE, taskId: 't1', taskTitle: 'Report',
      text: 'Ace mentioned you on “Report”', read: false, at: new Date(),
    });
  });
});

const notice = (over = {}) => ({
  userId: MIA, workspaceId: WS, kind: 'mention', source: 'person',
  fromUserId: ACE, taskId: 't1', taskTitle: 'Report',
  text: 'Ace mentioned you on “Report”', read: false, at: new Date(),
  ...over,
});

// ─── raising one ────────────────────────────────────────────────────────────

test('a member can tell another member of the same workspace', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertSucceeds(addDoc(collection(db, 'notifications'), notice()));
});

test('a notice cannot be raised in somebody else’s name', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(addDoc(collection(db, 'notifications'), notice({ fromUserId: MIA })));
});

test('somebody outside the workspace cannot reach into it', async () => {
  const db = await as(OUTSIDER, { email: email(OUTSIDER) });
  await assertFails(addDoc(collection(db, 'notifications'), notice({ fromUserId: OUTSIDER })));
});

test('a notice cannot be sent to somebody who is not in the workspace', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(addDoc(collection(db, 'notifications'), notice({ userId: OUTSIDER })));
});

test('a notice cannot arrive already read, which would hide it', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(addDoc(collection(db, 'notifications'), notice({ read: true })));
});

test('a browser cannot forge one that claims to come from an automation', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(addDoc(collection(db, 'notifications'), notice({ kind: 'automation' })));
});

test('a notice cannot carry an essay', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(addDoc(collection(db, 'notifications'), notice({ text: 'x'.repeat(301) })));
});

// ─── reading and dismissing ─────────────────────────────────────────────────

test('you can read the notices addressed to you', async () => {
  const db = await as(MIA, { email: email(MIA) });
  await assertSucceeds(getDoc(doc(db, 'notifications', 'n1')));
});

test('you cannot read somebody else’s', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(getDoc(doc(db, 'notifications', 'n1')));
});

test('you can mark your own as read', async () => {
  const db = await as(MIA, { email: email(MIA) });
  await assertSucceeds(updateDoc(doc(db, 'notifications', 'n1'), { read: true }));
});

test('marking it read is the only change you may make to it', async () => {
  const db = await as(MIA, { email: email(MIA) });
  await assertFails(updateDoc(doc(db, 'notifications', 'n1'), { text: 'something else' }));
  await assertFails(updateDoc(doc(db, 'notifications', 'n1'), { read: true, taskId: 't9' }));
});

test('nobody deletes a notice from a browser — reading it is enough', async () => {
  const db = await as(MIA, { email: email(MIA) });
  await assertFails(deleteDoc(doc(db, 'notifications', 'n1')));
});
