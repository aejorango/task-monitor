// T-0002 / BUG-002 — invite links must not be a back door to project admin.
//
// Before the fix: `invites` create only asked that userId == auth.uid, so any
// signed-in user could mint an invite for any project with role 'admin' and
// claim it; and `invites` read was open to every signed-in user, so the invite
// ids (the secret in the URL) were enumerable.
import { test, before, after, beforeEach } from 'node:test';
import {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, collection, query, where,
  arrayUnion, writeBatch,
} from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const ADMIN = 'proj-admin-uid';       // admin on project P
const OUTSIDER = 'outsider-uid';      // approved user, no rights on P
const RECIPIENT = 'recipient-uid';    // the person the link is for
const WS = 'ws-1';
const PROJECT = 'project-p';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [ADMIN, OUTSIDER, RECIPIENT]) {
      await setDoc(doc(db, 'users', uid), userDoc({ email: `${uid}@example.com` }));
    }
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: ADMIN, name: 'WS',
      members: [ADMIN], acl: { [ADMIN]: 'owner' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'projects', PROJECT), {
      userId: ADMIN, workspaceId: WS, name: 'Project P',
      members: [ADMIN], acl: { [ADMIN]: 'admin' },
      archived: false, deleted: false,
    });
  });
});

const inviteBody = (userId, role = 'admin') => ({
  userId, projectId: PROJECT, projectName: 'Project P',
  role, revoked: false, expiresAt: null, claims: [],
});

test('an outsider cannot create an invite for a project they do not administer', async () => {
  const db = await as(OUTSIDER, { email: `${OUTSIDER}@example.com` });
  await assertFails(addDoc(collection(db, 'invites'), inviteBody(OUTSIDER)));
});

test('a project admin can create an invite', async () => {
  const db = await as(ADMIN, { email: `${ADMIN}@example.com` });
  await assertSucceeds(addDoc(collection(db, 'invites'), inviteBody(ADMIN, 'viewer')));
});

test('a workspace admin who is not on the project ACL can still create an invite', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: ADMIN, name: 'WS',
      members: [ADMIN, OUTSIDER], acl: { [ADMIN]: 'owner', [OUTSIDER]: 'admin' },
      archived: false, deleted: false,
    });
  });
  const db = await as(OUTSIDER, { email: `${OUTSIDER}@example.com` });
  await assertSucceeds(addDoc(collection(db, 'invites'), inviteBody(OUTSIDER, 'viewer')));
});

test('invites are not enumerable by an outsider', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'viewer'));
  });
  const db = await as(OUTSIDER, { email: `${OUTSIDER}@example.com` });
  await assertFails(getDocs(collection(db, 'invites')));
  await assertFails(getDocs(query(collection(db, 'invites'), where('projectId', '==', PROJECT))));
});

test('a project admin can list the invites for their own project', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'viewer'));
  });
  const db = await as(ADMIN, { email: `${ADMIN}@example.com` });
  await assertSucceeds(getDocs(query(collection(db, 'invites'), where('projectId', '==', PROJECT))));
});

test('the recipient can fetch an invite by its exact id (the link is the secret)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'viewer'));
  });
  const db = await as(RECIPIENT, { email: `${RECIPIENT}@example.com` });
  await assertSucceeds(getDoc(doc(db, 'invites', 'secret-invite')));
});

test('claiming a valid invite still works end to end', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'editor'));
  });
  const db = await as(RECIPIENT, { email: `${RECIPIENT}@example.com` });
  const batch = writeBatch(db);
  batch.update(doc(db, 'invites', 'secret-invite'), {
    claims: arrayUnion({ uid: RECIPIENT, displayName: '', email: '', claimedAt: new Date() }),
  });
  batch.update(doc(db, 'projects', PROJECT), {
    members: arrayUnion(RECIPIENT),
    [`acl.${RECIPIENT}`]: 'editor',
    lastClaimInviteId: 'secret-invite',
  });
  await assertSucceeds(batch.commit());
});

test('a claimer cannot award themselves a higher role than the invite grants', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'viewer'));
  });
  const db = await as(RECIPIENT, { email: `${RECIPIENT}@example.com` });
  await assertFails(updateDoc(doc(db, 'projects', PROJECT), {
    members: arrayUnion(RECIPIENT),
    [`acl.${RECIPIENT}`]: 'admin',
    lastClaimInviteId: 'secret-invite',
  }));
});

test('a claimer cannot change anybody else’s role while claiming', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'editor'));
  });
  const db = await as(RECIPIENT, { email: `${RECIPIENT}@example.com` });
  await assertFails(updateDoc(doc(db, 'projects', PROJECT), {
    members: arrayUnion(RECIPIENT),
    [`acl.${RECIPIENT}`]: 'editor',
    [`acl.${ADMIN}`]: 'viewer',
    lastClaimInviteId: 'secret-invite',
  }));
});

test('a revoked invite cannot be claimed', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'dead-invite'), { ...inviteBody(ADMIN, 'editor'), revoked: true });
  });
  const db = await as(RECIPIENT, { email: `${RECIPIENT}@example.com` });
  await assertFails(updateDoc(doc(db, 'projects', PROJECT), {
    members: arrayUnion(RECIPIENT),
    [`acl.${RECIPIENT}`]: 'editor',
    lastClaimInviteId: 'dead-invite',
  }));
});

test('an invite update may only append claims', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'viewer'));
  });
  const db = await as(RECIPIENT, { email: `${RECIPIENT}@example.com` });
  await assertFails(updateDoc(doc(db, 'invites', 'secret-invite'), { projectName: 'Renamed' }));
});

test('the invite creator can revoke it', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'invites', 'secret-invite'), inviteBody(ADMIN, 'viewer'));
  });
  const db = await as(ADMIN, { email: `${ADMIN}@example.com` });
  await assertSucceeds(updateDoc(doc(db, 'invites', 'secret-invite'), { revoked: true }));
});
