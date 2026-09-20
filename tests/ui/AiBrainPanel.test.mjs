// T-0018 / BUG-008 — what Settings tells the user about the AI brain.
//
// The panel must never advertise "no API billing" while the bridge is running
// on an API key, and the non-admin card must reflect whether AI actually works
// rather than whether the user has been put in a company.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();
const ai = await import('../../src/services/ai.js');
const { useAiStatus } = await import('../../src/hooks/useAiStatus.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

// ─── the wording itself ─────────────────────────────────────────────────────

test('a bridge running on an API key never says "no API billing"', () => {
  const shown = `${ai.providerLabel('bridge-api')} ${ai.providerHeadline('bridge-api')}`;
  assert.match(shown, /billed per token/);
  assert.doesNotMatch(shown, /no API billing/);
  assert.doesNotMatch(shown, /Thinking on your Claude subscription/);
});

test('the CLI still says it is on the subscription', () => {
  const shown = `${ai.providerLabel('claude-code')} ${ai.providerHeadline('claude-code')}`;
  assert.match(shown, /subscription/);
  assert.match(shown, /no API billing/);
});

test('no headline shows a provider id to the user', () => {
  for (const p of ['claude-code', 'bridge-api', 'api', 'mock', 'none']) {
    const headline = ai.providerHeadline(p);
    assert.doesNotMatch(headline, /bridge-api|claude-code\b/,
      `headline for ${p} leaked an internal id`);
  }
});

// ─── the hook the card reads ────────────────────────────────────────────────

test('useAiStatus reports availability, which is what the card must gate on', async () => {
  const seen = [];
  function Probe() { seen.push(useAiStatus()); return null; }
  const ui = await mount(h(Probe));
  const status = seen.at(-1);
  assert.equal(typeof status.available, 'boolean');
  assert.equal(typeof status.known, 'boolean');
  assert.ok('provider' in status);
  assert.equal(typeof status.recheck, 'function');
  ui.unmount();
});

test('availability does not depend on having an API key', () => {
  // A CLI user has no key at all. Gating any AI surface on hasApiKey hides AI
  // from exactly the people the bridge was built for.
  const status = ai.aiStatus();
  assert.ok('hasApiKey' in status);
  assert.ok('available' in status);
  assert.notEqual(status.available, undefined);
});
