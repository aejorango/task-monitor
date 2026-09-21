// T-0139 / NEW-019 — duplicating a task, a project or a whole process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COPY_SUFFIX, NEVER_COPIED, copiedTitle, describeDuplicate,
  duplicateProjectPlan, duplicateTaskPayload,
} from './duplicate.js';

const task = (over = {}) => ({
  id: 't1', title: 'Board pack', workspaceId: 'ws', projectId: 'p1', phaseId: 'ph1',
  status: 'doing', priority: 'high', progress: 40,
  plan: { startDate: '2026-09-21', endDate: '2026-09-25' },
  actual: { startDate: '2026-09-22', endDate: null },
  tags: ['finance'], subtasks: [{ id: 's1', text: 'Draft', done: true }],
  dependsOn: [], links: [], assignedTo: ['u-ace'], estimateHours: 8,
  activityCount: 7, totalHoursLogged: 12.5, attachmentCount: 2,
  lastActivityAt: 'STAMP', createdAt: 'STAMP', updatedAt: 'STAMP',
  ...over,
});

/* ── the title ─────────────────────────────────────────────────────────── */

test('a copy says it is one', () => {
  assert.equal(copiedTitle('Board pack'), 'Board pack (copy)');
  assert.equal(copiedTitle(''), 'Untitled (copy)');
  assert.equal(copiedTitle(undefined), 'Untitled (copy)');
});

// Making five of something is normal; "(copy) (copy) (copy) (copy)" is not.
test('a copy of a copy counts rather than stacking the word', () => {
  assert.equal(copiedTitle('Board pack (copy)'), 'Board pack (copy 2)');
  assert.equal(copiedTitle('Board pack (copy 2)'), 'Board pack (copy 3)');
  assert.equal(copiedTitle('Board pack (copy 9)'), 'Board pack (copy 10)');
});

test('a title that merely mentions copying is left alone', () => {
  assert.equal(copiedTitle('Copy the ledger'), 'Copy the ledger (copy)');
  assert.equal(copiedTitle('Hard copy needed'), 'Hard copy needed (copy)');
});

test('the suffix can be turned off, for tasks inside a copied project', () => {
  assert.equal(copiedTitle('Board pack', ''), 'Board pack');
});

/* ── one task ──────────────────────────────────────────────────────────── */

test('a duplicate carries nothing from the original’s history', () => {
  const copy = duplicateTaskPayload(task());
  for (const field of NEVER_COPIED) {
    assert.equal(copy[field], undefined, `${field} must not travel with a copy`);
  }
  assert.deepEqual(copy.actual, { startDate: null, endDate: null },
    'a copy has not started and has not finished');
  assert.equal(copy.status, 'todo');
  assert.equal(copy.progress, 0);
});

test('it carries the things that make it the same task', () => {
  const copy = duplicateTaskPayload(task());
  assert.equal(copy.title, 'Board pack (copy)');
  assert.equal(copy.description, '');
  assert.equal(copy.priority, 'high');
  assert.equal(copy.estimateHours, 8, 'what it was expected to take is still true');
  assert.deepEqual(copy.tags, ['finance']);
  assert.deepEqual(copy.assignedTo, ['u-ace']);
  assert.equal(copy.workspaceId, 'ws');
  assert.equal(copy.projectId, 'p1');
  assert.equal(copy.phaseId, 'ph1');
  assert.deepEqual(copy.plan, { startDate: '2026-09-21', endDate: '2026-09-25' },
    'the plan comes with it; the history does not');
});

test('subtasks come back unticked, with ids of their own', () => {
  const copy = duplicateTaskPayload(task({
    subtasks: [{ id: 's1', text: 'Draft', done: true }, { id: 's2', text: 'Review', done: true }],
  }));
  assert.deepEqual(copy.subtasks.map((s) => s.text), ['Draft', 'Review']);
  assert.ok(copy.subtasks.every((s) => s.done === false), 'a copy has not been done');
  assert.ok(copy.subtasks.every((s) => s.id && s.id !== 's1' && s.id !== 's2'),
    'two tasks sharing a subtask id would tick together');
  assert.equal(new Set(copy.subtasks.map((s) => s.id)).size, 2);
});

test('arrays are copied, not shared with the original', () => {
  const original = task();
  const copy = duplicateTaskPayload(original);
  copy.tags.push('mutated');
  assert.deepEqual(original.tags, ['finance'], 'editing a copy must not edit what it came from');
});

test('a missing task produces nothing, rather than an empty task', () => {
  assert.equal(duplicateTaskPayload(null), null);
  assert.equal(duplicateTaskPayload(undefined), null);
});

/* ── a whole project ───────────────────────────────────────────────────── */

