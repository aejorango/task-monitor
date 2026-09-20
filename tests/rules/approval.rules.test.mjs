// T-0005 / BUG-003 — the approval gate must live in the rules, not only in
// App.jsx. A signed-in but unapproved account could previously create
// workspaces, projects and tasks straight from the SDK.
import { test, before, after, beforeEach } from 'node:test';
import {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, arrayUnion,
} from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, superadminDoc, userDoc } from './harness.mjs';

const PENDING  = 'pending-uid';
const REJECTED = 'rejected-uid';
const OK       = 'approved-uid';
const SUPER    = 'super-uid';
const WS       = 'ws-1';
const PROJECT  = 'project-1';
const TASK     = 'task-1';

const emailOf = (uid) => `${uid}@example.com`;

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', PENDING),  userDoc({ email: emailOf(PENDING),  status: 'pending' }));
    await setDoc(doc(db, 'users', REJECTED), userDoc({ email: emailOf(REJECTED), status: 'rejected' }));
    await setDoc(doc(db, 'users', OK),       userDoc({ email: emailOf(OK),       status: 'approved' }));
    await setDoc(doc(db, 'users', SUPER),    superadminDoc());
    // Every account below is deliberately a member of the workspace and the
    // project — approval, not membership, is what must stop them.
    const members = [OK, PENDING, REJECTED];
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: OK, name: 'WS', members,
      acl: { [OK]: 'owner', [PENDING]: 'editor', [REJECTED]: 'editor' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'projects', PROJECT), {
      userId: OK, workspaceId: WS, name: 'P', members,
      acl: { [OK]: 'admin', [PENDING]: 'editor', [REJECTED]: 'editor' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'tasks', TASK), {
      userId: OK, workspaceId: WS, projectId: PROJECT, title: 'T',
      status: 'todo', archived: false, deleted: false,
    });
  });
});

const newWorkspace = (uid) => ({
  createdByUserId: uid, name: 'Sneaky', members: [uid],
  acl: { [uid]: 'owner' }, archived: false, deleted: false,
});
const newTask = (uid) => ({
  userId: uid, workspaceId: WS, projectId: PROJECT, title: 'Sneaky',
  status: 'todo', archived: false, deleted: false,
});

for (const [label, uid] of [['pending', PENDING], ['rejected', REJECTED]]) {
  test(`a ${label} user cannot create a workspace`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(addDoc(collection(db, 'workspaces'), newWorkspace(uid)));
  });

  test(`a ${label} user cannot create a task`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(addDoc(collection(db, 'tasks'), newTask(uid)));
  });

  test(`a ${label} user cannot update an existing task`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(updateDoc(doc(db, 'tasks', TASK), { title: 'Hijacked' }));
  });

  test(`a ${label} user cannot delete an existing task`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(deleteDoc(doc(db, 'tasks', TASK)));
  });

  test(`a ${label} user cannot create an activity`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(addDoc(collection(db, 'activities'), {
      userId: uid, workspaceId: WS, taskId: TASK, date: '2026-09-20', hoursSpent: 1,
    }));
  });

  test(`a ${label} user cannot create a project`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(addDoc(collection(db, 'projects'), {
      userId: uid, workspaceId: WS, name: 'Sneaky', members: [uid],
      acl: { [uid]: 'admin' }, archived: false, deleted: false,
    }));
  });

  test(`a ${label} user cannot read workspace data`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(getDoc(doc(db, 'workspaces', WS)));
    await assertFails(getDocs(query(collection(db, 'tasks'), where('workspaceId', '==', WS))));
  });

  test(`a ${label} user cannot claim an invite`, async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'invites', 'inv'), {
        userId: OK, projectId: PROJECT, projectName: 'P',
        role: 'admin', revoked: false, expiresAt: null, claims: [],
      });
    });
    const db = await as(uid, { email: emailOf(uid) });
    await assertFails(updateDoc(doc(db, 'projects', PROJECT), {
      members: arrayUnion(uid),
      [`acl.${uid}`]: 'admin',
      lastClaimInviteId: 'inv',
    }));
  });

  test(`a ${label} user can still read and refresh their own profile`, async () => {
    const db = await as(uid, { email: emailOf(uid) });
    await assertSucceeds(getDoc(doc(db, 'users', uid)));
    await assertSucceeds(updateDoc(doc(db, 'users', uid), {
      email: emailOf(uid), displayName: 'Still Me', photoURL: '',
    }));
  });
}

test('a brand-new account with no profile yet can create its pending profile', async () => {
  const db = await as('brand-new', { email: 'brand-new@example.com' });
  await assertSucceeds(setDoc(doc(db, 'users', 'brand-new'), {
    email: 'brand-new@example.com', displayName: '', photoURL: '',
    status: 'pending', role: 'user',
  }));
});

test('a brand-new account with no profile yet cannot write anything else', async () => {
  const db = await as('brand-new-2', { email: 'brand-new-2@example.com' });
  await assertFails(addDoc(collection(db, 'workspaces'), newWorkspace('brand-new-2')));
});

test('an approved user is unaffected: create, update and read all still work', async () => {
  const db = await as(OK, { email: emailOf(OK) });
  await assertSucceeds(addDoc(collection(db, 'workspaces'), newWorkspace(OK)));
  await assertSucceeds(addDoc(collection(db, 'tasks'), newTask(OK)));
  await assertSucceeds(updateDoc(doc(db, 'tasks', TASK), { title: 'Edited' }));
  await assertSucceeds(getDoc(doc(db, 'workspaces', WS)));
  await assertSucceeds(getDocs(query(collection(db, 'tasks'), where('workspaceId', '==', WS))));
});

test('a superadmin can still bootstrap and manage users', async () => {
  const db = await as(SUPER, { email: 'aejorango888@gmail.com' });
  await assertSucceeds(updateDoc(doc(db, 'users', PENDING), { status: 'approved' }));
  await assertSucceeds(addDoc(collection(db, 'workspaces'), newWorkspace(SUPER)));
});
