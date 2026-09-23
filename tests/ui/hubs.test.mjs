// T-0143 — the icon rail holds six destinations; the app has twenty-odd pages.
// The hub registry is what stops the other sixteen from going the way Trash and
// Artifacts went in BUG-029: present in the app, reachable by nobody.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const { HUBS, VIEW_REGISTRY, hubForView, tabsForView, hubLanding } =
  await import('../../src/services/views.js');

test('every page belongs to exactly one hub', () => {
  const claims = new Map();
  HUBS.forEach((h) => h.tabs.forEach((t) => {
    claims.set(t.view, [...(claims.get(t.view) || []), h.id]);
  }));

  const unclaimed = VIEW_REGISTRY.filter((v) => !claims.has(v.id)).map((v) => v.id);
  assert.deepEqual(unclaimed, [],
    'a page no hub owns is unreachable from the rail — add it to a hub in services/views.js');

  const twice = [...claims].filter(([, hubs]) => hubs.length > 1);
  assert.deepEqual(twice, [],
    'two hubs claiming one page makes the rail highlight ambiguous');
});

test('a hub tab points at a page that really exists', () => {
  const known = new Set(VIEW_REGISTRY.map((v) => v.id));
  HUBS.forEach((h) => h.tabs.forEach((t) => {
    assert.ok(known.has(t.view), `hub "${h.id}" has a tab for unknown view "${t.view}"`);
  }));
});

test('a hub lands on its first tab', () => {
  HUBS.forEach((h) => assert.equal(hubLanding(h.id), h.landing || h.tabs[0].view));

  // A hub that states its landing must name one of its OWN tabs, or the rail
  // sends you somewhere the strip does not even list.
  HUBS.filter((h) => h.landing).forEach((h) => {
    assert.ok(h.tabs.some((t) => t.view === h.landing),
      `${h.id} lands on ${h.landing}, which is not one of its tabs`);
  });

  // The Board's strip reads Calendar → Gantt → Kanban, and the rail opens the
  // WBS (asked for directly). Both halves matter; either alone is the bug —
  // the point of `landing` is that the strip's ORDER cannot move the home.
  const board = HUBS.find((h) => h.id === 'board');
  assert.deepEqual(board.tabs.map((t) => t.view),
    ['calendar', 'gantt', 'board', 'wbs', 'workload']);
  assert.equal(hubLanding('board'), 'wbs',
    'reordering the strip must not move where the rail lands');
  // An id nobody has is not a crash — it is the Dashboard.
  assert.equal(hubLanding('nope'), 'dashboard');
});

test('the strip renames a page where its hub gives it another name', () => {
  const labels = tabsForView('gantt').map((t) => t.label);
  assert.ok(labels.includes('Gantt'), 'Gantt chart reads as "Gantt" under Board');
  assert.ok(tabsForView('review').some((t) => t.label === 'Summary'));
  // …and uses the registry's own label everywhere else.
  assert.ok(tabsForView('gantt').some((t) => t.label === 'Workload'));
});

test('exactly one tab is marked active, and only for the page shown', () => {
  const tabs = tabsForView('calendar');
  assert.equal(tabs.filter((t) => t.active).length, 1);
  assert.equal(tabs.find((t) => t.active).view, 'calendar');
});

test('a page outside the rail draws no strip', () => {
  assert.equal(hubForView('invite'), null);
  assert.deepEqual(tabsForView('invite'), []);
  // …and neither does a hub with nothing to switch between. Messages has two
  // pages now (the Inbox came in off the topbar bell), so the single-tab rule
  // is checked against a hub that really has one.
  const singles = HUBS.filter((h) => h.tabs.length === 1);
  singles.forEach((h) => assert.deepEqual(tabsForView(h.tabs[0].view), [],
    'a strip of one tab is a label that looks clickable'));
});

test('the rail itself is built from the registry, not listed again', () => {
  const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
  assert.match(shell, /HUBS\.map/, 'the rail must render HUBS, not a hand-kept copy');
  assert.doesNotMatch(shell, /const SIDEBAR_ITEMS/,
    'the old sidebar group builder is gone; hubs replaced it');
});

/* ── the page chrome ───────────────────────────────────────────────────── */

test('no view writes a page title of its own any more', () => {
  // The shell draws the title, the subtitle line and the command row (T-0143).
  // A view that also renders `.page-header` / `.page-title` puts the same name
  // on the screen twice — which is exactly what every page did for the hour
  // between the chrome landing and the sweep finishing.
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))) {
    if (f === 'PageHeader.jsx') continue;     // it IS the chrome
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/className="page-header"/.test(src)) offenders.push(`${f}: .page-header`);
    if (/className="page-title"/.test(src))  offenders.push(`${f}: .page-title`);
  }
  assert.deepEqual(offenders, [],
    'use <PageSubtitle> and <PageActions> from PageHeader.jsx instead');
});

