// T-0002 / BUG-002 — presence was world-readable, leaking task ids and the
// names of people working on them across every workspace.
import { test, before, after, beforeEach } from 'node:test';
import { doc, getDocs, setDoc, collection, query, where } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const MEMBER = 'ws-member';
const STRANGER = 'stranger';
const WS = 'ws-1';
const TASK = 'task-1';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [MEMBER, STRANGER]) {
      await setDoc(doc(db, 'users', uid), userDoc({ email: `${uid}@example.com` }));
    }
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: MEMBER, name: 'WS',
      members: [MEMBER], acl: { [MEMBER]: 'owner' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'presence', `${TASK}__${MEMBER}`), {
      taskId: TASK, workspaceId: WS, userId: MEMBER,
      displayName: 'Member', photoURL: '', lastSeen: new Date(),
    });
  });
});

test('a stranger cannot read presence for a workspace they are not in', async () => {
  const db = await as(STRANGER, { email: `${STRANGER}@example.com` });
  await assertFails(getDocs(query(
    collection(db, 'presence'),
    where('taskId', '==', TASK), where('workspaceId', '==', WS),
  )));
});

test('a workspace member can read presence for that workspace', async () => {
  const db = await as(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(getDocs(query(
    collection(db, 'presence'),
    where('taskId', '==', TASK), where('workspaceId', '==', WS),
  )));
});

test('presence cannot be written without a workspace the writer belongs to', async () => {
  const db = await as(STRANGER, { email: `${STRANGER}@example.com` });
  await assertFails(setDoc(doc(db, 'presence', `${TASK}__${STRANGER}`), {
    taskId: TASK, workspaceId: WS, userId: STRANGER,
    displayName: 'Stranger', photoURL: '', lastSeen: new Date(),
  }));
});
