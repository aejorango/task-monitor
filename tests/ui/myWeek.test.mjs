// T-0131 / NEW-020 — My Week, on screen.
//
//   1. Given tasks assigned to the user in two different workspaces
//   2. When they open My Week
//   3. Then both appear on their due days with their workspace named, and
//      dragging one to another day writes plan.endDate while preserving its
//      duration
//
// The bucketing and the drop arithmetic are covered in
// src/services/myWeek.test.mjs. This is the page: the registry entry, the
// routing, and the markup the week is actually drawn with.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, muteConsoleError, text } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const view = () => read('src', 'components', 'MyWeekView.jsx');

setupDom();

const { buildMyWeek } = await import('../../src/services/myWeek.js');
const { VIEW_REGISTRY, NAV_TARGETS, isKnownView } = await import('../../src/services/views.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const ACE = 'u-ace';
const TODAY = '2026-09-23';
const WORKSPACES = [
  { id: 'ws-1', name: 'BRIDGED', color: '#0051BA' },
  { id: 'ws-2', name: 'AIM', color: '#7B2D8F' },
];

/* ── the page exists, and can be found ─────────────────────────────────── */

test('My Week is in the registry, so the sidebar and ⌘K both get it', () => {
  const entry = VIEW_REGISTRY.find((v) => v.id === 'my-week');
  assert.ok(entry, 'a page kept out of the registry is unreachable from search');
  assert.equal(entry.label, 'My Week');
  assert.ok(isKnownView('my-week'), 'otherwise the hash is a not-found');

  const target = NAV_TARGETS.find((t) => t.view === 'my-week');
  assert.ok(target, 'NAV_TARGETS is derived — if this fails the derivation broke');
  for (const phrase of ['my tasks', 'assigned to me', 'mine']) {
    assert.ok(target.words.includes(phrase), `⌘K should find it by "${phrase}"`);
  }
});

test('it is routed and code-split like every other view', () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /const MyWeekView\s+= lazy\(\(\) => import\('\.\/components\/MyWeekView'\)\)/,
    'every non-Board view is lazy');
  assert.match(app, /route\.view === 'my-week'\s+&& <MyWeekView \/>/);
});

test('it is deliberately not given a project filter', () => {
  // The whole point is that it spans workspaces; a one-project filter would be
  // the opposite of what the page is for.
  const app = read('src', 'App.jsx');
  assert.doesNotMatch(app, /<MyWeekView projectFilter/);
  assert.doesNotMatch(view(), /projectFilter/);
});

test('the page name for a crash is derived, not listed a second time', () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /RENDERABLE_VIEWS\.map\(\(v\) => \[v\.id, v\.label\]\)/);
  assert.doesNotMatch(app, /wbs: 'WBS', goals: 'Goals'/,
    'the hand-kept map had already drifted — Task table and others were missing');
});

/* ── what it reads ─────────────────────────────────────────────────────── */

test('it reads the bounded, per-person subscription', () => {
  assert.match(view(), /useMyTasksAcrossWorkspaces/);
  assert.doesNotMatch(view(), /useAllWorkspaceTasks/,
    'that one downloads every task in every workspace, and this screen stays open all day');
});

test('the drop goes through the one module that decides what a drop means', () => {
  // The sequencing moved to hooks/useMyWeek.js for T-0132, so a test could
  // actually perform a drop. The rule is unchanged: one module works out the
  // patch, and nothing else writes plan dates by hand.
  const hook = read('src', 'hooks', 'useMyWeek.js');
  assert.match(hook, /moveTaskToDay\(task, over\.id\)/);
  assert.doesNotMatch(hook, /'plan\.endDate'/,
    'a second place computing the patch is how a drop comes to mean two things');
  assert.doesNotMatch(view(), /'plan\.endDate'/);
});

test('the Calendar was moved onto the same helper rather than left as a copy', () => {
  const cal = read('src', 'components', 'CalendarView.jsx');
  assert.match(cal, /moveTaskToDay\(task, newDate\)/);
  assert.doesNotMatch(cal, /if \(!oldEnd \|\| oldEnd === newDate\) return;/,
    'that early return is why an undated task could not be dropped onto a day');
  assert.doesNotMatch(cal, /const DAY = 24 \* 60 \* 60 \* 1000/, 'the arithmetic went with it');
});

/* ── the week it draws ─────────────────────────────────────────────────── */
//
// MyWeekView itself needs a live workspace to render, so what is checked here
// is the shape it is handed and the markup contract it renders against — the
// same split the task table uses.

const week = buildMyWeek({
  tasks: [
    { id: 'a', title: 'Ledger', status: 'todo', priority: 'high', workspaceId: 'ws-1', assignedTo: [ACE], plan: { endDate: '2026-09-22' } },
    { id: 'b', title: 'Board pack', status: 'todo', priority: 'low', workspaceId: 'ws-2', assignedTo: [ACE], plan: { endDate: '2026-09-24' } },
    { id: 'c', title: 'Someday', status: 'todo', workspaceId: 'ws-1', assignedTo: [ACE], plan: {} },
    { id: 'd', title: 'Late thing', status: 'todo', workspaceId: 'ws-2', assignedTo: [ACE], plan: { endDate: '2026-09-01' } },
  ],
  userId: ACE, workspaces: WORKSPACES, today: TODAY, weekStart: 1,
});

