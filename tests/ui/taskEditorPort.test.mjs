// T-0160 — the task editor, ported from Board Explorer.dc.html.
//
// The numbers here are the mockup's own, copied from the style objects in its
// <script type="text/x-dc"> block. They are pinned because a port drifts one
// padding at a time, and because the features the mockup does NOT draw
// (duplicate, templates, recurrence, custom fields, links, promote) are the
// ones a redesign quietly drops — "the mockup wins on look; the app wins on
// coverage" (docs/PORTING-A-MOCKUP.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const editor = () => read('src', 'components', 'TaskEditor.jsx');
const css = () => read('src', 'App.css');

/* ── the mockup's own geometry ──────────────────────────────────────────── */

test('the shell keeps the mockup’s measurements', () => {
  const c = css();
  assert.match(c, /\.te-modal \{[\s\S]*?max-width: 1020px/, 'the modal is 1020px wide');
  assert.match(c, /\.te-backdrop \{[\s\S]*?background: rgba\(15, 39, 64, 0\.55\)/);
  assert.match(c, /\.te-backdrop \{[\s\S]*?padding: 40px 44px/);
  assert.match(c, /\.te-nav \{[\s\S]*?padding: 11px 20px/);
  assert.match(c, /\.te-primary \{[\s\S]*?border-left: 4px solid var\(--c-accent\)/,
    'the orange rail down the primary block');
  assert.match(c, /\.te-body \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.05fr\)/,
    'the right column is the slightly wider one');
  assert.match(c, /\.te-title \{[\s\S]*?font-size: 21px/);
  assert.match(c, /\.te-tab\.is-on \{[\s\S]*?border-bottom-color: var\(--c-accent\)/);
});

test('the title is the display face, like every other ported heading', () => {
  assert.match(css(), /\.te-title \{[\s\S]*?font-family: var\(--font-display\)/);
});

/* ── the five tabs, in the mockup's order ───────────────────────────────── */

test('the right column carries the mockup’s five tabs, in its order', () => {
  const src = editor();
  const keys = [...src.matchAll(/\{ key: '([a-z]+)',\s+icon:/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['details', 'ai', 'activity', 'subitems', 'files']);
});

/* ── the trap this port actually hit ────────────────────────────────────── */

test('the nav strip never inverts to white-on-white in dark', () => {
  const c = css();
  // `background: var(--c-text)` with `color: #fff` is navy-on-white in light
  // and white-on-white in dark — the pitfall CLAUDE.md lists, and the one this
  // port hit. The strip is chrome: it stays navy in all three theme blocks.
  assert.match(c, /\.te-nav \{[\s\S]*?background: var\(--c-te-nav\)/);
  assert.doesNotMatch(c, /\.te-nav \{[\s\S]*?background: var\(--c-text\)/);
  const navDecls = [...c.matchAll(/--c-te-nav:\s*#16324d/g)];
  assert.equal(navDecls.length, 3, 'declared in :root and BOTH dark blocks');
});

test('every token this port added is in all three theme blocks', () => {
  const c = css();
  for (const tok of ['--c-check-ring', '--c-panel-warm', '--c-te-nav']) {
    const n = [...c.matchAll(new RegExp(`${tok}:`, 'g'))].length;
    assert.equal(n, 3, `${tok} must be declared three times — :root, the media query and [data-theme="dark"]`);
  }
});

/* ── features the mockup does not draw, which must survive anyway ───────── */

test('nothing the old editor could do was dropped to match a screenshot', () => {
  const src = editor();
  for (const [what, re] of [
    ['duplicate',      /onClick=\{duplicate\}/],
    ['delete',         /onClick=\{remove\}/],
    ['save template',  /onClick=\{saveAsTemplate\}/],
    ['promote subtask',/promoteSubtask\(s\)/],
    ['reorder subtask',/moveSubtask\(i, -1\)/],
    ['recurrence',     /<RecurrenceEditor/],
    ['custom fields',  /<CustomFieldsForm/],
    ['links',          /<LinksEditor/],
    ['dependencies',   /<DepPicker/],
    ['assignees',      /<TaskAssigneeSection/],
    ['comments',       /<CommentsThread/],
    ['AI',             /<TaskAiPanel/],
    ['activity log',   /<ActivityTimeline/],
    ['log composer',   /<LogComposer/],
    ['tags',           /addTag\(tagInput\)/],
    ['presence',       /<PresenceStack/],
  ]) {
    assert.match(src, re, `${what} must survive the port`);
  }
});

test('the status the editor PRINTS is the board’s own function', () => {
  const src = editor();
  // Not a fourth private label map: the mockup's status field reads "Stuck",
  // which is exactly what displayStatus computes, and the editor must not be
  // able to disagree with the Kanban card about it.
  assert.match(src, /import \{ displayStatus, STATUS_TEXT \} from '\.\.\/services\/boardScope'/);
  assert.match(src, /const shown = displayStatus\(/);
  assert.match(src, /TASK_STATUSES\.map/, 'all four statuses, from the one vocabulary');
});

/* ── what it replaced is gone ───────────────────────────────────────────── */

test('the old children block went with the design it belonged to', () => {
  const c = css();
  for (const dead of ['.pe-children', '.pe-child-dot', '.pe-child-title', '.pe-kind-task']) {
    assert.ok(!c.includes(dead + ' '), `${dead} should have been removed`);
    assert.ok(!c.includes(dead + ' {'), `${dead} should have been removed`);
  }
  // …but the rest of the family stays: ProjectsView and ActivityTimeline are
  // built from it, and some of it is addressed dynamically (`pe-tone-${tone}`).
  assert.match(c, /\.pe-tone-muted/, 'still reachable as pe-tone-${tone}');
  assert.match(c, /\.pe-pill-amber/, 'still reachable as pe-pill-${tone}');
});

test('the editor no longer draws the old hero', () => {
  const src = editor();
  assert.doesNotMatch(src, /className="pe-hero/);
  assert.doesNotMatch(src, /className="pe-modal"/);
  assert.match(src, /className="te-modal"/);
});