const project = {
  id: 'p1', workspaceId: 'ws', name: 'SBLAF rollout', color: '#0051BA',
  description: 'The pilot', segment: 'Delivery',
  phases: [
    { id: 'ph1', name: 'Discovery', order: 0 },
    { id: 'ph2', name: 'Build', order: 1 },
    { id: 'ph3', name: 'Handover', order: 2 },
  ],
  customFields: [{ id: 'f1', label: 'Client', type: 'text' }],
  wipLimits: { doing: 3 },
};

const twelve = Array.from({ length: 12 }, (_, i) => task({
  id: `t${i}`, title: `Task ${i}`, projectId: 'p1',
  phaseId: ['ph1', 'ph2', 'ph3'][i % 3],
  status: 'todo',
  plan: { startDate: `2026-09-${String(10 + i).padStart(2, '0')}`, endDate: `2026-09-${String(12 + i).padStart(2, '0')}` },
}));

// The acceptance case.
test('three phases and twelve tasks come across, fresh', () => {
  const plan = duplicateProjectPlan(project, twelve);
  assert.equal(plan.project.name, 'SBLAF rollout (copy)');
  assert.deepEqual(plan.project.phases.map((p) => p.name), ['Discovery', 'Build', 'Handover']);
  assert.equal(plan.tasks.length, 12);

  for (const t of plan.tasks) {
    assert.equal(t.activityCount, undefined, 'no counters');
    assert.equal(t.totalHoursLogged, undefined);
    assert.equal(t.id, undefined, 'no id');
    assert.deepEqual(t.actual, { startDate: null, endDate: null }, 'no history');
    assert.equal(t.status, 'todo');
  }
});

test('the phases are new ids, so the two projects do not share them', () => {
  const plan = duplicateProjectPlan(project, twelve);
  const ids = plan.project.phases.map((p) => p.id);
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) {
    assert.ok(!['ph1', 'ph2', 'ph3'].includes(id),
      'a shared phase id means moving a task in one project moves it in the other');
  }
});

test('each task lands in the copy of the phase it was in', () => {
  const plan = duplicateProjectPlan(project, twelve);
  const byName = Object.fromEntries(plan.project.phases.map((p) => [p.id, p.name]));
  // Task i was in phase i % 3 — Discovery, Build, Handover, repeating.
  plan.tasks.forEach((t, i) => {
    assert.equal(byName[t.phaseId], ['Discovery', 'Build', 'Handover'][i % 3], `task ${i}`);
  });
});

test('tasks inside a copied project are not each called "(copy)"', () => {
  const plan = duplicateProjectPlan(project, twelve);
  assert.equal(plan.tasks[0].title, 'Task 0', 'the PROJECT is the copy, not each task in it');
});

test('only this project’s live tasks come across', () => {
  const plan = duplicateProjectPlan(project, [
    ...twelve,
    task({ id: 'x', projectId: 'p2', title: 'Somebody else’s' }),
    task({ id: 'y', projectId: 'p1', deleted: true }),
    task({ id: 'z', projectId: 'p1', archived: true }),
  ]);
  assert.equal(plan.tasks.length, 12);
  assert.ok(!plan.tasks.some((t) => t.title === 'Somebody else’s'));
});

test('finished tasks are left behind by default, and counted', () => {
  const withDone = [...twelve, task({ id: 'done1', projectId: 'p1', status: 'done', title: 'Shipped' })];
  const plan = duplicateProjectPlan(project, withDone);
  assert.equal(plan.tasks.length, 12);
  assert.equal(plan.skipped, 1, 'the user should be told, not left to count');

  const all = duplicateProjectPlan(project, withDone, { includeDone: true });
  assert.equal(all.tasks.length, 13);
  assert.equal(all.skipped, 0);
});

test('without tasks it is just the shape', () => {
  const plan = duplicateProjectPlan(project, twelve, { withTasks: false });
  assert.deepEqual(plan.tasks, []);
  assert.equal(plan.project.phases.length, 3);
});

/* ── the dates ─────────────────────────────────────────────────────────── */

test('relative plan dates are preserved when the copy is moved', () => {
  // The earliest date across the twelve is 2026-09-10; asking it to start on
  // the 20th moves everything ten days.
  const plan = duplicateProjectPlan(project, twelve, { startOn: '2026-09-20' });
  assert.equal(plan.dayShift, 10);
  assert.equal(plan.tasks[0].plan.startDate, '2026-09-20');
  assert.equal(plan.tasks[0].plan.endDate, '2026-09-22');
  assert.equal(plan.tasks[11].plan.startDate, '2026-09-31'.replace('09-31', '10-01'));

  // The shape is what matters: every gap is the gap it was.
  const spanBefore = twelve.map((t) => t.plan.startDate);
  const spanAfter = plan.tasks.map((t) => t.plan.startDate);
  for (let i = 1; i < spanBefore.length; i++) {
    const a = Date.parse(`${spanBefore[i]}T00:00:00Z`) - Date.parse(`${spanBefore[0]}T00:00:00Z`);
    const b = Date.parse(`${spanAfter[i]}T00:00:00Z`) - Date.parse(`${spanAfter[0]}T00:00:00Z`);
    assert.equal(a, b, `gap ${i} changed`);
  }
});

