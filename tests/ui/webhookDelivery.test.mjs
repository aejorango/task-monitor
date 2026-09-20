// T-0044 / MISS-002 — Settings → Webhooks must tell the truth about delivery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const settings = fs.readFileSync(path.join(root, 'src', 'components', 'SettingsView.jsx'), 'utf8');
const section = settings.slice(
  settings.indexOf('function WebhooksSection'),
  settings.indexOf('function WebhookEditor') > 0
    ? settings.indexOf('function WebhookEditor')
    : settings.indexOf('function WorkspacesSection'),
);

test('the "nothing is delivered" warning is gone, because it is delivered now', () => {
  assert.doesNotMatch(section, /Not sending yet/);
  assert.doesNotMatch(section, /nothing is delivered until sending is/);
});

test('the panel explains the signature in plain words', () => {
  assert.match(section, /signed with your secret/);
  assert.doesNotMatch(section, /HMAC|SHA-?256/i, 'that means nothing to the reader');
});

test('each webhook row shows how its last attempt went', () => {
  assert.match(section, /last one delivered/);
  assert.match(section, /last one failed/);
  assert.match(section, /lastByHook/);
});

test('there is a delivery history, and it is read from the log the function writes', () => {
  assert.match(section, /Delivery history/);
  assert.match(section, /subscribeToWebhookDeliveries\(workspaceId, setDeliveries\)/);
});

test('the history is only subscribed to while it is open', () => {
  assert.match(section, /if \(!showLog \|\| !workspaceId\) return undefined;/,
    'a closed panel must not hold a listener');
});

test('an empty history says what will make something appear', () => {
  assert.match(section, /Nothing sent yet/);
  assert.match(section, /the next time one of the events/);
});

test('each attempt shows the outcome sentence the function wrote', () => {
  assert.match(section, /\{d\.message\}/);
  assert.match(section, /\{d\.attempts > 1 &&/, 'retries are worth knowing about');
});

test('the history is bounded and says so', () => {
  assert.match(section, /last 50 attempts/);
  assert.match(section, /Kept for 30 days/);
});

// ─── and the delivery side actually exists ──────────────────────────────────

test('the triggers that do the delivering are exported', () => {
  const index = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
  assert.match(index, /export \{ onTaskWritten, onActivityWritten \}/);
});

test('deliveries are logged where the UI reads them', () => {
  const hooks = fs.readFileSync(path.join(root, 'functions', 'webhooks.js'), 'utf8');
  assert.match(hooks, /collection\('webhookDeliveries'\)/);
  assert.match(hooks, /describeDelivery\(outcome\)/, 'a sentence, not a status code');
});

test('the delivery log is read-only from a browser', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const block = rules.slice(rules.indexOf('match /webhookDeliveries/'));
  assert.match(block.slice(0, 400), /allow write: if false/);
});
