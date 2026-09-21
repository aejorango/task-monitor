// T-0099 / BUG-017 — what the user typed has to survive the trip.
//
//   1. Given the user runs "new project Website revamp" from ⌘K
//   2. When the editor opens
//   3. Then its name field already reads "Website revamp"
//
// The palette shows the name in its hint and then handed it to a listener that
// threw it away: ProjectsView, MinutesView and GoalsView all declared a
// zero-argument callback. This file holds the shared mechanism; the pages are
// T-0100.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

setupDom();

const { newSeed, useSeededField, useQuickCreate, requestQuickCreate } =
  await import('../../src/hooks/useQuickCreate.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

// ─── the seed itself ────────────────────────────────────────────────────────

test('a seed carries the text and a moment, so the same words can arrive twice', () => {
  const a = newSeed('Website revamp');
  assert.equal(a.text, 'Website revamp');
  assert.ok(a.at > 0);
  assert.notEqual(newSeed('Website revamp'), a, 'a new object every time, deliberately');
});

test('an empty ask is still a seed, not a crash', () => {
  assert.equal(newSeed().text, '');
  assert.equal(newSeed(null).text, '');
  assert.equal(newSeed(undefined).text, '');
});

// ─── applying it ────────────────────────────────────────────────────────────

/** A create form, shaped like the three real ones. */
function Form({ seed }) {
  const [name, setName] = React.useState('');
  useSeededField(seed, setName);
  return h('input', { 'aria-label': 'Name', value: name, onChange: (e) => setName(e.target.value) });
}

const valueOf = (ui) => ui.container.querySelector('input').value;

test('the field is filled the moment the seed arrives', async () => {
  const ui = await mount(h(Form, { seed: null }));
  assert.equal(valueOf(ui), '');
  await ui.render(h(Form, { seed: newSeed('Website revamp') }));
  assert.equal(valueOf(ui), 'Website revamp');
  ui.unmount();
});

test('asking twice with the same words refills it', async () => {
  const ui = await mount(h(Form, { seed: newSeed('Website revamp') }));
  const input = ui.container.querySelector('input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set;
    setter.call(input, 'something else');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(valueOf(ui), 'something else');

  await ui.render(h(Form, { seed: newSeed('Website revamp') }));
  assert.equal(valueOf(ui), 'Website revamp', 'the `at` stamp is what makes this work');
  ui.unmount();
});

test('a re-render with the SAME seed does not undo what the user typed since', async () => {
  const seed = newSeed('Website revamp');
  const ui = await mount(h(Form, { seed }));
  const input = ui.container.querySelector('input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set;
    setter.call(input, 'Website revamp 2026');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  await ui.render(h(Form, { seed }));
  assert.equal(valueOf(ui), 'Website revamp 2026', 'a seed is applied once, not on every render');
  ui.unmount();
});

test('no seed at all leaves the field alone', async () => {
  const ui = await mount(h(Form, { seed: null }));
  await ui.render(h(Form, { seed: null }));
  assert.equal(valueOf(ui), '');
  ui.unmount();
});

// ─── end to end through the event ───────────────────────────────────────────

function Page({ entity }) {
  const [seed, setSeed] = React.useState(null);
  useQuickCreate(entity, React.useCallback((text) => setSeed(newSeed(text)), []));
  return seed ? h(Form, { seed }) : h('span', null, 'closed');
}

test('the typed name reaches the form through the real event', async () => {
  const ui = await mount(h(Page, { entity: 'project' }));
  await act(async () => { requestQuickCreate('project', 'Website revamp'); });
  assert.equal(valueOf(ui), 'Website revamp');
  ui.unmount();
});

test('a request for another entity is ignored', async () => {
  const ui = await mount(h(Page, { entity: 'project' }));
  await act(async () => { requestQuickCreate('goal', 'Ship v1'); });
  assert.match(ui.container.textContent, /closed/);
  ui.unmount();
});

// ─── and the mechanism is written once ──────────────────────────────────────

test('nobody builds a seed by hand', () => {
  const dir = path.join(root, 'src');
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(e.name) || full.endsWith('useQuickCreate.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      if (/\{\s*text[,:][^}]*at:\s*Date\.now\(\)/.test(src)) offenders.push(path.relative(root, full));
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], 'use newSeed(text)');
});

test('the Board still seeds its quick-add box', () => {
  assert.match(read('src', 'components', 'Board.jsx'), /setQuickAddSeed\(newSeed\(text\)\)/);
  assert.match(read('src', 'components', 'TaskForm.jsx'), /useSeededField\(seed,/);
});
test('every quick-create listener actually takes the text', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))) {
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of src.matchAll(/useQuickCreate\('([a-z]+)',\s*useCallback\((\([^)]*\))\s*=>/g)) {
      // 'activity' has nothing to prefill — a picker, not a form.
      if (m[1] === 'activity') continue;
      if (m[2] === '()') offenders.push(`${name}: ${m[1]} throws the text away`);
    }
  }
  assert.deepEqual(offenders, [],
    'the palette shows the name in its hint; opening a blank form makes that a lie');
});


