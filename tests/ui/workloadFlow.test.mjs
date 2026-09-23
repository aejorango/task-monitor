// T-0080 / NEW-005 — the acceptance path, end to end.
//
//   1. Given an overloaded member
//   2. When a task is dragged to another member
//   3. Then assignedTo and plan.endDate update
//
// The drag itself is dnd-kit's; what this proves is the chain either side of
// it: the grid says who is overloaded, the cell the task was dropped on names
// its target, the pure module turns that into a patch, and the grid rebuilt
// from the patched task shows the load has actually moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildWorkload, cellId, describeMove, moveTaskPlan, parseCellId, planningWeeks,
} from '../../src/services/workload.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const ACE = 'u-ace';
const MIA = 'u-mia';
const memberProfiles = {
  [ACE]: { displayName: 'Ace Jorango' },
  [MIA]: { displayName: 'Mia Santos' },
};
const weeks = planningWeeks({ from: '2026-09-16', count: 3, weekStart: 1 });
const opts = { weeks, members: [ACE, MIA], memberProfiles };

/** Ace is carrying two big things in the same week; Mia has almost nothing. */
const tasks = [
  { id: 'a', title: 'Disbursement report', assignedTo: [ACE], estimateHours: 30, status: 'todo', plan: { endDate: '2026-09-18' } },
  { id: 'b', title: 'Board pack', assignedTo: [ACE], estimateHours: 20, status: 'todo', plan: { startDate: '2026-09-15', endDate: '2026-09-17' } },
  { id: 'c', title: 'Policy review', assignedTo: [MIA], estimateHours: 8, status: 'todo', plan: { endDate: '2026-09-23' } },
];

const rowFor = (grid, uid) => grid.rows.find((r) => r.userId === uid);

/** What `updateTask` would leave behind, applied locally. */
const applied = (task, patch) => ({
  ...task,
  assignedTo: patch.assignedTo ?? task.assignedTo,
  plan: {
    startDate: patch['plan.startDate'] ?? task.plan?.startDate ?? null,
    endDate: patch['plan.endDate'] ?? task.plan?.endDate ?? null,
  },
});

test('step 1: the grid shows who is overloaded, and says so in words', () => {
  const grid = buildWorkload(tasks, opts);
  const ace = rowFor(grid, ACE);
  assert.equal(ace.cells['2026-09-14'].hours, 50);
  assert.equal(ace.cells['2026-09-14'].level, 'over');
  assert.equal(rowFor(grid, MIA).cells['2026-09-14'].level, 'free');
});

test('step 2: the cell dropped on names both the person and the week', () => {
  const where = parseCellId(cellId(MIA, weeks[1].key));
  assert.deepEqual(where, { userId: MIA, weekKey: '2026-09-21' });
});

test('step 3: the patch sets assignedTo and plan.endDate — the acceptance line', () => {
  const where = parseCellId(cellId(MIA, weeks[1].key));
  const patch = moveTaskPlan(tasks[0], {
    toUserId: where.userId,
    toWeek: weeks.find((w) => w.key === where.weekKey),
  });
  assert.deepEqual(patch, { 'plan.endDate': '2026-09-25', assignedTo: [MIA] });
});

test('and the grid rebuilt from the patched task shows the load has moved', () => {
  const patch = moveTaskPlan(tasks[0], { toUserId: MIA, toWeek: weeks[1] });
  const after = buildWorkload(
    tasks.map((t) => (t.id === 'a' ? applied(t, patch) : t)),
    opts,
  );
  assert.equal(rowFor(after, ACE).cells['2026-09-14'].hours, 20);
  assert.equal(rowFor(after, ACE).cells['2026-09-14'].level, 'ok', 'Ace is no longer over');
  assert.equal(rowFor(after, MIA).cells['2026-09-21'].hours, 38);
  assert.equal(rowFor(after, MIA).cells['2026-09-21'].level, 'full');
});

test('a task that runs over several days keeps its length when it moves', () => {
  const patch = moveTaskPlan(tasks[1], { toWeek: weeks[2] });
  const moved = applied(tasks[1], patch);
  assert.equal(moved.plan.endDate, '2026-10-01', 'a Thursday deadline stays a Thursday');
  assert.equal(moved.plan.startDate, '2026-09-29', 'two days long before, two days long after');
});

test('the person told about it is the one who now has it', () => {
  const patch = moveTaskPlan(tasks[0], { toUserId: MIA, toWeek: weeks[1] });
  assert.equal(describeMove(patch, memberProfiles), 'Moved: due 2026-09-25, assigned to Mia Santos.');
});

// ─── docs ───────────────────────────────────────────────────────────────────

test('the README explains the planner to somebody who has not seen it', () => {
  const readme = read('README.md');
  assert.match(readme, /## Workload/);
  assert.match(readme, /Drag a task to \*\*another week\*\*/);
  assert.match(readme, /to \*\*another person\*\* to\nhand it over — they get a notice/);
  assert.match(readme, /A drop where the task already was writes\nnothing/);
  assert.match(readme, /Tasks with no due date cannot be placed/);
  assert.match(readme, /counts as four hours unless it carries an estimate/,
    'the arithmetic a manager is trusting must be stated');
});

test('the README lists the new suites and the harness', () => {
  const readme = read('README.md');
  assert.match(readme, /`src\/services\/workload\.test\.mjs`/);
  assert.match(readme, /`tests\/ui\/workload\.test\.mjs`/);
  assert.match(readme, /`tests\/ui\/workloadApi\.test\.mjs`/);
});

// T-0150 replaced the weeks grid with the mockup's single panel, and T-0152
// took the Table with its bulk bar. What CLAUDE.md must still carry is where
// the grid's two capabilities went, and that the pure module survived it.
test('CLAUDE.md records what the weeks grid became, and what it cost', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /WorkloadView\.jsx\s+← Board → Workload/);
  assert.match(claude, /workload\.js\s+← load per person/);
  assert.match(claude, /kept but unrendered/, 'the unrendered arithmetic must be flagged, not silently dead');
  assert.match(claude, /Workload \(the weeks grid\)/, 'the removal has a row of its own');
  assert.match(claude, /Reassigning many tasks at once is no longer possible/,
    'the capability the deletion cost has to be stated, not discovered');
});

test('the changelog records both halves', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /T-0078 — Workload planner by week \(API\/data layer\)/);
  assert.match(changelog, /T-0079 — Workload planner by week \(UI\)/);
});
