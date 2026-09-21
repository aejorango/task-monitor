// The activity log's query shape, pinned against the real rules engine.
//
// This has flip-flopped once already. A per-task query was written as
// `where('taskId','==',id)` alone; rules are not filters, so Firestore refused
// the whole query and every activity log rendered empty. The fix was to derive
// the log from the workspace-wide listener instead — but that listener is
// capped at the newest ACTIVITY_PAGE_SIZE rows across the WHOLE workspace, so
// an older task's log went empty again, this time without any error.
//
// What actually works is both clauses: workspaceId (so every result is
// provably readable) AND taskId (so nothing is capped away). These tests fail
// if either half is dropped.
import { test, before, after, beforeEach } from 'node:test';
import { collection, getDocs, query, where } from 'firebase/firestore';
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
      await setDocCompat(db, `users/${uid}`, userDoc({ email: email(uid) }));
    }
    await setDocCompat(db, `workspaces/${WS}`, {
      createdByUserId: ACE, name: 'Ace workspace',
      members: [ACE], acl: { [ACE]: 'owner' },
      archived: false, deleted: false,
    });
    // A workspace Ace is NOT a member of — the reason a bare taskId query is
    // unsafe: it could reach across into this one.
    await setDocCompat(db, `workspaces/${OTHER_WS}`, {
      createdByUserId: OUTSIDER, name: 'Someone else',
      members: [OUTSIDER], acl: { [OUTSIDER]: 'owner' },
      archived: false, deleted: false,
    });

    await setDocCompat(db, 'activities/a1', activity({ date: '2026-01-05' }));
    await setDocCompat(db, 'activities/a2', activity({ date: '2026-01-06' }));
    // Same taskId, different workspace, different owner.
    await setDocCompat(db, 'activities/a3', activity({
      workspaceId: OTHER_WS, userId: OUTSIDER, date: '2026-01-07',
    }));
  });
});

function activity(over = {}) {
  return {
    taskId: TASK, userId: ACE, workspaceId: WS,
    taskTitle: 'Write the report', projectId: 'p1', phaseId: null,
    date: '2026-01-05', comment: 'Drafted it', hoursSpent: 2,
    statusAtTime: 'doing', attachments: [],
    completionStatus: 'in-progress', bottleneckRemarks: '', requestedBy: '',
    ...over,
  };
}

// setDoc via a path string, to keep the fixture block readable.
async function setDocCompat(db, path, data) {
  const { doc, setDoc } = await import('firebase/firestore');
  await setDoc(doc(db, path), data);
}

test('the log query a member actually runs is allowed', async () => {
  const db = await as(ACE, { email: email(ACE) });
  const snap = await assertSucceeds(getDocs(query(
    collection(db, 'activities'),
    where('workspaceId', '==', WS),
    where('taskId', '==', TASK),
  )));
  // And it returns this task's rows — the point of the taskId clause.
  const dates = snap.docs.map((d) => d.data().date).sort();
  if (dates.length !== 2) {
    throw new Error(`expected both of the task's activities, got ${dates.length}`);
  }
});

test('dropping the workspaceId clause gets the whole query refused', async () => {
  // Rules are not filters: this could match the other workspace's row, so
  // Firestore rejects it outright rather than quietly returning less. This is
  // the failure that made every activity log look empty.
  const db = await as(ACE, { email: email(ACE) });
  await assertFails(getDocs(query(
    collection(db, 'activities'),
    where('taskId', '==', TASK),
  )));
});

test('a workspace-wide log query is still allowed (Table, WBS, Analytics)', async () => {
  const db = await as(ACE, { email: email(ACE) });
  await assertSucceeds(getDocs(query(
    collection(db, 'activities'),
    where('workspaceId', '==', WS),
  )));
});

test('an outsider cannot read a workspace they are not in', async () => {
  const db = await as(OUTSIDER, { email: email(OUTSIDER) });
  await assertFails(getDocs(query(
    collection(db, 'activities'),
    where('workspaceId', '==', WS),
    where('taskId', '==', TASK),
  )));
});
