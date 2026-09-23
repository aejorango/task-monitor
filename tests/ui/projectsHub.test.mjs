// T-0153 — the Projects hub, rebuilt to `Projects Explorer.dc.html`.
//
// Portfolio · Timeline · Minutes. The old cross-workspace `portfolio` page and
// the `archive` page were deleted, the Projects page took the name Portfolio,
// and a project Timeline was added.
//
// These guards exist for the three things that go wrong quietly: a tab left
// pointing at a deleted page, a "removal" that strands a capability, and a
// chart that invents a number the data cannot support.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  UNITS, barOf, pctOf, phaseMarksOf, rulerColumns, spanOfProject, timelineRange,
} from '../../src/services/projectTimeline.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'App.css');
const app = read('src', 'App.jsx');

/* ── the hub ────────────────────────────────────────────────────────────── */

test('the Projects hub is Portfolio · Timeline · Minutes', async () => {
  const { HUBS, tabsForView } = await import('../../src/services/views.js');
  const hub = HUBS.find((h) => h.id === 'projects');
  assert.deepEqual(hub.tabs.map((t) => t.view), ['projects', 'timeline', 'minutes']);
  assert.deepEqual(tabsForView('projects').map((t) => t.label), ['Portfolio', 'Timeline', 'Minutes']);
});

test('the Projects page is CALLED Portfolio, everywhere the name is read', async () => {
  const { VIEW_REGISTRY } = await import('../../src/services/views.js');
  assert.equal(VIEW_REGISTRY.find((v) => v.id === 'projects')?.label, 'Portfolio');
  // …and ⌘K still finds it under both words, because people will type either.
  const words = VIEW_REGISTRY.find((v) => v.id === 'projects')?.words || [];
  assert.ok(words.includes('projects') && words.includes('portfolio'));
});

test('the deleted pages are gone from the registry, the routes and the disk', async () => {
  const { VIEW_REGISTRY } = await import('../../src/services/views.js');
  for (const view of ['portfolio', 'archive']) {
    assert.ok(!VIEW_REGISTRY.some((v) => v.id === view), `${view} is still in the registry`);
    assert.ok(!app.includes(`route.view === '${view}'`), `${view} still has a route`);
  }
  for (const file of ['PortfolioView.jsx', 'ArchiveView.jsx']) {
    assert.ok(!fs.existsSync(path.join(root, 'src', 'components', file)), `${file} is still on disk`);
  }
});

test('deleting Archive stranded nothing — the Portfolio still lists archived projects', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.match(view, /projects\.filter\(\(p\) => p\.archived && !p\.deleted\)/,
    'archived projects must still have somewhere to be seen');
  assert.match(view, /archivedProjects\.length > 0 &&/);
});

test('the Portfolio opens grouped by segment, not by health', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.match(view, /useState\('segment'\)/,
    'segment is what somebody decided the project IS; health changes week to week');
  assert.match(view, /'segment' \| 'health'/, 'and the other grouping is still there');
});

/* ── the Timeline's arithmetic ──────────────────────────────────────────── */

const task = (s, e, phaseId) => ({ plan: { startDate: s, endDate: e }, phaseId });

test('a project with no dated task has no span, and says so rather than guessing', () => {
  assert.equal(spanOfProject([{ plan: {}, actual: {} }]), null);
  assert.equal(spanOfProject([]), null);
  assert.match(read('src', 'components', 'TimelineView.jsx'), /nothing in this project has a date yet/);
});

test('a span reaches from the earliest date to the latest, plan or actual', () => {
  assert.deepEqual(
    spanOfProject([task('2026-07-05', '2026-07-10'), { actual: { startDate: '2026-07-01', endDate: '2026-07-20' } }]),
    { start: '2026-07-01', end: '2026-07-20' },
  );
});

test('the window always contains today, or the Today line is off the chart', () => {
  const r = timelineRange([{ start: '2026-01-01', end: '2026-01-20' }], '2026-06-15');
  const at = pctOf('2026-06-15', r);
  assert.ok(at >= 0 && at <= 100, `today fell outside the window at ${at}%`);
});

test('a bar is clamped into the window, so it never paints over the labels', () => {
  const range = timelineRange([{ start: '2026-07-01', end: '2026-07-31' }], '2026-07-15');
  const bar = barOf({ start: '2020-01-01', end: '2030-01-01' }, range);
  assert.ok(bar.left >= 0, 'a negative left is the bug the Gantt had in T-0145');
  assert.ok(bar.left + bar.width <= 100.01);
});

test('nothing at all still yields no window rather than a divide by zero', () => {
  assert.equal(timelineRange([], null), null);
  assert.deepEqual(rulerColumns(null, 'month'), []);
});

