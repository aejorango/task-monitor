// T-0140 / NEW-024 — asking about one project, with cited sources.
//
//   1. Given a project with a notebook configured and a question typed into
//      its Ask panel
//   2. When the answer comes back
//   3. Then the cited notebook material is shown alongside it — and if the
//      lookup failed, the answer is still given and marked degraded with the
//      reason
//
// The scoping and the three grounding states are covered in
// src/services/projectAsk.test.mjs. This renders the real panel and drives it
// with a stand-in for the answer path, so both halves of (3) can be seen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, clickText, typeInto, muteConsoleError, text } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const panel = () => read('src', 'components', 'ProjectAskPanel.jsx');

setupDom();

const ai = await import('../../src/services/ai.js');
const { default: ProjectAskPanel } = await import('../../src/components/ProjectAskPanel.jsx');

const h = React.createElement;

let quiet;
before(async () => {
  quiet = muteConsoleError();
  // The panel is gated on AI being available; in a test the settings default
  // to allowing a mock, which counts.
  ai.setAiSettings({ provider: 'mock', allowMock: true });
  await ai.recheckProvider();
});
after(() => { quiet?.restore(); teardownDom(); });

const WS = { id: 'ws', name: 'Blue', knowledge: { notebookId: 'nb-ws', notebookTitle: 'Workspace notes' } };
const PROJECT = {
  id: 'p1', workspaceId: 'ws', name: 'Riverside', phases: [],
  knowledge: { notebookId: 'nb-p', notebookTitle: 'Riverside notes' },
};
const TASKS = [
  { id: 't1', title: 'Pour the slab', projectId: 'p1', status: 'todo', plan: { endDate: '2026-01-05' }, actual: {} },
  { id: 't2', title: 'Somebody else’s', projectId: 'p2', status: 'todo', plan: {}, actual: {} },
];

/** What narrate() would have returned. */
const GROUNDED = {
  summary: 'Two things are late.',
  actions: ['Chase the supplier'],
  followUps: [{ label: 'Who is on it?', q: 'Who is on it?' }],
  grounding: { citations: [{ title: 'Site contract' }, { title: 'Week 3 notes' }] },
  groundDegraded: null,
};
const DEGRADED = {
  summary: 'Two things are late.',
  actions: [],
  followUps: [],
  grounding: null,
  groundDegraded: 'The notebook could not be reached, so this answer is not grounded.',
};

function rig({ reply = GROUNDED, fail = false } = {}) {
  const calls = [];
  const ask = async (args) => {
    calls.push(args);
    if (fail) throw new Error('7 PERMISSION_DENIED: nope');
    return reply;
  };
  const ui = mount(h(ProjectAskPanel, {
    project: PROJECT, workspace: WS, tasks: TASKS, activities: [], userId: 'u-ace', ask,
  }));
  return { calls, ui };
}

const askQuestion = async (ui, q) => {
  await typeInto(ui.container.querySelector('#pa-q'), q);
  await act(async () => {
    ui.container.querySelector('form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }));
  });
};

/* ── the acceptance case ───────────────────────────────────────────────── */

test('a grounded answer shows what it was read from', async () => {
  const { ui: mounting, calls } = rig();
  const ui = await mounting;
  await askQuestion(ui, 'What is holding this up?');

  const badge = ui.container.querySelector('.pa-ground');
  assert.ok(badge, 'an answer that was grounded has to say so');
  assert.match(badge.textContent, /Grounded · 2 sources/);
  assert.ok(badge.classList.contains('is-grounded'));

  const cites = ui.container.querySelector('.pa-citations');
  assert.ok(cites, 'the cited material is the point');
  assert.match(text(cites), /Site contract/);
  assert.match(text(cites), /Week 3 notes/);
  assert.match(text(ui.container), /Two things are late/);

  // And it asked to be grounded on the PROJECT's notebook.
  assert.deepEqual(calls[0].ground, { notebookId: 'nb-p', workspaceId: 'ws', projectId: 'p1' });
  ui.unmount();
});

// Degraded ≠ success. The answer is still given.
test('a failed lookup still answers, marked, with the reason on hover', async () => {
  const { ui: mounting } = rig({ reply: DEGRADED });
  const ui = await mounting;
  await askQuestion(ui, 'What is holding this up?');

  assert.match(text(ui.container), /Two things are late/, 'the answer must not be swallowed');
  const badge = ui.container.querySelector('.pa-ground');
  assert.match(badge.textContent, /Not grounded/);
  assert.ok(badge.classList.contains('is-degraded'));
  assert.match(badge.getAttribute('title'), /could not be reached/);
  assert.equal(ui.container.querySelector('.pa-citations'), null, 'nothing was read, so nothing is cited');
  ui.unmount();
});

/* ── the scope ─────────────────────────────────────────────────────────── */

test('the digest handed over is this project’s only', async () => {
  const { ui: mounting, calls } = rig();
  const ui = await mounting;
  await askQuestion(ui, 'What is happening?');
  const json = JSON.stringify(calls[0].digest);
  assert.match(json, /Pour the slab/);
  assert.ok(!json.includes('Somebody else’s'),
    'the workspace-wide question is what the Ask AI page already answers');
  assert.equal(calls[0].scope, 'Riverside');
  ui.unmount();
});

test('the panel says out loud what it is looking at', async () => {
  const { ui: mounting } = rig();
  const ui = await mounting;
  assert.match(text(ui.container), /Answers use only this project’s tasks and activity/);
  assert.match(text(ui.container), /read this project’s notebook first/);
  ui.unmount();
});

test('with no project notebook it says it is using the workspace’s', async () => {
  const ui = await mount(h(ProjectAskPanel, {
    project: { ...PROJECT, knowledge: null }, workspace: WS, tasks: TASKS, userId: 'u',
    ask: async () => GROUNDED,
  }));
  assert.match(text(ui.container), /read the workspace’s notebook first/);
  ui.unmount();
});

test('with no notebook anywhere it promises no grounding', async () => {
  const ui = await mount(h(ProjectAskPanel, {
    project: { ...PROJECT, knowledge: null }, workspace: { id: 'ws' }, tasks: TASKS, userId: 'u',
    ask: async () => ({ summary: 'Fine', actions: [], followUps: [] }),
  }));
  assert.doesNotMatch(text(ui.container), /notebook first/);
  ui.unmount();
});

/* ── the starters ──────────────────────────────────────────────────────── */

test('it offers questions before anybody types, and they run', async () => {
  const { ui: mounting, calls } = rig();
  const ui = await mounting;
  const starters = [...ui.container.querySelectorAll('.pa-suggestions button')];
  assert.ok(starters.length > 0, 'an empty box with no prompts teaches nobody anything');

  await clickText(ui.container, starters[0].textContent);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].question, starters[0].textContent);
  ui.unmount();
});

