// T-0040 / MISS-001 — joining a workspace by email invitation.
//
// The invitation IS the credential: the workspace names the address, and the
// person holding that address may add themselves at exactly the role offered.
import { test, before, after, beforeEach } from 'node:test';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, userDoc } from './harness.mjs';

const OWNER = 'owner-uid';
const INVITED = 'invited-uid';
const STRANGER = 'stranger-uid';
const WS = 'ws-1';
const INVITED_EMAIL = 'invited@example.com';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

const baseWorkspace = (over = {}) => ({
  createdByUserId: OWNER, name: 'WS', description: '',
  members: [OWNER], acl: { [OWNER]: 'owner' },
  memberProfiles: {},
  pendingInvites: [{ email: INVITED_EMAIL, role: 'editor', invitedBy: OWNER }],
  pendingInviteEmails: [INVITED_EMAIL],
  pendingInviteRoles: { [INVITED_EMAIL]: 'editor' },
  archived: false, deleted: false,
  ...over,
});

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', OWNER), userDoc({ email: 'owner@example.com' }));
    await setDoc(doc(db, 'users', INVITED), userDoc({ email: INVITED_EMAIL }));
    await setDoc(doc(db, 'users', STRANGER), userDoc({ email: 'stranger@example.com' }));
    await setDoc(doc(db, 'workspaces', WS), baseWorkspace());
  });
});

const claim = (uid, { role = 'editor', email = INVITED_EMAIL, extra = {} } = {}) => ({
  members: arrayUnion(uid),
  [`acl.${uid}`]: role,
  [`memberProfiles.${uid}`]: { displayName: '', email, photoURL: '' },
  pendingInvites: [],
  pendingInviteEmails: [],
  pendingInviteRoles: {},
  lastClaimedInviteEmail: email,
  ...extra,
});

test('the invited person joins at the role they were offered', async () => {
  const db = await as(INVITED, { email: INVITED_EMAIL });
  await assertSucceeds(updateDoc(doc(db, 'workspaces', WS), claim(INVITED)));
});

test('the email match ignores case', async () => {
  const db = await as(INVITED, { email: 'Invited@Example.COM' });
  await assertSucceeds(updateDoc(doc(db, 'workspaces', WS), claim(INVITED)));
});

test('somebody who was not invited cannot join', async () => {
  const db = await as(STRANGER, { email: 'stranger@example.com' });
  await assertFails(updateDoc(doc(db, 'workspaces', WS), claim(STRANGER, { email: 'stranger@example.com' })));
});

test('the invited person cannot award themselves a higher role', async () => {
  const db = await as(INVITED, { email: INVITED_EMAIL });
  await assertFails(updateDoc(doc(db, 'workspaces', WS), claim(INVITED, { role: 'owner' })));
  await assertFails(updateDoc(doc(db, 'workspaces', WS), claim(INVITED, { role: 'admin' })));
});

test('the invited person cannot bring anybody else in with them', async () => {
  const db = await as(INVITED, { email: INVITED_EMAIL });
  await assertFails(updateDoc(doc(db, 'workspaces', WS), {
    ...claim(INVITED),
    [`acl.${STRANGER}`]: 'admin',
  }));
});

test('the invitation must be consumed, not left for a second use', async () => {
  const db = await as(INVITED, { email: INVITED_EMAIL });
  await assertFails(updateDoc(doc(db, 'workspaces', WS), {
    ...claim(INVITED),
    pendingInviteEmails: [INVITED_EMAIL],
    pendingInvites: [{ email: INVITED_EMAIL, role: 'editor' }],
  }));
});

test('claiming cannot rename or delete the workspace on the way in', async () => {
  const db = await as(INVITED, { email: INVITED_EMAIL });
  await assertFails(updateDoc(doc(db, 'workspaces', WS), claim(INVITED, { extra: { name: 'Mine now' } })));
  await assertFails(updateDoc(doc(db, 'workspaces', WS), claim(INVITED, { extra: { deleted: true } })));
});

test('an unapproved account cannot claim, invitation or not', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'users', INVITED), userDoc({ email: INVITED_EMAIL, status: 'pending' }));
  });
  const db = await as(INVITED, { email: INVITED_EMAIL });
  await assertFails(updateDoc(doc(db, 'workspaces', WS), claim(INVITED)));
});

test('an admin can still invite and withdraw', async () => {
  const db = await as(OWNER, { email: 'owner@example.com' });
  await assertSucceeds(updateDoc(doc(db, 'workspaces', WS), {
    pendingInvites: [{ email: 'another@example.com', role: 'viewer', invitedBy: OWNER }],
    pendingInviteEmails: ['another@example.com'],
    pendingInviteRoles: { 'another@example.com': 'viewer' },
  }));
  await assertSucceeds(updateDoc(doc(db, 'workspaces', WS), {
    pendingInvites: [], pendingInviteEmails: [], pendingInviteRoles: {},
  }));
});

test('a member who is not an admin cannot invite', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'workspaces', WS), baseWorkspace({
      members: [OWNER, STRANGER], acl: { [OWNER]: 'owner', [STRANGER]: 'editor' },
    }));
  });
  const db = await as(STRANGER, { email: 'stranger@example.com' });
  await assertFails(updateDoc(doc(db, 'workspaces', WS), {
    pendingInvites: [{ email: 'friend@example.com', role: 'admin' }],
    pendingInviteEmails: ['friend@example.com'],
    pendingInviteRoles: { 'friend@example.com': 'admin' },
  }));
});

test('after joining, the new member can read the workspace', async () => {
  const db = await as(INVITED, { email: INVITED_EMAIL });
  await updateDoc(doc(db, 'workspaces', WS), claim(INVITED));
  await assertSucceeds(getDoc(doc(db, 'workspaces', WS)));
});
