// T-0148 — the Board hub rebuilt to `Board Explorer.dc.html`.
//
// Six tabs were ported in one pass: Kanban, Table, WBS, Workload, Flow, Item.
// These guards exist because the three things that go wrong with a port all
// look fine in a screenshot:
//
//   1. the old markup is left behind and two designs ship at once;
//   2. a metric drifts — 13px becomes 13.5px — and the page stops being the
//      mockup while still looking roughly like it;
//   3. a control is "removed" without being re-homed, and a feature quietly
//      becomes unreachable.
//
// The numbers asserted here are the mockup's OWN, copied from the style
// objects in its <script type="text/x-dc"> block, not measured off a picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'App.css');
const board = read('src', 'components', 'Board.jsx');

/* ── 1. the old Kanban is gone ─────────────────────────────────────────── */

const RETIRED = [
  '.board', '.column', '.column-head', '.column-add', '.column-fill',
  '.task-card', '.tc-rail', '.tc-prog', '.swim-lane', '.swim-lanes',
  '.board-segment', '.droppable', '.tag-filter-bar', '.kchip', '.kflag',
  // T-0149 — the WBS's Gantt-in-a-table went the same way.
  '.wbsx', '.wbs-card', '.wbs-code', '.flow-node', '.flow-row', '.age-row', '.age-list',
];

test('the classes the old board was built from are gone from the stylesheet', () => {
  const alive = RETIRED.filter((cls) => {
    // a rule START, not a mention inside a comment or a longer class
    const re = new RegExp(`^\\${cls}(\\s|\\{|,|\\.|:)`, 'm');
    return re.test(css);
  });
  assert.deepEqual(alive, [],
    'two designs shipping at once is the failure this whole file is about');
});

test('…and nothing renders them either', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsx'))) {
    const src = read('src', 'components', f);
    for (const cls of ['task-card"', 'kchip', 'kflag', 'tc-rail', 'column-add', 'TagFilterBar', 'wbsx-']) {
      if (src.includes(cls)) offenders.push(`${f}: ${cls}`);
    }
  }
  assert.deepEqual(offenders, []);
});

/* ── 2. the mockup's own metrics ───────────────────────────────────────── */

