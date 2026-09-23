// T-0142 / NEW-026 — every project on one list, across every workspace.
//
// The rating arithmetic was inline in DashboardView and is shared now, so these
// pin the EXISTING behaviour first: the Dashboard's RAG must mean exactly what
// it meant before the move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAG_RANK, buildPortfolio, compareHealth, daysBetween, describePortfolio,
  projectHealth, rateProjects,
} from './portfolio.js';

const TODAY = '2026-09-23';
const P = (id, over = {}) => ({ id, name: id, workspaceId: 'ws1', ...over });
const T = (projectId, over = {}) => ({
  id: Math.random().toString(36).slice(2), projectId, status: 'todo', plan: {}, ...over,
});

/* ── the rating, exactly as it was ─────────────────────────────────────── */

test('a project with no tasks is idle, not healthy', () => {
  const h = projectHealth(P('a'), [], TODAY);
  assert.equal(h.rag, 'IDLE');
  assert.equal(h.total, 0);
  assert.equal(h.pct, 0);
  assert.equal(h.gap, null, 'no tasks, no schedule to be behind');
});

test('three overdue tasks is red, whatever the gap', () => {
  const late = () => T('a', { plan: { endDate: '2026-09-01' } });
  assert.equal(projectHealth(P('a'), [late(), late(), late()], TODAY).rag, 'RED');
});

test('one overdue task is amber, when the project is otherwise on schedule', () => {
  // One thing is late, but the project as a whole has barely started: elapsed
  // 10, half done, so the gap is negative and only the overdue count bites.
  const tasks = [
    T('a', { plan: { endDate: '2026-09-01' } }),
    T('a', { status: 'done', plan: { startDate: '2026-09-20', endDate: '2026-10-20' } }),
  ];
  const h = projectHealth(P('a'), tasks, TODAY);
  assert.equal(h.late, 1);
  assert.ok(h.gap < 10, `gap ${h.gap}`);
  assert.equal(h.rag, 'AMBER');
});

// A single overdue task in a project that has run out of road is not "watch
// it" — the whole span has elapsed with half the work outstanding.
test('one overdue task in an out-of-time project is red', () => {
  const tasks = [T('a', { plan: { endDate: '2026-09-01' } }), T('a', { status: 'done' })];
  const h = projectHealth(P('a'), tasks, TODAY);
  assert.equal(h.elapsed, 100, 'its last date is behind us');
  assert.equal(h.gap, 50);
  assert.equal(h.rag, 'RED');
});

test('a twenty-point gap is red even with nothing overdue', () => {
  // Half the span gone, nothing done: elapsed 50, pct 0, gap 50.
  const tasks = [
    T('a', { plan: { startDate: '2026-09-13', endDate: '2026-10-03' } }),
    T('a', { plan: { startDate: '2026-09-13', endDate: '2026-10-03' } }),
  ];
  const h = projectHealth(P('a'), tasks, TODAY);
  assert.equal(h.elapsed, 50);
  assert.equal(h.pct, 0);
  assert.equal(h.gap, 50);
  assert.equal(h.rag, 'RED');
});

test('keeping up is green', () => {
  const tasks = [
    T('a', { status: 'done', plan: { startDate: '2026-09-13', endDate: '2026-10-03' } }),
    T('a', { plan: { startDate: '2026-09-13', endDate: '2026-10-03' } }),
  ];
  const h = projectHealth(P('a'), tasks, TODAY);
  assert.equal(h.pct, 50);
  assert.equal(h.gap, 0);
  assert.equal(h.rag, 'GREEN');
});

test('a project whose last date has passed is fully elapsed', () => {
  const tasks = [T('a', { status: 'done', plan: { endDate: '2026-09-01' } })];
  const h = projectHealth(P('a'), tasks, TODAY);
  assert.equal(h.elapsed, 100);
  assert.equal(h.pct, 100);
  assert.equal(h.gap, 0);
});

