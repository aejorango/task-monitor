// T-0071 / NEW-002 — Settings → Automations, rendered.
//
// The rule editor is the whole point of this row: a non-technical person must
// be able to build "when a task is completed, create a follow-up" without ever
// seeing a field name, an id or a piece of JSON. These tests mount the real
// component and read what is on the screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, clickText, text, muteConsoleError } from './dom.mjs';

setupDom();

const { default: AutomationsSection } = await import('../../src/components/AutomationsSection.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');
const { DialogProvider } = await import('../../src/components/Dialog.jsx');
const { setActiveWorkspaceId } = await import('../../src/hooks/useWorkspace.js');
const { db } = await import('../../src/services/firebase.js');
const { terminate } = await import('firebase/firestore');

// Rules belong to a workspace; without one the section only says so.
setActiveWorkspaceId('ws-test');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const src = fs.readFileSync(
  path.join(root, 'src', 'components', 'AutomationsSection.jsx'), 'utf8',
);

let quiet;
before(() => { quiet = muteConsoleError(); });
after(async () => {
  quiet?.restore();
  teardownDom();
  // The listeners this section opens hold a connection; without this the test
  // process never exits.
  await terminate(db).catch(() => {});
});

const render = (props = {}) => mount(
  h(ToastProvider, null, h(DialogProvider, null,
    h(AutomationsSection, { userId: 'u1', isAdmin: true, ...props }))),
);

const selects = (ui) => [...ui.container.querySelectorAll('select')];
const optionsOf = (s) => [...s.options].map((o) => o.textContent);

// ─── the section itself ─────────────────────────────────────────────────────

test('the section renders and explains itself without jargon', async () => {
  const ui = await render();
  const shown = text(ui.container);
  assert.match(shown, /Automations/);
  assert.match(shown, /when something happens/);
  assert.doesNotMatch(shown, /JSON|payload|trigger:|webhook URL/i);
  ui.unmount();
});

test('an empty list says what to do rather than showing "0"', async () => {
  const ui = await render();
  assert.match(text(ui.container), /No automations yet/);
  assert.doesNotMatch(text(ui.container), /\b0 rules\b/);
  ui.unmount();
});

test('a member who is not an admin is told who can add one, and gets no buttons', async () => {
  const ui = await render({ isAdmin: false });
  const shown = text(ui.container);
  assert.match(shown, /owner or an admin of this workspace can add one/);
  assert.doesNotMatch(shown, /\+ New automation/);
  ui.unmount();
});

// ─── the editor ─────────────────────────────────────────────────────────────

