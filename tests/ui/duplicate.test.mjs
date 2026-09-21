// T-0139 / NEW-019 — duplicating, where it is offered and what it writes.
//
//   1. Given a project with three phases and twelve tasks
//   2. When the user duplicates it with tasks included
//   3. Then a new project exists with the same phases, twelve fresh tasks with
//      zeroed counters and no activity, and relative plan dates preserved
//
// What a copy IS lives in src/services/duplicate.test.mjs. These hold the write
// path and the three places the audit asked for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDuplicateCommands, commandsFirst } from '../../src/services/commandPalette.js';
import { duplicateProjectPlan } from '../../src/services/duplicate.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');

const bodyOf = (name) => {
  const start = firebase.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = firebase.indexOf('\nexport ', start + 10);
  return firebase.slice(start, next > 0 ? next : undefined);
};

/* ── the write path ────────────────────────────────────────────────────── */

test('the data layer decides nothing — it asks the pure module', () => {
  assert.match(firebase, /import \{ duplicateProjectPlan, duplicateTaskPayload \} from '\.\/duplicate'/);
  assert.match(bodyOf('duplicateTask'), /duplicateTaskPayload\(task, opts\)/);
  assert.match(bodyOf('duplicateProject'), /duplicateProjectPlan\(project, tasks, opts\)/);
});

