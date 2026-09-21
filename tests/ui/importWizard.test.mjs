// T-0059 / NEW-006 — import a spreadsheet whatever its column names are.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, clickText, muteConsoleError } from './dom.mjs';

setupDom();
const { default: ImportWizard } = await import('../../src/components/ImportWizard.jsx');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const csvFile = (contents, name = 'sheet.csv') => ({ name, text: async () => contents });

async function pick(ui, contents) {
  const { act } = await import('react');
  const input = ui.container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [csvFile(contents)], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

test('the wizard opens on the first step and shows all four', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  const shown = text(ui.container);
  assert.match(shown, /Import from a spreadsheet/);
  for (const step of ['What to import', 'Choose the file', 'Match the columns', 'Confirm']) {
    assert.match(shown, new RegExp(step));
  }
  ui.unmount();
});

test('all three kinds are offered, each explained', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  const shown = text(ui.container);
  assert.match(shown, /Tasks.*One row per task/s);
  assert.match(shown, /Projects.*One row per project/s);
  assert.match(shown, /Activity log.*One row per logged entry/s);
  ui.unmount();
});

test('it says plainly that nothing is written until the end', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  assert.match(text(ui.container), /Nothing is added until you confirm/);
  ui.unmount();
});

test('someone else’s column names are guessed, and shown for checking', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  await pick(ui, 'Summary,Deadline,Importance\nShip it,2026-09-30,Urgent');
  const shown = text(ui.container);
  assert.match(shown, /Match the columns/);
  assert.match(shown, /We have guessed from your headings/);

  // The "Task name" row should have selected the Summary column.
  const rows = [...ui.container.querySelectorAll('.iw-map-row')];
  const titleRow = rows.find((r) => r.textContent.startsWith('Task name'));
  assert.equal(titleRow.querySelector('select').selectedOptions[0].textContent, 'Summary');
  ui.unmount();
});

test('every field can be pointed at any column, or at none', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  await pick(ui, 'A,B\nx,y');
  const select = ui.container.querySelector('.iw-map-row select');
  const labels = [...select.options].map((o) => o.textContent);
  assert.equal(labels[0], '— not in my file —');
  assert.ok(labels.includes('A') && labels.includes('B'));
  ui.unmount();
});

test('an unmapped required field blocks the import and says which one', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  await pick(ui, 'Widget,Sprocket\n1,2');
  const shown = text(ui.container);
  assert.match(shown, /Still needed: Task name/);
  const importBtn = [...ui.container.querySelectorAll('button')].find((b) => /^Import \d/.test(b.textContent));
  assert.ok(!importBtn || importBtn.disabled, 'the import button must not be usable');
  ui.unmount();
});

test('a mapped file previews what will happen, with the line numbers', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  // The second row has content but no task name — a row the person must fix.
  // (A wholly blank line is dropped when the file is read; it is not a failure.)
  await pick(ui, 'Task,Due,Status\nShip it,2026-09-30,In Progress\n,2026-10-01,Done\n');
  const shown = text(ui.container);
  assert.match(shown, /1 row will be imported/);
  assert.match(shown, /1 skipped/);
  assert.match(shown, /Missing Task name\./);
  assert.match(shown, /Ship it/);
  assert.match(shown, /doing/, 'the normalised value, not the raw one');
  ui.unmount();
});

test('an empty or headings-only file is explained', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  await pick(ui, '');
  assert.match(text(ui.container), /That file is empty/);
  await pick(ui, 'Task,Due');
  assert.match(text(ui.container), /column headings but no rows/);
  ui.unmount();
});

test('switching what you are importing re-guesses the mapping', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  await pick(ui, 'Project,Description\nRollout,The thing');
  await clickText(ui.container, 'Projects');
  const rows = [...ui.container.querySelectorAll('.iw-map-row')];
  const nameRow = rows.find((r) => r.textContent.startsWith('Project name'));
  assert.equal(nameRow.querySelector('select').selectedOptions[0].textContent, 'Project');
  ui.unmount();
});

test('writes are batched under the Firestore limit', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'ImportWizard.jsx'), 'utf8');
  assert.match(src, /chunkForImport\(valid\)/);
});

test('a failed row is reported by line and reason, not swallowed', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'ImportWizard.jsx'), 'utf8');
  assert.match(src, /failures\.push\(\{/);
  assert.match(src, /line: row\.line/);
  assert.match(src, /reason: friendlyError/);
  assert.match(src, /will not be duplicated/);
});

