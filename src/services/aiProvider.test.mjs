// T-0017 / BUG-008 — the app must never tell a user "no API billing" while the
// bridge is spending API tokens, and must never claim web access or notebook
// grounding from a provider that has neither.
//
// Only the pure exports are exercised here; detectProvider() talks to a bridge
// and is covered by the bridge's own tests plus the panel test in tests/ui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_PROVIDERS, PROVIDERS, canBrowse, canGround, isBridgeProvider,
  providerHeadline, providerLabel,
} from './ai.js';

test('bridge-api is not something a user can pick', () => {
  assert.equal(PROVIDERS.includes('bridge-api'), false,
    'it is what the bridge turns out to be, not a choice');
  assert.deepEqual(PROVIDERS, ['claude-code', 'api', 'mock']);
});

test('both bridge providers route through the bridge', () => {
  assert.deepEqual(BRIDGE_PROVIDERS, ['claude-code', 'bridge-api']);
  assert.equal(isBridgeProvider('claude-code'), true);
  assert.equal(isBridgeProvider('bridge-api'), true);
  assert.equal(isBridgeProvider('api'), false);
  assert.equal(isBridgeProvider('mock'), false);
  assert.equal(isBridgeProvider('none'), false);
});

test('only the CLI can browse or read a notebook', () => {
  assert.equal(canBrowse('claude-code'), true);
  assert.equal(canGround('claude-code'), true);
  for (const p of ['bridge-api', 'api', 'mock', 'none', null]) {
    assert.equal(canBrowse(p), false, `canBrowse(${p})`);
    assert.equal(canGround(p), false, `canGround(${p})`);
  }
});

test('a bridge on an API key is labelled as billed, never as the subscription', () => {
  const label = providerLabel('bridge-api');
  assert.match(label, /billed per token/);
  assert.doesNotMatch(label, /no API billing|subscription/i, 'this is the bug');
});

test('the CLI is still labelled as the subscription', () => {
  assert.match(providerLabel('claude-code'), /subscription/);
  assert.match(providerLabel('claude-code'), /no API billing/);
});

test('every provider has a label and none falls through to "Checking…"', () => {
  for (const p of ['claude-code', 'bridge-api', 'api', 'mock', 'none']) {
    assert.notEqual(providerLabel(p), 'Checking…', p);
  }
  assert.equal(providerLabel(null), 'Checking…');
});

test('the headline tells a bridge-api user how to get onto their subscription', () => {
  const h = providerHeadline('bridge-api');
  assert.match(h, /billed per token/);
  assert.match(h, /claude/i, 'say what to do about it');
});

test('headlines are plain sentences with no jargon or code for other providers', () => {
  assert.match(providerHeadline('claude-code'), /^Thinking on your Claude subscription/);
  assert.match(providerHeadline('mock'), /Placeholder answers only/);
  assert.match(providerHeadline('none'), /switched off/);
  assert.match(providerHeadline(null, false), /Checking/);
});
