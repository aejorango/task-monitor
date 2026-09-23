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
test('the picker’s menu opens rightwards, above the rail, one line per project', () => {
  const block = css.slice(css.indexOf('.proj-picker .dropdown-menu {'),
    css.indexOf('.proj-picker .dropdown-menu {') + 300);
  assert.match(block, /left: 0/);
  assert.match(block, /right: auto/);
  const z = Number(block.match(/z-index: (\d+)/)[1]);
  const railZ = Number(css.slice(css.indexOf('.rail {')).match(/z-index: (\d+)/)[1]);
  assert.ok(z > railZ, `the menu (${z}) must sit above the rail (${railZ})`);
  assert.match(css, /\.proj-picker-name \{[\s\S]*?text-overflow: ellipsis/);
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
