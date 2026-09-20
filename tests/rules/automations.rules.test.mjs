// T-0070 / NEW-002 — who may write an automation, and who may only watch.
import { test, before, after, beforeEach } from 'node:test';
import { doc, getDoc, setDoc, addDoc, updateDoc, collection } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const OWNER = 'owner-uid';
const MEMBER = 'member-uid';
const STRANGER = 'stranger-uid';
const WS = 'ws-1';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [OWNER, MEMBER, STRANGER]) {
      await setDoc(doc(db, 'users', uid), userDoc({ email: `${uid}@example.com` }));
    }
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: OWNER, name: 'WS',
      members: [OWNER, MEMBER], acl: { [OWNER]: 'owner', [MEMBER]: 'editor' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'automations', 'r1'), {
      userId: OWNER, workspaceId: WS, name: 'Tell me',
      trigger: 'task.completed', action: 'notify', actionValue: OWNER,
      enabled: true, deleted: false,
    });
  });
});

const newRule = (uid) => ({
  userId: uid, workspaceId: WS, name: 'Mine',
  trigger: 'task.created', action: 'add_tag', actionValue: 'new',
  enabled: true, deleted: false,
});

test('an admin can create a rule', async () => {
  const db = await as(OWNER, { email: `${OWNER}@example.com` });
  await assertSucceeds(addDoc(collection(db, 'automations'), newRule(OWNER)));
});

test('an editor cannot — automations act on everybody’s work', async () => {
  const db = await as(MEMBER, { email: `${MEMBER}@example.com` });
  await assertFails(addDoc(collection(db, 'automations'), newRule(MEMBER)));
  await assertFails(updateDoc(doc(db, 'automations', 'r1'), { enabled: false }));
});

test('a member can still read them, so nobody is surprised by one', async () => {
  const db = await as(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(getDoc(doc(db, 'automations', 'r1')));
});

test('somebody outside the workspace sees nothing', async () => {
  const db = await as(STRANGER, { email: `${STRANGER}@example.com` });
  await assertFails(getDoc(doc(db, 'automations', 'r1')));
  await assertFails(addDoc(collection(db, 'automations'), newRule(STRANGER)));
});

test('the run log is read-only from a browser', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'automationRuns', 'run1'), {
      workspaceId: WS, ruleId: 'r1', outcome: 'done', message: 'Told them.',
    });
  });
  const db = await as(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(getDoc(doc(db, 'automationRuns', 'run1')));
  await assertFails(addDoc(collection(db, 'automationRuns'), { workspaceId: WS }));
});

test('a notice belongs to the person it is for, and only they may read it', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'notifications', 'n1'), { userId: MEMBER, workspaceId: WS, text: 'x', read: false });
  });
  const mine = await as(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(getDoc(doc(mine, 'notifications', 'n1')));

  const theirs = await as(OWNER, { email: `${OWNER}@example.com` });
  await assertFails(getDoc(doc(theirs, 'notifications', 'n1')));
});

test('you may mark your own notice read, and nothing else about it', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'notifications', 'n1'), { userId: MEMBER, workspaceId: WS, text: 'x', read: false });
  });
  const db = await as(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(updateDoc(doc(db, 'notifications', 'n1'), { read: true }));
  await assertFails(updateDoc(doc(db, 'notifications', 'n1'), { text: 'rewritten' }));
  await assertFails(addDoc(collection(db, 'notifications'), { userId: MEMBER, text: 'made up' }));
});
