// T-0047 / MISS-003 — the Export control, and the pages that offer it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, clickText, muteConsoleError } from './dom.mjs';

const window = setupDom();
const saved = [];
window.URL.createObjectURL = (b) => { saved.push(b); return 'blob:mock'; };
window.URL.revokeObjectURL = () => {};
globalThis.URL.createObjectURL = window.URL.createObjectURL;
globalThis.URL.revokeObjectURL = window.URL.revokeObjectURL;
globalThis.Blob = window.Blob;
window.HTMLAnchorElement.prototype.click = function click() {};

const { default: ExportButton } = await import('../../src/components/ExportButton.jsx');
const { heading, paragraph, table } = await import('../../src/services/exporters.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const DOC = { title: 'Report', blocks: [heading('A', 1), paragraph('b'), table(['X'], [['1']])] };

test('the menu is closed until asked for', async () => {
  const ui = await mount(h(ExportButton, { build: () => DOC, baseName: 'report' }));
  assert.equal(ui.container.querySelectorAll('.export-menu-item').length, 0);
  assert.match(text(ui.container), /Export ▾/);
  ui.unmount();
});

test('opening it lists formats by name and extension', async () => {
  const ui = await mount(h(ExportButton, { build: () => DOC, baseName: 'report' }));
  await clickText(ui.container, 'Export');
  const items = [...ui.container.querySelectorAll('.export-menu-item')].map((b) => b.textContent);
  assert.ok(items.some((i) => /Word document \(\.docx\)/.test(i)));
  assert.ok(items.some((i) => /PDF \(\.pdf\)/.test(i)));
  assert.ok(items.some((i) => /Markdown \(\.md\)/.test(i)));
  ui.unmount();
});

test('a table export offers the spreadsheet formats instead', async () => {
  const ui = await mount(h(ExportButton, { build: () => DOC, baseName: 'tasks', kind: 'table' }));
  await clickText(ui.container, 'Export');
  const items = [...ui.container.querySelectorAll('.export-menu-item')].map((b) => b.textContent);
  assert.ok(items.some((i) => /Excel spreadsheet/.test(i)));
  assert.ok(items.some((i) => /CSV/.test(i)));
  ui.unmount();
});

test('picking a format saves a file and says what it was called', async () => {
  saved.length = 0;
  const ui = await mount(h(ExportButton, { build: () => DOC, baseName: 'report' }));
  await clickText(ui.container, 'Export');
  await clickText(ui.container, 'Markdown');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(saved.length, 1);
  assert.match(text(ui.container), /Saved report-\d{4}-\d{2}-\d{2}\.md/);
  ui.unmount();
});

test('build() is not called until a format is picked', async () => {
  let built = 0;
  const ui = await mount(h(ExportButton, { build: () => { built += 1; return DOC; }, baseName: 'r' }));
  assert.equal(built, 0, 'a page must not prepare an export nobody asked for');
  await clickText(ui.container, 'Export');
  assert.equal(built, 0);
  ui.unmount();
});

test('a failure is reported in plain language, not thrown away', async () => {
  const ui = await mount(h(ExportButton, {
    build: () => { throw new Error('boom'); }, baseName: 'r',
  }));
  await clickText(ui.container, 'Export');
  await clickText(ui.container, 'Markdown');
  await new Promise((r) => setTimeout(r, 30));
  const shown = text(ui.container);
  assert.match(shown, /Could not create that file|try again/i);
  assert.doesNotMatch(shown, /boom|Error:/);
  ui.unmount();
});

test('the menu is a menu, for a screen reader too', async () => {
  const ui = await mount(h(ExportButton, { build: () => DOC, baseName: 'r' }));
  const btn = ui.container.querySelector('button');
  assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  await clickText(ui.container, 'Export');
  assert.equal(ui.container.querySelector('button').getAttribute('aria-expanded'), 'true');
  assert.ok(ui.container.querySelector('[role="menu"]'));
  ui.unmount();
});

// ─── the pages that wire it up ──────────────────────────────────────────────

for (const [name, file, marker] of [
  ['Review', 'ReviewView.jsx', 'buildReport'],
  ['Board', 'Board.jsx', 'buildTaskExport'],
  ['Minutes', 'MinutesView.jsx', 'buildMinutesDocument'],
  ['Goals', 'GoalsView.jsx', 'buildGoalsDocument'],
]) {
  test(`${name} offers an export`, () => {
    const src = fs.readFileSync(path.join(root, 'src', 'components', file), 'utf8');
    assert.match(src, /<ExportButton/, `${name} has no Export button`);
    assert.match(src, new RegExp(marker), `${name} does not build a document`);
  });
}

test('the JSON dump is labelled as a backup, not as the way to get data out', () => {
  const settings = fs.readFileSync(path.join(root, 'src', 'components', 'SettingsView.jsx'), 'utf8');
  assert.match(settings, /Backup everything \(\.json\)/);
  assert.doesNotMatch(settings, />Export JSON</);
});