test('a view that publishes to the chrome imports it', () => {
  // Neither slot is a global: <PageActions> without the import is a
  // ReferenceError at render, and the build does not catch an undefined
  // identifier — only mounting the page does.
  const dir = path.join(root, 'src', 'components');
  const missing = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))) {
    if (f === 'PageHeader.jsx') continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const uses = /<PageSubtitle[\s>]/.test(src) || /<PageActions[\s>]/.test(src);
    if (uses && !/from '\.\/PageHeader'/.test(src)) missing.push(f);
  }
  assert.deepEqual(missing, [], 'import { PageActions, PageSubtitle } from \'./PageHeader\'');
});

test('the tour still has something to point at', () => {
  // Three steps aimed at `.page-header`, which no page renders any longer; an
  // anchor that matches nothing leaves the tour highlighting empty space.
  const tour = fs.readFileSync(path.join(root, 'src', 'services', 'tutorials.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'src', 'components', 'PageHeader.jsx'), 'utf8');
  const selectors = [...tour.matchAll(/selector: '\.([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(selectors.includes('chrome-bar'));
  // A class can be written as a plain string OR as the head of a template
  // literal — `className={`gc-bar${…}`}` is just as real an anchor.
  const renders = (src, cls) => src.includes(`className="${cls}`) || src.includes('className={`' + cls);
  const files = fs.readdirSync(path.join(root, 'src', 'components'));
  for (const cls of new Set(selectors)) {
    assert.ok(
      renders(shell, cls) || files.some((f) =>
        renders(fs.readFileSync(path.join(root, 'src', 'components', f), 'utf8'), cls)),
      `the tour points at .${cls}, which nothing renders`,
    );
  }
});

test('the phone gets the same six destinations as the rail', () => {
  // The bottom bar was its own list of five and had already drifted: "Log"
  // pointed at the Activity Log while the sidebar's Reports group held seven
  // pages, and Messages was not on it at all.
  const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
  const nav = shell.slice(shell.indexOf('function BottomNav'));
  assert.doesNotMatch(shell, /const BOTTOM_TABS = \[/, 'derive it from HUBS');
  assert.match(nav, /HUBS\.map/);
  assert.match(nav, /hubLanding\(hub\.id\)/);
  // …and it lights the hub you are IN, not only an exact route match: on
  // Calendar it is Board that should be lit.
  assert.match(nav, /activeHub\?\.id === hub\.id/);
});

test('the breadcrumb never says the same word twice in a row', () => {
  // "Workspaces › BRIDGED › Projects › Projects" — the hub and its own landing
  // page share a name on three of the six hubs.
  const chrome = fs.readFileSync(path.join(root, 'src', 'components', 'PageHeader.jsx'), 'utf8');
  assert.match(chrome, /inHub && hub\.label !== here/);

  for (const hub of HUBS) {
    const tabs = tabsForView(hub.tabs[0].view);
    if (!tabs.length) continue;             // single-tab hub draws no strip
    const here = tabs.find((t) => t.active).label;
    const trail = [hub.label, here].filter((x, i, a) => i === 0 || x !== a[i - 1]);
    assert.ok(trail.length <= 2);
    if (hub.label === here) {
      assert.equal(trail.length, 1, `${hub.id} would print "${hub.label}" twice`);
    }
  }
});

/* ── T-0144: the labelled rail, and the tabs the mockups named ─────────── */

test('the rail shows names, not only glyphs', () => {
  // Ace asked for the labels back: six unlabelled icons is a memory test.
  const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
  const css   = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');

  assert.match(shell, /<span className="rail-btn-label">\{h\.label\}<\/span>/);
  // The TM tile and the wordmark were removed on request; the hub LABELS are
  // what this guard is really about, and they stay.
  assert.doesNotMatch(shell, /className="rail-brand-name"/);
  assert.doesNotMatch(shell, /className="rail-brand"/);

  // …and the label is really drawn, not visually hidden the way it was while
  // the rail was 64px wide.
  const label = css.slice(css.indexOf('.rail-btn-label {'));
  const body = label.slice(0, label.indexOf('}'));
  assert.doesNotMatch(body, /clip:\s*rect\(0 0 0 0\)/,
    'the label must be visible, not screen-reader-only');
  assert.match(css, /--rail-w: 196px;/, 'wide enough for a name');

  // Collapsing back to icons stays possible, and is remembered per device.
  assert.match(shell, /rail-narrow/);
  assert.match(shell, /RAIL_NARROW_KEY/);
  assert.match(css, /\.app-shell\.rail-narrow \{ --rail-w: 64px; \}/);
});

test('every tab the Explorer mockups name has a page behind it', () => {
  // The first pass shipped the chrome and six hubs but only the pages that
  // already existed, so Monitoring, Automations, Archive, People, Variance
  // and Library were named nowhere. This is the list. (Flow was on it too,
  // until T-0152 deleted that tab — see CLAUDE.md.)
  // Archive went in T-0153 — Projects → Portfolio already lists archived
  // projects at its foot, so the tab was a second door to one room.
  // Monitoring became `analytics` in T-0157: the page is still here, at a
  // different id, which is what MOVED_VIEWS is checked for below.
  const added = ['analytics', 'automations', 'people', 'variance', 'library'];
  const known = new Set(VIEW_REGISTRY.map((v) => v.id));
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  for (const id of added) {
    assert.ok(known.has(id), `${id} is not in the registry`);
    assert.ok(hubForView(id), `${id} belongs to no hub`);
    assert.match(app, new RegExp(`route\\.view === '${id}'`), `${id} has no route branch`);
  }
});

test('Settings is six routes over one component, each drawing real blocks', async () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'SettingsView.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

  // Every settings route in the hub passes a section…
  const settingsHub = HUBS.find((h) => h.id === 'settings');
  for (const t of settingsHub.tabs) {
    if (t.view === 'trash') continue;                 // its own component
    assert.match(app, new RegExp(`route\\.view === '${t.view}'`), `${t.view} has no route`);
  }

  // …and every block the component can draw belongs to some section, or it is
  // a block nobody can ever reach.
  const declared = [...src.matchAll(/show\('([a-z-]+)'\)/g)].map((m) => m[1]);
  const listed = new Set(
    [...src.matchAll(/^\s+[a-z'-]+:\s+\[([^\]]+)\]/gm)]
      .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, ''))),
  );
  const orphans = [...new Set(declared)].filter((d) => !listed.has(d));
  assert.deepEqual(orphans, [], 'a block in no section is a block nobody can open');
});

/* ── T-0157: Monitoring moved to Analytics ──────────────────────────────── */

test('a page that MOVED forwards; it does not 404', async () => {
  const { MOVED_VIEWS, resolveView, isKnownView } = await import('../../src/services/views.js');

  assert.equal(resolveView('monitoring'), 'analytics',
    'the Monitoring panels are the Analytics page now — an old link must reach them');
  assert.equal(isKnownView('monitoring'), true,
    'Not Found implies the content is gone; it is not, only its address changed');
  assert.equal(resolveView('board'), 'board', 'a page that did not move is left alone');

  // A forwarding address has to point somewhere real, or it is worse than a 404.
  const known = new Set(VIEW_REGISTRY.map((v) => v.id));
  for (const [from, to] of Object.entries(MOVED_VIEWS)) {
    assert.ok(known.has(to), `${from} forwards to ${to}, which is not a page`);
    assert.ok(!known.has(from), `${from} both forwards AND exists — pick one`);
    assert.ok(hubForView(to), `${to} belongs to no hub`);
  }
});

test('the route layer actually applies the forwarding', () => {
  const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
  assert.match(shell, /view: resolveView\(parts\[0\] \|\| 'dashboard'\)/,
    'MOVED_VIEWS is inert unless parseHash reads it');
});

test('nothing still navigates to the retired id', () => {
  const dirs = ['src', 'dev'];
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.(jsx?|mjs)$/.test(e.name)) continue;
      if (rel.endsWith(path.join('services', 'views.js'))) continue;  // the table itself
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      if (/view: 'monitoring'|=== 'monitoring'/.test(src)) offenders.push(rel);
    }
  };
  dirs.forEach(walk);
  assert.deepEqual(offenders, [],
    'forwarding is for links we do not control — our own should point at the real id');
});

test('Analytics carries the search words Monitoring was found by', () => {
  const entry = VIEW_REGISTRY.find((v) => v.id === 'analytics');
  for (const w of ['cycle time', 'throughput', 'blocked rate', 'alert rules', 'monitoring']) {
    assert.ok(entry.words.includes(w), `⌘K "${w}" would find nothing`);
  }
});

test('the deleted Analytics charts are really gone', () => {
  assert.equal(fs.existsSync(path.join(root, 'src', 'components', 'AnalyticsView.jsx')), false,
    'its content was deleted on request; a file nothing mounts is the worse outcome');
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  assert.ok(!app.includes('AnalyticsView'), 'App.jsx still imports it');
});
