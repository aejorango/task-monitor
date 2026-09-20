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
// Storage rules read the workspace document out of Firestore, so both
// emulators run together — see `npm run test:rules`.
const STORAGE_PORT = Number(
  (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '').split(':').pop() || 9199,
);

let envPromise = null;

// Each test FILE gets its own Firestore project inside the emulator, and
// `npm run test:rules` runs the files one at a time: clearFirestore() is
// project-wide, and with singleProjectMode the emulator's one bucket is shared
// by every file, so a parallel run let one file wipe another's fixtures.
//
// The exception is a file that tests STORAGE rules: those read the workspace
// document through `firestore.get()`, and the Storage emulator resolves that
// against the project the emulator was started with — so such a file must use
// that project id, which `RULES_TEST_PROJECT` (or the `--project` flag) names.
const EMULATOR_PROJECT = process.env.RULES_TEST_PROJECT
  || process.env.GCLOUD_PROJECT
  || 'task-monitor-rules-test';

const ownProjectId = 'rules-' + path
  .basename(process.argv[1] || 'default')
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-z0-9-]/gi, '-')
  .toLowerCase();

let projectId = ownProjectId;

/**
 * Run this file's fixtures in the emulator's own project, so Storage rules can
 * read them with `firestore.get()`. Call it before anything else in the file.
 */
export function useEmulatorProject() {
  if (envPromise) throw new Error('useEmulatorProject() must be called before the first query');
  projectId = EMULATOR_PROJECT;
}

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
      storage: {
        host: HOST,
        port: STORAGE_PORT,
        rules: fs.readFileSync(path.join(repoRoot, 'storage.rules'), 'utf8'),
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

/** Firestore handle for somebody who is not signed in at all. */
export async function anon() {
  const env = await testEnv();
  return env.unauthenticatedContext().firestore();
}

/** Storage handle for a signed-in user (rules enforced). */
export async function storageAs(uid, token = {}) {
  const env = await testEnv();
  return env.authenticatedContext(uid, token).storage();
}

/** Storage handle with rules disabled — used to put a fixture file in place. */
export async function seedStorage(fn) {
  const env = await testEnv();
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.storage()));
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
