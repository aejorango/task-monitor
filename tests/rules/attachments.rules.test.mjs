// T-0073 / IMP-008 — an attachment belongs to the workspace.
//
// The bug: files were stored under users/{uploaderUid}/…, so only the uploader
// could delete one. An admin who deleted somebody else's activity removed the
// record and left the bytes in the bucket for ever. These run against the real
// Storage emulator with the real storage.rules.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { doc, setDoc } from 'firebase/firestore';
import {
  deleteObject, getBytes, ref, uploadBytes,
} from 'firebase/storage';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  reset, seed, seedStorage, shutdown, storageAs, useEmulatorProject, userDoc,
} from './harness.mjs';

// Storage rules read the workspace out of Firestore; the emulator resolves that
// against its own project, so this file's fixtures go there.
useEmulatorProject();

const OWNER = 'owner-uid';       // workspace owner
const MEMBER = 'member-uid';     // uploaded the file
const OUTSIDER = 'outsider-uid'; // in no workspace of ours
const WS = 'ws-1';
const OTHER_WS = 'ws-2';

const FILE = `workspaces/${WS}/task-1/1700000000000-report.pdf`;
const bytes = () => new Uint8Array([1, 2, 3, 4]);

// Storage is not wiped between cases the way Firestore is, so each case starts
// by removing anything a previous one may have left.
const LEFTOVERS = [
  FILE,
  `workspaces/${WS}/task-1/2-new.png`,
  `users/${MEMBER}/task-1/1-old.pdf`,
];

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    for (const uid of [OWNER, MEMBER, OUTSIDER]) {
      await setDoc(doc(db, 'users', uid), userDoc({ email: `${uid}@example.com` }));
    }
    await setDoc(doc(db, 'workspaces', WS), {
      createdByUserId: OWNER, name: 'Ours',
      members: [OWNER, MEMBER], acl: { [OWNER]: 'owner', [MEMBER]: 'editor' },
      archived: false, deleted: false,
    });
    await setDoc(doc(db, 'workspaces', OTHER_WS), {
      createdByUserId: OUTSIDER, name: 'Theirs',
      members: [OUTSIDER], acl: { [OUTSIDER]: 'owner' },
      archived: false, deleted: false,
    });
  });
  // The member's attachment, already in the bucket. Put there with the rules
  // off, exactly as a previous upload would have left it.
  await seedStorage(async (st) => {
    for (const p of LEFTOVERS) {
      await deleteObject(ref(st, p)).catch(() => {});
    }
    await uploadBytes(ref(st, FILE), bytes());
  });
});

// ─── the finding itself ─────────────────────────────────────────────────────

test("the owner can delete a file a member uploaded — the bug this row fixes", async () => {
  const st = await storageAs(OWNER, { email: `${OWNER}@example.com` });
  await assertSucceeds(deleteObject(ref(st, FILE)));
});

test('the uploader can still delete their own file', async () => {
  const st = await storageAs(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(deleteObject(ref(st, FILE)));
});

test('every member of the workspace can open it', async () => {
  const st = await storageAs(OWNER, { email: `${OWNER}@example.com` });
  const got = await assertSucceeds(getBytes(ref(st, FILE)));
  assert.equal(new Uint8Array(got).length, 4);
});

test('a member of the workspace can upload into it', async () => {
  const st = await storageAs(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(uploadBytes(ref(st, `workspaces/${WS}/task-1/2-new.png`), bytes()));
});

// ─── and nobody else gets in ────────────────────────────────────────────────

test('somebody from another workspace cannot read it', async () => {
  const st = await storageAs(OUTSIDER, { email: `${OUTSIDER}@example.com` });
  await assertFails(getBytes(ref(st, FILE)));
});

test('somebody from another workspace cannot delete it', async () => {
  const st = await storageAs(OUTSIDER, { email: `${OUTSIDER}@example.com` });
  await assertFails(deleteObject(ref(st, FILE)));
});

test('somebody from another workspace cannot upload into it', async () => {
  const st = await storageAs(OUTSIDER, { email: `${OUTSIDER}@example.com` });
  await assertFails(uploadBytes(ref(st, `workspaces/${WS}/task-1/3-theirs.png`), bytes()));
});

test('a workspace that does not exist is not a way in', async () => {
  const st = await storageAs(MEMBER, { email: `${MEMBER}@example.com` });
  await assertFails(uploadBytes(ref(st, 'workspaces/no-such-ws/t/1-x.png'), bytes()));
});

test('nothing outside a workspace folder can be written at all', async () => {
  const st = await storageAs(OWNER, { email: `${OWNER}@example.com` });
  await assertFails(uploadBytes(ref(st, 'loose-file.png'), bytes()));
  await assertFails(uploadBytes(ref(st, 'workspaces/'), bytes()));
});

// ─── legacy files: readable and removable by their uploader, and no more ────

test('a file from before the change is still openable by the person who put it there', async () => {
  const legacy = `users/${MEMBER}/task-1/1-old.pdf`;
  await seedStorage(async (st) => { await uploadBytes(ref(st, legacy), bytes()); });
  const st = await storageAs(MEMBER, { email: `${MEMBER}@example.com` });
  await assertSucceeds(getBytes(ref(st, legacy)));
  await assertSucceeds(deleteObject(ref(st, legacy)));
});

test('nothing new may be written to the legacy prefix', async () => {
  const st = await storageAs(MEMBER, { email: `${MEMBER}@example.com` });
  await assertFails(uploadBytes(ref(st, `users/${MEMBER}/task-1/2-new.pdf`), bytes()));
});

test("a legacy file is not readable by somebody else, which is why the prefix was abandoned", async () => {
  const legacy = `users/${MEMBER}/task-1/1-old.pdf`;
  await seedStorage(async (st) => { await uploadBytes(ref(st, legacy), bytes()); });
  const st = await storageAs(OWNER, { email: `${OWNER}@example.com` });
  await assertFails(getBytes(ref(st, legacy)));
});
