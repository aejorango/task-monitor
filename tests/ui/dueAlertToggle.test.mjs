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
