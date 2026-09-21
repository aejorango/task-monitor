// T-0126 / POL-016 — the default theme follows the operating system.
//
//   1. Given a device with no stored settings and an OS set to dark
//   2. When the app first loads
//   3. Then it renders in dark, and a device that previously chose Light still
//      renders light
//
// The settings module resolves its state once, at import, so each case gets a
// fresh copy of it: localStorage is set up first, then the module is imported
// under a unique URL so Node's module cache cannot hand back a previous run's
// answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupDom, teardownDom } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

setupDom();
after(() => teardownDom());

const STORAGE_KEY = 'task-monitor.settings.v1';
let n = 0;

/** Import a pristine copy of useSettings.js against the given stored value. */
async function loadWith(stored) {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  if (stored !== undefined) localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return import(`../../src/hooks/useSettings.js?case=${++n}`);
}

test('a device with nothing stored follows the operating system', async () => {
  const { readSettings } = await loadWith(undefined);
  assert.equal(readSettings().theme, 'system',
    'a new user on a dark Mac used to get a bright white app');
});

test('following the system means leaving the decision to the stylesheet', async () => {
  const { readSettings, applyTheme } = await loadWith(undefined);
  // The module applies the theme at import; with 'system' there must be no
  // attribute at all, so the @media (prefers-color-scheme: dark) block decides.
  assert.equal(document.documentElement.getAttribute('data-theme'), null);

  applyTheme('dark');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  applyTheme('system');
  assert.equal(document.documentElement.getAttribute('data-theme'), null);
  applyTheme('light');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(readSettings().theme, 'system', 'applyTheme paints; it does not decide');
});

// The reason no migration was written: the stored value wins over the default,
// so nobody who chose Light is moved off it.
test('a device that chose Light keeps Light', async () => {
  const { readSettings } = await loadWith({ theme: 'light', weekStart: 1 });
  assert.equal(readSettings().theme, 'light');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
});

test('a device that chose Dark keeps Dark', async () => {
  const { readSettings } = await loadWith({ theme: 'dark' });
  assert.equal(readSettings().theme, 'dark');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
});

test('a device that already chose System is unchanged', async () => {
  const { readSettings } = await loadWith({ theme: 'system' });
  assert.equal(readSettings().theme, 'system');
  assert.equal(document.documentElement.getAttribute('data-theme'), null);
});

test('settings saved before the theme key existed pick up the new default', async () => {
  const { readSettings } = await loadWith({ weekStart: 0 });
  assert.equal(readSettings().theme, 'system');
  assert.equal(readSettings().weekStart, 0, 'the rest of the stored settings survive');
});

test('unreadable storage still yields a usable theme', async () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, '{not json');
  const { readSettings } = await import(`../../src/hooks/useSettings.js?case=${++n}`);
  assert.equal(readSettings().theme, 'system');
});

// Making dark the default for far more people makes this visible: native
// chrome is painted by the browser, and without `color-scheme` it stays light
// however dark the page is — a white date picker inside a dark task editor.
test('the stylesheet tells the browser which chrome to paint, in all three states', () => {
  const css = read('src', 'App.css');

  const base = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
  assert.match(base, /color-scheme:\s*light/, 'the light palette must claim light chrome');

  const sysDark = css.slice(css.indexOf(':root:not([data-theme="light"]) {'));
  assert.match(sysDark.slice(0, 400), /color-scheme:\s*dark/,
    'system dark must claim dark chrome');

  const forced = css.slice(css.indexOf(':root[data-theme="dark"] {'));
  assert.match(forced.slice(0, 400), /color-scheme:\s*dark/,
    'the Dark setting must claim dark chrome too');
});

test('the Appearance picker still offers all three, and System is the default', () => {
  const settings = read('src', 'components', 'SettingsView.jsx');
  for (const option of ['system', 'light', 'dark']) {
    assert.ok(settings.includes(`'${option}'`) || settings.includes(`"${option}"`),
      `the picker lost ${option}`);
  }
  assert.match(read('src', 'hooks', 'useSettings.js'), /theme:\s*'system'/,
    'the default the picker describes and the default the app uses must agree');
});

test('the Appearance note is plain language, now that everybody reads it', () => {
  const src = read('src', 'components', 'SettingsView.jsx');
  const start = src.indexOf('<strong>System</strong>');
  assert.ok(start > 0, 'the note explaining System is gone');
  const note = src.slice(start, src.indexOf('</p>', start)).replace(/\s+/g, ' ');
  assert.doesNotMatch(note, /prefers-color-scheme/,
    'a CSS property name is not an explanation for a non-technical reader');
  assert.doesNotMatch(note, /<code>/, 'standing requirement 1: no code on screen');
  assert.match(note, /your device/i);
  assert.match(note, /default/i, 'saying which one is the default is the point of the note');
});
