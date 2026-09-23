// T-0118 / BUG-032 — a div acting as a button obeys the button contract.
//
//   1. Given any row rendered with role=button
//   2. When the user presses either Enter or Space on it
//   3. Then the same action fires and the page does not scroll
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();
const { activateProps } = await import('../../src/hooks/useActivate.js');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const Row = ({ onActivate, ...opts }) =>
  h('div', { ...activateProps(onActivate, opts), 'data-testid': 'row' }, 'Draft proposal');

const press = async (el, key) => {
  const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => { el.dispatchEvent(e); });
  return e;
};

test('it is announced as a button and can be reached by Tab', async () => {
  const ui = await mount(h(Row, { onActivate() {} }));
  const row = ui.container.querySelector('[data-testid="row"]');
  assert.equal(row.getAttribute('role'), 'button');
  assert.equal(row.tabIndex, 0);
  ui.unmount();
});

test('Enter activates it', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await press(ui.container.querySelector('[data-testid="row"]'), 'Enter');
  assert.equal(fired, 1);
  ui.unmount();
});

test('Space activates it too — this is the whole bug', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await press(ui.container.querySelector('[data-testid="row"]'), ' ');
  assert.equal(fired, 1, 'a screen-reader user pressing the spacebar got a page scroll');
  ui.unmount();
});

test('Space does not scroll the page', async () => {
  const ui = await mount(h(Row, { onActivate() {} }));
  const e = await press(ui.container.querySelector('[data-testid="row"]'), ' ');
  assert.equal(e.defaultPrevented, true, 'without preventDefault the page jumps');
  ui.unmount();
});

test('an older browser spelling of Space works as well', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await press(ui.container.querySelector('[data-testid="row"]'), 'Spacebar');
  assert.equal(fired, 1);
  ui.unmount();
});

test('a click still activates it', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await act(async () => {
    ui.container.querySelector('[data-testid="row"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.equal(fired, 1);
  ui.unmount();
});

test('any other key is left alone', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  const row = ui.container.querySelector('[data-testid="row"]');
  for (const key of ['a', 'Escape', 'ArrowDown', 'Tab']) {
    const e = await press(row, key);
    assert.equal(e.defaultPrevented, false, `${key} must not be swallowed`);
  }
  assert.equal(fired, 0);
  ui.unmount();
});

test('the key press does not also reach whatever the row sits inside', async () => {
  let rowFired = 0;
  let parentFired = 0;
  const ui = await mount(h('div', { onKeyDown: () => { parentFired += 1; } },
    h(Row, { onActivate: () => { rowFired += 1; } })));
  await press(ui.container.querySelector('[data-testid="row"]'), 'Enter');
  assert.equal(rowFired, 1);
  assert.equal(parentFired, 0, 'a row often sits inside something else clickable');
  ui.unmount();
});

test('a disabled row is announced as disabled and cannot be operated', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; }, disabled: true }));
  const row = ui.container.querySelector('[data-testid="row"]');
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  assert.equal(row.tabIndex, -1);
  await press(row, 'Enter');
  await act(async () => { row.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.equal(fired, 0);
  ui.unmount();
});

test('a row whose text says nothing can be given a name', async () => {
  const ui = await mount(h(Row, { onActivate() {}, label: 'Open Draft proposal' }));
  assert.equal(ui.container.querySelector('[data-testid="row"]').getAttribute('aria-label'), 'Open Draft proposal');
  ui.unmount();
});

test('a row that reads as a sentence is not given a redundant name', async () => {
  const ui = await mount(h(Row, { onActivate() {} }));
  assert.equal(ui.container.querySelector('[data-testid="row"]').getAttribute('aria-label'), null,
    'a label that repeats the visible text is noise to a screen-reader user');
  ui.unmount();
});

// ─── T-0119: every call site really uses it ─────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const componentsDir = path.join(root, 'src', 'components');
const componentFiles = () => fs.readdirSync(componentsDir)
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => ({ name: f, src: fs.readFileSync(path.join(componentsDir, f), 'utf8') }));

/**
 * The tag an attribute line belongs to — looking back for the nearest `<tag`.
 * Enter-only is CORRECT on a text input (Enter submits, Space types a space);
 * it is the bug only on something pretending to be a button.
 */
