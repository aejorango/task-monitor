// T-0034 / IMP-001 — who may spend the company's AI budget, and on what terms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DENY, MAX_OUTPUT_TOKENS, authorizeAiCall, normalizeAiRequest,
} from './authorize.js';

const AUTH = { uid: 'u1' };
const USER = { status: 'approved', companyId: 'c1' };
const COMPANY = { name: 'Acme', aiEnabled: true, deleted: false };
const KEY = 'sk-ant-real';

test('an approved member of an enabled company is allowed', () => {
  const d = authorizeAiCall(AUTH, USER, COMPANY, KEY);
  assert.equal(d.ok, true);
  assert.equal(d.companyId, 'c1');
  assert.match(d.model, /^claude-/);
});

test('a signed-out caller is refused', () => {
  const d = authorizeAiCall(null, USER, COMPANY, KEY);
  assert.equal(d.ok, false);
  assert.equal(d.code, DENY.UNAUTHENTICATED);
});

test('a pending or rejected account is refused even with a company', () => {
  for (const status of ['pending', 'rejected', undefined]) {
    const d = authorizeAiCall(AUTH, { ...USER, status }, COMPANY, KEY);
    assert.equal(d.ok, false, String(status));
    assert.equal(d.code, DENY.NOT_APPROVED);
  }
  assert.equal(authorizeAiCall(AUTH, null, COMPANY, KEY).code, DENY.NOT_APPROVED);
});

test('a user with no company cannot spend anybody’s budget', () => {
  assert.equal(authorizeAiCall(AUTH, { status: 'approved' }, COMPANY, KEY).code, DENY.NO_COMPANY);
  assert.equal(authorizeAiCall(AUTH, USER, null, KEY).code, DENY.NO_COMPANY);
  assert.equal(authorizeAiCall(AUTH, USER, { ...COMPANY, deleted: true }, KEY).code, DENY.NO_COMPANY);
});

test('the per-company switch is enforced here, not merely displayed', () => {
  const d = authorizeAiCall(AUTH, USER, { ...COMPANY, aiEnabled: false }, KEY);
  assert.equal(d.ok, false);
  assert.equal(d.code, DENY.COMPANY_OFF);
});

test('a legacy company with no aiEnabled field keeps working', () => {
  const { aiEnabled, ...legacy } = COMPANY;   // eslint-disable-line no-unused-vars
  assert.equal(authorizeAiCall(AUTH, USER, legacy, KEY).ok, true);
});

test('a company with no key is refused before any network call', () => {
  for (const key of ['', '   ', null, undefined]) {
    assert.equal(authorizeAiCall(AUTH, USER, COMPANY, key).code, DENY.NO_KEY);
  }
});

test('every refusal is a sentence, never a code, and never leaks the key', () => {
  for (const d of [
    authorizeAiCall(null, USER, COMPANY, KEY),
    authorizeAiCall(AUTH, { status: 'pending' }, COMPANY, KEY),
    authorizeAiCall(AUTH, { status: 'approved' }, COMPANY, KEY),
    authorizeAiCall(AUTH, USER, { ...COMPANY, aiEnabled: false }, KEY),
    authorizeAiCall(AUTH, USER, COMPANY, ''),
  ]) {
    assert.match(d.message, /^[A-Z].*\.$/, d.message);
    assert.doesNotMatch(d.message, /sk-ant|anthropic|companyId|uid/i, d.message);
  }
});

test('the model comes from the company, never from the caller', () => {
  const d = authorizeAiCall(AUTH, USER, { ...COMPANY, anthropicModel: 'claude-opus-5' }, KEY);
  assert.equal(d.model, 'claude-opus-5');
});

// ─── request shaping ────────────────────────────────────────────────────────

test('a well-formed request passes through', () => {
  const r = normalizeAiRequest({ system: 'You are', user: 'Hello', maxTokens: 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.maxTokens, 1000);
});

test('an empty prompt is refused', () => {
  for (const data of [{}, { system: 'x' }, { user: 'y' }, { system: '  ', user: 'y' }]) {
    assert.equal(normalizeAiRequest(data).ok, false);
  }
});

test('the token budget is clamped — the caller does not get to choose it', () => {
  assert.equal(normalizeAiRequest({ system: 'a', user: 'b', maxTokens: 1e9 }).maxTokens, MAX_OUTPUT_TOKENS);
  assert.equal(normalizeAiRequest({ system: 'a', user: 'b', maxTokens: -5 }).maxTokens, 256);
  assert.equal(normalizeAiRequest({ system: 'a', user: 'b', maxTokens: 'lots' }).maxTokens, 2048);
});

test('an enormous prompt is refused with an actionable sentence', () => {
  const r = normalizeAiRequest({ system: 'a', user: 'x'.repeat(300_000) });
  assert.equal(r.ok, false);
  assert.match(r.message, /too long/);
});

test('extra fields in the request body are ignored, not forwarded', () => {
  const r = normalizeAiRequest({
    system: 'a', user: 'b',
    model: 'attacker-choice', apiKey: 'sk-ant-theirs', messages: [{ role: 'user', content: 'x' }],
  });
  assert.deepEqual(Object.keys(r).sort(), ['maxTokens', 'ok', 'system', 'user']);
});
