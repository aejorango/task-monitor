// T-0127 / IMP-017 — a batched bulk edit is held to the same rules as one edit.
//
// The bulk bar writes many tasks in one `writeBatch`. There is no client-side
// permission check in front of it, on purpose: rules are the enforcement point,
// and guessing at permissions in the browser is how a bulk edit half-applies.
// What that leaves resting on the rules engine is this — a batch is all or
// nothing, so ONE task the caller may not write must take the whole batch down
// rather than letting the rest through.
import { test, before, after, beforeEach } from 'node:test';
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const OWNER  = 'owner-uid';
const EDITOR = 'editor-uid';
const VIEWER = 'viewer-uid';
const OUTSIDER = 'outsider-uid';
const WS = 'ws-1';
const OTHER_WS = 'ws-2';

const email = (uid) => `${uid}@example.com`;
const MINE = ['task-1', 'task-2', 'task-3'];
const THEIRS = 'task-elsewhere';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

function task(over = {}) {
  return {
    userId: OWNER, workspaceId: WS, title: 'A task',
    projectId: null, phaseId: null, category: '',
    priority: 'medium', status: 'todo', progress: 0,
    plan: { startDate: null, endDate: '2026-10-01' },
    actual: { startDate: null, endDate: null },
    tags: [], subtasks: [], dependsOn: [], assignedTo: [],
    activityCount: 0, totalHoursLogged: 0, attachmentCount: 0,
    archived: false, deleted: false,
    ...over,
  };
}

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [OWNER, EDITOR, VIEWER, OUTSIDER]) {
      await setDoc(doc(db, `users/${uid}`), userDoc({ email: email(uid) }));
    }
    await setDoc(doc(db, `workspaces/${WS}`), {
      createdByUserId: OWNER, name: 'Ace workspace',
      members: [OWNER, EDITOR, VIEWER],
      acl: { [OWNER]: 'owner', [EDITOR]: 'editor', [VIEWER]: 'viewer' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, `workspaces/${OTHER_WS}`), {
      createdByUserId: OUTSIDER, name: 'Somewhere else',
      members: [OUTSIDER], acl: { [OUTSIDER]: 'owner' },
      archived: false, deleted: false,
    });

    for (const id of MINE) await setDoc(doc(db, `tasks/${id}`), task());
    await setDoc(doc(db, `tasks/${THEIRS}`), task({ userId: OUTSIDER, workspaceId: OTHER_WS }));
  });
});

/** The shape the bulk bar commits: one update per task, one batch. */
const bulkBatch = (db, ids, patch) => {
  const batch = writeBatch(db);
  for (const id of ids) {
    batch.update(doc(db, 'tasks', id), { ...patch, updatedAt: serverTimestamp() });
  }
  return batch.commit();
};

test('an editor can re-prioritise every task in the workspace at once', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  await assertSucceeds(bulkBatch(db, MINE, { priority: 'high' }));
});

test('an editor can close them in bulk, stamps and all', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  await assertSucceeds(bulkBatch(db, MINE, {
    status: 'done', progress: 100,
    'actual.startDate': '2026-09-01', 'actual.endDate': '2026-09-22',
  }));
});

test('a bulk delete is a soft delete, and is allowed as an update', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  await assertSucceeds(bulkBatch(db, MINE, { deleted: true }));
});

test('a viewer cannot bulk-edit, exactly as a viewer cannot edit one', async () => {
  const db = await as(VIEWER, { email: email(VIEWER) });
  await assertFails(bulkBatch(db, MINE, { priority: 'high' }));
  // The single-write rule and the batch rule must agree — if they did not, the
  // bulk bar would be a way around the ACL.
  await assertFails(updateDoc(doc(db, 'tasks', MINE[0]), { priority: 'high' }));
});

test('an outsider cannot touch the workspace at all', async () => {
  const db = await as(OUTSIDER, { email: email(OUTSIDER) });
  await assertFails(bulkBatch(db, MINE, { priority: 'high' }));
});

// The reason there is no client-side permission filter: this is the behaviour
// we want, and it is the rules engine that provides it.
test('one task the caller may not write takes the whole batch down', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  await assertFails(bulkBatch(db, [...MINE, THEIRS], { priority: 'high' }));

  // And nothing from that batch landed — a partial bulk edit is the outcome
  // this must never produce.
  const owner = await as(OWNER, { email: email(OWNER) });
  const { getDoc } = await import('firebase/firestore');
  for (const id of MINE) {
    const snap = await getDoc(doc(owner, 'tasks', id));
    if (snap.data().priority !== 'medium') {
      throw new Error(`${id} was changed by a batch that failed`);
    }
  }
});

test('a batch of one behaves like a plain update', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  await assertSucceeds(bulkBatch(db, [MINE[0]], { priority: 'low' }));
  await assertFails(bulkBatch(db, [THEIRS], { priority: 'low' }));
});

// ─── T-0130 / NEW-020: the read behind My Week ──────────────────────────────
//
// My Week subscribes per workspace with `assignedTo array-contains me`. The
// audit assumed the rules already permit it; these check that rather than
// trusting it, and check the other half too — that the bounded query does not
// become a way to read a workspace you are not in.

test('a member can read their own assigned tasks in a workspace they belong to', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  const { collection, getDocs, query, where } = await import('firebase/firestore');
  await assertSucceeds(getDocs(query(
    collection(db, 'tasks'),
    where('workspaceId', '==', WS),
    where('assignedTo', 'array-contains', EDITOR),
  )));
});

test('even a viewer can read their own week — reading is not editing', async () => {
  const db = await as(VIEWER, { email: email(VIEWER) });
  const { collection, getDocs, query, where } = await import('firebase/firestore');
  await assertSucceeds(getDocs(query(
    collection(db, 'tasks'),
    where('workspaceId', '==', WS),
    where('assignedTo', 'array-contains', VIEWER),
  )));
});

test('array-contains is not a way into a workspace you are not in', async () => {
  const db = await as(EDITOR, { email: email(EDITOR) });
  const { collection, getDocs, query, where } = await import('firebase/firestore');
  await assertFails(getDocs(query(
    collection(db, 'tasks'),
    where('workspaceId', '==', OTHER_WS),
    where('assignedTo', 'array-contains', EDITOR),
  )));
});

test('dropping the workspace clause gets the query refused outright', async () => {
  // Rules are not filters: a bare assignedTo query could match a workspace the
  // caller is not a member of, so it must be rejected rather than quietly
  // returning less. This is why the subscription is one listener PER workspace.
  const db = await as(EDITOR, { email: email(EDITOR) });
  const { collection, getDocs, query, where } = await import('firebase/firestore');
  await assertFails(getDocs(query(
    collection(db, 'tasks'),
    where('assignedTo', 'array-contains', EDITOR),
  )));
});