function tagAt(lines, i) {
  for (let n = i; n >= 0 && n > i - 12; n--) {
    const m = lines[n].match(/<([a-zA-Z][\w.]*)\b/);
    if (m) return m[1];
  }
  return null;
}

test('nothing acting as a button hand-rolls the contract', () => {
  const TYPING = new Set(['input', 'textarea', 'select']);
  const offenders = [];
  for (const { name, src } of componentFiles()) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/onKeyDown=.*e\.key === 'Enter'/.test(line)) return;
      if (/e\.key === ' '/.test(line)) return;              // handles Space already
      const tag = tagAt(lines, i);
      if (TYPING.has(tag)) return;                          // Enter submits; Space types
      offenders.push(`${name}:${i + 1} <${tag}>: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    'a div acting as a button must use activateProps() from hooks/useActivate');
});

test('the guard knows a text input from a fake button', () => {
  // Enter-only on an input is left alone, on purpose: several forms rely on it.
  const inputs = componentFiles().flatMap(({ name, src }) => {
    const lines = src.split('\n');
    return lines
      .map((line, i) => ({ line, i }))
      .filter(({ line, i }) => /onKeyDown=.*e\.key === 'Enter'/.test(line)
        && ['input', 'textarea', 'select'].includes(tagAt(lines, i)))
      .map(({ i }) => `${name}:${i + 1}`);
  });
  assert.ok(inputs.length > 0, 'if this ever hits zero the guard above is unproven');
});

test('every role="button" div goes through the helper', () => {
  const offenders = [];
  for (const { name, src } of componentFiles()) {
    src.split('\n').forEach((line, i) => {
      if (!/role="button"/.test(line)) return;
      // The helper spreads role/tabIndex/onClick/onKeyDown together, so a
      // literal role="button" in the markup means it was written by hand.
      offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    'activateProps() supplies role, tabIndex, onClick and onKeyDown as one set');
});

test('the four Dashboard and editor rows use it', () => {
  for (const [file, count] of [['DashboardView.jsx', 3], ['TaskEditor.jsx', 1], ['WorkPerformedView.jsx', 1], ['AppShell.jsx', 1]]) {
    const src = fs.readFileSync(path.join(componentsDir, file), 'utf8');
    const uses = (src.match(/\{\.\.\.activateProps\(/g) || []).length;
    assert.equal(uses, count, `${file} should spread it ${count} time(s)`);
  }
});

test('an icon-only row is given a name, a readable one is not', () => {
  const shell = fs.readFileSync(path.join(componentsDir, 'AppShell.jsx'), 'utf8');
  assert.match(shell, /label: `Remove saved view \$\{v\.name\}`/,
    'a bare ✕ means nothing to a screen reader');

  const dash = fs.readFileSync(path.join(componentsDir, 'DashboardView.jsx'), 'utf8');
  // The row opens the EDITOR now, not the read-only activity list — one click,
  // one destination. Still no explicit label: the row's own text is the name.
  assert.match(dash, /activateProps\(\(\) => setEditingTask\(task\)\)/,
    'the queue row reads as a sentence already — a label would be noise');
});

test('the confirm behind the saved-view delete is written once', () => {
  const shell = fs.readFileSync(path.join(componentsDir, 'AppShell.jsx'), 'utf8');
  const confirms = (shell.match(/Remove saved view "\$\{v\.name\}"\?/g) || []).length;
  assert.equal(confirms, 1, 'it used to be written once per input, and could drift');
});

// ─── T-0120: the docs carry it too ──────────────────────────────────────────

test('CLAUDE.md records the contract and the input exception', () => {
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /handles only Enter/);
  assert.match(claude, /Space must `preventDefault`/);
  assert.match(claude, /still correct on a \*\*text input\*\*/,
    'the exception matters as much as the rule');
  assert.match(claude, /useActivate\.js/, 'the hook belongs in the map');
});

test('the README lists the new suite', () => {
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /tests\/ui\/activateProps\.test\.mjs/);
});

test('the changelog records both halves of the fix', () => {
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(log, /T-0118 — Clickable rows respond to Enter/);
  assert.match(log, /T-0119 — Clickable rows respond to Enter/);
});
