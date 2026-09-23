// T-0138 / NEW-017 — WIP limits and column ageing, on the board.
//
//   1. Given In Progress has a limit of 3 and holds 5 tasks
//   2. When the board renders
//   3. Then the header reads 5 / 3 in a warning tone and dropping a sixth
//      shows a non-blocking warning toast
//
// The rules are in src/services/wipLimits.test.mjs. These render the real
// column header and the real card, and hold the drop path to warning rather
// than blocking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, muteConsoleError, text } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const board = () => read('src', 'components', 'Board.jsx');

setupDom();

const { CardBody } = await import('../../src/components/Board.jsx');
const { columnState, warnOnDrop } = await import('../../src/services/wipLimits.js');
const { todayLocal } = await import('../../src/services/recurrence.js');
const { addDaysISO } = await import('../../src/services/dueAlerts.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const LIMITED = { id: 'p1', name: 'BRIDGED', wipLimits: { doing: 3 } };
const TODAY = todayLocal();

/* ── the column header ─────────────────────────────────────────────────── */

// The acceptance case.
test('a limit of 3 holding 5 reads "5 / 3" and is marked over', () => {
  const s = columnState(LIMITED, 'doing', 5);
  assert.equal(s.text, '5 / 3');
  assert.equal(s.over, true);
  assert.match(s.title, /2 over the limit of 3/);
});

// The Board Explorer splits these: a plain white COUNT pill, and a separate
// WIP chip at the far end of the head. One pill reading "4 / 3" made the
// count and the policy the same number (T-0145).
test('the header renders the state, and announces it', () => {
  const src = board();
  assert.match(src, /const wip = columnState\(project, column\.id, count\);/);
  assert.match(src, /className=\{`bx-col-wip\$\{wip\.over \? ' over' : wip\.at \? ' at' : ''\}`\}/);
  assert.match(src, /aria-label=\{`\$\{column\.label\}: \$\{wip\.title\}`\}/,
    'a colour alone is not a signal — a screen reader needs the sentence');
  assert.match(src, /WIP \{wip\.count\}\/\{wip\.limit\}/);
  assert.match(src, /\{wip\.limit != null && \(/,
    'no limit, no chip — a count with nothing to compare it to is not a policy');
});

test('over and at look different from each other, and from normal', () => {
  const css = read('src', 'App.css');
  assert.match(css, /\.bx-col-wip\.at\s*\{[\s\S]*?--c-warn/);
  assert.match(css, /\.bx-col-wip\.over\s*\{[\s\S]*?--c-danger/);
});

// A limit belongs to a project, so across every project at once "5 / 3" would
// be comparing a number against a limit it does not belong to.
test('limits apply only when the board is showing one project', () => {
  assert.match(board(),
    /const wipProject = projectFilter === 'all' \? null : projectById\[projectFilter\];/);
  assert.equal(columnState(null, 'doing', 5).text, '5', 'no project, no limit, bare count');
});

/* ── the drop ──────────────────────────────────────────────────────────── */

test('dropping a sixth warns, and says by how much', () => {
  const msg = warnOnDrop(LIMITED, 'doing', 5, { columnLabel: 'In Progress' });
  assert.match(msg, /In Progress now has 6 tasks/);
  assert.match(msg, /3 over your limit of 3/);
});

// The whole point of this row's design: the write still happens.
test('the drop is never blocked — the status is written, then the warning shown', () => {
  const src = board();
  const block = src.slice(src.indexOf('if (statusChanged) {'), src.indexOf('if (phaseChanged)'));
  assert.match(block, /await setTaskStatus\(task, targetStatus\);/, 'the move must still land');
  assert.match(block, /if \(warning\) toast\.info\(warning\);/);
  assert.ok(block.indexOf('await setTaskStatus') < block.indexOf('toast.info'),
    'warn about what happened, not instead of it');
  assert.doesNotMatch(block, /return;\s*\/\/ over limit|if \(warning\) return/,
    'a hard block on a personal board is an annoyance, not a discipline');
});

test('the warning is an info toast, not an error', () => {
  const src = board();
  assert.match(src, /toast\.info\(warning\)/, 'nothing went wrong — you were told something');
  assert.doesNotMatch(src, /toast\.error\(warning\)/);
});

test('the count the warning talks about is the column before the drop', () => {
  assert.match(board(),
    /const before = filtered\.filter\(\(t\) => t\.status === targetStatus\)\.length;/);
});

/* ── the ageing badge ──────────────────────────────────────────────────── */

const card = (task, project) => mount(h(CardBody, {
  task: { id: 't', title: 'A task', status: 'doing', plan: {}, actual: {}, ...task },
  project: project ?? null,
  expanded: false,
  onToggleExpand() {}, onLog() {}, onEdit() {}, onEditActivity() {},
  dragging: false,
}));

test('a card that has sat in progress too long says so', async () => {
  const ui = await card({ actual: { startDate: addDaysISO(TODAY, -8) } });
  const badge = ui.container.querySelector('.card-ageing');
  assert.ok(badge, 'this is the signal the audit asked for');
  assert.match(badge.textContent, /8d idle/);
  assert.match(badge.getAttribute('title'), /longer than 5/);
  ui.unmount();
});

test('a card that has not been there long gets no badge', async () => {
  const ui = await card({ actual: { startDate: addDaysISO(TODAY, -1) } });
  assert.equal(ui.container.querySelector('.card-ageing'), null,
    'a badge on every card says nothing');
  ui.unmount();
});

test('only work in progress ages', async () => {
  for (const status of ['todo', 'done']) {
    const ui = await card({ status, actual: { startDate: addDaysISO(TODAY, -30) } });
    assert.equal(ui.container.querySelector('.card-ageing'), null, status);
    ui.unmount();
  }
});

test('a task in progress with no start date is not flagged', async () => {
  const ui = await card({ actual: {} });
  assert.equal(ui.container.querySelector('.card-ageing'), null,
    'a badge with nothing behind it is worse than no badge');
  assert.doesNotMatch(text(ui.container), /NaN|undefined/);
  ui.unmount();
});

test('the threshold comes from the card’s own project', async () => {
  // A board can show several projects at once, so a board-wide threshold would
  // be wrong for all but one of them.
  const patient = { id: 'p2', name: 'Slow', wipAgeingDays: 30 };
  const ui = await card({ actual: { startDate: addDaysISO(TODAY, -8) } }, patient);
  assert.equal(ui.container.querySelector('.card-ageing'), null, '8 days is fine when 30 is the limit');
  ui.unmount();

  const strict = await card({ actual: { startDate: addDaysISO(TODAY, -8) } }, { id: 'p3', wipAgeingDays: 2 });
  assert.ok(strict.container.querySelector('.card-ageing'));
  strict.unmount();

  assert.match(board(), /ageing\(task, \{ today, days: ageingDaysFor\(project\) \}\)/);
});

/* ── setting the limits ────────────────────────────────────────────────── */

test('the project editor asks in plain language, with no jargon', () => {
  const src = read('src', 'components', 'ProjectsView.jsx');
  assert.match(src, /Board limits/);
  assert.match(src, /How many tasks each column of this project’s board should hold at once/);
  assert.match(src, /Going over is a warning, never a block/,
    'the behaviour has to be stated where it is configured');
  assert.match(src, /placeholder="No limit"/, 'an empty box needs to say what empty means');
  assert.doesNotMatch(src, /wipLimits\s*JSON|<textarea[^>]*wip/i, 'nobody types JSON');
});

test('the editor uses the board’s own column names', () => {
  // The board builds its columns from TASK_STATUSES through COLUMN_LABEL
  // (T-0147), so the two maps are compared directly rather than by scraping
  // `label:` entries that no longer exist.
  const editor = read('src', 'components', 'ProjectsView.jsx');
  const names = (src, decl) => {
    const line = src.match(new RegExp(`const ${decl} = \\{([^}]*)\\}`));
    return Object.fromEntries((line[1].match(/(\w+):\s*'([^']+)'/g) || [])
      .map((pair) => pair.split(/:\s*/).map((x) => x.replace(/'/g, ''))));
  };
  assert.deepEqual(names(editor, 'WIP_LABEL'), names(board(), 'COLUMN_LABEL'),
    'the project editor and the board must call a column the same thing');
  assert.deepEqual(Object.keys(names(board(), 'COLUMN_LABEL')),
    ['todo', 'doing', 'review', 'done']);
});

test('the editor stores only real limits, through the one normaliser', () => {
  const src = read('src', 'components', 'ProjectsView.jsx');
  const writes = [...src.matchAll(/wipLimits: normalizeLimits\(wipLimits\)/g)];
  assert.equal(writes.length, 2, 'create and update must agree');
  assert.match(src, /wipAgeingDays: normalizeLimit\(wipAgeingDays\)/);
});

test('a created project carries the fields, cleaned', () => {
  const firebase = read('src', 'services', 'firebase.js');
  assert.match(firebase, /wipLimits:\s+normalizeLimits\(project\.wipLimits\)/);
  assert.match(firebase, /wipAgeingDays: project\.wipAgeingDays \?\? null/);
  assert.match(firebase, /import \{ normalizeLimits \} from '\.\/wipLimits'/);
});

/* ── T-0148: the per-column "+ Add item" is gone ──────────────────────────
   Ace asked for it: the mockup's own column ends with one, but four dashed
   buttons on a board that is now divided into project bands is four buttons
   per band. What must NOT go with it is the write path — the toolbar's
   "+ New item" and ⌘K → New task both still land in the quick-add form, and
   that form still passes a status to addTask. */

test('the per-column add button is gone, and took nothing with it', () => {
  const board = fs.readFileSync(path.join(root, 'src', 'components', 'Board.jsx'), 'utf8');
  const form  = fs.readFileSync(path.join(root, 'src', 'components', 'TaskForm.jsx'), 'utf8');

  assert.doesNotMatch(board, /\+ Add item/, 'removed on request in T-0148');
  assert.doesNotMatch(board, /onAdd\(column\.id\)/);

  // The quick-add still exists and is still reachable — it is just no longer
  // a strip standing open on every visit.
  assert.match(board, /useQuickCreate\('task'/, 'the palette and the toolbar both land here');
  assert.match(board, /\{quickAddSeed && \(/, 'shown on request rather than always');
  assert.match(board, /<TaskForm /);
  assert.match(form, /status = 'todo'/, 'a board with no column asking still defaults to To Do');
  assert.match(form, /^\s*status,$/m, 'addTask must receive it, or the form is a lie');
});
