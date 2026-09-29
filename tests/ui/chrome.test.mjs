// T-0146 — the top bar was cleared, and five things had to go somewhere.
//
// Every one of these guards is about the same failure: a control that is
// removed from the chrome and not re-homed does not become "simpler", it
// becomes a feature nobody can reach — which is how Trash and Artifacts went
// missing in BUG-029, and how "Tell someone" nearly became dead UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const shell = read('src', 'components', 'AppShell.jsx');
const header = read('src', 'components', 'PageHeader.jsx');
const css = read('src', 'App.css');
const { VIEW_REGISTRY, hubForView } = await import('../../src/services/views.js');

test('the top bar carries only what acts on the page you are on', () => {
  const bar = shell.slice(shell.indexOf('<header className="topbar">'), shell.indexOf('</header>'));
  for (const gone of ['<AiHelper', '<InboxBell', '<DueAlertBell', '<WorkspaceSwitcher', '<ProjectPicker', '<TutorialGuide', 'topbar-chip-mytasks']) {
    assert.ok(!bar.includes(gone), `the top bar still carries ${gone}`);
  }
  // …and nothing imports what it no longer renders.
  for (const dead of ['./AiHelper', './InboxBell', './DueAlertBell']) {
    assert.ok(!shell.includes(`from '${dead}'`), `AppShell still imports ${dead}`);
  }
});

test('the workspace switcher is in the rail, and its topbar skin went with it', () => {
  const rail = shell.slice(shell.indexOf('<aside'), shell.indexOf('</aside>'));
  assert.match(rail, /<WorkspaceSwitcher/);
  assert.match(css, /\.rail-ws \{/);
  assert.ok(!css.includes('.topbar .ws-switcher'),
    'the white-bar overrides are dead CSS now the control is back on navy');
});

// It was centred in the crumb strip until it moved to the toolbar, at the
// left of the work area — where the Board hub had drawn its own copy all
// along. One control in one place: the point of the move is that the picker
// does not shift as you walk from the Dashboard to the Board.
test('the project picker is in the toolbar, on every hub that can use one', () => {
  assert.ok(!shell.includes('projectPicker={'), 'the crumb-strip slot is gone');
  assert.ok(!header.includes('crumbs-mid'), 'and so is the hole it went in');
  assert.ok(!css.includes('.crumbs-mid {'), 'and the CSS that centred it');

  // The Board keeps its own toolbar; every other hub with something to filter
  // gets the same strip with just the picker in it.
  assert.match(shell, /const PICKER_HUBS = new Set\(\[([^\]]+)\]\)/);
  const listed = shell.match(/const PICKER_HUBS = new Set\(\[([^\]]+)\]\)/)[1];
  for (const hub of ['dashboard', 'projects', 'reports', 'messages']) {
    assert.ok(listed.includes(`'${hub}'`), `${hub} should carry the picker`);
  }
  assert.ok(!listed.includes("'board'"), 'the Board has BoardToolbar — two strips is two pickers');
  assert.match(shell, /<ProjectBar route=\{route\}/);
  assert.match(read('src', 'components', 'BoardToolbar.jsx'), /<ProjectPicker/);
});