test('a project with no dates at all has no elapsed and no gap', () => {
  const h = projectHealth(P('a'), [T('a'), T('a')], TODAY);
  assert.equal(h.elapsed, null);
  assert.equal(h.gap, null);
  assert.equal(h.rag, 'GREEN', 'nothing is late and nothing is behind — there is no schedule');
});

test('deleted and archived tasks are not the project’s work', () => {
  const tasks = [
    T('a', { status: 'done' }),
    T('a', { deleted: true, plan: { endDate: '2026-01-01' } }),
    T('a', { archived: true, plan: { endDate: '2026-01-01' } }),
  ];
  const h = projectHealth(P('a'), tasks, TODAY);
  assert.equal(h.total, 1);
  assert.equal(h.late, 0, 'a deleted task cannot be overdue');
});

test('only this project’s tasks count', () => {
  const h = projectHealth(P('a'), [T('a'), T('b'), T('b')], TODAY);
  assert.equal(h.total, 1);
});

test('the day arithmetic is local, and safe on rubbish', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-23'), 22);
  assert.equal(daysBetween(null, '2026-09-23'), null);
  assert.equal(daysBetween('nonsense', '2026-09-23'), null);
});

/* ── the ranking ───────────────────────────────────────────────────────── */

test('worst first, then the widest gap', () => {
  const rows = [
    { rag: 'GREEN', gap: 0, project: P('g') },
    { rag: 'RED', gap: 20, project: P('r1') },
    { rag: 'IDLE', gap: null, project: P('i') },
    { rag: 'RED', gap: 50, project: P('r2') },
    { rag: 'AMBER', gap: 10, project: P('a') },
  ].sort(compareHealth);
  assert.deepEqual(rows.map((r) => r.project.id), ['r2', 'r1', 'a', 'g', 'i']);
  assert.equal(RAG_RANK.IDLE, 3, 'a project with nothing in it is not the healthiest');
});

test('two projects that tie are ordered by name, not at random', () => {
  const rows = [
    { rag: 'GREEN', gap: 0, project: P('Zebra') },
    { rag: 'GREEN', gap: 0, project: P('Apple') },
  ].sort(compareHealth);
  assert.deepEqual(rows.map((r) => r.project.id), ['Apple', 'Zebra']);
});

test('archived and deleted projects are not rated at all', () => {
  const rows = rateProjects(
    [P('a'), P('b', { archived: true }), P('c', { deleted: true })], [T('a')], TODAY);
  assert.deepEqual(rows.map((r) => r.project.id), ['a']);
});

/* ── the acceptance case ───────────────────────────────────────────────── */

const WORKSPACES = [
  { id: 'ws1', name: 'BRIDGED' },
  { id: 'ws2', name: 'AIM' },
  { id: 'ws3', name: 'Personal' },
];
const PROJECTS = [
  P('healthy', { workspaceId: 'ws1' }),
  P('slipping', { workspaceId: 'ws1' }),
  P('burning', { workspaceId: 'ws2' }),
  P('empty', { workspaceId: 'ws3' }),
];
const late = (projectId) => T(projectId, { plan: { endDate: '2026-09-01' } });
// Chosen so each project lands on a different rating under the real rule:
//   healthy  — half done, half the span gone → gap 0 → GREEN
//   slipping — one late, but barely started  → gap < 10 → AMBER
//   burning  — three late                     → RED
//   empty    — no tasks                       → IDLE
const TASKS = [
  T('healthy', { status: 'done', plan: { startDate: '2026-09-13', endDate: '2026-10-03' } }),
  T('healthy', { plan: { startDate: '2026-09-13', endDate: '2026-10-03' } }),
  late('slipping'),
  T('slipping', { status: 'done', plan: { startDate: '2026-09-20', endDate: '2026-10-20' } }),
  late('burning'), late('burning'), late('burning'),
];