test('the ruler is labelled from the window, never from a fixed list', () => {
  const range = timelineRange([{ start: '2026-07-01', end: '2026-08-26' }], '2026-07-15');
  const cols = rulerColumns(range, 'month');
  assert.equal(cols.length, 8);
  assert.ok(cols.every((c) => /[A-Z][a-z]{2}/.test(c.label)), 'a hard-coded ruler lies in another month');
  assert.equal(rulerColumns(range, 'quarter').length, 8);
  assert.deepEqual(UNITS.map((u) => u.id), ['month', 'quarter']);
});

test('a diamond is a real phase end, not an invented milestone', () => {
  const range = timelineRange([{ start: '2026-07-01', end: '2026-07-31' }], '2026-07-15');
  const project = { phases: [{ id: 'a', name: 'Discovery', order: 0 }, { id: 'b', name: 'Build', order: 1 }] };
  const marks = phaseMarksOf(project, [task('2026-07-01', '2026-07-10', 'a'), task('2026-07-11', '2026-07-28', 'b')], range);
  assert.deepEqual(marks.map((m) => m.date), ['2026-07-10', '2026-07-28']);
  // A phase nobody has dated gets no diamond, rather than one at zero.
  assert.deepEqual(phaseMarksOf(project, [{ phaseId: 'a', plan: {} }], range), []);
  assert.match(read('src', 'components', 'TimelineView.jsx'), /◆ Phase end/,
    'and the legend must call it what it is');
});

test('the Timeline is one row per PROJECT, and is registered like any page', async () => {
  const { VIEW_REGISTRY, hubForView } = await import('../../src/services/views.js');
  assert.ok(VIEW_REGISTRY.some((v) => v.id === 'timeline' && v.label === 'Timeline'));
  assert.equal(hubForView('timeline')?.id, 'projects');
  assert.match(app, /const TimelineView\s+= lazy\(\(\) => import\('\.\/components\/TimelineView'\)\)/);
  assert.match(app, /route\.view === 'timeline'/);
  assert.match(css, /\.ptl-row \{[\s\S]*?height: 54px/, "the mockup's own row height");
  assert.match(css, /\.ptl-ruler \{ display: grid; grid-template-columns: 186px/, "and its 186px gutter");
});

/* ── the editor ─────────────────────────────────────────────────────────── */

test('the editor leads with the mockup’s colour tile, not a dot', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.match(view, /className="pe-icon"/);
  assert.doesNotMatch(view, /className="pe-name-dot"/,
    'the PROJECT editor leads with the tile now');
  // The TASK editor used to share this hero and keep the dot. T-0160 ported it
  // to the Board Explorer's own modal, which leads with the mockup's square
  // kind chip instead — so the dot is gone from there, and the rule below is
  // now only about the PROJECT editor. `.pe-name-dot` itself stays: ProjectsView
  // still draws it.
  assert.doesNotMatch(read('src', 'components', 'TaskEditor.jsx'), /className="pe-name-dot"/,
    'the ported task editor leads with .te-kind, not the old hero dot');
  assert.match(read('src', 'components', 'TaskEditor.jsx'), /className="te-kind"/);
  assert.match(css, /\.pe-name-dot \{ width: 14px/);
  assert.match(css, /\.pe-icon \{[\s\S]*?width: 44px; height: 44px/);
  assert.match(css, /\.pe-icon \{[\s\S]*?border-radius: 13px/);
});

test('Pace puts the work done and the schedule gone on ONE track', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.match(view, /className="pe-pace-bar"/,   'the bar is completion');
  assert.match(view, /className="pe-pace-notch"/, 'the notch is the schedule');
  assert.match(view, /pts behind schedule/);
  assert.match(view, /pts ahead/);
  // Drawn only when there is a schedule to measure against.
  assert.match(view, /!isNew && health\.schedulePct !== null && \(/,
    'a notch with no dates behind it is decoration');
});

test('text on a tinted KPI card is the ink token, never the fill', () => {
  // The card became a tint in T-0153; #e74c3c on #fee8e6 is the exact pair
  // the ink tokens exist to prevent.
  assert.match(css, /\.pe-tone-red\s+\{[^}]*--pe-fg: var\(--c-danger-ink\)/);
  assert.match(css, /\.pe-tone-green \{[^}]*--pe-fg: var\(--c-success-ink\)/);
  assert.match(css, /\.pe-tone-amber \{[^}]*--pe-fg: var\(--c-accent-ink\)/);
});

/* ── the Kanban's breathing room ────────────────────────────────────────── */

test('the Kanban column headers are separated from the first band', () => {
  assert.match(css, /\.bx-cols \+ \.bx-band \{ margin-top: 20px; \}/,
    'without the break the header row and the first band read as one block');
});