test('the card is the mockup’s card, to the pixel', () => {
  assert.match(css, /\.bx-kc\s*\{[\s\S]*?border-radius:\s*14px/,   'radius 14px');
  assert.match(css, /\.bx-kc\s*\{[\s\S]*?padding:\s*13px 14px 13px 16px/, 'the mockup’s asymmetric padding');
  assert.match(css, /\.bx-kc-title\s*\{[\s\S]*?font-size:\s*13px[\s\S]*?font-weight:\s*600/);
  assert.match(css, /\.bx-kc-title\s*\{[\s\S]*?line-height:\s*1\.35/);
  assert.match(css, /\.bx-kc-rail\s*\{[\s\S]*?width:\s*3px/);
  assert.match(css, /\.bx-kc-prog\s*\{[\s\S]*?height:\s*5px/);
  assert.match(css, /\.bx-kc-due\s*\{[\s\S]*?font-size:\s*10\.5px/);
});

test('a status chip is a FILL with white text, not a soft tint', () => {
  assert.match(css, /\.bx-st\s*\{[\s\S]*?font-size:\s*10\.5px[\s\S]*?font-weight:\s*700/);
  assert.match(css, /\.bx-st\s*\{[\s\S]*?padding:\s*4px 10px[\s\S]*?border-radius:\s*5px/);
  for (const [cls, token] of [
    ['st-done', '--c-st-done'], ['st-doing', '--c-st-doing'],
    ['st-stuck', '--c-st-stuck'], ['st-review', '--c-st-review'],
  ]) {
    assert.match(css, new RegExp(`\\.bx-st\\.${cls}\\s*\\{[^}]*var\\(${token}\\)`), cls);
  }
  // "Not started" is the one that is NOT a saturated fill.
  assert.match(css, /\.bx-st\.st-todo\s*\{[^}]*var\(--c-st-idle\)[^}]*var\(--c-st-idle-ink\)/);
});

test('the solid chip colours are the mockup’s ST map, and have dark values', () => {
  assert.match(css, /--c-st-done:\s*#137a36/);
  assert.match(css, /--c-st-doing:\s*#e2892e/);
  assert.match(css, /--c-st-stuck:\s*#e2445c/);
  assert.match(css, /--c-st-review:\s*#1D7CC7/);
  assert.match(css, /--c-st-idle:\s*#e6eaef/);
  // Both dark blocks, every time — editing one is the commonest mistake here.
  const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  assert.match(media, /--c-st-done:/, 'the @media dark block');
  const attr = css.slice(css.indexOf(':root[data-theme="dark"]'));
  assert.match(attr, /--c-st-done:/, 'the [data-theme="dark"] block');
});

test('the column head is the mockup’s four things in a row', () => {
  assert.match(css, /\.bx-col-name\s*\{[\s\S]*?font-family:\s*var\(--font-display\)[\s\S]*?font-size:\s*13\.5px/);
  assert.match(css, /\.bx-col-count\s*\{[\s\S]*?font-size:\s*11px[\s\S]*?font-weight:\s*800/);
  assert.match(css, /\.bx-col-dot\s*\{[\s\S]*?width:\s*10px/);
  assert.match(board, /className="bx-col-count"/);
  assert.match(board, /\{wip\.limit != null && \(/,
    'no limit, no chip — a count with nothing to compare it to is not a policy');
});

/* ── 3. the structure Ace asked for ────────────────────────────────────── */

test('the column headers are drawn ONCE, above the bands', () => {
  // One <ColumnHead> loop outside the band loop, and none inside it.
  const headLoop = board.match(/<div className="bx-cols"[\s\S]*?<\/div>/);
  assert.ok(headLoop, 'the header row must exist');
  assert.match(board, /COLUMNS\.map\(\(col\) => \(\s*<ColumnHead/,
    'the heads are their own row, not repeated per band');
});

test('the FIRST band is open, the rest are not, and a shut band still counts', () => {
  // Ace asked for the first band to open (T-0159). That makes the state
  // three-valued — open / shut / nobody-has-said — and the whole rule lives in
  // services/boardBands.js so the component cannot grow a second copy of it.
  assert.match(board, /from '\.\.\/services\/boardBands'/);
  assert.match(board, /isBandOpen\(expandedSegments, id, index\)/);
  assert.ok(!/expandedSegments\[id\] === true/.test(board),
    'the two-valued test is gone — it cannot express "nobody has said"');

  // The trap: Collapse all must write explicit falses. `{}` means "nobody has
  // said", and the default would reopen the first band immediately.
  assert.match(board, /setExpandedSegments\(collapseAll\(bands\)\)/);
  assert.match(board, /setExpandedSegments\(expandAll\(bands\)\)/);
  assert.ok(!/setExpandedSegments\(\{\}\)/.test(board),
    'Collapse all would visibly fail to collapse the first band');

  assert.match(board, /\{!open && \(\s*<span className="bx-band-counts">/,
    'a collapsed band must still print its per-column counts');
  assert.match(board, /aria-expanded=\{open\}/);
});

test('…and the rule itself is covered where it can be run, not just read', async () => {
  const { isBandOpen, collapseAll } = await import('../../src/services/boardBands.js');
  assert.equal(isBandOpen({}, 'a', 0), true);
  assert.equal(isBandOpen({}, 'b', 1), false);
  assert.equal(isBandOpen({ a: false }, 'a', 0), false, 'shutting the first band sticks');
  assert.equal(isBandOpen(collapseAll([{ id: 'a' }]), 'a', 0), false);
});

test('the bands are projects across the portfolio and phases inside one project', () => {
  assert.match(board, /if \(selectedProject\) \{/);
  assert.match(board, /const bandIsPhase = !!selectedProject;/,
    'a drop between bands must move the PHASE, never reassign the project');
  assert.match(board, /never\s+the\s*\n\s*\/\/ project in the first/,
    'and the reason has to be written down');
});

test('there is no "+ Add item" and no permanently-open quick-add', () => {
  assert.doesNotMatch(board, /\+ Add item/, 'removed on request');
  assert.match(board, /\{quickAddSeed && \(/, 'the form appears when asked for');
  assert.match(board, /useQuickCreate\('task'/, 'and both callers still reach it');
});

test('no card, table row or outline row carries a tag chip any more', () => {
  for (const f of ['Board.jsx', 'WBSView.jsx']) {
    assert.doesNotMatch(read('src', 'components', f), /tag-pill/, `${f} still draws tags`);
  }
});

/* ── 4. the other five tabs were ported too ────────────────────────────── */

test('every ported tab uses the shared panel, not its own card', () => {
  assert.match(css, /\.bx-panel\s*\{[\s\S]*?border-radius:\s*16px/);
  assert.match(css, /\.bx-panel\s*\{[\s\S]*?box-shadow:\s*var\(--c-panel-shadow\)/);
});

test('the WBS and the Item page print the same status the board does', () => {
  assert.match(read('src', 'components', 'WBSView.jsx'), /className=\{`bx-st st-\$\{shownStatus\.id\}/);
  assert.match(read('src', 'components', 'WBSView.jsx'), /displayStatus\(t, blockedIds/);
});

test('Workload keeps the cap notch and says the cap in the legend', () => {
  const wl = read('src', 'components', 'WorkloadView.jsx');
  assert.match(wl, /className="wl-notch"/);
  assert.match(wl, /wl-leg-line/);
  assert.match(css, /\.wl-name \{ width: 104px/, 'the mockup’s own 104px');
  assert.match(wl, /title=\{`\$\{p\.name\}/, 'so a truncated name is still readable');
});

/* ── 5. the tour still points at something that exists ─────────────────── */

test('the tutorial was re-pointed with the markup', () => {
  // The lessons moved to services/tutorials.js in T-0158; the selectors they
  // aim at did not change, so this guard just follows them.
  const tour = read('src', 'services', 'tutorials.js');
  assert.doesNotMatch(tour, /selector: '\.task-card'/, 'that class no longer exists');
  assert.match(tour, /selector: '\.bx-kc'/);
  // "+ New item" was removed from the toolbar in T-0161 (the project picker
  // took its place), so the lesson aims at the columns and names the keys.
  assert.doesNotMatch(tour, /selector: '\.bt-new'/, 'that button no longer exists');
  assert.match(tour, /Press \*\*⌘K\*\*/, 'the tour has to say how a task is created now');
  assert.doesNotMatch(tour, /Three columns/, 'there are four');
});

/* ── 6. T-0149: the WBS is an outline, not a timeline ──────────────────── */

const wbs = read('src', 'components', 'WBSView.jsx');

test('the WBS keeps the mockup\u2019s three indents, to the pixel', () => {
  assert.match(css, /\.wbs-proj\s*\{[\s\S]*?padding:\s*12px 16px/);
  assert.match(css, /\.wbs-phase\s*\{[\s\S]*?padding:\s*9px 16px 9px 40px/);
  assert.match(css, /\.wbs-item\s*\{[\s\S]*?padding:\s*8px 16px 8px 70px/);
  assert.match(css, /\.wbs-proj-name\s*\{[\s\S]*?font-size:\s*13\.5px[\s\S]*?font-weight:\s*800/);
  assert.match(css, /\.wbs-pname\s*\{[\s\S]*?font-size:\s*12\.5px[\s\S]*?font-weight:\s*700/);
  assert.match(css, /\.wbs-ititle\s*\{[\s\S]*?font-size:\s*12\.5px[\s\S]*?font-weight:\s*600/);
  assert.match(css, /\.wbs-icode\s*\{[\s\S]*?width:\s*26px/);
  assert.match(css, /\.wbs-badge\s*\{[\s\S]*?font-size:\s*9\.5px[\s\S]*?font-weight:\s*800/);
});

test('the timeline the WBS used to carry is gone, with its zoom', () => {
  assert.doesNotMatch(wbs, /ZOOMS/,        'the day-grid zoom preset went with the grid');
  assert.doesNotMatch(wbs, /wbsx-/,        'the old grid classes');
  assert.doesNotMatch(wbs, /barGeom|todayLeft|dayHeaders|gridCols/, 'and its geometry');
  assert.doesNotMatch(wbs, /wbsx-summary|ring-pct/, 'and the progress-ring band');
});

test('\u2026and what it carried that exists nowhere else survived', () => {
  assert.match(wbs, /activeTodayIds/,      'the "logged activity today" tick');
  assert.match(wbs, /className="wbs-today"/);
  assert.match(wbs, /className="wbs-sub"/, 'subtasks, as a fourth indent');
  // Clicking a row opened a read-only activity table until T-0162; it opens
  // the TASK EDITOR now, whose Activity tab is that same log — and which took
  // the table's Export ▾ with it, so the modal could go rather than leaving
  // two doors onto one thing.
  assert.match(wbs, /onOpen=\{\(\) => setEditingTask\(t\)\}/, 'clicking a row opens the task');
  assert.ok(!wbs.includes('ScopedActivityLogModal'), 'and the modal it replaced is gone');
  assert.match(wbs, /<TaskEditor/);
  assert.match(wbs, /newTaskDraft\(/,      '+ New task opens the same editor, on an unsaved task');
  assert.match(wbs, /STATUS_FILTERS/,      'the status filter moved to the title block, not away');
});

test('a project name is darkened ink, never the raw brand colour', () => {
  // #e2892e at 13.5px on a cream band is a smudge; the mockup carries a
  // hard-coded pair for its two problem colours, color-mix does it for any.
  assert.match(wbs, /function inkOf/);
  assert.match(wbs, /color-mix\(in srgb, \$\{color\} 62%, var\(--c-text\)\)/);
  assert.match(wbs, /style=\{\{ color: inkOf\(project\.color\) \}\}/);
});

test('the WBS still prints the same status word as the board', () => {
  assert.match(wbs, /displayStatus\(t, blockedIds, fmtDate\(today\)\)/);
  assert.match(wbs, /className=\{`bx-st st-\$\{shownStatus\.id\}`\}/);
});

test('the harness twin was rebuilt with it', () => {
  const shell = read('dev', 'shell.jsx');
  assert.doesNotMatch(shell, /wbsx-/, 'a stale twin is worse than none — it verifies the old design');
  assert.match(shell, /className="wbs-item"/);
});