test('both table pages offer it', () => {
  for (const [file, kind] of [['TableView.jsx', 'activities'], ['TasksTableView.jsx', 'tasks']]) {
    const src = fs.readFileSync(path.join(root, 'src', 'components', file), 'utf8');
    assert.match(src, /<ImportWizard/, file);
    assert.match(src, new RegExp(`initialKind="${kind}"`), file);
  }
});

// ─── T-0114 / BUG-030: one door, and it covers the old one's cases ──────────
//
// The Activity Log header used to carry "Import CSV" (the fixed-column
// importer) beside "Import from spreadsheet" (this wizard), with nothing to say
// which to pick. The wizard supersedes the other for every case; these are the
// promises the retired screen made, now held against this one.

test('the Activity Log has exactly one import control', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TableView.jsx'), 'utf8');
  const header = src.slice(src.indexOf('<div className="page-actions">'), src.indexOf('</div>', src.indexOf('<div className="page-actions">')));
  const importButtons = [...header.matchAll(/>\s*([^<>{}]*[Ii]mport[^<>{}]*?)\s*</g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  assert.deepEqual(importButtons, ['Import'], `saw ${JSON.stringify(importButtons)}`);
});

test('the retired importer is gone, and nothing still reaches for it', () => {
  assert.equal(fs.existsSync(path.join(root, 'src', 'components', 'CsvImporter.jsx')), false);
  const dir = path.join(root, 'src', 'components');
  const offenders = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => /from '\.\/CsvImporter'/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('a file exported from the Activity Log maps itself, with nothing to do by hand', async () => {
  const { guessMapping, IMPORT_KINDS } = await import('../../src/services/csv.js');
  // The exact header row exportCsv writes — the old importer's whole reason to exist.
  const exported = ['Project', 'Phase', 'Task', 'Activity details', 'Date',
    'Completion', 'Output link', 'Bottlenecks', 'Requested by', 'Hours'];
  const mapping = guessMapping(exported, 'activities');
  const unmapped = IMPORT_KINDS.activities.fields.filter((f) => mapping[f.key] === -1).map((f) => f.label);
  assert.deepEqual(unmapped, [],
    'the fast path the old importer offered is the wizard’s default behaviour');
});

test('the export header and the import aliases stay in step', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TableView.jsx'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("const headers = ['Project'"));
  assert.ok(line, 'exportCsv’s header row moved');
  assert.match(line, /'Activity details'/);
  assert.match(line, /'Output link'/,
    'renaming an exported column without adding the alias breaks round-tripping');
});

// ── the promises the retired screen made ────────────────────────────────────

test('it only offers spreadsheet files', async () => {
  const ui = await mount(h(ImportWizard, { onClose() {} }));
  const input = ui.container.querySelector('input[type="file"]');
  assert.match(input.getAttribute('accept'), /csv/);
  ui.unmount();
});

test('a file with the wrong columns is explained, not rejected with jargon', async () => {
  const ui = await mount(h(ImportWizard, { initialKind: 'activities', onClose() {} }));
  await pick(ui, 'Name,Amount\nx,1');
  const shown = text(ui.container);
  assert.doesNotMatch(shown, /undefined|Error:|-1\b/,
    'the old screen was careful about this and the new one must be too');
  // It names the columns it did find, so the person can map them by hand.
  assert.match(shown, /Name/);
  assert.match(shown, /Amount/);
  ui.unmount();
});

test('it says what will happen before anything is written, and skips a bad row', async () => {
  const ui = await mount(h(ImportWizard, { initialKind: 'activities', onClose() {} }));
  // The third row has a date and hours but no task name — the same file the
  // retired screen was tested with.
  await pick(ui, 'Task,Date,Hours\nWrite the brief,2026-09-20,2\nShip the build,2026-09-21,1.5\n,2026-09-22,9\n');
  const shown = text(ui.container);
  assert.match(shown, /2 rows will be imported/);
  assert.match(shown, /1 skipped/);
  assert.match(shown, /Missing Task\./, 'and it says why, by row');
  assert.match(shown, /Write the brief/);
  assert.match(shown, /Ship the build/);

  // Nothing is written until the button is pressed, and the button says how many.
  const buttons = [...ui.container.querySelectorAll('button')].map((b) => b.textContent.trim());
  assert.ok(buttons.some((b) => /^Import 2\b/.test(b)), `saw ${buttons.join(' | ')}`);
  ui.unmount();
});