test('moving it earlier works the same way', () => {
  const plan = duplicateProjectPlan(project, twelve, { startOn: '2026-09-01' });
  assert.equal(plan.dayShift, -9);
  assert.equal(plan.tasks[0].plan.startDate, '2026-09-01');
});

test('with no start given, nothing moves', () => {
  const plan = duplicateProjectPlan(project, twelve);
  assert.equal(plan.dayShift, 0);
  assert.equal(plan.tasks[0].plan.startDate, '2026-09-10');
});

test('a copy of an undated backlog is an undated backlog', () => {
  const undated = [task({ id: 'a', projectId: 'p1', plan: {} })];
  const plan = duplicateProjectPlan(project, undated, { startOn: '2026-12-01' });
  assert.equal(plan.dayShift, 0, 'there is nothing to anchor a shift to');
  assert.deepEqual(plan.tasks[0].plan, { startDate: null, endDate: null });
});

/* ── dependencies ──────────────────────────────────────────────────────── */

// A copy that depends on the original is a copy that waits for the thing it
// was copied from.
test('a dependency inside the copy points at the copy', () => {
  const a = task({ id: 'a', projectId: 'p1', dependsOn: [], title: 'First' });
  const b = task({ id: 'b', projectId: 'p1', dependsOn: ['a'], title: 'Second' });
  const plan = duplicateProjectPlan(project, [a, b]);

  const copyOfA = plan.tasks.find((t) => t.title === 'First');
  const copyOfB = plan.tasks.find((t) => t.title === 'Second');
  assert.deepEqual(copyOfB.dependsOn, [copyOfA._tempId]);
  assert.ok(!copyOfB.dependsOn.includes('a'), 'it must not point back at the original');
});

test('a dependency on a task that was not copied is dropped, not left dangling', () => {
  const b = task({ id: 'b', projectId: 'p1', dependsOn: ['somewhere-else'], title: 'Second' });
  const plan = duplicateProjectPlan(project, [b]);
  assert.deepEqual(plan.tasks[0].dependsOn, []);
});

test('links are remapped the same way', () => {
  const a = task({ id: 'a', projectId: 'p1', title: 'First', links: [] });
  const b = task({ id: 'b', projectId: 'p1', title: 'Second', links: [{ targetId: 'a', type: 'blocks' }] });
  const plan = duplicateProjectPlan(project, [a, b]);
  const copyOfB = plan.tasks.find((t) => t.title === 'Second');
  assert.equal(copyOfB.links.length, 1);
  assert.equal(copyOfB.links[0].type, 'blocks');
  assert.ok(copyOfB.links[0].targetId.startsWith('__new_'));
});

test('a single task copy keeps its dependencies as they are', () => {
  // Duplicating one task inside a project it stays in: the dependency targets
  // still exist and still mean what they meant.
  const copy = duplicateTaskPayload(task({ dependsOn: ['t9'] }));
  assert.deepEqual(copy.dependsOn, ['t9']);
});

/* ── what the user is told ─────────────────────────────────────────────── */

test('the sentence says what is about to happen', () => {
  const plan = duplicateProjectPlan(project, twelve, { startOn: '2026-09-20' });
  const line = describeDuplicate(plan);
  assert.match(line, /SBLAF rollout \(copy\)/);
  assert.match(line, /with 12 tasks/);
  assert.match(line, /moved 10 days later/);
});

test('it mentions what is being left behind', () => {
  const plan = duplicateProjectPlan(project, [...twelve, task({ id: 'd', projectId: 'p1', status: 'done' })]);
  assert.match(describeDuplicate(plan), /1 finished one is left behind/);
});

test('one task is not "1 tasks", and none is "no tasks"', () => {
  assert.match(describeDuplicate(duplicateProjectPlan(project, [task({ id: 'a', projectId: 'p1' })])), /with 1 task\b/);
  assert.match(describeDuplicate(duplicateProjectPlan(project, [], { withTasks: false })), /with no tasks/);
});

test('the suffix is one constant, not typed in three places', () => {
  assert.equal(COPY_SUFFIX, ' (copy)');
  assert.equal(copiedTitle('X'), `X${COPY_SUFFIX}`);
});
