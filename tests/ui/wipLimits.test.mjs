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

test('the header renders the state, and announces it', () => {
  const src = board();
  assert.match(src, /const wip = columnState\(project, column\.id, count\);/);
  assert.match(src, /className=\{`count\$\{wip\.over \? ' is-over' : wip\.at \? ' is-at' : ''\}`\}/);
  assert.match(src, /aria-label=\{`\$\{column\.label\}: \$\{wip\.title\}`\}/,
    'a colour alone is not a signal — a screen reader needs the sentence');
  assert.match(src, />\{wip\.text\}</);
});

test('over and at look different from each other, and from normal', () => {
  const css = read('src', 'App.css');
  assert.match(css, /\.column-head \.count\.is-at \{[\s\S]*?--c-warn/);
  assert.match(css, /\.column-head \.count\.is-over \{[\s\S]*?--c-danger/);
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
  assert.match(badge.textContent, /8d in progress/);
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
  const src = read('src', 'components', 'ProjectsView.jsx');
  assert.match(src, /const WIP_LABEL = \{ todo: 'To Do', doing: 'In Progress', done: 'Done' \};/);
  const boardCols = board().match(/label: '([^']+)'/g) || [];
  for (const label of ["'To Do'", "'In Progress'", "'Done'"]) {
    assert.ok(boardCols.some((c) => c.includes(label.slice(1, -1))), `board lost ${label}`);
  }
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
