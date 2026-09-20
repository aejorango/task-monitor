// T-0034 / IMP-001 — the company's Anthropic key must not be readable from a
// browser. Members can still see that a company exists and whether AI is on;
// the key itself is superadmin-only (the aiProxy function uses admin
// credentials and bypasses these rules entirely).
import { test, before, after, beforeEach } from 'node:test';
import { doc, getDoc, setDoc, addDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, reset, seed, shutdown, superadminDoc, userDoc } from './harness.mjs';

const MEMBER = 'member-uid';
const OUTSIDER = 'outsider-uid';
const SUPER = 'super-uid';
const COMPANY = 'company-1';

before(async () => { await reset(); });
after(async () => { await shutdown(); });

beforeEach(async () => {
  await reset();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', MEMBER), userDoc({ email: 'member@example.com', companyId: COMPANY }));
    await setDoc(doc(db, 'users', OUTSIDER), userDoc({ email: 'outsider@example.com' }));
    await setDoc(doc(db, 'users', SUPER), superadminDoc());
    await setDoc(doc(db, 'companies', COMPANY), {
      name: 'Acme', hasApiKey: true, aiEnabled: true, deleted: false,
    });
    await setDoc(doc(db, 'companies', COMPANY, 'secrets', 'anthropic'), {
      anthropicApiKey: 'sk-ant-the-real-key',
    });
  });
});

test('a member can still read their company', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  const snap = await assertSucceeds(getDoc(doc(db, 'companies', COMPANY)));
  // And what they get back must not contain a key.
  const data = snap.data();
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      if (v.startsWith('sk-ant')) throw new Error(`the key is still on the company doc under "${k}"`);
    }
  }
});

test('a member cannot read their own company’s API key', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(getDoc(doc(db, 'companies', COMPANY, 'secrets', 'anthropic')));
});

test('an outsider cannot read the key either', async () => {
  const db = await as(OUTSIDER, { email: 'outsider@example.com' });
  await assertFails(getDoc(doc(db, 'companies', COMPANY, 'secrets', 'anthropic')));
});

test('a member cannot write themselves a key', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(setDoc(doc(db, 'companies', COMPANY, 'secrets', 'anthropic'), {
    anthropicApiKey: 'sk-ant-mine',
  }));
});

test('a superadmin can read and set the key', async () => {
  const db = await as(SUPER, { email: 'aejorango888@gmail.com' });
  await assertSucceeds(getDoc(doc(db, 'companies', COMPANY, 'secrets', 'anthropic')));
  await assertSucceeds(setDoc(doc(db, 'companies', COMPANY, 'secrets', 'anthropic'), {
    anthropicApiKey: 'sk-ant-rotated',
  }));
});

test('nobody writes the AI usage log from a browser', async () => {
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertFails(addDoc(collection(db, 'aiUsage'), {
    userId: MEMBER, companyId: COMPANY, inputTokens: 1, outputTokens: 1,
  }));
});

test('a member can read their own usage, and only their own', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'aiUsage', 'mine'), { userId: MEMBER, companyId: COMPANY });
    await setDoc(doc(db, 'aiUsage', 'theirs'), { userId: OUTSIDER, companyId: COMPANY });
  });
  const db = await as(MEMBER, { email: 'member@example.com' });
  await assertSucceeds(getDoc(doc(db, 'aiUsage', 'mine')));
  await assertFails(getDoc(doc(db, 'aiUsage', 'theirs')));
  await assertFails(getDocs(collection(db, 'aiUsage')));
  await assertSucceeds(getDocs(query(collection(db, 'aiUsage'), where('userId', '==', MEMBER))));
});

test('a superadmin can read the whole usage log', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'aiUsage', 'mine'), { userId: MEMBER, companyId: COMPANY });
  });
  const db = await as(SUPER, { email: 'aejorango888@gmail.com' });
  await assertSucceeds(getDocs(collection(db, 'aiUsage')));
});
