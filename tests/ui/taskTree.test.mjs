// T-0141 / NEW-025 — a promoted subtask that is still part of its parent.
//
//   1. Given a task with a promoted subtask
//   2. When the parent is opened
//   3. Then the child is listed under it with its own status and hours, and the
//      parent's progress includes it
//
// The rollup arithmetic and the cycle guards are in
// src/services/taskTree.test.mjs. These hold the three surfaces to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHILD_OF, rollup } from '../../src/services/taskTree.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const editor = () => read('src', 'components', 'TaskEditor.jsx');

/* ── promote keeps the parent ──────────────────────────────────────────── */

// It used to write 'related-to', which lost the hierarchy at exactly the moment
// a checklist item started needing dates, an owner or its own log.
test('promoting writes the parent link, not a loose "related to"', () => {
  const src = editor();
  const fn = src.slice(src.indexOf('const promoteSubtask'), src.indexOf('const promoteSubtask') + 1200);
  assert.match(fn, /links: \[\{ targetId: task\.id, type: CHILD_OF \}\]/);
  assert.doesNotMatch(fn, /type: 'related-to'/);
});

test('the confirmation says the task stays underneath', () => {
  const src = editor();
  assert.match(src, /stays listed under this task/);
  assert.match(src, /still counts towards this task\\u2019s progress|still counts towards this task’s progress/);
});

test('"is part of" and "contains" are offerable relations', () => {
  const src = editor();
  assert.match(src, /\{ value: CHILD_OF,\s+label: 'is part of'/);
  assert.match(src, /\{ value: PARENT_OF,\s+label: 'contains'/);
  // Plain language: nobody picks "child-of" from a dropdown.
  assert.doesNotMatch(src, /label: 'child-of'/);
  assert.doesNotMatch(src, /label: 'parent-of'/);
});

/* ── the acceptance case ───────────────────────────────────────────────── */

const parent = {
  id: 'p', title: 'Ship the pilot', status: 'doing', progress: 0,
  subtasks: [{ id: 's1', text: 'Draft', done: true }, { id: 's2', text: 'Review', done: false }],
  links: [], totalHoursLogged: 2,
};
const child = {
  id: 'c', title: 'Book the venue', status: 'done', totalHoursLogged: 5,
  links: [{ targetId: 'p', type: CHILD_OF }], subtasks: [],
};

test('the child is listed under the parent, with its status and its hours', () => {
  const r = rollup(parent, [parent, child]);
  assert.equal(r.hasChildren, true);
  assert.deepEqual(r.children.map((c) => c.id), ['c']);
  assert.equal(r.children[0].status, 'done');
  assert.equal(r.hours, 7, 'the parent carries what was logged underneath it');
});

test('the parent’s progress includes it', () => {
  const r = rollup(parent, [parent, child]);
  assert.equal(r.units, 3, 'two checklist lines and one promoted task');
  assert.equal(r.unitsDone, 2);
  assert.equal(r.progress, 67);
});

test('the editor computes the rollup from the checklist ON SCREEN', () => {
  // Ticking a box has to move the bar before the save, as it always did.
  const src = editor();
  assert.match(src, /const tree = rollup\(\{ \.\.\.task, subtasks \}, allTasks\);/);
  assert.match(src, /const completionPct = tree\.units === 0 \? null : tree\.progress;/);
});

test('the editor renders the children with their status and hours', () => {
  const src = editor();
  assert.match(src, /\{tree\.hasChildren && \(/);
  assert.match(src, /Inside this task · \{tree\.childrenDone\}\/\{tree\.childCount\} done/);
  assert.match(src, /\{tree\.hours\.toFixed\(1\)\}h logged across all of it/);
  assert.match(src, /STATUS_META\[c\.status\]\?\.label/, 'a status in words, not a code');
});

test('the bar says where its number came from', () => {
  const src = editor();
  assert.match(src, /\{explainRollup\(tree\) && <> · \{explainRollup\(tree\)\}<\/>\}/,
    'a percentage that changed for an invisible reason is a percentage nobody trusts');
});

test('clicking a child opens it the way everything else opens a task', () => {
  const src = editor();
  assert.match(src, /onClick=\{\(\) => \{ onClose\(\); requestOpenTask\(c\.id\); \}\}/);
  assert.match(src, /import \{ requestOpenTask \} from '\.\.\/services\/openTask'/,
    'navigating by hand is how three surfaces come to behave differently');
});

/* ── the table ─────────────────────────────────────────────────────────── */

const ctx = { projectById: {}, memberProfiles: {}, projects: [] };
const tasks = [
  { ...parent, projectId: null, plan: {}, actual: {} },
  { ...child, projectId: null, plan: {}, actual: {} },
  { id: 'x', title: 'Unrelated', status: 'todo', links: [], subtasks: [], plan: {}, actual: {} },
];

// With a grouping applied, something else is already deciding the order, and an
// indent would claim a relationship the row order does not have.

/* ── the rollup feeds the things that already read progress ────────────── */

test('a task with nothing underneath is unaffected', () => {
  const plain = { id: 'z', status: 'doing', progress: 40, subtasks: [], links: [] };
  assert.equal(rollup(plain, [plain]).progress, 40, 'the dashboard RAG must not shift under a task nobody touched');
  assert.equal(rollup(plain, [plain]).source, 'own');
});

test('the tree module is pure, so the arithmetic can be checked', () => {
  const src = read('src', 'services', 'taskTree.js');
  assert.doesNotMatch(src, /from '\.\/firebase'/);
  assert.doesNotMatch(src, /new Date\(\)/, 'no clock of its own');
});