// The bug the move exposed: `.dropdown-menu` is right-anchored, which is right
// for a button at the end of a row and wrong for one at the left edge of the
// page — the menu grew leftwards under the rail, and the rail (z-index 20)
// painted over it.
test('the picker’s menu stays on screen, above the rail, one line per project', () => {
  // Anywhere else the picker opens rightwards from the left edge (the base
  // rule). In the tab row it sits at the right-hand end, so there the menu
  // anchors right instead — rightwards would run off the page.
  const base = css.slice(css.lastIndexOf('\n.proj-picker .dropdown-menu {'));
  assert.match(base.slice(0, 300), /left: 0/);
  assert.match(base.slice(0, 300), /right: auto/);
  assert.match(css, /\.chrome-tabtools \.proj-picker \.dropdown-menu \{ left: auto; right: 0; \}/);
  const z = Number(css.match(/\.chrome-tabtools \.dropdown-menu \{ z-index: (\d+)/)[1]);
  const railZ = Number(css.slice(css.indexOf('.rail {')).match(/z-index: (\d+)/)[1]);
  assert.ok(z > railZ, `the menu (${z}) must sit above the rail (${railZ})`);
  assert.match(css, /\.proj-picker-name \{[\s\S]*?text-overflow: ellipsis/);
});

// The filters moved up into the tab row, left of the find box, and were
// drawn as the find box — and the Saved views chip left the chrome. The
// strip they used to fill below the tabs is gone, not left empty.
test('the filters are in the tab row, drawn like the find box', () => {
  assert.match(shell, /filters=\{activeHub\?\.id === 'board' \? \(/);
  assert.match(header, /<div className="chrome-tabtools">\{filters\}<\/div>/);
  const toolbar = read('src', 'components', 'BoardToolbar.jsx');
  // Status: an icon in place of the word, the word kept for a screen reader.
  assert.match(toolbar, /<FilterMenu\s+name="Status"\s+icon=\{<StatusIcon \/>\}/);
  assert.ok(!/label="Status"/.test(toolbar), 'the word "Status" is not drawn');
  // The person menu carries no visible word (on request) — only a name for a
  // screen reader, so it still announces itself as "Assigned to".
  assert.match(toolbar, /<FilterMenu\s+name="Assigned to"/);
  assert.ok(!/label="Assigned to"/.test(toolbar), 'the word "Assigned to" is not drawn');
  assert.ok(!/label="Show"/.test(toolbar), 'the All · Mine · Stuck menu was replaced by Status');
  assert.match(toolbar, /triggerClassName="fbx"/);
  // Same field as the find box: background, border, radius and height.
  const fbx = css.slice(css.indexOf('\n.fbx {'), css.indexOf('}', css.indexOf('\n.fbx {')));
  const box = css.slice(css.indexOf('\n.findbox {'), css.indexOf('}', css.indexOf('\n.findbox {')));
  for (const prop of ['background: var(--c-surface-2)', 'border: 1px solid var(--c-border)', 'border-radius: 8px', 'height: 32px']) {
    assert.ok(fbx.includes(prop) && box.includes(prop), `.fbx and .findbox must share ${prop}`);
  }
  for (const gone of ['.bt-pill', '.bt-face', '.bt-clear', '.bt-plain', 'saved-views-btn']) {
    assert.ok(!css.includes(gone), `${gone} is back in App.css`);
  }
  assert.ok(!shell.includes('SavedViewsMenu'), 'the Saved views chip is gone from the chrome');
});

test('saved views still have a home once the chip is gone', () => {
  // Nothing is removed from the chrome without somewhere to land.
  const lib = read('src', 'components', 'LibraryView.jsx');
  assert.match(lib, /useSavedViews/);
  assert.match(lib, /isKnownView\(v\.view\)/, 'a view on a deleted page must not be offered');
  assert.match(shell, /find it in Reports → Library/, 'Save view says where the view went');
});

test('⌘K still opens the palette, and nothing is left in the DOM when it is shut', () => {
  assert.match(shell, /e\.key\.toLowerCase\(\) === 'k'/);
  assert.match(shell, /if \(!open\) return null;/,
    'a hidden input is still something Tab and a screen reader find');
  assert.match(shell, /setOpen\(true\);\s*\n\s*requestAnimationFrame/,
    'the input does not exist until it is open, so focus has to wait a frame');
  assert.match(css, /\.palette \{/);
});

test('the tutorials are Dashboard → Tutorial, and the tour is still app-wide', () => {
  // It was Settings → Tutorial until T-0158, when the page was rebuilt to the
  // Dashboard Explorer's own Tutorial tab and moved to the hub that draws it.
  assert.ok(VIEW_REGISTRY.some((v) => v.id === 'tutorial'));
  assert.equal(hubForView('tutorial')?.id, 'dashboard');
  assert.match(read('src', 'App.jsx'), /route\.view === 'tutorial'/);

  // One overlay, mounted by the shell — it navigates between pages, so it
  // cannot live inside the page that offers it.
  assert.match(shell, /<TutorialGuide route=\{route\} navigate=\{navigate\} showLauncher=\{false\} \/>/);
  const page = read('src', 'components', 'TutorialView.jsx');
  assert.match(page, /startTutorial\(active\.id\)/, 'the page asks; it does not run the tour itself');
  assert.match(page, /TUTORIALS/, 'and reads the same list, not a copy of it');
});

test('every control taken off the bar has somewhere else to be', () => {
  // The inbox: a page in the Messages hub.
  assert.equal(hubForView('inbox')?.id, 'messages');
  // Due alerts: the on/off switch is in Settings → Notifications, so turning
  // them off does not remove the only way back on.
  const settings = read('src', 'components', 'SettingsView.jsx');
  assert.match(settings, /onChange=\{\(e\) => set\(\{ enabled: e\.target\.value === 'on' \}\)\}/);
  // "My tasks": still a route the palette and any link can set.
  assert.match(shell, /onlyMine:\s+params\.get\('mine'\)\s+=== '1'/);
  // AI: its own page, which the rail reaches through the Dashboard hub.
  assert.equal(hubForView('ask-ai')?.id, 'dashboard');
});

test('there is no top bar at all — the crumb strip is the top of the app', () => {
  assert.ok(!shell.includes('className="topbar"'), 'the row was removed, not emptied');
  assert.ok(!css.includes('grid-area: topbar'));
  assert.ok(!css.includes('"rail topbar"'), 'and the grid no longer reserves a row for it');
  assert.match(css, /--topbar-h:\s+0px/, 'the height token is 0 for the calc\\(\\) sites that used it');

  // What it still had to carry is now the header's, in slots.
  assert.match(shell, /onToggleMenu=\{\(\) => setSidebarOpen/);
  assert.match(shell, /tools=\{<>/);
  assert.match(header, /\{tools && <div className="chrome-tools">/);
  assert.match(header, /className="nav-toggle"/, 'the phone menu button moved with it');
});
