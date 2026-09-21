// T-0125 / POL-015 — what the AI helper says when AI is switched off.
//
//   1. Given AI is unavailable because the bridge is down
//   2. When a non-superadmin opens the AI helper
//   3. Then the reason shown matches the actual provider state and names no
//      screen the reader cannot open
//
// The wording itself is covered across every provider in AiBrainPanel.test.mjs.
// This is the receiving end: the real modal, rendering what the real status
// says — a source guard alone would pass on a sentence nobody sees.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, clickText, muteConsoleError, text } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const helperSrc = () => fs.readFileSync(path.join(root, 'src', 'components', 'AiHelper.jsx'), 'utf8');

setupDom();

const { default: AiHelper } = await import('../../src/components/AiHelper.jsx');
const ai = await import('../../src/services/ai.js');

const h = React.createElement;

let quiet;
before(async () => {
  quiet = muteConsoleError();
  // Put the app in the state this row is about: nothing connected. In DEV the
  // settings default to allowing mock answers, and mock genuinely IS available
  // — it produces placeholder text — so the empty state never appears until
  // that is switched off and the probe finds no bridge and no key.
  ai.setAiSettings({ provider: 'auto', bridge: 'off', allowMock: false });
  await ai.recheckProvider();
});
after(() => { quiet?.restore(); teardownDom(); });

const openHelper = async () => {
  const ui = await mount(h(AiHelper));
  await clickText(ui.container, 'AI');
  return ui;
};
const dialog = (ui) => ui.container.querySelector('[role="dialog"]');

test('the bulb opens the helper, and AI really is unavailable here', async () => {
  const ui = await openHelper();
  assert.ok(dialog(ui), 'the topbar bulb is the only way in');
  assert.match(text(dialog(ui)), /Stuck\?/);
  assert.equal(ai.aiStatus().available, false,
    'the rest of this file is about the empty state — it has to be showing');
  assert.equal(ai.aiStatus().provider, 'none');
  ui.unmount();
});

// In a test there is no bridge and no key, so the status is exactly the state
// this row is about: unavailable, and not because of any company.
test('the empty state says what the status actually says', async () => {
  const ui = await openHelper();
  const shown = text(dialog(ui));
  const expected = ai.aiUnavailableCopy(ai.aiStatus(), { isOperator: false });
  assert.ok(shown.includes(expected.headline),
    `expected "${expected.headline}" in: ${shown}`);
  ui.unmount();
});

test('it no longer blames a company the user may not even have', async () => {
  const ui = await openHelper();
  const shown = text(dialog(ui));
  assert.doesNotMatch(shown, /assign your account to a company/i);
  assert.doesNotMatch(shown, /AI isn't enabled for your account yet/i);
  ui.unmount();
});

test('it names no screen the reader cannot open', async () => {
  const ui = await openHelper();
  const shown = text(dialog(ui));
  // User Management is superadmin-only; the test user is not one, so neither
  // it nor any operator runbook may appear.
  assert.doesNotMatch(shown, /User Management/);
  assert.doesNotMatch(shown, /npm run bridge/, 'the runbook is behind AiOperatorHint');
  ui.unmount();
});

test('the suggest button is not offered when there is nothing to suggest with', async () => {
  const ui = await openHelper();
  const buttons = [...dialog(ui).querySelectorAll('button')].map((b) => b.textContent.trim());
  assert.ok(!buttons.some((b) => /Suggest my top 3/.test(b)),
    'a button that cannot work is dead UI');
  ui.unmount();
});

test('the empty-state wording comes from the AI module, not from the component', () => {
  const src = helperSrc();
  assert.match(src, /import \{ aiUnavailableCopy \} from '\.\.\/services\/ai'/,
    'provider wording lives in services/ai.js — a component copy is how the two drift');
  assert.match(src, /<AiOperatorHint hint=\{off\.operatorHint\}/,
    'the runbook must be gated, not inlined');
  // The exact string this row removed.
  assert.doesNotMatch(src, /An admin needs to assign your account to a company/);
});
