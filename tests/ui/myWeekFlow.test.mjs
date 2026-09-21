// T-0132 / NEW-020 — the acceptance path, end to end.
//
//   1. Given tasks assigned to the user in two different workspaces
//   2. When they open My Week
//   3. Then both appear on their due days with their workspace named, and
//      dragging one to another day writes plan.endDate while preserving its
//      duration
//
// The bucketing is covered in src/services/myWeek.test.mjs and the page's
// wiring in tests/ui/myWeek.test.mjs. This is the join: the real grid, the real
// hook and a real drop, with the write recorded instead of performed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError, text } from './dom.mjs';

setupDom();

const { useMyWeek } = await import('../../src/hooks/useMyWeek.js');
const { DAY_UNSCHEDULED } = await import('../../src/services/workload.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const ACE = 'u-ace';
const TODAY = '2026-09-23';                 // a Wednesday
const WORKSPACES = [
  { id: 'ws-1', name: 'BRIDGED', color: '#0051BA' },
  { id: 'ws-2', name: 'AIM', color: '#7B2D8F' },
];

// Two workspaces, two days — plus the two rails' worth.
const TASKS = [
  { id: 'a', title: 'Ledger', workspaceId: 'ws-1', assignedTo: [ACE], status: 'todo',
    priority: 'high', plan: { startDate: '2026-09-20', endDate: '2026-09-22' }, actual: {} },
  { id: 'b', title: 'Board pack', workspaceId: 'ws-2', assignedTo: [ACE], status: 'todo',
    priority: 'low', plan: { endDate: '2026-09-24' }, actual: {} },
  { id: 'c', title: 'Someday', workspaceId: 'ws-1', assignedTo: [ACE], status: 'todo',
    priority: 'low', plan: {}, actual: {} },
  { id: 'd', title: 'Late memo', workspaceId: 'ws-2', assignedTo: [ACE], status: 'todo',
    priority: 'high', plan: { endDate: '2026-09-01' }, actual: {} },
  { id: 'theirs', title: 'Not mine', workspaceId: 'ws-1', assignedTo: ['u-mia'], status: 'todo',
    plan: { endDate: '2026-09-22' }, actual: {} },
];

function makeRig({ tasks = TASKS, commitFails = false } = {}) {
  const rig = { writes: [], errors: [] };
  rig.commit = async (id, patch) => {
    rig.writes.push({ id, patch });
    if (commitFails) throw Object.assign(new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'), { code: 'permission-denied' });
  };
  rig.toast = { error: (t) => rig.errors.push(t), success() {}, info() {} };

  function Page() {
    rig.hook = useMyWeek({
      tasks, userId: ACE, workspaces: WORKSPACES, weekStart: 1,
      toast: rig.toast, commit: rig.commit, today: () => TODAY,
    });
    const { week, dragging } = rig.hook;
    return h('div', null,
      h('p', { className: 'title' }, week.week.start),
      ...week.days.map((d) => h('section', { key: d.date, 'data-day': d.date },
        ...d.tasks.map((t) => h('article', { key: t.id, 'data-task': t.id },
          `${t.title} · ${t.workspaceName}`)),
      )),
      h('section', { 'data-rail': 'unscheduled' },
        ...week.unscheduled.map((t) => h('article', { key: t.id, 'data-task': t.id }, t.title))),
      h('section', { 'data-rail': 'overdue' },
        ...week.overdue.map((t) => h('article', { key: t.id, 'data-task': t.id }, t.title))),
      dragging ? h('p', { className: 'overlay' }, dragging.title) : null,
    );
  }
  return { rig, Page };
}

const drop = async (rig, taskId, over) => {
  await act(async () => {
    await rig.hook.onDragStart({ active: { id: taskId } });
  });
  await act(async () => {
    await rig.hook.onDragEnd({ active: { id: taskId }, over: over === null ? null : { id: over } });
  });
};

const dayOf = (ui, date) => ui.container.querySelector(`[data-day="${date}"]`);
const railOf = (ui, name) => ui.container.querySelector(`[data-rail="${name}"]`);

/* ── the acceptance sentence ───────────────────────────────────────────── */

test('both workspaces appear, on their own days, each card naming its workspace', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));

  assert.equal(text(dayOf(ui, '2026-09-22')), 'Ledger · BRIDGED');
  assert.equal(text(dayOf(ui, '2026-09-24')), 'Board pack · AIM');
  assert.doesNotMatch(text(ui.container), /Not mine/, "somebody else's task is not my week");
  ui.unmount();
  void rig;
});

