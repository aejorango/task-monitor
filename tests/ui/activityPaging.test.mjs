// T-0038 / IMP-003 — the list views must page, not hold everything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, clickText, muteConsoleError } from './dom.mjs';

setupDom();
const { useAllActivities } = await import('../../src/hooks/useTasks.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

test('useAllActivities exposes a paging API, not just a list', async () => {
  const seen = [];
  function Probe() { seen.push(useAllActivities()); return null; }
  const ui = await mount(h(Probe));
  const api = seen.at(-1);
  assert.equal(typeof api.loadMore, 'function');
  assert.equal(typeof api.hasMore, 'boolean');
  assert.equal(typeof api.loadingMore, 'boolean');
  assert.ok(Array.isArray(api.activities));
  ui.unmount();
});

test('with no data there is nothing more to load', async () => {
  const seen = [];
  function Probe() { seen.push(useAllActivities()); return null; }
  const ui = await mount(h(Probe));
  assert.equal(seen.at(-1).hasMore, false,
    'a half-empty first page IS the end — offering "Load more" there is a lie');
  ui.unmount();
});

test('loadMore is safe to call when there is nothing to load', async () => {
  const seen = [];
  function Probe() { seen.push(useAllActivities()); return null; }
  const ui = await mount(h(Probe));
  await assert.doesNotReject(() => seen.at(-1).loadMore());
  ui.unmount();
});

// ─── the two views that use it ──────────────────────────────────────────────

for (const [name, file, label] of [
  ['Activity table', 'TableView.jsx', 'Load older activities'],
  ['Work Performed', 'WorkPerformedView.jsx', 'Load older work'],
]) {
  test(`${name} offers "${label}" and wires it to the hook`, () => {
    const src = fs.readFileSync(path.join(root, 'src', 'components', file), 'utf8');
    assert.match(src, /loadMore, hasMore, loadingMore/, `${name} must take the paging API`);
    assert.match(src, new RegExp(label), `${name} must offer the button`);
    assert.match(src, /onClick=\{loadMore\}/);
    assert.match(src, /disabled=\{loadingMore\}/, 'and not allow double-clicking it');
  });

  test(`${name} hides the button when there is nothing older`, () => {
    const src = fs.readFileSync(path.join(root, 'src', 'components', file), 'utf8');
    assert.match(src, /\{hasMore && \(/);
  });
}

test('the paging copy explains itself without jargon', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TableView.jsx'), 'utf8');
  const block = src.slice(src.indexOf('load-more-row'), src.indexOf('load-more-row') + 700);
  assert.match(block, /Older entries load on request/);
  assert.doesNotMatch(block, /cursor|pagination|limit\(|query/i);
});

test('switching workspace drops the pages fetched for the previous one', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'hooks', 'useTasks.js'), 'utf8');
  const hook = src.slice(src.indexOf('export function useAllActivities'));
  assert.match(hook, /seenWorkspace/, 'otherwise another workspace’s history bleeds in');
  assert.doesNotMatch(hook, /seenWorkspace\.current/, 'refs must not be read during render');
  assert.match(hook, /setOlderActivities\(\[\]\)/);
});

test('the merged list stays newest-first after pages are appended', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'hooks', 'useTasks.js'), 'utf8');
  const hook = src.slice(src.indexOf('export function useAllActivities'));
  assert.match(hook, /\.sort\(\(a, b\) => String\(b\.date/);
});