test('the editor opens as a real dialog, with a name it announces', async () => {
  const ui = await render();
  await clickText(ui.container, '+ New automation');
  const dialog = ui.container.querySelector('[role="dialog"]');
  assert.ok(dialog, 'the editor is not a dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const labelledBy = dialog.getAttribute('aria-labelledby');
  assert.ok(labelledBy, 'nothing for a screen reader to announce');
  const heading = [...ui.container.querySelectorAll('[id]')]
    .find((el) => el.id === labelledBy);
  assert.ok(heading, 'aria-labelledby points at nothing');
  assert.equal(heading.textContent, 'New automation');
  ui.unmount();
});

test('every part of a rule is a choice, never a typed code', async () => {
  const ui = await render();
  await clickText(ui.container, '+ New automation');

  const trigger = selects(ui).find((s) => optionsOf(s).includes('A task is completed'));
  assert.ok(trigger, 'no trigger dropdown');
  assert.deepEqual(optionsOf(trigger), [
    'A task is created', 'A task is completed', 'A task becomes overdue',
    'A task is assigned to someone', 'A task is changed', 'Work is logged on a task',
  ]);

  const action = selects(ui).find((s) => optionsOf(s).includes('Create a follow-up task'));
  assert.ok(action, 'no action dropdown');
  assert.deepEqual(optionsOf(action), [
    'Tell someone', 'Assign it to someone', 'Set its priority', 'Move it to a phase',
    'Add a tag', 'Create a follow-up task', 'Send it to a webhook',
  ]);
  ui.unmount();
});

test('the rule is read back as one English sentence before it is saved', async () => {
  const ui = await render();
  await clickText(ui.container, '+ New automation');
  const shown = text(ui.container);
  assert.match(shown, /In other words:/);
  assert.match(shown, /When a task is completed, tell someone/);
  ui.unmount();
});

test('a condition is three dropdowns, each labelled for a screen reader', async () => {
  const ui = await render();
  await clickText(ui.container, '+ New automation');
  await clickText(ui.container, '+ Add a condition');

  const field = selects(ui).find((s) => optionsOf(s).includes('Assigned to'));
  assert.ok(field, 'no condition field dropdown');
  assert.equal(field.getAttribute('aria-label'), 'What to check');

  const operator = selects(ui).find((s) => optionsOf(s).includes('is not'));
  assert.ok(operator, 'no comparison dropdown');
  assert.equal(operator.getAttribute('aria-label'), 'How to compare it');

  assert.match(text(ui.container), /Only when/);
  ui.unmount();
});

test('with no conditions the form says it always runs, rather than leaving a blank', async () => {
  const ui = await render();
  await clickText(ui.container, '+ New automation');
  assert.match(text(ui.container), /Always — add a condition to narrow it down/);
  ui.unmount();
});

test('an unfinished rule cannot be saved, and says what is missing', async () => {
  const ui = await render();
  await clickText(ui.container, '+ New automation');
  const create = [...ui.container.querySelectorAll('button')]
    .find((b) => b.textContent === 'Create it');
  assert.ok(create, 'no create button');
  assert.equal(create.disabled, true, 'an empty rule must not be saveable');
  assert.match(text(ui.container), /Give this rule a name so you can find it later/);
  ui.unmount();
});

test('the ready-made starters open the editor filled in, not a blank form', async () => {
  const ui = await render();
  assert.match(text(ui.container), /Open a follow-up when something is finished/);
  await clickText(ui.container, 'Open a follow-up when something is finished');
  const name = ui.container.querySelector('#au-name');
  assert.equal(name.value, 'Follow up on finished work');
  assert.match(text(ui.container), /create a follow-up task/);
  ui.unmount();
});

// ─── what the rules did, and the notices they raise ─────────────────────────

test('the run log is only subscribed to while it is open', () => {
  assert.match(src, /if \(!showRuns \|\| !workspaceId\) return undefined;/);
});

test('the run log shows the sentence the runner wrote, and is bounded', () => {
  assert.match(src, /\{run\.message\}/);
  assert.match(src, /The last 50 runs\. Kept for 30 days\./);
});

test('"Tell someone" reaches the person told — the panel says where', () => {
  // The notices themselves are the topbar inbox (T-0076); this panel points at
  // it rather than showing a second copy of the same list.
  assert.match(src, /Anyone a rule tells finds it in their inbox/);
  assert.doesNotMatch(src, /Notices for you/);
});

// ─── wiring: the editor and the runner share one vocabulary ─────────────────

test('the editor reads its vocabulary from the module the runner uses', () => {
  assert.match(src, /from '\.\.\/\.\.\/functions\/src\/automations\.js'/,
    'a second copy of the vocabulary would let the form and the rule disagree');
  assert.match(src, /validateRule/);
  assert.match(src, /describeRule/);
});

test('the section is mounted in Settings, for members of the workspace', () => {
  const settings = fs.readFileSync(
    path.join(root, 'src', 'components', 'SettingsView.jsx'), 'utf8');
  assert.match(settings, /<AutomationsSection userId=\{userId\} isAdmin=\{isWorkspaceOwnerOrAdmin\} \/>/);
  assert.match(settings, /\{ id: 'automations', label: 'Automations' \}/);
  assert.match(settings, /myWorkspaceRole === 'owner' \|\| myWorkspaceRole === 'admin'/);
});

test('writing a rule goes through the API from T-0070, not straight at Firestore', () => {
  assert.match(src, /addAutomation\(userId, rule\)/);
  assert.match(src, /updateAutomation\(id, fields\)/);
  assert.match(src, /softDeleteAutomation\(rule\.id\)/);
});

test('an id is never sent back as a field when a rule is updated', () => {
  // updateDoc with an `id` field would write the document id into the document.
  assert.match(src, /const \{ id, \.\.\.fields \} = rule;/);
});

test('the webhook action offers the connections you already have, by name', () => {
  assert.match(src, /need === 'webhook'/);
  assert.match(src, /— choose a connection —/);
  assert.match(src, /You have not set up a connection yet/);
});

test('Settings points from Webhooks at Automations', () => {
  const settings = fs.readFileSync(
    path.join(root, 'src', 'components', 'SettingsView.jsx'), 'utf8');
  assert.match(settings, /use <strong>Automations<\/strong>, below/);
});
