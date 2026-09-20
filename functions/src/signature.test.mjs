// T-0043 / MISS-002 — a receiver must be able to prove the request came from us.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signBody } from './webhookEvents.js';

const BODY = JSON.stringify({ event: 'task.completed', task: { id: 't1' } });

test('the signature is an HMAC-SHA256 of the exact bytes sent', () => {
  const sig = signBody(BODY, 'shhh');
  const expected = 'sha256=' + crypto.createHmac('sha256', 'shhh').update(BODY, 'utf8').digest('hex');
  assert.equal(sig, expected);
});

test('it is prefixed, so the algorithm can change later without breaking receivers', () => {
  assert.match(signBody(BODY, 'shhh'), /^sha256=[0-9a-f]{64}$/);
});

test('a different secret gives a different signature', () => {
  assert.notEqual(signBody(BODY, 'a'), signBody(BODY, 'b'));
});

test('a changed body gives a different signature', () => {
  assert.notEqual(signBody(BODY, 'a'), signBody(BODY + ' ', 'a'));
});

test('no secret means no signature header, not an empty one', () => {
  assert.equal(signBody(BODY, ''), null);
  assert.equal(signBody(BODY, undefined), null);
});

test('the secret itself never appears in the signature', () => {
  const secret = 'sk-super-secret-value';
  assert.doesNotMatch(signBody(BODY, secret), new RegExp(secret));
});