// ─── T-0100: the three pages that threw it away ─────────────────────────────

for (const [file, entity, prop, seedState] of [
  ['ProjectsView.jsx', 'project', 'nameSeed', 'setNameSeed'],
  ['MinutesView.jsx', 'minute', 'titleSeed', 'setTitleSeed'],
  ['GoalsView.jsx', 'goal', 'titleSeed', 'setTitleSeed'],
]) {
  test(`${file} carries the typed name into its editor`, () => {
    const src = read('src', 'components', file);
    assert.ok(src.includes(`useQuickCreate('${entity}', useCallback((text)`),
      'the listener must take the text, not throw it away');
    assert.ok(src.includes(`${seedState}(text ? newSeed(text) : null)`),
      'an empty ask must open a blank form, not seed it with ""');
    assert.ok(src.includes(`${prop}={editing === 'new' ? ${prop} : null}`),
      'only a NEW one is seeded — editing an existing one must never be overwritten');
    assert.match(src, /useSeededField\(/, 'the editor must apply it');
    assert.ok(src.includes(`setEditing(null); ${seedState}(null);`),
      'closing must clear the seed, or reopening refills it');
  });
}

// ─── the real editors, rendered ─────────────────────────────────────────────

const { default: ProjectsView } = await import('../../src/components/ProjectsView.jsx');
const { default: MinutesView } = await import('../../src/components/MinutesView.jsx');
const { default: GoalsView } = await import('../../src/components/GoalsView.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');
const { DialogProvider } = await import('../../src/components/Dialog.jsx');

const page = (View, props = {}) => mount(
  h(ToastProvider, null, h(DialogProvider, null, h(View, props))),
);

/** The field the seed goes into. Not simply "the first input": the goal
 *  editor's first field is its short code, and seeding THAT would be wrong. */
const seededInput = (ui, placeholder) => {
  const dialog = ui.container.querySelector('[role="dialog"]');
  if (!dialog) return null;
  return dialog.querySelector(`input[placeholder="${placeholder}"]`);
};

// Placeholder identifies the field on purpose: it is what the user sees, and
// it moves only when somebody deliberately changes the form.
const PAGES = [
  ['the project editor', ProjectsView, 'project', 'Website revamp', 'Untitled project'],
  ['the minutes editor', MinutesView, 'minute', 'Weekly stand-up', 'e.g. Weekly sync — Data Governance'],
  ['the goal editor', GoalsView, 'goal', 'Ship v1 by December', 'Enabling Data Driven Decisions'],
];

for (const [name, View, entity, typed, placeholder] of PAGES) {
  test(`${name} opens with the name already typed`, async () => {
    const ui = await page(View);
    await act(async () => { requestQuickCreate(entity, typed); });

    const input = seededInput(ui, placeholder);
    assert.ok(input, `${name} did not open, or its name field moved`);
    assert.equal(input.value, typed,
      'the palette promised this name in its hint; a blank field makes that a lie');
    ui.unmount();
  });

  test(`${name} still opens blank when nothing was typed`, async () => {
    const ui = await page(View);
    await act(async () => { requestQuickCreate(entity, ''); });

    const input = seededInput(ui, placeholder);
    assert.ok(input, `${name} did not open, or its name field moved`);
    assert.equal(input.value, '', 'a bare "new project" must not seed an empty string over anything');
    ui.unmount();
  });
}

// ─── T-0101: the docs carry it too ──────────────────────────────────────────

test('CLAUDE.md records the trap', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /useQuickCreate` listener that ignores its argument/);
  assert.match(claude, /newSeed\(\)/);
});

test('the README lists the new suite', () => {
  assert.match(read('README.md'), /tests\/ui\/quickCreateSeed\.test\.mjs/);
});

test('the changelog records both halves of the fix', () => {
  const log = read('CHANGELOG.md');
  assert.match(log, /T-0099 — Quick create drops the name/);
  assert.match(log, /T-0100 — Quick create drops the name/);
});