test('dragging one to another day writes plan.endDate and keeps its duration', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));

  // "Ledger" runs 20th → 22nd: a two-day task.
  await drop(rig, 'a', '2026-09-25');

  assert.deepEqual(rig.writes, [{
    id: 'a',
    patch: { 'plan.endDate': '2026-09-25', 'plan.startDate': '2026-09-23' },
  }], 'still a two-day task, three days later');
  assert.deepEqual(rig.errors, []);
  ui.unmount();
});

/* ── the rest of the flow ──────────────────────────────────────────────── */

test('a task with no date can be dropped onto a day — that is what the rail is for', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  assert.equal(text(railOf(ui, 'unscheduled')), 'Someday');

  await drop(rig, 'c', '2026-09-25');
  assert.deepEqual(rig.writes, [{ id: 'c', patch: { 'plan.endDate': '2026-09-25' } }]);
  ui.unmount();
});

test('an overdue task can be given a new day', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  assert.equal(text(railOf(ui, 'overdue')), 'Late memo');

  await drop(rig, 'd', '2026-09-25');
  assert.deepEqual(rig.writes, [{ id: 'd', patch: { 'plan.endDate': '2026-09-25' } }]);
  ui.unmount();
});

test('dropping back on the rail takes the date off, start date and all', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await drop(rig, 'a', DAY_UNSCHEDULED);
  assert.deepEqual(rig.writes, [{
    id: 'a', patch: { 'plan.endDate': null, 'plan.startDate': null },
  }], 'a start with no end is a plan that began and will never finish');
  ui.unmount();
});

test('dropping a task where it already is writes nothing', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await drop(rig, 'b', '2026-09-24');
  assert.deepEqual(rig.writes, [], 'an unchanged write is still a write');
  ui.unmount();
});

test('dropping on nothing writes nothing', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await drop(rig, 'a', null);
  assert.deepEqual(rig.writes, []);
  ui.unmount();
});

test('a drag in progress is visible, and clears when it ends', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));

  await act(async () => { await rig.hook.onDragStart({ active: { id: 'a' } }); });
  assert.equal(text(ui.container.querySelector('.overlay')), 'Ledger');

  await act(async () => { await rig.hook.onDragCancel(); });
  assert.equal(ui.container.querySelector('.overlay'), null, 'a cancelled drag must not leave a ghost');
  ui.unmount();
});

test('a failed move is one plain sentence, not the gRPC dump', async () => {
  const { rig, Page } = makeRig({ commitFails: true });
  const ui = await mount(h(Page));
  await drop(rig, 'a', '2026-09-25');

  assert.equal(rig.errors.length, 1);
  assert.doesNotMatch(rig.errors[0], /PERMISSION_DENIED|^7 /);
  assert.match(rig.errors[0], /permission/i);
  ui.unmount();
});

/* ── moving between weeks ──────────────────────────────────────────────── */

test('the week can be moved forward and back, and is clamped', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  assert.equal(text(ui.container.querySelector('.title')), '2026-09-21');

  await act(async () => { rig.hook.goToWeek((o) => o + 1); });
  assert.equal(text(ui.container.querySelector('.title')), '2026-09-28');

  await act(async () => { rig.hook.goToWeek(0); });
  assert.equal(text(ui.container.querySelector('.title')), '2026-09-21');

  await act(async () => { rig.hook.goToWeek(9999); });
  assert.equal(rig.hook.offset, 8, 'a week eight years out is not a week you are planning');
  ui.unmount();
});

test('moving the week does not move any task', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await act(async () => { rig.hook.goToWeek((o) => o + 2); });
  assert.deepEqual(rig.writes, []);
  ui.unmount();
});

/* ── the page uses the hook rather than a copy of it ───────────────────── */

test('the page does not keep its own drop handler', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(
    import.meta.dirname, '..', '..', 'src', 'components', 'MyWeekView.jsx'), 'utf8');
  assert.match(src, /useMyWeek\(\{ tasks, userId, workspaces, weekStart: settings\.weekStart, toast \}\)/);
  assert.doesNotMatch(src, /await updateTask\(/,
    'the write belongs in the hook, which a test can hand a recorder');
  assert.doesNotMatch(src, /moveTaskToDay\(/, 'and so does working out the patch');
});