// Twelve tasks is twelve round trips otherwise, and a mis-click makes a lot of
// rows.
test('the tasks go in batches, not one write each', () => {
  const body = bodyOf('duplicateProject');
  assert.match(body, /for \(const chunk of chunkWrites\(writes\)\) \{/);
  assert.match(body, /const batch = writeBatch\(db\);/);
  assert.match(body, /batch\.set\(ref, data\)/);
});

test('a copy starts with no history, whatever the original had', () => {
  const body = bodyOf('duplicateProject');
  for (const zeroed of ['activityCount: 0', 'totalHoursLogged: 0', 'attachmentCount: 0']) {
    assert.ok(body.includes(zeroed), `a copy must not inherit ${zeroed}`);
  }
  assert.match(body, /lastActivityAt: null/);
  assert.match(body, /recurrenceParentId: null/,
    'a copy is not another occurrence of the original’s series');
});

test('ids are allocated before the dependency pass, so a link has something to point at', () => {
  const body = bodyOf('duplicateProject');
  assert.ok(body.indexOf('const ref = doc(tasksRef);') < body.indexOf('dependsOn: (payload.dependsOn'),
    'a placeholder cannot become a real id that does not exist yet');
  assert.match(body, /\.map\(\(id\) => realId\[id\]\)\.filter\(Boolean\)/);
});

test('a mis-click is one click to take back', () => {
  const body = bodyOf('undoDuplicateProject');
  assert.match(body, /deleted: true/, 'and it is a soft delete, like every other delete here');
  assert.doesNotMatch(body, /deleteDoc/);
  assert.match(body, /chunkWrites\(writes\)/, 'undoing twelve rows is one batch too');
  assert.match(bodyOf('duplicateProject'), /return \{\s*\n\s*projectId,\s*\n\s*taskIds/,
    'the undo needs to be told what was created');
});

test('duplicating nothing is refused rather than creating an empty project', () => {
  assert.match(bodyOf('duplicateTask'), /throw new Error\('There is nothing to duplicate\.'\)/);
  assert.match(bodyOf('duplicateProject'), /throw new Error\('There is nothing to duplicate\.'\)/);
});

/* ── the acceptance case, as a plan ────────────────────────────────────── */

const project = {
  id: 'p1', workspaceId: 'ws', name: 'SBLAF rollout',
  phases: [{ id: 'a', name: 'Discovery', order: 0 }, { id: 'b', name: 'Build', order: 1 }, { id: 'c', name: 'Handover', order: 2 }],
};
const twelve = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`, title: `Task ${i}`, projectId: 'p1', workspaceId: 'ws',
  phaseId: ['a', 'b', 'c'][i % 3], status: 'todo',
  plan: { startDate: `2026-09-${String(10 + i).padStart(2, '0')}`, endDate: `2026-09-${String(11 + i).padStart(2, '0')}` },
  actual: { startDate: '2026-09-01', endDate: '2026-09-02' },
  activityCount: 5, totalHoursLogged: 9, attachmentCount: 1,
}));

test('three phases, twelve fresh tasks, relative dates kept', () => {
  const plan = duplicateProjectPlan(project, twelve, { startOn: '2026-10-01' });
  assert.equal(plan.project.phases.length, 3);
  assert.equal(plan.tasks.length, 12);
  assert.equal(plan.dayShift, 21, '10 Sep → 1 Oct');
  assert.equal(plan.tasks[0].plan.startDate, '2026-10-01');
  assert.equal(plan.tasks[11].plan.startDate, '2026-10-12', 'eleven days after the first, as before');
  for (const t of plan.tasks) {
    assert.deepEqual(t.actual, { startDate: null, endDate: null });
    assert.equal(t.activityCount, undefined);
  }
});

/* ── the three places it is offered ────────────────────────────────────── */

test('the task editor offers it, next to Save as template', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  assert.match(editor, />Duplicate<\/button>/);
  assert.match(editor, /const newId = await duplicateTask\(userId, task\);/);
  assert.match(editor, /undo: async \(\) => \{ await softDeleteTask\(newId\);/,
    'a copy nobody wanted is one click to take back');
  assert.match(editor, /disabled=\{saving \|\| !task\.id\}/, 'an unsaved task has nothing to copy');
});

test('the project editor says what is about to happen before it happens', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.match(view, /const preview = duplicateProjectPlan\(project, tasks, \{ startOn: todayLocal\(\) \}\);/,
    'the question is built from the real plan, not from a guess');
  assert.match(view, /This creates \$\{describeDuplicate\(preview\)\}/);
  assert.match(view, /Nothing is copied from its history/,
    'what is NOT copied is the thing people worry about');
  assert.match(view, /confirmLabel: 'Duplicate'/);
  assert.doesNotMatch(view, /confirmLabel: 'OK'/);
  assert.match(view, /undo: async \(\) => \{ await undoDuplicateProject\(made\)/);
});

test('the palette offers it, and needs a target', () => {
  const tasks = [{ id: 't1', title: 'Board pack', projectId: 'p1' }];
  const projects = [{ id: 'p1', name: 'SBLAF rollout' }];

  const hits = buildDuplicateCommands('duplicate board', { tasks, projects });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].label, 'Duplicate “Board pack”');
  assert.equal(hits[0].entity, 'task');

  assert.deepEqual(buildDuplicateCommands('duplicate', { tasks, projects }), [],
    'a command that picks a target for you is how the wrong thing gets copied');
  assert.deepEqual(buildDuplicateCommands('board pack', { tasks, projects }), [],
    'searching is not duplicating');
});

test('"copy" and "clone" work too, because that is what people type', () => {
  const projects = [{ id: 'p1', name: 'SBLAF rollout' }];
  for (const verb of ['duplicate', 'copy', 'clone']) {
    assert.equal(buildDuplicateCommands(`${verb} sblaf`, { projects }).length, 1, verb);
    assert.equal(commandsFirst(`${verb} sblaf`), true, `${verb} should lead the palette`);
  }
});

test('deleted and archived things are not offered', () => {
  const projects = [
    { id: 'p1', name: 'Gone', deleted: true },
    { id: 'p2', name: 'Filed', archived: true },
  ];
  assert.deepEqual(buildDuplicateCommands('duplicate g', { projects }), []);
});

// Copying twelve documents straight from a search box, with no preview, is not
// a thing a palette should do.
test('the palette opens the thing rather than copying it there and then', () => {
  const shell = read('src', 'components', 'AppShell.jsx');
  const run = shell.slice(shell.indexOf('const runCommand'), shell.indexOf('const activateResult'));
  assert.match(run, /if \(cmd\.kind === 'duplicate'\)/);
  assert.match(run, /requestQuickCreate\('duplicate-project', cmd\.payload\.id\)/);
  assert.doesNotMatch(run, /await duplicateProject\(/, 'no writes from a search box');
});

test('the page the palette sends you to is listening', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.match(view, /useQuickCreate\('duplicate-project', useCallback\(\(projectId\) => \{/,
    'a command with no listener navigates somewhere and then does nothing');
  assert.match(view, /if \(projectId\) setEditing\(projectId\);/);
});
