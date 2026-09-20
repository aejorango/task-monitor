// T-0024 / IMP-007 — a missing or unedited .env must produce instructions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIREBASE_ENV_VARS, readFirebaseConfig } from './firebaseConfig.js';

const complete = {
  VITE_FIREBASE_API_KEY: 'AIzaSyRealKey123',
  VITE_FIREBASE_AUTH_DOMAIN: 'real.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'real-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'real-project.appspot.com',
  VITE_FIREBASE_SENDER_ID: '999888777666',
  VITE_FIREBASE_APP_ID: '1:999888777666:web:deadbeef',
};

test('a complete config is accepted and mapped to SDK field names', () => {
  const { ok, missing, config } = readFirebaseConfig(complete);
  assert.equal(ok, true);
  assert.deepEqual(missing, []);
  assert.equal(config.projectId, 'real-project');
  assert.equal(config.messagingSenderId, '999888777666', 'the SDK field is messagingSenderId');
});

test('no .env at all names all six variables', () => {
  const { ok, missing } = readFirebaseConfig({});
  assert.equal(ok, false);
  assert.equal(missing.length, 6);
  assert.deepEqual(missing.map((m) => m.key).sort(), FIREBASE_ENV_VARS.map((v) => v.key).sort());
  assert.ok(missing.every((m) => m.reason === 'not set'));
});

test('one missing variable is named on its own', () => {
  const { ok, missing } = readFirebaseConfig({ ...complete, VITE_FIREBASE_APP_ID: '' });
  assert.equal(ok, false);
  assert.deepEqual(missing.map((m) => m.key), ['VITE_FIREBASE_APP_ID']);
});

test('copying .env.example without editing it is caught, not treated as valid', () => {
  const { ok, missing } = readFirebaseConfig({
    VITE_FIREBASE_API_KEY: 'AIzaSy...',
    VITE_FIREBASE_AUTH_DOMAIN: 'your-project-id.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'your-project-id',
    VITE_FIREBASE_STORAGE_BUCKET: 'your-project-id.appspot.com',
    VITE_FIREBASE_SENDER_ID: '123456789012',
    VITE_FIREBASE_APP_ID: '1:123456789012:web:abc123def456',
  });
  assert.equal(ok, false);
  assert.equal(missing.length, 6);
  assert.ok(missing.every((m) => m.reason === 'still the example value'));
});

test('whitespace-only values count as missing', () => {
  const { missing } = readFirebaseConfig({ ...complete, VITE_FIREBASE_PROJECT_ID: '   ' });
  assert.deepEqual(missing.map((m) => m.key), ['VITE_FIREBASE_PROJECT_ID']);
});

test('every variable has a human label to show next to it', () => {
  const { missing } = readFirebaseConfig({});
  assert.ok(missing.every((m) => m.label && !m.label.startsWith('VITE_')));
});

test('the .env.example file lists exactly these variables', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const example = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', '.env.example'), 'utf8',
  );
  for (const { key } of FIREBASE_ENV_VARS) {
    assert.match(example, new RegExp(`^${key}=`, 'm'), `.env.example is missing ${key}`);
  }
});
