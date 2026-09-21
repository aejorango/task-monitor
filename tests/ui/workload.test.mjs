// T-0079 / NEW-005 — Board → Workload, rendered.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();

const { default: WorkloadView } = await import('../../src/components/WorkloadView.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');
const { cellId, parseCellId, describeMove } = await import('../../src/services/workload.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const view = read('src', 'components', 'WorkloadView.jsx');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const render = (props = {}) => mount(
  h(ToastProvider, null, h(WorkloadView, props)),
);

// ─── the page ───────────────────────────────────────────────────────────────

test('the page renders with its heading and says what to do with it', async () => {
  const ui = await render();
  const shown = text(ui.container);
  assert.match(shown, /Workload/);
  assert.match(shown, /Drag a task to another week to move its deadline/);
  assert.match(shown, /to another person to hand it over/);
  ui.unmount();
});

test('the colour key is spelled out, not left to be guessed from a shade', async () => {
  const ui = await render();
  const shown = text(ui.container);
  for (const label of ['Nothing planned', 'Room to spare', 'A full week', 'More than a full week']) {
    assert.match(shown, new RegExp(label));
  }
  ui.unmount();
});

test('an empty workspace says what would make the grid appear', async () => {
  const ui = await render();
  assert.match(text(ui.container), /Nobody to plan for yet/);
  assert.match(text(ui.container), /give tasks a due date so they show up here/);
  ui.unmount();
});

test('the week navigation is there, including a way back to now', async () => {
  const ui = await render();
  const labels = [...ui.container.querySelectorAll('button')].map((b) => b.textContent.trim());
  assert.ok(labels.includes('← Earlier'));
  assert.ok(labels.includes('This week'));
  assert.ok(labels.includes('Later →'));
  ui.unmount();
});

// ─── the grid ───────────────────────────────────────────────────────────────

test('the grid is a real table, so a screen reader can read across it', () => {
  assert.match(view, /<table className="workload-grid">/);
  assert.match(view, /<th scope="col"/);
  assert.match(view, /<th scope="row" className="workload-person">/);
});

test('every cell says what it holds, in a sentence, on hover and for a reader', () => {
  assert.match(view, /const description = describeCell\(row, week, cell\)/);
  assert.match(view, /title=\{description\}/);
  assert.match(view, /aria-label=\{description\}/);
});

test('the week columns honour the week-start preference', () => {
  assert.match(view, /const weekStart = settings\?\.weekStart \?\? 1;/);
  assert.match(view, /planningWeeks\(\{ from, count: WEEKS_AHEAD, weekStart \}\)/);
});

test('the grid is built by the pure module, not in the component', () => {
  assert.match(view, /buildWorkload\(visible, \{ weeks, members, memberProfiles \}\)/);
  assert.doesNotMatch(view, /plan\?\.endDate >=/, 'bucketing belongs in services/workload.js');
});

// ─── dragging ───────────────────────────────────────────────────────────────

test('a cell id carries both halves of where it is, and reads back', () => {
  const id = cellId('u-ace', '2026-09-14');
  assert.deepEqual(parseCellId(id), { userId: 'u-ace', weekKey: '2026-09-14' });
  assert.equal(parseCellId('something-else'), null);
  assert.equal(parseCellId(undefined), null);
});

test('a drop works out its target from the cell it landed on', () => {
  assert.match(view, /const where = parseCellId\(over\?\.id\)/);
  assert.match(view, /toUserId: where\.userId/);
  assert.match(view, /toWeek: weeks\.find\(\(w\) => w\.key === where\.weekKey\) \|\| null/);
});

test('a drop outside a cell, or on a task that is gone, writes nothing', () => {
  assert.match(view, /if \(!where\) return;/);
  assert.match(view, /if \(!task\) return;/);
});

