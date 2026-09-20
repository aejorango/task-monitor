// T-0035 / IMP-001 — what Settings → Companies shows a superadmin, and what it
// can no longer show anybody.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const settings = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'SettingsView.jsx'), 'utf8',
);
const row = settings.slice(settings.indexOf('function CompanyRow'), settings.indexOf('// ─── Non-admin AI status card'));

test('the key field starts empty — the stored key is never rendered back', () => {
  assert.match(row, /const \[apiKey, setApiKey\] = useState\(''\)/,
    'seeding it from the document is how the key got onto the page');
  assert.doesNotMatch(row, /useState\(company\.anthropicApiKey/);
});

test('the key field is not re-synced from the document', () => {
  assert.doesNotMatch(row, /setApiKey\(company\.anthropicApiKey/);
});

test('an empty key box means "leave the key alone", not "clear it"', () => {
  assert.match(row, /apiKey\.trim\(\) \? \{ anthropicApiKey/,
    'sending an empty string would wipe a working key on every save');
});

test('key presence is read from a flag, not from the key', () => {
  assert.match(row, /company\.hasApiKey/);
});

test('the model is chosen from a list, not typed', () => {
  assert.match(row, /COMPANY_MODEL_CHOICES/);
  const modelField = row.slice(row.indexOf('Model <span'));
  assert.match(modelField, /<select/);
});

test('the panel explains where the key lives, in plain words', () => {
  assert.match(row, /only superadmins and the server can read it/);
  assert.doesNotMatch(row, /readable only by superadmins and members of this company/,
    'that was the old, now untrue, sentence');
});

test('the Companies panel migrates any key still on a company document', () => {
  const section = settings.slice(settings.indexOf('function CompaniesManagementSection'));
  assert.match(section, /migrateCompanyKeys/);
  assert.match(section, /migrationRun/, 'must not re-run on every render');
});

test('nothing in Settings reads a company key to decide anything', () => {
  const offenders = settings.split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /anthropicApiKey/.test(l) && !l.trim().startsWith('//'))
    // The only legitimate uses: sending a NEW key, a `??` fallback for
    // documents that have not been migrated yet, and the migration itself
    // finding the ones that still carry a key.
    .filter(({ l }) => !/apiKey\.trim\(\) \?|\?\?|hasApiKey|const legacy =/.test(l));
  assert.deepEqual(offenders.map((o) => `${o.n}: ${o.l.trim()}`), []);
});
