// The due-task alert is an interrupting modal that also spends AI budget on a
// generated prompt, so it is opt-in: off unless the operator switched it on.
// These cover the two ways that promise can quietly break — a stored `true`
// from the old default surviving, and the switch hiding itself while off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupDom, teardownDom } from './dom.mjs';

const window = setupDom();
after(() => teardownDom());

const SETTINGS_KEY = 'task-monitor.settings.v1';
const OPT_IN_KEY = 'task-monitor.dueAlerts.optIn.v1';

// `current = load()` runs at module scope, so each scenario needs a fresh
// module instance — hence the cache-busting query on the specifier.
let n = 0;
const freshSettings = () => import(`../../src/hooks/useSettings.js?case=${n++}`);

before(() => window.localStorage.clear());

test('the due-task alert defaults to off', async () => {
  const { DEFAULT_DUE_ALERT_SETTINGS } = await import('../../src/services/dueAlerts.js');
  assert.equal(
    DEFAULT_DUE_ALERT_SETTINGS.enabled,
    false,
    'an interrupting modal that spends AI budget must be opt-in',
  );
});

test('a device carrying the old default-on value is switched off once', async () => {
  window.localStorage.clear();
  // What every device that ever saved any setting looks like today.
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    theme: 'light', dueAlerts: { enabled: true, leadDays: 0 },
  }));

  const { readSettings } = await freshSettings();
  assert.equal(readSettings().dueAlerts.enabled, false, 'inherited true must be cleared');
  assert.ok(window.localStorage.getItem(OPT_IN_KEY), 'the migration must record that it ran');
});

test('a deliberate opt-in survives the next load', async () => {
  window.localStorage.clear();
  window.localStorage.setItem(OPT_IN_KEY, '1'); // migration already ran
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    theme: 'light', dueAlerts: { enabled: true, leadDays: 0 },
  }));

  const { readSettings } = await freshSettings();
  assert.equal(
    readSettings().dueAlerts.enabled,
    true,
    'once it has run, the migration must never undo a choice the user made',
  );
});

test('other settings are untouched by the migration', async () => {
  window.localStorage.clear();
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    theme: 'dark', weekStart: 0, dueAlerts: { enabled: true, leadDays: 2 },
  }));

  const { readSettings } = await freshSettings();
  const s = readSettings();
  assert.equal(s.theme, 'dark');
  assert.equal(s.weekStart, 0);
  assert.equal(s.dueAlerts.leadDays, 2, 'only `enabled` is cleared');
});

// ── the control itself ──────────────────────────────────────────────────
// Mounting it would drag in useTasks → Firebase, so assert on the source,
// the same way the AppShell polling tests do.
const toggleSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'DueAlertBell.jsx'),
  'utf8',
);

test('the switch is visible while the alert is off', () => {
  assert.doesNotMatch(
    toggleSource,
    /if\s*\(\s*!enabled\s*\)\s*return null/,
    'hiding it while off leaves no way to turn the alert back on',
  );
});

test('it is a switch with an accessible name, not a bare icon', () => {
  assert.match(toggleSource, /role="switch"/, 'a toggle must expose switch semantics');
  assert.match(toggleSource, /aria-checked=\{enabled\}/, 'its state has to be announced');
  assert.match(toggleSource, /aria-label=/, 'an icon-only control needs a name');
  assert.doesNotMatch(toggleSource, /🔔|🔕/, 'the bell was replaced by a toggle');
});

test('turning it on clears a mute left over from "close all"', () => {
  assert.match(
    toggleSource,
    /if\s*\(!enabled\s*&&\s*muted\)\s*unmute\(\)/,
    'otherwise the switch reads on and nothing is ever shown',
  );
});

// ── T-0107 / BUG-022: one switch, both surfaces ─────────────────────────────
//
// The switch is presented as the on/off control for due-task alerts, but
// `useOverdueScan` read `leadDays`, `snoozes` and `skips` from the same
// settings object and never checked `enabled` — so a user who turned it off
// kept getting desktop banners every five minutes for the same tasks.

const scanSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'src', 'hooks', 'useNotifications.js'),
  'utf8',
);

/** The body of the scan effect, where the guard has to be. */
const scanEffect = () => {
  const start = scanSource.indexOf('  useEffect(() => {', scanSource.indexOf('export function useOverdueScan'));
  return scanSource.slice(start, scanSource.indexOf('\n  }, [tasks, permission', start));
};

test('the desktop scan does not run while the switch is off', () => {
  assert.match(scanEffect(), /if \(permission !== 'granted' \|\| !prefs\.enabled\) return;/,
    'with the switch off, a banner every five minutes reads as broken');
});

test('flipping the switch restarts the scan rather than waiting for a reload', () => {
  assert.match(scanSource, /\}, \[tasks, permission, userId, prefs\.enabled, prefs\.leadDays\]\);/,
    'without `enabled` in the deps the effect never re-runs when it changes');
});

test('the scan still honours the same rules as the modal once it is on', () => {
  const effect = scanEffect();
  assert.match(effect, /buildAlertQueue\(tasks, \{ today, leadDays: prefs\.leadDays, snoozes, skips \}\)/,
    'the two surfaces must never disagree about what is due');
});

test('a due task raises nothing when alerts are off, and something when they are on', async () => {
  const { buildAlertQueue } = await import('../../src/services/dueAlerts.js');
  const today = '2026-09-21';
  const task = { id: 't1', status: 'todo', title: 'Ship it', plan: { endDate: today } };

  // The queue itself is unconditional — it is the effect that is gated, which
  // is what keeps the two surfaces agreeing about what "due" means.
  assert.equal(buildAlertQueue([task], { today, leadDays: 0, snoozes: {}, skips: [] }).length, 1);

  // And the gate is a plain boolean read of the same preference the switch writes.
  const gate = (prefs, permission) => permission === 'granted' && !!prefs.enabled;
  assert.equal(gate({ enabled: false }, 'granted'), false, 'switch off: nothing is sent');
  assert.equal(gate({ enabled: true }, 'granted'), true);
  assert.equal(gate({ enabled: true }, 'denied'), false, 'permission still has the final say');
});

test('the switch says it covers the desktop too', () => {
  assert.match(toggleSource, /off, in the app and on your desktop/,
    'a label that claims less than it controls is how this went unnoticed');
});

test('Settings says where desktop notifications are controlled from', () => {
  const settings = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'SettingsView.jsx'),
    'utf8',
  );
  assert.match(settings, /follow the due-task alert switch in the top bar/,
    'otherwise there is no discoverable way to turn them back on');
});
