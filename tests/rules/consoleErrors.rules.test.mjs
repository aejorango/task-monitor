// BUG-033 — the four listener failures in the browser console.
//
// Three of them were `permission-denied` on a LIST, and every one is the same
// mistake: **rules are not filters.** Firestore evaluates a read rule against
// every document a query could return, and refuses the WHOLE query if it
// cannot prove they all pass. A query that leaves out the constraint the rule
// tests is therefore not "a query that returns less" — it is a query that
// returns nothing, for ever.
//
// This file reproduces each one against the emulator, so the fix is provable
// rather than plausible.
import { test, before, after, beforeEach } from 'node:test';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const ME = 'me-uid';
const MATE = 'mate-uid';
const WS = 'ws-1';
const PROJ = 'proj-1';
const MY_EMAIL = 'me@example.com';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', ME),   userDoc({ email: MY_EMAIL }));
    await setDoc(doc(db, 'users', MATE), userDoc({ email: 'mate@example.com' }));
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: ME, name: 'WS', members: [ME, MATE],
      acl: { [ME]: 'owner', [MATE]: 'editor' }, memberProfiles: {},
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'projects', PROJ), {
      userId: ME, workspaceId: WS, name: 'P', members: [ME, MATE],
      acl: { [ME]: 'owner', [MATE]: 'editor' }, phases: [],
      archived: false, deleted: false,
    });
    // One saved view each. Mine and my teammate's.
    await setDoc(doc(db, 'savedViews', 'sv-mine'), { userId: ME,   workspaceId: WS, name: 'Mine',  deleted: false });
    await setDoc(doc(db, 'savedViews', 'sv-mate'), { userId: MATE, workspaceId: WS, name: 'Their', deleted: false });
    // Activities and tasks belonging to the teammate, inside my project.
    for (let i = 0; i < 6; i += 1) {
      await setDoc(doc(db, 'activities', `a-${i}`), {
        userId: MATE, workspaceId: WS, projectId: PROJ, taskId: `t-${i}`,
        date: `2026-09-0${i + 1}`, hoursSpent: 1, comment: 'x', deleted: false,
      });
      await setDoc(doc(db, 'tasks', `t-${i}`), {
        userId: MATE, workspaceId: WS, projectId: PROJ, title: `T${i}`,
        status: 'todo', deleted: false, archived: false,
      });
    }
  });
});

/* ── 1. savedViews ─────────────────────────────────────────────────────────
   `subscribeToSavedViews` asked for the whole WORKSPACE's views and filtered
   to mine in the callback — with a comment saying it avoided a composite
   index. It avoided the index by writing a query that can never run: the rule
   is `isOwner(resource)`, and my teammate's view is in the result set. */

test('asking for the workspace\'s saved views is refused — a teammate owns one', async () => {
  const db = await as(ME);
  await assertFails(getDocs(query(collection(db, 'savedViews'), where('workspaceId', '==', WS))));
});

test('asking for MY saved views succeeds — the query states what the rule tests', async () => {
  const db = await as(ME);
  const snap = await assertSucceeds(
    getDocs(query(collection(db, 'savedViews'), where('userId', '==', ME))),
  );
  assertOnlyMine(snap, ME);
});

test('…and it is still refused if I ask for somebody else\'s', async () => {
  const db = await as(ME);
  await assertFails(getDocs(query(collection(db, 'savedViews'), where('userId', '==', MATE))));
});

/* ── 2. activities / tasks by project ──────────────────────────────────────
   `where('projectId','in',[…])` with nothing else. For a teammate's document
   the only branch that can pass is `isProjectMember`, which is exists() +
   get() — two document-access calls PER DOCUMENT, against a per-query budget.
   A handful of rows exhausts it and the whole listener dies. */

// NOTE: the emulator does NOT enforce production's per-query document-access
// budget, so `projectId in […]` is ALLOWED here at any fixture size (probed up
// to 40 rows) while production answers `permission-denied`. That half cannot be
// reproduced locally and this file does not pretend otherwise. What it CAN
// prove is the half that made removing the query safe — the workspace-scoped
// listener already returns the same rows — plus a source guard that the query
// has not come back.