test('the starters go away once there is an answer', async () => {
  const { ui: mounting } = rig();
  const ui = await mounting;
  await askQuestion(ui, 'Anything?');
  // The follow-ups take their place — the same control, a different list.
  const buttons = [...ui.container.querySelectorAll('.pa-suggestions button')].map((b) => b.textContent);
  assert.deepEqual(buttons, ['Who is on it?']);
  ui.unmount();
});

/* ── failure and gating ────────────────────────────────────────────────── */

test('a failure is one plain sentence, not the SDK’s', async () => {
  const { ui: mounting } = rig({ fail: true });
  const ui = await mounting;
  await askQuestion(ui, 'What is happening?');
  const err = ui.container.querySelector('.pa-error');
  assert.ok(err);
  assert.doesNotMatch(err.textContent, /PERMISSION_DENIED|^7 /);
  assert.match(err.textContent, /Could not answer that just now|permission/i);
  ui.unmount();
});

test('an empty question does nothing at all', async () => {
  const { ui: mounting, calls } = rig();
  const ui = await mounting;
  const button = [...ui.container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ask');
  assert.equal(button.disabled, true, 'a button that cannot work must not be pressable');
  await askQuestion(ui, '   ');
  assert.deepEqual(calls, []);
  ui.unmount();
});

test('with AI switched off the panel says why, in the shared wording', async () => {
  ai.setAiSettings({ provider: 'auto', bridge: 'off', allowMock: false });
  await ai.recheckProvider();
  const ui = await mount(h(ProjectAskPanel, { project: PROJECT, workspace: WS, userId: 'u' }));
  assert.match(text(ui.container), /No AI brain is connected/);
  assert.equal(ui.container.querySelector('#pa-q'), null, 'no box that cannot be used');
  ui.unmount();

  ai.setAiSettings({ provider: 'mock', allowMock: true });
  await ai.recheckProvider();
});

/* ── the rules it must not break ───────────────────────────────────────── */

test('it goes through the one chokepoint, not round it', () => {
  const src = panel();
  assert.match(src, /import \{ narrate \} from '\.\.\/services\/askAi'/);
  assert.doesNotMatch(src, /fetch\(/, 'no direct model call');
  assert.doesNotMatch(src, /anthropic\.com/);
  assert.doesNotMatch(src, /getEffectiveApiKey/,
    'gating on a key would hide this from every CLI user');
  assert.match(src, /useAiStatus\(\)/);
});

test('the wording for "AI is off" is the shared one', () => {
  assert.match(panel(), /aiUnavailableCopy\(aiStatus, \{ isOperator \}\)/);
  assert.match(panel(), /<AiOperatorHint hint=\{off\.operatorHint\} \/>/,
    'the runbook is for the operator, not for everybody');
});

test('the panel is mounted on an existing project, not a new one', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.match(view, /\{!isNew && \(\s*\n\s*<section className="pe-card">\s*\n\s*<h4 className="pe-sect">[^<]*<span className="pe-sect-mark">✦<\/span>Ask about this project/,
    'a project with no tasks yet has nothing to be asked about');
  assert.match(view, /<ProjectAskPanel/);
});
