// T-0145 — the Board Explorer, tab by tab.
//
// The mockup draws eight tabs and one toolbar above all of them. The risk it
// creates is a toolbar that lies: a filter drawn on every page and honoured by
// six of them. So these guards check the wiring, not the pixels — every Board
// page must be routed, must take the route, and must put it through the one
// module that decides what Mine and Stuck mean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const { HUBS, VIEW_REGISTRY, hubForView, tabsForView } = await import('../../src/services/views.js');

const app   = read('src', 'App.jsx');
const shell = read('src', 'components', 'AppShell.jsx');

// Every page the Board hub owns, and the component behind it.
// Five, not the Explorer's eight: Table, Flow and Item were deleted in
// T-0152 at Ace's request — see the "what happened to each mockup tab"
// table in CLAUDE.md for what went with them.
const BOARD_PAGES = {
  board:         'Board.jsx',
  calendar:      'CalendarView.jsx',
  gantt:         'GanttView.jsx',
  wbs:           'WBSView.jsx',
  workload:      'WorkloadView.jsx',
};

test('the Board hub holds its five tabs, schedule first', () => {
  // The Explorer draws Kanban first. Ace asked for it AFTER Gantt, so the
  // strip reads as the schedule (when the work is) and then the board (what
  // state it is in). The rail still opens the Kanban — see `landing` in
  // services/views.js and the guard in tests/ui/hubs.test.mjs.
  const hub = HUBS.find((h) => h.id === 'board');
  assert.deepEqual(
    hub.tabs.map((t) => t.view),
    ['calendar', 'gantt', 'board', 'wbs', 'workload'],
  );
  assert.deepEqual(
    tabsForView('board').map((t) => t.label),
    ['Calendar', 'Gantt', 'Kanban', 'WBS', 'Workload'],
  );
});

// The deletion has to be total. A tab left pointing at a component that is
// gone is a Not Found; a component left behind with no tab is dead code that
// still has to be maintained.
test('Table, Flow and Item are gone from every list that named them', () => {
  for (const view of ['tasks-table', 'flow', 'item']) {
    assert.ok(!VIEW_REGISTRY.some((v) => v.id === view), `${view} is still in the registry`);
    assert.ok(!app.includes(`route.view === '${view}'`), `${view} still has a route`);
  }
  for (const file of ['TasksTableView.jsx', 'FlowView.jsx', 'ItemView.jsx']) {
    assert.ok(!fs.existsSync(path.join(root, 'src', 'components', file)), `${file} is still on disk`);
  }
  for (const file of ['tableViews.js', 'bulkTasks.js']) {
    assert.ok(!fs.existsSync(path.join(root, 'src', 'services', file)),
      `${file} had no other caller and should have gone with the page`);
  }
  assert.ok(!fs.existsSync(path.join(root, 'src', 'hooks', 'useBulkTasks.js')));
});

// chunkWrites is the one thing that had to survive: duplicateProject and two
// other writers in firebase.js batch through it.
test('the batching the bulk bar shared with duplicateProject was kept', () => {
  assert.ok(fs.existsSync(path.join(root, 'src', 'services', 'writeBatches.js')));
  assert.match(read('src', 'services', 'firebase.js'), /from '\.\/writeBatches'/);
});

test('every Board tab is a real, routed, registered page', () => {
  Object.entries(BOARD_PAGES).forEach(([view, file]) => {
    assert.ok(VIEW_REGISTRY.some((v) => v.id === view), `${view} is not in the registry`);
    assert.equal(hubForView(view)?.id, 'board', `${view} is not in the Board hub`);
    assert.ok(app.includes(`route.view === '${view}'`), `${view} has no route branch`);
    assert.ok(fs.existsSync(path.join(root, 'src', 'components', file)), `${file} is missing`);
  });
});

// The whole point of a shared toolbar is that it is shared. Eight copies is
// how the Kanban and the Timeline come to disagree about how much work there
// is — the same failure as NAV_TARGETS, VIEW_NAMES and BOTTOM_TABS.
test('the toolbar is drawn once, by the shell, for the whole hub', () => {
  assert.match(shell, /<BoardToolbar route=\{route\} navigate=\{navigate\} \/>/);
  assert.match(shell, /activeHub\?\.id === 'board'/,
    'the shell must ask the hub registry, not carry its own list of Board pages');

  Object.values(BOARD_PAGES).forEach((file) => {
    assert.ok(!read('src', 'components', file).includes('<BoardToolbar'),
      `${file} draws its own toolbar — there must be exactly one`);
  });
});

