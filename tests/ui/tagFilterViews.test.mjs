// T-0103 / BUG-018 / T-0148 — a saved view's tag filter, now that the chip
// strip is gone.
//
// The STRIP was removed from every page in T-0148 (Ace asked for it). The
// FILTER was not: a saved view still carries `tagFilter`, the router still
// hands it down as `initialTagFilter`, and every page that receives it must
// still apply it. What changed is how a reader finds out — the page names the
// active tag in its subtitle and offers a way out, instead of drawing a row
// of chips.
//
// That distinction is the whole point of this suite. "Removed the strip" and
// "quietly stopped filtering" look identical in a screenshot, and the second
// makes one saved view mean two different things depending on which page it
// opens.
//
// The arithmetic is in src/services/tagFilter.test.mjs; this one reads the
// real pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// Every page the router can hand a tag to.
const FILTERABLE = ['Board.jsx', 'GanttView.jsx', 'CalendarView.jsx', 'TableView.jsx'];

// ─── the strip is gone, everywhere ──────────────────────────────────────────

test('no page renders a tag chip strip any more', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => /<TagFilterBar/.test(read('src', 'components', f)));
  assert.deepEqual(offenders, [],
    'the tag strip was removed from every page in T-0148');
});

test('and nobody hand-rolled a replacement', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => /className="tag-filter-bar"/.test(read('src', 'components', f)));
  assert.deepEqual(offenders, [],
    'a page growing its own chip strip is how the three copies started');
});

test('the component itself is gone, not merely unmounted', () => {
  assert.equal(fs.existsSync(path.join(root, 'src', 'components', 'TagFilterBar.jsx')), false,
    'an unmounted component is dead code that still has to be maintained');
  assert.equal(fs.existsSync(path.join(root, 'dev', 'tag-filter.html')), false);
});

// ─── but the filter still works, and still says so ──────────────────────────

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

test('a filter with no chip is still NAMED, on every page that can carry one', () => {
  for (const name of FILTERABLE) {
    const src = read('src', 'components', name);
    assert.match(src, /Filtered to <strong>#\{tagState\.active\}<\/strong>/,
      `${name}: a filter nobody can see is a silent one`);
  }
});

test('…and clearable, or it is a trap', () => {
  for (const name of FILTERABLE) {
    const src = read('src', 'components', name);
    assert.match(src, /show all<\/button>/,
      `${name}: there must be a way back to everything`);
  }
});

test('the Gantt still filters the rows it draws', () => {
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /export default function GanttView\(\{ projectFilter, initialTagFilter, route = \{\} \}\)/,
    'the prop was passed and never declared — that is the whole bug');
  assert.match(src, /useState\(initialTagFilter \|\| null\)/);
  assert.match(src, /useEffect\(\(\) => \{ setTagFilter\(initialTagFilter \|\| null\); \}, \[initialTagFilter\]\);/,
    'opening a second saved view must re-apply, not keep the first one');
  assert.match(src, /const rows = tagState\.filtered;/, 'the chart must actually be filtered');
});

test('the Activity Log borrows its tags from the task, and applies them', () => {
  const src = read('src', 'components', 'TableView.jsx');
  assert.match(src, /export default function TableView\(\{ projectFilter, initialTagFilter \}\)/);
  assert.match(src, /tagFilterState\(inProject, tagFilter, \{ taskById \}\)/,
    'an activity has no tags of its own');
  assert.match(src, /const filtered = tagState\.filtered;/);
});

test('an empty page explains the filter rather than looking broken', () => {
  const gantt = read('src', 'components', 'GanttView.jsx');
  // The chart's empty state keeps the period switch, because a window that is
  // too narrow is the usual reason it is empty.
  assert.match(gantt, /<PeriodSwitch/);
  assert.match(gantt, /Widen the date range/);

  const table = read('src', 'components', 'TableView.jsx');
  assert.match(table, /No activities against tasks tagged #\{tagState\.active\}/);
  assert.match(table, /takes its tags from the task it was logged against/,
    'the one thing a user would not guess');
});

// ─── the docs carry it too ──────────────────────────────────────────────────

test('CLAUDE.md records the trap and the activity subtlety', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /Passing a filter prop the receiving view never declares/);
  assert.match(claude, /activity has no tags of its own/);
  assert.match(claude, /tagFilter\.js/, 'the module belongs in the file map');
});

test('the changelog records both halves of the fix', () => {
  const log = read('CHANGELOG.md');
  assert.match(log, /T-0102 — Saved view's tag filter/);
  assert.match(log, /T-0103 — Saved view's tag filter/);
});
