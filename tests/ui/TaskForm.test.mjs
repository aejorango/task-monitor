// T-0012 / BUG-005 — Settings → Defaults → "Default project for quick-add"
// must actually preselect that project in the Board's quick-add row.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

setupDom();
const { default: TaskForm } = await import('../../src/components/TaskForm.jsx');
const { useSettings } = await import('../../src/hooks/useSettings.js');

const h = React.createElement;
const PROJECTS = [
  { id: 'p1', name: 'SBLAF rollout', phases: [] },
  { id: 'p2', name: 'Website revamp', phases: [] },
  { id: 'p3', name: 'Personal', phases: [] },
];

// The hook keeps module-level state; drive it the way the Settings page does.
function setDefaultProject(id) {
  const calls = [];
  function Probe() { calls.push(useSettings()); return null; }
  return { Probe, calls, id };
}

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });
beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

/** The project dropdown is the only select with project names in it. */
function projectSelect(container) {
  return [...container.querySelectorAll('select')]
    .find((sel) => [...sel.options].some((o) => o.textContent.includes('SBLAF')));
}

async function mountForm({ projectFilter = 'all', defaultProject = null } = {}) {
  const probe = setDefaultProject(defaultProject);
  const ui = await mount(h(React.Fragment, null,
    h(probe.Probe),
    h(TaskForm, { projects: PROJECTS, projectFilter }),
  ));
  if (defaultProject !== null) {
    const { act } = await import('react');
    await act(async () => { probe.calls.at(-1).update({ defaultProject }); });
  }
  return ui;
}

test('with no default set, the first project is preselected', async () => {
  const ui = await mountForm();
  assert.equal(projectSelect(ui.container).value, 'p1');
  ui.unmount();
});

test('the Settings default is preselected on the Board with All projects', async () => {
  const ui = await mountForm({ defaultProject: 'p3' });
  assert.equal(projectSelect(ui.container).value, 'p3',
    'Settings → Defaults → Default project for quick-add must be honoured');
  ui.unmount();
});

test('a Board filtered to one project wins over the saved default', async () => {
  const ui = await mountForm({ projectFilter: 'p2', defaultProject: 'p3' });
  assert.equal(projectSelect(ui.container).value, 'p2');
  ui.unmount();
});

test('a default pointing at a project that no longer exists falls back', async () => {
  const ui = await mountForm({ defaultProject: 'deleted-project' });
  assert.equal(projectSelect(ui.container).value, 'p1');
  ui.unmount();
});

test('the dropdown is never left blank on first paint', async () => {
  const ui = await mountForm({ defaultProject: 'p2' });
  const sel = projectSelect(ui.container);
  assert.notEqual(sel.value, '');
  assert.ok([...sel.options].some((o) => o.value === sel.value));
  ui.unmount();
});