test('every Board page applies the toolbar it is shown under', () => {
  // A page that ignores the filter shows a different number from its
  // neighbours, and the user has no way of telling which one is wrong.
  Object.entries(BOARD_PAGES).forEach(([view, file]) => {
    const src = read('src', 'components', file);
    assert.match(src, /route = \{\}/, `${file} does not take the route`);
    assert.match(src, /scopeTasks\(/, `${file} does not apply the shared filter`);
    assert.match(src, /from '\.\.\/services\/boardScope'/,
      `${file} must use the one definition of Mine and Stuck, not write its own`);
    assert.ok(app.includes(`route.view === '${view}'`) && app.match(
      new RegExp(`route\\.view === '${view}'[^\\n]*route=\\{route\\}`),
    ), `App.jsx does not hand ${view} the route`);
  });
});

test('nobody redefines what Stuck means', () => {
  // The definition lives in one pure module. A component that rebuilds it
  // from bottleneckRemarks is the second copy this guard exists to stop.
  const offenders = Object.values(BOARD_PAGES).filter((file) => {
    const src = read('src', 'components', file);
    return /const\s+\w*[Ss]tuck\w*\s*=\s*\(?.*bottleneckRemarks/.test(src);
  });
  assert.deepEqual(offenders, []);
});

test('the route carries the toolbar and the open item across a navigation', () => {
  assert.match(shell, /stuckOnly:\s+params\.get\('stuck'\)\s+=== '1'/);
  assert.match(shell, /who:\s+params\.get\('who'\)/);
  assert.match(shell, /itemId:\s+params\.get\('item'\)/);
  ['stuck', 'who', 'item'].forEach((key) => {
    assert.ok(shell.includes(`params.set('${key}'`), `setHash drops ?${key}=`);
  });
});

test('the Workload bar says when its hours were assumed', () => {
  // A full bar the reader believes is measured, when half of it was a 4h
  // fallback, is the oldest trap on this page.
  const src = read('src', 'components', 'WorkloadView.jsx');
  assert.match(src, /assumed/);
  assert.match(src, /HOURS_PER_TASK/);
});

// The numbering is the thing people quote in a status meeting, so it is the
// one part of the WBS that must survive any restyle. T-0149 rebuilt the page
// to the mockup; the codes moved class but not meaning.
test('the WBS numbers its outline', () => {
  const src = read('src', 'components', 'WBSView.jsx');
  assert.match(src, /className="wbs-badge"/, 'the project carries the WBS badge');
  assert.match(src, /className="wbs-pcode"[\s\S]*?\{gi \+ 1\}/, 'a phase carries its ordinal');
  assert.match(src, /code=\{`\$\{gi \+ 1\}\.\$\{ti \+ 1\}`\}/, 'an item carries 1.2');
  assert.match(src, /\{code\}\.\{si \+ 1\}/, 'and a subtask carries 1.2.3');
});

// ─── fidelity to the Board Explorer ─────────────────────────────────────────

test('a person is one component, on every surface that shows one', () => {
  // The mockup puts the same circle on the card, in the Table's Owner column,
  // on a Gantt row, beside a WBS task, down the Workload and against a
  // subitem. Six hand-rolled spans would be six colours for one person.
  ['Board.jsx', 'GanttView.jsx', 'WBSView.jsx', 'WorkloadView.jsx', 'BoardToolbar.jsx']
    .forEach((file) => {
      const src = read('src', 'components', file);
      assert.match(src, /from '\.\/Avatar'/, `${file} does not use the shared Avatar`);
    });
});

test('the avatar colour is derived, not stored — so it needs no migration', () => {
  const src = read('src', 'components', 'Avatar.jsx');
  assert.match(src, /export function avatarColor/);
  assert.ok(!/localStorage|firestore|useState/.test(src),
    'a face must not depend on state a device might not have');
});

test('the find box filters every tab, not the one that drew it', () => {
  const scope = read('src', 'services', 'boardScope.js');
  assert.match(scope, /q = null/, 'the text belongs in the shared filter');
  assert.match(scope, /title \|\| ''/, 'it must at least match the title');

  const shell = read('src', 'components', 'AppShell.jsx');
  assert.match(shell, /<FindItem value=\{route\.q \|\| ''\}/);
  assert.match(shell, /activeHub\?\.id === 'board'\n?\s*\? <FindItem/,
    'the box belongs to the hub that can answer it');

  Object.values(BOARD_PAGES).forEach((file) => {
    assert.match(read('src', 'components', file), /q: route\.q/,
      `${file} draws the find box but ignores what is typed into it`);
  });
});

test('the find box does not write a history entry per keystroke', () => {
  const src = read('src', 'components', 'FindItem.jsx');
  assert.match(src, /setTimeout/, 'commit on a pause, not on every letter');
  const shell = read('src', 'components', 'AppShell.jsx');
  assert.match(shell, /navRef\.current\(\{ q \}\)/,
    'a fresh arrow each render would tear the debounce down before it fires');
});

test('the Kanban column beds are the mockup\'s own, and answer dark mode', () => {
  const css = read('src', 'App.css');
  assert.match(css, /--c-col-todo:\s+#efe6d8/);
  assert.match(css, /--c-col-doing:\s+#f0e6dc/);
  assert.match(css, /--c-col-done:\s+#e6ecdf/);
  // Both dark blocks — the media query AND the explicit override.
  assert.equal((css.match(/--c-col-todo:\s+#1e2938/g) || []).length, 2,
    'a token with one dark answer is a token that is wrong in the other theme');
});

test('the breadcrumb carries the count and the connection, as the mockup writes them', () => {
  const shell = read('src', 'components', 'AppShell.jsx');
  assert.match(shell, /crumb-chip stuck/);
  assert.match(shell, /crumb-live/);
  assert.match(shell, /isStuck\(t, blocked, today\)/,
    'the chip must use the hub\'s own definition, or it will disagree with the Stuck pill');
});

// ─── the Gantt is the mockup's chart, not the old day grid ──────────────────

test('the Gantt fits the card — no fixed pixels-per-day, no sideways scroll', () => {
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /const dayWidth = trackW > 0 \? trackW \/ range\.total : 0;/,
    'the scale is measured off the card, not a zoom preset');
  assert.match(src, /new ResizeObserver/);
  assert.ok(!/dayWidth: 36|dayWidth: 16|dayWidth: 6/.test(src),
    'the pixels-per-day presets belonged to the scrolling chart');
});

test('the old day grid is gone, markup and stylesheet alike', () => {
  const src = read('src', 'components', 'GanttView.jsx');
  const css = read('src', 'App.css');
  for (const dead of ['gantt-day-header', 'gantt-weekend-col', 'gantt-weekend-overlay',
    'gantt-day-grid', 'gantt-day-cell', 'gantt-row', 'gantt-label', 'gantt-bar', 'gantt-handle']) {
    assert.ok(!src.includes(dead), `GanttView still renders .${dead}`);
    assert.ok(!css.includes(`.${dead}`), `App.css still styles .${dead}`);
  }
  // …and nothing else in the app was left pointing at them.
  const components = fs.readdirSync(path.join(root, 'src', 'components'));
  components.forEach((f) => {
    const s = fs.readFileSync(path.join(root, 'src', 'components', f), 'utf8');
    assert.ok(!s.includes('gantt-day-grid') && !s.includes('gantt-today-line'),
      `${f} still uses a class the Gantt rewrite removed`);
  });
});

test('the chart keeps the mockup\'s own metrics', () => {
  const css = read('src', 'App.css');
  const block = css.slice(css.indexOf('.gc-ruler,'));
  // Wider than the mockup's 220 on purpose: at 220 every task name was cut
  // off at roughly the same word, which is a chart you cannot read.
  assert.match(block, /grid-template-columns: var\(--gc-label-w, 288px\) minmax\(0, 1fr\)/);
  assert.match(block, /height: 44px/, 'the 44px row');
  assert.match(block, /height: 18px/, 'the 18px bar');
  assert.match(block, /font-size: 10px[\s\S]{0,120}letter-spacing: 0\.05em/, 'the ruler label');
  assert.match(block, /\.gc-name \{[\s\S]*?font-size: 12px;[\s\S]*?font-weight: 600;/, 'the row title');
});

test('the ruler is proportional, so a bar lands on its own date', () => {
  // Equal columns would put a bar a day or two out at the ends of a month
  // that is not exactly four weeks.
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /ruler\.map\(\(c\) => `\$\{c\.days\}fr`\)/);
  assert.match(src, /function rulerColumns/);
});

test('dragging a plan bar still writes dates', () => {
  // The chart was rebuilt around it; the arithmetic must not have moved.
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /dragPatch\(current, rangeMin/);
  assert.match(src, /Math\.round\(\(e\.clientX - live\.startX\) \/ dayWidth\)/);
  assert.match(src, /gc-handle gc-handle-l/);
  assert.match(src, /gc-handle gc-handle-r/);
});

// ─── the Gantt, second pass ─────────────────────────────────────────────────

test('the chart measures itself with a CALLBACK ref, not an effect', () => {
  // The effect version ran once on mount, while the page was still the
  // loading spinner: the ruler did not exist, the ref was null, the observer
  // was never attached and the day width stayed 0 — so every bar was skipped
  // and the chart drew as empty rows, silently.
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /const trackRef = useCallback\(\(el\) => \{/);
  assert.ok(!/const trackRef = useRef\(null\);[\s\S]{0,400}ro\.observe/.test(src),
    'an effect keyed on [] cannot see a node that mounts later');
});

test('the chart is segmented by project', () => {
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /kind: 'group'/);
  assert.match(src, /className="gc-group"/);
  assert.match(src, /gc-group-span/, 'a band worth having says what the project spans');
  // The bands take vertical space, so the arrow overlay has to count them.
  assert.match(src, /if \(entry\.kind === 'task'\) taskRowByTaskId\.set/);
});

test('the period is one switch in the card head, over one vocabulary', () => {
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /const PERIODS = \[/);
  assert.match(src, /function periodOf\(from, to\)/,
    'which segment is lit is read back off the dates, so a reload still lights one');
  assert.match(src, /export function PeriodSwitch/);
  assert.ok(!/className=\{`gz/.test(src), 'the Quarter/Week pills it replaced are gone');
  assert.ok(!/const ZOOMS/.test(src) || !/setZoom/.test(src),
    'nothing may still be setting a zoom that has no control');

  // T-0159 — "This week" added at Ace's request. The switch reads left to
  // right from narrow to wide, with All as the escape at the head.
  const list = src.slice(src.indexOf('const PERIODS = ['), src.indexOf('/** Which segment'));
  assert.deepEqual([...list.matchAll(/label: '([^']+)'/g)].map((m) => m[1]),
    ['All', 'This week', 'This month', 'This quarter', 'Next 30 days']);

  // A week starts on the day the READER says it does. Working it out here
  // would mean "this week" began on a different day on the Gantt than on the
  // Timesheet and My Week, which both ask `weekDays`.
  assert.match(src, /weekDays\(todayLocal\(\), readSettings\(\)\.weekStart \?\? 1\)/);
  assert.match(src, /from '\.\.\/services\/timesheet'/);
});

test('the five-chip period bar the switch replaced is really gone', () => {
  // T-0145 replaced it and left the component behind, unmounted — dead code
  // that still had to be maintained, and a design that no longer ships sitting
  // in the file next to the one that does.
  const src = read('src', 'components', 'GanttView.jsx');
  assert.ok(!src.includes('GanttDateFilter'), 'the old filter bar is still in the file');
  assert.ok(!src.includes('presetThisYear'), 'and so is the preset only it used');
  assert.ok(!read('src', 'App.css').includes('gantt-date-filter'), 'its CSS went too');
});

test('every period the switch offers produces a usable window', async () => {
  // A preset that returns an empty or inverted range lights a segment and
  // shows an empty chart, which reads as "no work" rather than as a bug.
  const { weekDays } = await import('../../src/services/timesheet.js');
  for (const start of [0, 1]) {
    const days = weekDays('2026-09-22', start);
    assert.equal(days.length, 7);
    assert.ok(days[0] <= '2026-09-22' && '2026-09-22' <= days[6],
      `week starting ${start} must contain the day it was asked about`);
    assert.ok(days[0] < days[6], 'and run forwards');
  }
});

test('the ruler granularity is worked out, not asked for', () => {
  const src = read('src', 'components', 'GanttView.jsx');
  assert.match(src, /range\.total <= 77 \? 'week' : 'month'/);
});

test('the segmented switch is a shared control, not a Gantt one-off', () => {
  const css = read('src', 'App.css');
  assert.match(css, /\.seg \{/);
  assert.match(css, /\.seg-btn\.is-on \{/);
  assert.match(css, /--c-surface-2/, 'the track is the quiet surface, the chosen one is raised');
});

test('an item past its plan date is CALLED stuck, on every surface that names one', () => {
  // The rule is one function. Five surfaces print a status; all five ask it,
  // or the board and the dashboard end up arguing about the same task.
  const scope = read('src', 'services', 'boardScope.js');
  assert.match(scope, /export function displayStatus/);
  assert.match(scope, /label: 'Stuck'/);

  for (const file of ['Board.jsx', 'WBSView.jsx', 'DashboardView.jsx']) {
    const src = read('src', 'components', file);
    assert.match(src, /displayStatus\(/, `${file} names a status without asking the one rule`);
  }

  // …and nobody keeps a private label map to do it with.
  for (const file of ['Board.jsx', 'WBSView.jsx']) {
    const src = read('src', 'components', file);
    assert.ok(!/'Working on it'/.test(src), `${file} still has its own copy of the labels`);
  }
});

// ─── T-0147: In Review is a real status, not a fourth-coloured label ────────

test('the Kanban has the mockup\'s four columns, derived from the status list', async () => {
  const { TASK_STATUSES } = await import('../../src/services/taskStatus.js');
  assert.deepEqual(TASK_STATUSES, ['todo', 'doing', 'review', 'done']);

  const board = read('src', 'components', 'Board.jsx');
  assert.match(board, /const COLUMNS = TASK_STATUSES\.map/,
    'the columns are derived, not listed again — a fifth status must not need remembering');
  // The grid is derived too: the column count is handed in as --bx-n from
  // COLUMNS.length, so a fifth status widens the board with no CSS edit.
  assert.match(read('src', 'App.css'),
    /\.bx-cols \{[\s\S]*?grid-template-columns: repeat\(var\(--bx-n, 4\), minmax\(0, 1fr\)\)/);
  assert.match(board, /'--bx-n': COLUMNS\.length/);
});

test('review is a state with stamps of its own, not a synonym for doing', async () => {
  const { statusStamps } = await import('../../src/services/taskStatus.js');
  const s = statusStamps('review', { today: '2026-07-20' });
  assert.equal(s.actualEndDate, null, 'it is handed over, not finished');
  assert.ok(s.actualStartDate, 'you cannot review work nobody did');
  assert.equal(s.progress, 90, 'a review queue must not read as delivered');
  // …and an existing start survives, as it does for the other statuses.
  const kept = statusStamps('review', { today: '2026-07-20', current: { startDate: '2026-07-01', progress: 95 } });
  assert.equal(kept.actualStartDate, '2026-07-01');
  assert.equal(kept.progress, 95, 'the floor is a floor, not an overwrite');
});

test('every vocabulary that names a status knows about review', () => {
  const files = [
    ['src/services/boardScope.js', 'STATUS_TEXT'],
    ['src/services/taskExport.js', 'STATUS_LABEL'],
    ['src/services/activityExport.js', 'STATUS_LABEL'],
    ['src/components/SharedSnapshot.jsx', 'STATUS_LABEL'],
    ['src/components/ProjectsView.jsx', 'WIP_LABEL'],
  ];
  for (const [file, decl] of files) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const line = src.match(new RegExp(`${decl}\\s*=\\s*\\{[^}]*\\}`));
    assert.ok(line, `${file}: ${decl} not found`);
    assert.match(line[0], /review:/, `${file}: ${decl} still has three statuses`);
  }
  // The runner's own vocabulary too — the editor imports this exact list, so a
  // browser could otherwise author a rule the deployed function rejects.
  assert.match(fs.readFileSync(path.join(root, 'functions/src/automations.js'), 'utf8'),
    /options: \['todo', 'doing', 'review', 'done'\]/);
});

test('the status cycle is derived, so dragging rounds all four columns', () => {
  const fb = read('src', 'services', 'firebase.js');
  assert.match(fb, /const order = TASK_STATUSES;/);
  assert.ok(!/task\.status === 'doing' \? 'done'/.test(fb), 'the hand-written three-step cycle is gone');
});