test('the write goes through applyTaskMove, so the new owner is told', () => {
  assert.match(view, /await applyTaskMove\(task, patch, \{/);
  assert.match(view, /byUserId: userId/);
  assert.match(view, /byName: memberLabel\(userId, memberProfiles\)/);
});

test('a drop where it already was is not a write', () => {
  assert.match(view, /if \(!patch\) return;\s+\/\/ dropped where it already was/);
});

test('a failed move says so in plain words rather than silently doing nothing', () => {
  assert.match(view, /friendlyError\(err, 'Could not move that task\.'\)/);
});

test('a successful move says what it did', () => {
  assert.equal(
    describeMove({ 'plan.endDate': '2026-09-25', assignedTo: ['u-mia'] },
      { 'u-mia': { displayName: 'Mia Santos' } }),
    'Moved: due 2026-09-25, assigned to Mia Santos.',
  );
  assert.equal(describeMove({ assignedTo: [] }), 'Moved: unassigned.');
  assert.match(view, /toast\.success\(describeMove\(patch, memberProfiles\)\)/);
});

test('the chip is both the drag handle and the way into the task', () => {
  assert.match(view, /useDraggable\(\{ id: task\.id \}\)/);
  assert.match(view, /drag to move it, click to open it/);
  // A click at the end of a drag must not also open the task.
  assert.match(view, /const dragged = useRef\(false\);/);
  assert.match(view, /if \(isDragging\) dragged\.current = true;/);
  assert.match(view, /if \(dragged\.current\) \{ dragged\.current = false; return; \}/);
});

test('dragging a chip does not select the words it is dragging', () => {
  const css = read('src', 'App.css');
  const chip = css.slice(css.indexOf('.workload-chip {'), css.indexOf('.workload-chip.is-dragging'));
  assert.match(chip, /user-select: none/);
  assert.match(chip, /touch-action: none/, 'a touch drag must not scroll the page instead');
});

test('a drag in progress is shown, so the cursor is not carrying nothing', () => {
  assert.match(view, /<DragOverlay>/);
  assert.match(view, /dragging \? <span className="workload-chip is-dragging">/);
});

test('the cell being dropped on is marked with its own class, not the overload one', () => {
  assert.match(view, /isOver \? 'is-drop-target' : ''/);
  const css = read('src', 'App.css');
  assert.match(css, /\.workload-cell\.is-drop-target \{ outline: 2px dashed/);
  assert.match(css, /\.workload-cell\.is-over \{/, 'the over-capacity colour is separate');
});

// ─── the tasks that cannot be planned ───────────────────────────────────────

test('tasks with no due date are offered, with what to do about them', () => {
  assert.match(view, /No due date yet \(\{unscheduled\.length\}\)/);
  assert.match(view, /cannot be planned until somebody says when they are due/);
  assert.match(view, /onClick=\{\(\) => setEditing\(task\)\}/);
});

// ─── wiring ─────────────────────────────────────────────────────────────────

test('the page is routed, named and code-split like every other view', async () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /const WorkloadView\s+= lazy\(\(\) => import\('\.\/components\/WorkloadView'\)\)/);
  assert.match(app, /route\.view === 'workload'\s+&& <WorkloadView projectFilter=\{route\.projectFilter\} \/>/);

  // The error boundary's name for the page used to be a hand-kept map in
  // App.jsx, which had already drifted; it is derived from the registry now
  // (T-0131), so what matters is that the registry names it.
  const { RENDERABLE_VIEWS } = await import('../../src/services/views.js');
  assert.equal(RENDERABLE_VIEWS.find((v) => v.id === 'workload')?.label, 'Workload');
  assert.match(app, /RENDERABLE_VIEWS\.map\(\(v\) => \[v\.id, v\.label\]\)/,
    'a second list of page names is how a crash gets reported on the wrong page');
});

test('it lives under Board in the sidebar, which is where the audit put it', async () => {
  const { VIEW_REGISTRY } = await import('../../src/services/views.js');
  const shell = read('src', 'components', 'AppShell.jsx');
  assert.ok(VIEW_REGISTRY.find((v) => v.id === 'workload' && v.label === 'Workload'));
  assert.match(shell, /childIds: \['board', 'calendar', 'gantt', 'wbs', 'workload'\]/);
});

test('the grid scrolls inside itself on a narrow screen', () => {
  const css = read('src', 'App.css');
  assert.match(view, /<div className="workload-scroll">/);
  assert.match(css, /\.workload-scroll \{ overflow-x: auto; \}/);
  assert.match(css, /@media \(max-width: 720px\) \{\s*\n\s*\.workload-grid/);
});
