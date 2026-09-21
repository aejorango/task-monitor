// T-0095 / BUG-020 — what an AI failure looks like on the screen.
//
//   1. Given the AI provider is unreachable
//   2. When the user clicks Plan my day with AI
//   3. Then the message on screen is one plain sentence with no shell command,
//      URL, status code or provider internals
//
// The arithmetic is in src/services/errorMessages.test.mjs. This holds the
// rendered result: the real sentence a real component would put on the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

setupDom();

const { describeAiFailure, isPlainUserMessage } = await import('../../src/services/errorMessages.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

/** The error ai.js throws when the bridge is not running. */
const bridgeDown = Object.assign(
  new Error('The AI is not connected right now. Try again in a moment — if it keeps happening, ask whoever set this up.'),
  {
    code: 'bridge-unreachable',
    detail: 'Claude Code bridge unreachable at http://127.0.0.1:4319 (Failed to fetch). '
          + 'Start it with `npm run bridge`, or switch the provider in Settings → AI brain.',
  },
);

/** The card the Dashboard and the AI helper both render an error into. */
function ErrorCard({ err, fallback, isOperator = false }) {
  const { message } = describeAiFailure(err, fallback, { isOperator });
  return h('div', { className: 'auth-error' }, h('p', { className: 'auth-error-msg' }, message));
}

const shown = (ui) => ui.container.querySelector('.auth-error-msg').textContent;

// ─── the acceptance criterion, on the page ──────────────────────────────────

test('the bridge being down puts one plain sentence on the screen', async () => {
  const ui = await mount(h(ErrorCard, {
    err: bridgeDown, fallback: 'The AI could not plan your day just now. Try again in a moment.',
  }));
  const text = shown(ui);

  assert.doesNotMatch(text, /`/, 'no backtick');
  assert.doesNotMatch(text, /npm/, 'no shell command');
  assert.doesNotMatch(text, /http/i, 'no URL');
  assert.doesNotMatch(text, /4319/, 'no port');
  assert.doesNotMatch(text, /Claude Code|Anthropic|bridge/i, 'no provider internals');
  assert.ok(isPlainUserMessage(text), text);
  assert.equal(text.split('.').filter((s) => s.trim()).length <= 2, true, 'it is one sentence, not a paragraph');
  ui.unmount();
});

test('a rate limit says to wait, not "AI API error 429"', async () => {
  const err = Object.assign(new Error('The AI service refused that request.'), {
    code: 'http-429', status: 429,
    detail: 'AI API error 429: {"type":"error","error":{"type":"rate_limit_error"}}',
  });
  const ui = await mount(h(ErrorCard, { err, fallback: 'x' }));
  const text = shown(ui);
  assert.match(text, /busy|wait/i);
  assert.doesNotMatch(text, /429|rate_limit_error|\{/);
  ui.unmount();
});

test('an unrecognised crash shows the caller’s sentence, not the stack', async () => {
  const ui = await mount(h(ErrorCard, {
    err: new TypeError("Cannot read properties of undefined (reading 'map')"),
    fallback: 'Could not get suggestions just now. Try again in a moment.',
  }));
  assert.equal(shown(ui), 'Could not get suggestions just now. Try again in a moment.');
  ui.unmount();
});

test('the operator is shown the thing they can actually fix', async () => {
  const ui = await mount(h(ErrorCard, { err: bridgeDown, fallback: 'x', isOperator: true }));
  assert.match(shown(ui), /npm run bridge/, 'hiding it from the person who can fix it helps nobody');
  ui.unmount();
});

// ─── and every AI surface goes through it ───────────────────────────────────

const AI_SURFACES = [
  ['DashboardView.jsx', 'Plan my day with AI'],
  ['AiHelper.jsx', 'the topbar AI bulb'],
  ['AiTaskGenerator.jsx', 'the task generator'],
  ['TaskAiPanel.jsx', 'the task AI panel'],
  ['ReviewView.jsx', 'Review → AI assist'],
  ['DueTaskAlertModal.jsx', 'the due-task alert prompt'],
  ['KnowledgeSection.jsx', 'Settings → Knowledge base'],
];

for (const [file, where] of AI_SURFACES) {
  test(`${where} shows a described failure, not a thrown message`, () => {
    const src = read('src', 'components', file);
    assert.match(src, /describeAiFailure\(/, `${file} renders the raw message`);
    assert.doesNotMatch(src, /setError\(err\.message \|\| String\(err\)\)/,
      `${file} still has the raw pattern`);
  });
}

test('the operator detail is never lost — it goes to the console', () => {
  for (const [file] of AI_SURFACES) {
    const src = read('src', 'components', file);
    assert.match(src, /console\.error\([^)]*detail/,
      `${file} must still give whoever has to fix it something to go on`);
  }
});

test('the sign-in page never shows a Firebase message or a Firebase instruction', () => {
  const firebase = read('src', 'services', 'firebase.js');
  const signIn = firebase.slice(firebase.indexOf('export async function signInWithGoogle'));
  const body = signIn.slice(0, signIn.indexOf('\n}'));
  assert.doesNotMatch(body, /message: err\?\.message/, 'the SDK message is not copy');
  assert.match(body, /friendlyError\(err,/);
  assert.doesNotMatch(body, /message: 'This domain isn’t authorized for sign-in\. Add it in Firebase/,
    'a stranger cannot act on a Firebase console instruction');
  assert.match(body, /console\.error\('\[auth\] unauthorized domain/,
    'but whoever runs the project still finds out how to fix it');
});

// ─── T-0096: the docs carry it too ──────────────────────────────────────────

test('CLAUDE.md records the rule and the trap', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /describeAiFailure/, 'the function belongs in the map');
  assert.match(claude, /inline error/i, 'the pitfall names what the toast guard missed');
});

test('the README lists the new suite', () => {
  assert.match(read('README.md'), /tests\/ui\/aiErrorCopy\.test\.mjs/);
});

test('the changelog records both halves of the fix', () => {
  const log = read('CHANGELOG.md');
  assert.match(log, /T-0094 — Raw AI error text/);
  assert.match(log, /T-0095 — Raw AI error text/);
});