test('three workspaces, one ranked list, worst first', () => {
  const p = buildPortfolio({ workspaces: WORKSPACES, projects: PROJECTS, tasks: TASKS, today: TODAY });
  assert.deepEqual(p.rows.map((r) => r.project.id), ['burning', 'slipping', 'healthy', 'empty']);
  assert.deepEqual(p.rows.map((r) => r.rag), ['RED', 'AMBER', 'GREEN', 'IDLE']);
});

test('grouped by workspace, the worst workspace first', () => {
  const p = buildPortfolio({ workspaces: WORKSPACES, projects: PROJECTS, tasks: TASKS, today: TODAY });
  assert.deepEqual(p.groups.map((g) => g.workspace.id), ['ws2', 'ws1', 'ws3']);
  assert.deepEqual(p.groups[0].rows.map((r) => r.project.id), ['burning']);
  assert.deepEqual(p.groups[1].rows.map((r) => r.project.id), ['slipping', 'healthy'],
    'within a workspace, worst first too');
});

// Silently dropping it leaves somebody wondering where their third workspace
// went.
test('a workspace with nothing in it is still listed', () => {
  const p = buildPortfolio({
    workspaces: WORKSPACES, projects: PROJECTS.filter((x) => x.workspaceId !== 'ws3'),
    tasks: TASKS, today: TODAY,
  });
  const ws3 = p.groups.find((g) => g.workspace.id === 'ws3');
  assert.ok(ws3, '"nothing here yet" is an answer');
  assert.deepEqual(ws3.rows, []);
  assert.equal(ws3.totals.projects, 0);
});

test('a project whose workspace is not on the list still has somewhere to go', () => {
  const p = buildPortfolio({
    workspaces: [WORKSPACES[0]], projects: PROJECTS, tasks: TASKS, today: TODAY,
  });
  const other = p.groups.find((g) => g.workspace.id === '__other__');
  assert.ok(other, 'a row that vanishes is worse than one in the wrong group');
  assert.equal(other.rows.length, 2, 'burning and empty');
});

test('the totals count what is actually there', () => {
  const p = buildPortfolio({ workspaces: WORKSPACES, projects: PROJECTS, tasks: TASKS, today: TODAY });
  assert.equal(p.totals.projects, 4);
  assert.equal(p.totals.red, 1);
  assert.equal(p.totals.amber, 1);
  assert.equal(p.totals.green, 1);
  assert.equal(p.totals.idle, 1);
  assert.equal(p.totals.tasks, 7);
  assert.equal(p.totals.done, 2);
  assert.equal(p.totals.late, 4);
  assert.equal(p.totals.pct, 29);
});

test('an empty portfolio is a shape, not a crash', () => {
  const p = buildPortfolio({ today: TODAY });
  assert.deepEqual(p.rows, []);
  assert.deepEqual(p.groups, []);
  assert.equal(p.totals.projects, 0);
  assert.equal(p.totals.pct, 0);
  assert.equal(buildPortfolio().totals.projects, 0);
});

/* ── the heading ───────────────────────────────────────────────────────── */

test('the heading leads with what needs attention', () => {
  const p = buildPortfolio({ workspaces: WORKSPACES, projects: PROJECTS, tasks: TASKS, today: TODAY });
  const line = describePortfolio(p.totals, p.groups.length);
  assert.match(line, /4 projects/);
  assert.match(line, /across 3 workspaces/);
  assert.match(line, /1 needing attention now/);
});

test('with nothing red it says what to watch, and with neither it says so', () => {
  assert.match(describePortfolio({ projects: 2, red: 0, amber: 1 }, 1), /1 to watch/);
  assert.match(describePortfolio({ projects: 2, red: 0, amber: 0 }, 1), /all on track/);
  assert.equal(describePortfolio({ projects: 0 }, 0), 'No projects yet.');
  assert.equal(describePortfolio(null, 0), 'No projects yet.');
});

test('one workspace is not called "across 1 workspaces"', () => {
  assert.doesNotMatch(describePortfolio({ projects: 1, red: 0, amber: 0 }, 1), /across/);
  assert.match(describePortfolio({ projects: 1, red: 0, amber: 0 }, 1), /^1 project /);
});
