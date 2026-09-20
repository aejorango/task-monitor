// T-0027 / POL-003 — Settings → Knowledge base, seen by each kind of reader.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();
const { default: KnowledgeSection } = await import('../../src/components/KnowledgeSection.jsx');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

// Nothing is reachable in a test, so the hook lands in the "bridge down"
// state — which is exactly the state that used to print shell commands.
const CODE = /npm run bridge|pipx|brew install|notebooklm login|127\.0\.0\.1:\d+|localhost:\d+/;

test('a regular user sees no shell commands and no bridge URL', async () => {
  const ui = await mount(h(KnowledgeSection, { isOperator: false }));
  const shown = text(ui.container);
  assert.doesNotMatch(shown, CODE, `leaked operator detail: ${shown}`);
  ui.unmount();
});

test('a regular user is told what a knowledge base is and who sets it up', async () => {
  const ui = await mount(h(KnowledgeSection, { isOperator: false }));
  const shown = text(ui.container);
  assert.match(shown, /Knowledge base/);
  assert.match(shown, /own documents/);
  assert.match(shown, /admin/);
  ui.unmount();
});

test('a regular user gets no Re-check button — it is not theirs to re-check', async () => {
  const ui = await mount(h(KnowledgeSection, { isOperator: false }));
  const labels = [...ui.container.querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(labels, []);
  ui.unmount();
});

test('the operator still gets the runbook', async () => {
  const ui = await mount(h(KnowledgeSection, { isOperator: true }));
  const shown = text(ui.container);
  assert.match(shown, /Re-check/);
  assert.match(shown, /npm run bridge|Bridge/);
  ui.unmount();
});

test('Settings renders the section as operator-only for superadmins', () => {
  const settings = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'SettingsView.jsx'), 'utf8',
  );
  assert.match(settings, /<KnowledgeSection isOperator=\{isSuperadmin\} \/>/,
    'the section must be told who is reading it');
});

test('the component no longer hardcodes an install command list', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'KnowledgeSection.jsx'), 'utf8',
  );
  // Comments may still describe the flow; what must not survive is a command
  // the component renders itself rather than getting from knowledgeCopy().
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /INSTALL_CMDS/, 'commands come from services/knowledgeCopy.js');
  assert.doesNotMatch(code, /pipx install|brew install|notebooklm login/, 'same');
  assert.match(code, /knowledgeCopy\(/);
});
