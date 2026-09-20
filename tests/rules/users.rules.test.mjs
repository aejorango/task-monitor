// T-0001 / BUG-001 — a user must not be able to put themselves in a company.
//
// companyId on users/{uid} is a privilege field: companies/{id} is readable by
// its own members (isMyCompany), and the company doc holds the shared Anthropic
// API key. If a member can write their own companyId they can read any
// company's key. Only superadmins assign companies.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import {
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, superadminDoc, userDoc } from './harness.mjs';

const MEMBER = 'member-uid';
const SUPER = 'super-uid';
const COMPANY = 'company-with-key';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', MEMBER), userDoc());
    await setDoc(doc(db, 'users', SUPER), superadminDoc());
    await setDoc(doc(db, 'companies', COMPANY), {
      name: 'Acme',
      anthropicApiKey: 'sk-ant-secret',
      aiEnabled: true,
      deleted: false,
    });
  });
});

test('a member cannot self-assign a companyId', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(
    updateDoc(doc(db, 'users', MEMBER), { companyId: COMPANY }),
  );
});

test('a member cannot smuggle companyId in alongside a legitimate edit', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(
    updateDoc(doc(db, 'users', MEMBER), {
      displayName: 'Renamed',
      companyId: COMPANY,
    }),
  );
});

test('a member still cannot read a company they are not in', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(getDoc(doc(db, 'companies', COMPANY)));
});

test('a member can still update their own display name and photo', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertSucceeds(
    updateDoc(doc(db, 'users', MEMBER), {
      displayName: 'New Name',
      photoURL: 'https://example.com/a.png',
    }),
  );
});

test('a member still cannot change their own status or role', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(updateDoc(doc(db, 'users', MEMBER), { status: 'approved', role: 'superadmin' }));
});

test('a superadmin can assign a company to a member', async () => {
  const db = await as(SUPER, { email: 'aejorango888@gmail.com' });
  await assertSucceeds(
    updateDoc(doc(db, 'users', MEMBER), { companyId: COMPANY }),
  );
});

test('a member of a company can read that company', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'users', MEMBER), userDoc({ companyId: COMPANY }));
  });
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertSucceeds(getDoc(doc(db, 'companies', COMPANY)));
});

test('a superadmin email can still promote itself if the list changed later', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'users', 'late-super'), userDoc({
      email: 'blueinnovation.ph@gmail.com', status: 'pending', role: 'user',
    }));
  });
  const db = await as('late-super', { email: 'blueinnovation.ph@gmail.com' });
  await assertSucceeds(
    updateDoc(doc(db, 'users', 'late-super'), { role: 'superadmin', status: 'approved' }),
  );
});

test('a non-superadmin email cannot promote itself', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(
    updateDoc(doc(db, 'users', MEMBER), { role: 'superadmin', status: 'approved' }),
  );
});

test('a member cannot rewrite their email to someone else', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(
    updateDoc(doc(db, 'users', MEMBER), { email: 'aejorango888@gmail.com' }),
  );
});

test('ensureUserProfile refresh patch (email + displayName + photoURL) is allowed', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertSucceeds(
    updateDoc(doc(db, 'users', MEMBER), {
      email: 'member@example.com',
      displayName: 'Member',
      photoURL: 'https://lh3.example/photo.jpg',
    }),
  );
});
