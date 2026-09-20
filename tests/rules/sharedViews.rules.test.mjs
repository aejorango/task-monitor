// T-0081 / NEW-011 — a share link shows one snapshot to the world, and nothing
// else changes.
//
// This is the only world-readable document in the app, so the rule around it
// has to be exact: readable by its exact token and only while it is live, never
// listable, never writable by anybody but an admin of the workspace it belongs
// to — and it must not become a way into tasks, projects or anything else.
import { test, before, after, beforeEach } from 'node:test';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc,
} from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, anon, reset, seed, shutdown, userDoc } from './harness.mjs';

const OWNER = 'owner-uid';
const EDITOR = 'editor-uid';
const OUTSIDER = 'outsider-uid';
const WS = 'ws-1';
const PROJECT = 'p-1';

const email = (uid) => `${uid}@example.com`;
const hour = 3600 * 1000;

const share = (over = {}) => ({
  workspaceId: WS,
  projectId: PROJECT,
  projectName: 'SBLAF rollout',
  kind: 'gantt',
  createdByUserId: OWNER,
  createdByName: 'Owner',
  revoked: false,
  expiresAt: new Date(Date.now() + 24 * hour),
  createdAt: new Date(),
  updatedAt: new Date(),
  snapshot: { generatedAt: new Date().toISOString(), tasks: [], phases: [] },
  ...over,
});

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [OWNER, EDITOR, OUTSIDER]) {
      await setDoc(doc(db, 'users', uid), userDoc({ email: email(uid) }));
    }
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: OWNER, name: 'WS',
      members: [OWNER, EDITOR], acl: { [OWNER]: 'owner', [EDITOR]: 'editor' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'projects', PROJECT), {
      userId: OWNER, workspaceId: WS, name: 'SBLAF rollout',
      members: [OWNER], acl: { [OWNER]: 'owner' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'tasks', 't1'), {
      userId: OWNER, workspaceId: WS, projectId: PROJECT,
      title: 'Private task', status: 'todo', deleted: false, archived: false,
    });
    await setDoc(doc(db, 'sharedViews', 'live-token'), share());
    await setDoc(doc(db, 'sharedViews', 'revoked-token'), share({ revoked: true }));
    await setDoc(doc(db, 'sharedViews', 'expired-token'), share({
      expiresAt: new Date(Date.now() - hour),
    }));
    await setDoc(doc(db, 'sharedViews', 'forever-token'), share({ expiresAt: null }));
  });
});

// ─── what a stranger with the link can do ───────────────────────────────────

test('somebody with the link, signed out, can read that one snapshot', async () => {
  const db = await anon();
  await assertSucceeds(getDoc(doc(db, 'sharedViews', 'live-token')));
});

test('a link with no expiry date still works', async () => {
  const db = await anon();
  await assertSucceeds(getDoc(doc(db, 'sharedViews', 'forever-token')));
});

test('a revoked link stops working, immediately and for everybody', async () => {
  await assertFails(getDoc(doc(await anon(), 'sharedViews', 'revoked-token')));
  const member = await as(EDITOR, { email: email(EDITOR) });
  await assertFails(getDoc(doc(member, 'sharedViews', 'revoked-token')));
});

test('an expired link stops working — the date is enforced here, not in the UI', async () => {
  await assertFails(getDoc(doc(await anon(), 'sharedViews', 'expired-token')));
});

test('the links cannot be listed, so a token cannot be guessed by browsing', async () => {
  await assertFails(getDocs(collection(await anon(), 'sharedViews')));
  const outsider = await as(OUTSIDER, { email: email(OUTSIDER) });
  await assertFails(getDocs(collection(outsider, 'sharedViews')));
});

test('a link is not a way into anything else', async () => {
  const db = await anon();
  await assertFails(getDoc(doc(db, 'tasks', 't1')));
  await assertFails(getDoc(doc(db, 'projects', PROJECT)));
  await assertFails(getDoc(doc(db, 'workspaces', WS)));
  await assertFails(getDocs(collection(db, 'tasks')));
});

test('a stranger cannot change or delete the snapshot they can see', async () => {
  const db = await anon();
  await assertFails(updateDoc(doc(db, 'sharedViews', 'live-token'), { revoked: false }));
  await assertFails(deleteDoc(doc(db, 'sharedViews', 'live-token')));
  await assertFails(addDoc(collection(db, 'sharedViews'), share()));
});

// ─── who can make one ───────────────────────────────────────────────────────

test('an admin of the workspace can publish a link', async () => {
  const db = await as(OWNER, { email: email(OWNER) });
  await assertSucceeds(setDoc(doc(db, 'sharedViews', 'new-token'), share()));
});

test('an editor cannot — publishing to the world is an admin decision', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  await assertFails(setDoc(doc(db, 'sharedViews', 'new-token'), share({ createdByUserId: EDITOR })));
});

test('somebody outside the workspace cannot publish its work', async () => {
  const db = await as(OUTSIDER, { email: email(OUTSIDER) });
  await assertFails(setDoc(doc(db, 'sharedViews', 'new-token'), share({ createdByUserId: OUTSIDER })));
});

test('a link cannot be published in somebody else’s name', async () => {
  const db = await as(OWNER, { email: email(OWNER) });
  await assertFails(setDoc(doc(db, 'sharedViews', 'new-token'), share({ createdByUserId: EDITOR })));
});

test('a link cannot be born revoked or already expired — that is just confusing', async () => {
  const db = await as(OWNER, { email: email(OWNER) });
  await assertFails(setDoc(doc(db, 'sharedViews', 'n1'), share({ revoked: true })));
  await assertFails(setDoc(doc(db, 'sharedViews', 'n2'), share({ expiresAt: new Date(Date.now() - hour) })));
});

test('an admin can revoke and can refresh the snapshot', async () => {
  const db = await as(OWNER, { email: email(OWNER) });
  await assertSucceeds(updateDoc(doc(db, 'sharedViews', 'live-token'), { revoked: true }));
  await assertSucceeds(updateDoc(doc(db, 'sharedViews', 'forever-token'), {
    snapshot: { generatedAt: new Date().toISOString(), tasks: [], phases: [] },
    updatedAt: new Date(),
  }));
});

test('an editor cannot revoke or rewrite one', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  await assertFails(updateDoc(doc(db, 'sharedViews', 'live-token'), { revoked: true }));
});

test('an update cannot move a link to another workspace', async () => {
  const db = await as(OWNER, { email: email(OWNER) });
  await assertFails(updateDoc(doc(db, 'sharedViews', 'live-token'), { workspaceId: 'ws-2' }));
});

test('an admin can delete one outright', async () => {
  const db = await as(OWNER, { email: email(OWNER) });
  await assertSucceeds(deleteDoc(doc(db, 'sharedViews', 'live-token')));
});

// ─── and the member's own view of them ──────────────────────────────────────

test('an admin can list the workspace’s own links, to manage them', async () => {
  const db = await as(OWNER, { email: email(OWNER) });
  await assertSucceeds(getDoc(doc(db, 'sharedViews', 'live-token')));
});
