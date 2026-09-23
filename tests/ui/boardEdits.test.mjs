// T-0162 — eight changes asked for across the Board hub and the editors.
//
// Each guard here is a decision that is invisible in a screenshot and easy to
// undo by accident: a sticky header that stops sticking because a parent got
// `overflow: hidden` back, a default that creeps back into a new project, a
// "New task" button quietly re-pointed at the small dialog it replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'App.css');

/* ── Gantt: the ruler follows you down the page ─────────────────────────── */

test('the Gantt’s date headers stay put while the rows scroll', () => {
  const gantt = read('src', 'components', 'GanttView.jsx');
  assert.match(gantt, /className="gc-rulers"/, 'both ruler rows travel together');
  const block = css.slice(css.indexOf('.gc-rulers {'), css.indexOf('.gc-rulers {') + 160);
  assert.match(block, /position: sticky/);
  assert.match(block, /top: 0/);

  // The trap: `.bcard` is `overflow: hidden`, which makes the card its own
  // scroll container — and a sticky child of a box that never scrolls never
  // sticks. `clip` clips the rounded corners without doing that.
  const card = css.slice(css.indexOf('.gantt-card {'), css.indexOf('.gantt-card {') + 80);
  assert.match(card, /overflow: clip/);
  assert.ok(!/\.gantt-card \{[^}]*overflow: hidden/.test(css));
});

test('a short window names each day under its week', () => {
  const gantt = read('src', 'components', 'GanttView.jsx');
  assert.match(gantt, /const DAY_LETTERS = \['S', 'M', 'T', 'W', 'T', 'F', 'S'\]/);
  assert.match(gantt, /range\.total <= DAY_ROW_MAX/,
    'the row is asked for by WIDTH — at a quarter the letters are a grey smear');
  // One cell per day across the same track the week columns share, or a letter
  // sits under the wrong day, which is worse than no letters at all.
  assert.match(gantt, /gridTemplateColumns: `repeat\(\$\{range\.total\}, 1fr\)`/);
  assert.match(css, /\.gc-day\.is-today \{/, 'today is findable in the row');
});

/* ── WBS: a row opens the task ──────────────────────────────────────────── */

test('the WBS card no longer prints its own hierarchy note', () => {
  for (const file of [read('src', 'components', 'WBSView.jsx'), read('dev', 'shell.jsx')]) {
    assert.ok(!file.includes('project › phase › item'),
      'removed on request — the indents say it, and the harness twin has to move too');
  }
});

/* ── One editor for creating and for editing ────────────────────────────── */

test('“New task” opens the editor, not a four-field dialog in front of it', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  assert.match(editor, /export function newTaskDraft\(/);
  assert.match(editor, /const isNew = !task\.id;/);
  // The create writes through the SAME addTask every other create path uses,
  // so a task made here is stamped by `statusStamps` like any other.
  assert.match(editor, /if \(isNew\) \{[\s\S]{0,900}?await addTask\(userId, \{/);

  for (const file of ['GanttView.jsx', 'WBSView.jsx', 'CalendarView.jsx']) {
    const src = read('src', 'components', file);
    assert.match(src, /newTaskDraft\(\{ workspaceId:/, `${file} should open the editor`);
    assert.ok(!src.includes('TaskQuickAdd'), `${file} still opens the old quick-add`);
  }
});

test('what needs a saved task says so, rather than failing quietly', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  // A comment, an hours entry, a promoted subtask and presence all need a
  // document to point at. None of them may be offered before there is one.
  assert.match(editor, /\{isNew \? \(\s*\n\s*<p className="te-empty">Create the task first/);
  assert.match(editor, /\{isNew \? \(\s*\n\s*<p className="te-hint">Hours are logged against a saved task/);
  assert.match(editor, /\{!isNew && <PresenceStack/);
  assert.match(editor, /\{!isNew && \(\s*\n\s*<button type="button" className="te-iconbtn te-sub-btn"[^\n]*promoteSubtask/);
});

/* ── A new project starts empty ─────────────────────────────────────────── */

test('a new project has no phases until somebody adds one', () => {
  const view = read('src', 'components', 'ProjectsView.jsx');
  assert.ok(!view.includes("name: 'Planning'"), 'Planning · Execution · Review was a guess');
  assert.match(view, /seed\?\.phases\?\.length \? seed\.phases\.map[\s\S]{0,120}?:\s*\[\]/);
  // …and with none as the starting point, the LAST phase has to be removable
  // too, or a project can never get back to where it began.
  assert.ok(!view.includes('disabled={phases.length === 1}'));
  assert.match(view, /No phases yet/, 'and the empty state says what that means');
});