test('nothing issues an unqualified projectId-in query any more', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');
  const src = fs.readFileSync(path.join(root, 'src', 'services', 'firebase.js'), 'utf8');
  const live = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const bad of ["where('projectId', 'in'", 'where("projectId", "in"']) {
    if (live.includes(bad)) {
      throw new Error(
        'a projectId-in query with no workspace clause is back — the read rule '
        + 'cannot clear it without a get() per document, and rules are not filters',
      );
    }
  }
});

test('the same rows come back when the query names the workspace', async () => {
  // Which is what the workspace-wide listener already asks for, and why the
  // by-project listeners were redundant as well as broken.
  const db = await as(ME);
  const acts = await assertSucceeds(
    getDocs(query(collection(db, 'activities'), where('workspaceId', '==', WS))),
  );
  const tasks = await assertSucceeds(
    getDocs(query(collection(db, 'tasks'), where('workspaceId', '==', WS))),
  );
  if (acts.size !== 6) throw new Error(`expected 6 activities, got ${acts.size}`);
  if (tasks.size !== 6) throw new Error(`expected 6 tasks, got ${tasks.size}`);
});

/* ── 3. claiming a workspace invitation ────────────────────────────────────
   The invitee is BY DEFINITION not in `members` yet — that is what claiming
   is for. The read rule only admitted members, so the query somebody must run
   to find their own invitation was denied, and invite-by-email could never
   complete. `pendingInviteEmails` exists as a flat array precisely so a rule
   can check it; the read rule never did. */

const INVITEE = 'invitee-uid';
const INVITEE_EMAIL = 'invitee@example.com';

async function seedInvitation() {
  await seed(async (db) => {
    await setDoc(doc(db, 'users', INVITEE), userDoc({ email: INVITEE_EMAIL }));
    await setDoc(doc(db, 'workspaces', 'ws-invite'), {
      createdByUserId: ME, name: 'Invited WS', members: [ME],
      acl: { [ME]: 'owner' }, memberProfiles: {},
      pendingInvites: [{ email: INVITEE_EMAIL, role: 'editor', invitedBy: ME }],
      pendingInviteEmails: [INVITEE_EMAIL],
      pendingInviteRoles: { [INVITEE_EMAIL]: 'editor' },
      archived: false, deleted: false,
    });
  });
}

test('the invited person can find the workspace that is inviting them', async () => {
  await seedInvitation();
  const db = await as(INVITEE, { email: INVITEE_EMAIL });
  const snap = await assertSucceeds(getDocs(query(
    collection(db, 'workspaces'),
    where('pendingInviteEmails', 'array-contains', INVITEE_EMAIL),
  )));
  if (snap.size !== 1) throw new Error(`expected 1 invitation, got ${snap.size}`);
});

test('…and nobody else can read that workspace on the strength of it', async () => {
  await seedInvitation();
  const db = await as(MATE, { email: 'mate@example.com' });
  // Not a member, not the invitee.
  await assertFails(getDocs(query(
    collection(db, 'workspaces'),
    where('pendingInviteEmails', 'array-contains', INVITEE_EMAIL),
  )));
});

test('an invitee cannot use the invitation to read OTHER workspaces', async () => {
  await seedInvitation();
  const db = await as(INVITEE, { email: INVITEE_EMAIL });
  // `ws-1` is not inviting them and they are not a member.
  await assertFails(getDocs(query(
    collection(db, 'workspaces'),
    where('members', 'array-contains', ME),
  )));
});

test('the email match is exact — a lookalike address gets nothing', async () => {
  await seedInvitation();
  const db = await as('other-uid', { email: 'invitee@example.com.evil.test' });
  await seed(async (sdb) => {
    await setDoc(doc(sdb, 'users', 'other-uid'), userDoc({ email: 'invitee@example.com.evil.test' }));
  });
  await assertFails(getDocs(query(
    collection(db, 'workspaces'),
    where('pendingInviteEmails', 'array-contains', INVITEE_EMAIL),
  )));
});

function assertOnlyMine(snap, uid) {
  for (const d of snap.docs) {
    if (d.data().userId !== uid) throw new Error(`leaked ${d.id} owned by ${d.data().userId}`);
  }
}
