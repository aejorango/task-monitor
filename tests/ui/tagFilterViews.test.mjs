// T-0103 / BUG-018 — a saved view's tag filter, on the Gantt and the Activity Log.
//
//   1. Given a saved view with tagFilter=client pointing at the Gantt page
//   2. When the user opens it from the sidebar
//   3. Then only tasks carrying #client are on the chart and a clearable
//      "#client" chip is visible
//
// The arithmetic is in src/services/tagFilter.test.mjs. This renders the real
// pages and the real chip strip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();

const { default: TagFilterBar } = await import('../../src/components/TagFilterBar.jsx');
const { tagFilterState } = await import('../../src/services/tagFilter.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const TASKS = [
  { id: 't1', title: 'Client kickoff', tags: ['client'], plan: { endDate: '2026-09-25' } },
  { id: 't2', title: 'Fix the build', tags: ['internal'], plan: { endDate: '2026-09-26' } },
];

const chips = (ui) => [...ui.container.querySelectorAll('.tag-filter-bar .chip')]
  .map((b) => b.textContent.trim());
const activeChip = (ui) => ui.container.querySelector('.tag-filter-bar .chip.active')?.textContent.trim();

// ─── the strip itself ───────────────────────────────────────────────────────

test('the strip offers every tag, with All selected when nothing is filtering', async () => {
  const ui = await mount(h(TagFilterBar, { state: tagFilterState(TASKS, null), onChange() {} }));
  assert.deepEqual(chips(ui), ['All', '#client', '#internal']);
  assert.equal(activeChip(ui), 'All');
  ui.unmount();
});

test('the filtered tag is the one shown as selected — the chip is visible', async () => {
  const ui = await mount(h(TagFilterBar, { state: tagFilterState(TASKS, 'client'), onChange() {} }));
  assert.equal(activeChip(ui), '#client', 'the acceptance criterion: a visible #client chip');
  ui.unmount();
});

test('clicking the selected chip clears the filter', async () => {
  const calls = [];
  const ui = await mount(h(TagFilterBar, {
    state: tagFilterState(TASKS, 'client'), onChange: (t) => calls.push(t),
  }));
  const chip = [...ui.container.querySelectorAll('.chip')].find((b) => b.textContent.trim() === '#client');
  await act(async () => { chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  assert.deepEqual(calls, [null], 'the acceptance criterion: clearable');
  ui.unmount();
});

test('All clears it too', async () => {
  const calls = [];
  const ui = await mount(h(TagFilterBar, {
    state: tagFilterState(TASKS, 'client'), onChange: (t) => calls.push(t),
  }));
  const all = [...ui.container.querySelectorAll('.chip')].find((b) => b.textContent.trim() === 'All');
  await act(async () => { all.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  assert.deepEqual(calls, [null]);
  ui.unmount();
});

test('a saved view naming a tag nothing here carries still shows its chip', async () => {
  const ui = await mount(h(TagFilterBar, { state: tagFilterState(TASKS, 'renamed'), onChange() {} }));
  assert.equal(activeChip(ui), '#renamed', 'otherwise the page is empty for no visible reason');
  assert.match(ui.container.textContent, /Nothing here carries #renamed/);
  ui.unmount();
});

test('the chips say which one is pressed, for a screen reader', async () => {
  const ui = await mount(h(TagFilterBar, { state: tagFilterState(TASKS, 'client'), onChange() {} }));
  const pressed = [...ui.container.querySelectorAll('.chip')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent.trim());
  assert.deepEqual(pressed, ['#client']);
  ui.unmount();
});

test('no tags and no filter means no strip at all', async () => {
  const ui = await mount(h(TagFilterBar, { state: tagFilterState([{ id: 'x' }], null), onChange() {} }));
  assert.equal(ui.container.querySelector('.tag-filter-bar'), null, 'an empty row helps nobody');
  ui.unmount();
});

// ─── the pages honour the prop ──────────────────────────────────────────────

test('the Gantt declares and applies the prop the router passes it', () => {
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /export default function GanttView\(\{ projectFilter, initialTagFilter \}\)/,
    'the prop was passed and never declared — that is the whole bug');
  assert.match(src, /useState\(initialTagFilter \|\| null\)/);
  assert.match(src, /useEffect\(\(\) => \{ setTagFilter\(initialTagFilter \|\| null\); \}, \[initialTagFilter\]\);/,
    'opening a second saved view must re-apply, not keep the first one');
  assert.match(src, /const rows = tagState\.filtered;/, 'the chart must actually be filtered');
  assert.match(src, /<TagFilterBar state=\{tagState\} onChange=\{setTagFilter\} \/>/);
});

test('the Activity Log declares and applies it too, through its tasks', () => {
  const src = read('src', 'components', 'TableView.jsx');
  assert.match(src, /export default function TableView\(\{ projectFilter, initialTagFilter \}\)/);
  assert.match(src, /tagFilterState\(inProject, tagFilter, \{ taskById \}\)/,
    'an activity has no tags of its own');
  assert.match(src, /const filtered = tagState\.filtered;/);
  assert.match(src, /<TagFilterBar state=\{tagState\} onChange=\{setTagFilter\} \/>/);
});

test('every page the router hands initialTagFilter to declares it', () => {
  const app = read('src', 'App.jsx');
  const receivers = [...app.matchAll(/<(\w+)[^>]*initialTagFilter=/g)].map((m) => m[1]);
  assert.ok(receivers.length >= 4, `expected the four filterable views, saw ${receivers}`);

  const orphans = receivers.filter((name) => {
    const src = read('src', 'components', `${name}.jsx`);
    return !src.includes('initialTagFilter');
  });
  assert.deepEqual(orphans, [],
    'nothing fails when a prop is simply unused — which is why this guard exists');
});

test('an empty page explains the filter rather than looking broken', () => {
  const gantt = read('src', 'components', 'GanttView.jsx');
  assert.match(gantt, /No scheduled tasks carry #\{tagState\.active\}/);
  assert.match(gantt, /Clear the tag filter/);

  const table = read('src', 'components', 'TableView.jsx');
  assert.match(table, /No activities against tasks tagged #\{tagState\.active\}/);
  assert.match(table, /takes its tags from the task it was logged against/,
    'the one thing a user would not guess');
});

test('there is one chip strip, not three', () => {
  for (const name of ['Board.jsx', 'GanttView.jsx', 'TableView.jsx']) {
    const src = read('src', 'components', name);
    assert.match(src, /<TagFilterBar /, `${name} must use the shared strip`);
    assert.doesNotMatch(src, /<div className="tag-filter-bar">/,
      `${name} must not hand-roll its own`);
  }
});