// The acceptance case.
test('two workspaces, two days, each card naming where it came from', () => {
  const tue = week.days.find((d) => d.date === '2026-09-22');
  const thu = week.days.find((d) => d.date === '2026-09-24');
  assert.deepEqual(tue.tasks.map((t) => t.title), ['Ledger']);
  assert.deepEqual(thu.tasks.map((t) => t.title), ['Board pack']);
  assert.equal(tue.tasks[0].workspaceName, 'BRIDGED');
  assert.equal(thu.tasks[0].workspaceName, 'AIM');
});

test('the card renders the workspace name it was given', () => {
  // The card is what makes the mixing legible; a card that drops the workspace
  // makes the whole screen ambiguous.
  assert.match(view(), /\{task\.workspaceName\}/);
  assert.match(view(), /--ws-color/, 'and its colour, so the eye can group them');
});

test('nothing falls off the screen: both rails are rendered', () => {
  assert.equal(week.unscheduled.length, 1);
  assert.equal(week.overdue.length, 1);
  assert.match(view(), /title="No date yet"/);
  assert.match(view(), /Still open from before/);
  assert.match(view(), /id=\{DAY_UNSCHEDULED\}/, 'the rail must accept a drop, to un-schedule');
});

test('you cannot drop a task INTO overdue', () => {
  // Dragging out of it onto a day is the point; dropping back in would be
  // asking the app to make something late.
  assert.match(view(), /disabled: !id/);
  assert.match(view(), /id=\{null\}[\s\S]{0,200}Still open from before/);
});

test('today is marked and the weekend is drawn, not dropped', () => {
  assert.match(view(), /day\.isToday \? 'is-today' : ''/);
  assert.match(view(), /day\.isWeekend \? 'is-weekend' : ''/);
  assert.equal(week.days.length, 7);
});

test('a day column announces itself to a screen reader', () => {
  assert.match(view(), /aria-label=\{`\$\{weekday\} \$\{date\}\$\{day\.isToday \? ', today' : ''\}/,
    'a column of cards with no name is a column a screen reader cannot use');
});

test('the week arrows say which way they go', () => {
  assert.match(view(), /aria-label="The week before this one"/);
  assert.match(view(), /aria-label="The week after this one"/);
  // T-0121's rule: the glyph and the name must agree.
  assert.match(view(), /aria-label="The week before this one"\s*\n\s*>←</);
  assert.match(view(), /aria-label="The week after this one"\s*\n\s*>→</);
});

test('an empty week says so in plain language, and says what fills it', () => {
  const empty = buildMyWeek({ tasks: [], userId: ACE, workspaces: WORKSPACES, today: TODAY });
  assert.equal(empty.counts.total, 0);
  assert.match(view(), /Nothing is assigned to you/);
  assert.match(view(), /the moment somebody puts your name on one/);
});

test('a failed move is reported in a plain sentence, not an SDK one', () => {
  const hook = read('src', 'hooks', 'useMyWeek.js');
  assert.match(hook, /friendlyError\(err, 'Could not move that task\. Please try again\.'\)/);
  assert.match(hook, /console\.error\('\[my-week\] reschedule failed:', err\)/,
    "the operator's version goes to the console, not to the screen");
});

/* ── the card is the handle ────────────────────────────────────────────── */

test('the card has no inner button to swallow the drag', () => {
  // The workload chip learned this the hard way: a control small enough to sit
  // on a card this size makes the card undraggable.
  const card = view().slice(view().indexOf('function TaskCard('));
  assert.doesNotMatch(card, /<button/, 'the card IS the drag handle and the button');
  assert.match(card, /activationConstraint: \{ distance: 5 \}|onClick=\{\(\) => \{ if \(!overlay && !isDragging\)/,
    'and a click at the end of a drag must not also open the task');
});

test('a drag in progress is visible, and the overlay is not itself draggable', () => {
  const src = view();
  assert.match(src, /useDraggable\(\{\s*id: task\.id, disabled: overlay,\s*\}\)/);
  assert.match(src, /is-dragging/);
});

/* ── it renders ────────────────────────────────────────────────────────── */

test('the view mounts without a workspace and says it is loading', async () => {
  const { default: MyWeekView } = await import('../../src/components/MyWeekView.jsx');
  const { ToastProvider } = await import('../../src/components/Toast.jsx');
  const ui = await mount(h(ToastProvider, null, h(MyWeekView)));
  assert.match(text(ui.container), /Loading your week…|Nothing is assigned to you/,
    'it must not throw before the data arrives');
  ui.unmount();
});

/* ── T-0132: it is actually in the sidebar ─────────────────────────────── */

test('My Week gets its own sidebar entry, not swallowed into a group', async () => {
  const shell = read('src', 'components', 'AppShell.jsx');
  // The sidebar builds itself from the registry: a view in no NAV_GROUP becomes
  // a top-level item. What would break this is somebody adding 'my-week' to a
  // group's childIds, which would bury a page whose whole point is being there.
  assert.doesNotMatch(shell, /childIds: \[[^\]]*'my-week'/,
    'My Week is a destination, not a sub-item of Board or Reports');
  assert.match(shell, /const group = childToGroup\.get\(v\.id\);\s*\n\s*if \(!group\) \{ items\.push\(v\); return; \}/,
    'that is what makes an ungrouped registry entry appear at all');
});

test('it sits next to Dashboard, which is where you look first thing', async () => {
  const ids = VIEW_REGISTRY.map((v) => v.id);
  assert.equal(ids[ids.indexOf('my-week') - 1], 'dashboard');
});
