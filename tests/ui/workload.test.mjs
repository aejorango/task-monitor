// T-0079 / NEW-005 / T-0150 — Board → Workload.
//
// T-0150 rebuilt this page to `Board Explorer.dc.html`: it is now ONE panel —
// a person per row, a bar segmented by project, a cap notch and the hours.
// The people × six-weeks drag-to-rebalance grid that used to sit under it was
// removed on request.
//
// These guards are mostly about that removal, because "the grid is gone" and
// "the grid's arithmetic quietly broke" look identical from the outside, and
// because deleting a capability without re-homing it is the one thing the
// porting playbook forbids.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();

const { default: WorkloadView } = await import('../../src/components/WorkloadView.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');
const { cellId, parseCellId, describeMove, taskHours, DEFAULT_CAPACITY_HOURS } =
  await import('../../src/services/workload.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const view = read('src', 'components', 'WorkloadView.jsx');
const css = read('src', 'App.css');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const render = (props = {}) => mount(h(ToastProvider, null, h(WorkloadView, props)));

// ─── the panel, to the mockup ───────────────────────────────────────────────

test('the panel is the mockup’s, to the pixel', () => {
  assert.match(css, /\.wl-card \{[\s\S]*?padding: 18px 20px/);
  assert.match(css, /\.wl-card \{[\s\S]*?border-radius: 16px/);
  assert.match(css, /\.wl-rows \{[\s\S]*?gap: 15px/);
  assert.match(css, /\.wl-name \{ width: 104px/,       'the mockup’s own 104px');
  assert.match(css, /\.wl-person \{[\s\S]*?font-size: 12\.5px; font-weight: 700/);
  assert.match(css, /\.wl-count \{[\s\S]*?font-size: 10\.5px/);
  assert.match(css, /\.wl-track \{[\s\S]*?height: 16px; border-radius: 6px/);
  assert.match(css, /\.wl-notch \{[\s\S]*?width: 2px/);
  assert.match(css, /\.wl-hours \{[\s\S]*?font-size: 11\.5px; font-weight: 800/);
  assert.match(css, /\.wl-leg-dot \{ width: 9px; height: 9px; border-radius: 3px/);
});

test('a bar is segmented by project and measured against a real cap', () => {
  assert.match(view, /className="wl-seg"/);
  assert.match(view, /width: `\$\{\(sg\.h \/ load\.widest\) \* 100\}%`/);
  assert.match(view, /capPct: \(DEFAULT_CAPACITY_HOURS \/ widest\) \* 100/);
  assert.match(view, /Math\.max\(DEFAULT_CAPACITY_HOURS \* 1\.25/,
    'the notch must stay inside the track, and an over-cap bar needs somewhere to go');
});

test('the legend names every project on screen, and the cap line', () => {
  assert.match(view, /className="wl-leg-dot"/);
  assert.match(view, /className="wl-leg-line"/);
  assert.match(view, /\{DEFAULT_CAPACITY_HOURS\}h cap/);
});

// ─── honesty ────────────────────────────────────────────────────────────────

test('the page never lets an assumed hour pass as a measured one', () => {
  // A full bar the reader believes is measured, when half of it was a 4h
  // fallback, is the oldest trap on this page.
  assert.match(view, /if \(t\.estimateHours == null\) guessed \+= 1/);
  assert.match(view, /\{p\.guessed\} assumed<\/span>/,     'each row says how many');
  assert.match(view, /className="wl-assumed"/,
    'and it sits OUTSIDE the 104px name column, which truncates');
  assert.match(view, /HOURS_PER_TASK/);
  assert.match(view, /a full bar built out of assumptions is worse than no bar/);
});

test('the bar counts open work whether or not it has a date', () => {
  // With the weeks grid gone there is no date window, so an undated task is
  // no longer invisible here — which is why the "no due date" rail could go.
  assert.match(view, /const open = visible\.filter\(\(t\) => t\.status !== 'done'\)/);
  assert.doesNotMatch(view, /plan\?\.endDate/, 'no date filter belongs in this sum');
});

test('a person with nothing open is left out, not drawn as an empty row', () => {
  assert.match(view, /\.filter\(\(p\) => p\.open > 0\)/);
});

// ─── what a row does ────────────────────────────────────────────────────────

test('a row filters the whole Board hub to that person', () => {
  // The mockup's row is not a control. Making it one re-homes the grid's
  // "look at just this person" without adding anything the mockup lacks:
  // ?who= is the route the Board toolbar's roster already sets.
  assert.match(view, /navigate\?\.\(\{ who: isOn \? null : p\.uid \}\)/);
  assert.match(view, /aria-pressed=\{isOn\}/);
  assert.match(view, /Show everybody/, 'and a way back out when it is applied');
});

test('an empty workspace says what would make the panel appear', async () => {
  const ui = await render({ projectFilter: 'all' });
  assert.match(text(ui.container), /Nobody is carrying open work|Loading the plan/);
  ui.unmount();
});

// ─── the grid is gone, and both halves of it are re-homed ───────────────────

test('the weeks grid and its drag-and-drop are gone', () => {
  assert.doesNotMatch(view, /workload-grid|workload-cell|workload-scroll/);
  assert.doesNotMatch(view, /DndContext|useDraggable|useDroppable|DragOverlay/);
  // The header comment NAMES them on purpose, so match a real import or
  // call rather than the word.
  assert.doesNotMatch(view, /^import[\s\S]*?\b(buildWorkload|planningWeeks|moveTaskPlan)\b/m);
  assert.doesNotMatch(view, /\b(buildWorkload|planningWeeks|moveTaskPlan)\(/);
  assert.doesNotMatch(view, /No due date yet/, 'the unplannable rail went with it');
  const offenders = fs.readdirSync(path.join(root, 'src', 'components'))
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => /className="workload-/.test(read('src', 'components', f)));
  assert.deepEqual(offenders, [], 'nothing renders the grid any more');
});

test('…and its stylesheet went with it', () => {
  assert.doesNotMatch(css, /^\.workload-grid/m);
  assert.doesNotMatch(css, /^\.workload-cell/m);
  assert.doesNotMatch(css, /^\.workload-chip/m);
});

test('moving WHEN and moving WHO both still have a home', () => {
  // This is the guard that matters. The grid did two things; if neither of
  // these renders, a capability was deleted rather than re-homed.
  assert.match(read('src', 'components', 'CalendarView.jsx'), /moveTaskToDay/,
    'move WHEN — drag between days on the Calendar');
  assert.match(read('src', 'components', 'MyWeekView.jsx'), /useMyWeek/,
    'move WHEN — My Week');
  // T-0152 deleted the Table and the bulk bar with it, so reassigning is the
  // task editor alone now. That IS a narrowing — it is recorded in CLAUDE.md
  // rather than left to be discovered by someone looking for it.
  assert.match(read('src', 'components', 'TaskEditor.jsx'), /assignedTo/,
    'move WHO — the task editor');
});

test('the pure module keeps its arithmetic and its tests', () => {
  // buildWorkload and friends are unrendered but not deleted: the grid is one
  // component away from coming back, and moveTaskToDay from the same module
  // is still live behind the Calendar.
  assert.deepEqual(parseCellId(cellId('u-ace', '2026-09-14')), { userId: 'u-ace', weekKey: '2026-09-14' });
  assert.equal(parseCellId('something-else'), null);
  assert.equal(
    describeMove({ 'plan.endDate': '2026-09-25', assignedTo: ['u-mia'] },
      { 'u-mia': { displayName: 'Mia Santos' } }),
    'Moved: due 2026-09-25, assigned to Mia Santos.',
  );
  assert.equal(typeof taskHours, 'function');
  assert.equal(typeof DEFAULT_CAPACITY_HOURS, 'number');
  assert.match(view, /nothing renders them any more/,
    'the file must say so, or the next reader deletes a tested module by accident');
});

// ─── wiring ─────────────────────────────────────────────────────────────────

test('the page is routed, named and code-split like every other view', async () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /const WorkloadView\s+= lazy\(\(\) => import\('\.\/components\/WorkloadView'\)\)/);
  assert.match(app, /route\.view === 'workload'\s+&& <WorkloadView projectFilter=\{route\.projectFilter\} navigate=\{navigate\} route=\{route\} \/>/);

  const { RENDERABLE_VIEWS } = await import('../../src/services/views.js');
  assert.equal(RENDERABLE_VIEWS.find((v) => v.id === 'workload')?.label, 'Workload');
  assert.match(app, /RENDERABLE_VIEWS\.map\(\(v\) => \[v\.id, v\.label\]\)/,
    'a second list of page names is how a crash gets reported on the wrong page');
});

test('it lives under Board, which is where the audit put it', async () => {
  const { VIEW_REGISTRY, hubForView } = await import('../../src/services/views.js');
  assert.ok(VIEW_REGISTRY.find((v) => v.id === 'workload' && v.label === 'Workload'));
  assert.equal(hubForView('workload')?.id, 'board');
});
