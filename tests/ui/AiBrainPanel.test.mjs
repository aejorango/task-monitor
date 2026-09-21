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

// ─── T-0125 / POL-015: the empty state must blame the right thing ───────────
//
// `available` goes false for two unrelated reasons — the company gate, and
// nothing being connected — and the AI helper's empty state described only the
// first, whatever the real cause: "An admin needs to assign your account to a
// company that has an AI key (Settings → User Management)." A superadmin-only
// screen, named at a reader who cannot open it.

const status = (over) => ({ provider: 'none', known: true, allowed: true, ...over });

test('an unconnected brain is reported as unconnected, not as a missing company', () => {
  const copy = ai.aiUnavailableCopy(status({ provider: 'none' }));
  assert.equal(copy.headline, ai.providerHeadline('none'),
    'the sentence must come from the provider layer, not a second copy of it');
  assert.doesNotMatch(`${copy.headline} ${copy.detail}`, /compan(y|ies)/i);
});

test('no reader is sent to a screen they cannot open', () => {
  for (const s of [
    status({ provider: 'none' }),
    status({ provider: 'mock' }),
    status({ provider: 'claude-code' }),
    status({ allowed: false }),
    status({ known: false, provider: null }),
  ]) {
    const copy = ai.aiUnavailableCopy(s, { isOperator: false });
    const shown = `${copy.headline} ${copy.detail}`;
    assert.doesNotMatch(shown, /User Management/,
      `superadmin-only screen named for ${JSON.stringify(s)}`);
    assert.doesNotMatch(shown, /Settings →/,
      'a Settings section is operator copy — it belongs in operatorHint');
    assert.doesNotMatch(shown, /npm |`|CLI\b/, 'no shell command, no tool name');
  }
});

test('each provider gets its own sentence, so the reason is never generic', () => {
  const seen = new Set();
  for (const provider of ['none', 'mock', 'claude-code', 'bridge-api', 'api']) {
    const copy = ai.aiUnavailableCopy(status({ provider }));
    assert.equal(copy.headline, ai.providerHeadline(provider, true));
    seen.add(copy.headline);
  }
  assert.ok(seen.size >= 4, 'the states must read differently from one another');
});

// A bridge that is set but not running keeps provider 'claude-code' on purpose
// (askAI reports the failure). If something upstream does flip it to none, the
// helper must say so rather than invent a company problem.
test('a dead bridge reads as nothing connected, not as an account problem', () => {
  const copy = ai.aiUnavailableCopy(status({ provider: 'none' }), { isOperator: false });
  assert.match(copy.headline, /No AI brain is connected/);
  assert.match(copy.detail, /administrator/i, 'a non-operator needs someone to ask');
  assert.match(copy.operatorHint, /bridge/i, 'the operator needs the runbook');
});

test('the company gate keeps its own wording, and still names the company', () => {
  const copy = ai.aiUnavailableCopy(status({ allowed: false }));
  assert.match(copy.headline, /switched off/i);
  assert.doesNotMatch(copy.headline, /No AI brain is connected/,
    'this one really is an account problem — it must not read as a dead bridge');
});

test('while the probe is still running nothing is accused of being broken', () => {
  const copy = ai.aiUnavailableCopy(status({ known: false, provider: null }));
  assert.match(copy.headline, /Checking/i);
  assert.equal(copy.detail, '', 'nothing to do yet — there is no verdict');
});

test('an operator gets the runbook instead of being told to ask themselves', () => {
  for (const s of [status({ provider: 'none' }), status({ allowed: false })]) {
    const copy = ai.aiUnavailableCopy(s, { isOperator: true });
    assert.equal(copy.detail, '', 'they are the administrator');
    assert.ok(copy.operatorHint.length > 0);
  }
});

test('a missing status does not throw — an empty state must always render', () => {
  for (const arg of [undefined, null, {}]) {
    const copy = ai.aiUnavailableCopy(arg);
    assert.equal(typeof copy.headline, 'string');
    assert.ok(copy.headline.length > 0);
  }
});
