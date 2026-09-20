// Shared harness for Firestore security-rules tests.
//
// These run against the Firestore emulator, started by `npm run test:rules`
// (see package.json → firebase emulators:exec). They never touch the real
// project: initializeTestEnvironment points the SDK at 127.0.0.1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const HOST = '127.0.0.1';
const PORT = Number(
  (process.env.FIRESTORE_EMULATOR_HOST || '').split(':')[1] || 8787,
);

let envPromise = null;

// Each test FILE gets its own Firestore project inside the emulator. node
// --test runs files in parallel, and clearFirestore() is project-wide — shared
// projects would let one file wipe another's fixtures mid-test.
const projectId = 'rules-' + path
  .basename(process.argv[1] || 'default')
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-z0-9-]/gi, '-')
  .toLowerCase();

/** One shared RulesTestEnvironment per test process. */
export function testEnv() {
  if (!envPromise) {
    envPromise = initializeTestEnvironment({
      projectId,
      firestore: {
        host: HOST,
        port: PORT,
        rules: fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8'),
      },
    });
  }
  return envPromise;
}

/** Wipe all documents between tests so each case starts clean. */
export async function reset() {
  const env = await testEnv();
  await env.clearFirestore();
}

export async function shutdown() {
  if (!envPromise) return;
  const env = await envPromise;
  await env.cleanup();
  envPromise = null;
}

/** Firestore handle for a signed-in user (rules enforced). */
export async function as(uid, token = {}) {
  const env = await testEnv();
  return env.authenticatedContext(uid, token).firestore();
}

/** Firestore handle with rules disabled — used to seed fixtures. */
export async function seed(fn) {
  const env = await testEnv();
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

/** A plain approved member profile. */
export function userDoc(overrides = {}) {
  return {
    email: 'member@example.com',
    displayName: 'Member',
    status: 'approved',
    role: 'user',
    companyId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** An approved superadmin profile (email must be on the hardcoded list). */
export function superadminDoc(overrides = {}) {
  return userDoc({
    email: 'aejorango888@gmail.com',
    displayName: 'Super',
    status: 'approved',
    role: 'superadmin',
    ...overrides,
  });
}
