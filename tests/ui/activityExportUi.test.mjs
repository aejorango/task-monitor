// T-0116 / BUG-031 — the four pages that could only make a CSV.
//
//   1. Given the Activity Log with entries on screen
//   2. When the user opens Export ▾ and picks Excel
//   3. Then an .xlsx named activity-log-YYYY-MM-DD.xlsx downloads with a frozen
//      bold header and the same rows and order that are on screen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupDom, teardownDom } from './dom.mjs';

const window = setupDom();

// Capture what downloadFile hands the browser.
const saved = [];
window.URL.createObjectURL = (blob) => { saved.push(blob); return 'blob:mock'; };
window.URL.revokeObjectURL = () => {};
globalThis.URL.createObjectURL = window.URL.createObjectURL;
globalThis.URL.revokeObjectURL = window.URL.revokeObjectURL;
globalThis.Blob = window.Blob;
window.HTMLAnchorElement.prototype.click = function click() {};

const { exportDocument, formatsFor } = await import('../../src/services/exporters.js');
const { buildActivityLogDocument, buildWbsDocument } = await import('../../src/services/activityExport.js');

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
after(() => teardownDom());
before(() => { saved.length = 0; });

const projectById = { p1: { id: 'p1', name: 'Bridged', phases: [{ id: 'ph1', name: 'Discovery' }] } };
const activities = [
  { id: 'a1', date: '2026-09-21', projectId: 'p1', phaseId: 'ph1', taskId: 't1', taskTitle: 'Draft proposal',
    comment: 'Wrote the first draft', completionStatus: 'in-progress', hoursSpent: 2.5 },
  { id: 'a2', date: '2026-09-20', projectId: 'p1', taskId: 't2', taskTitle: 'Ship the build',
    comment: 'Shipped it', completionStatus: 'completed', hoursSpent: 1 },
];

async function bytesOf(format, baseName, doc) {
  saved.length = 0;
  const name = await exportDocument(format, baseName, doc);
  assert.equal(saved.length, 1, `${format} saved nothing`);
  return { name, buffer: Buffer.from(await saved[0].arrayBuffer()) };
}

// ─── the acceptance criterion, for real ─────────────────────────────────────

test('the Activity Log exports a real, date-stamped .xlsx with the rows on screen', async () => {
  const doc = buildActivityLogDocument(activities, { projectById });
  const { name, buffer } = await bytesOf('xlsx', 'activity-log', doc);

  assert.match(name, /^activity-log-\d{4}-\d{2}-\d{2}\.xlsx$/, 'date-stamped, per the convention');
  assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK', 'an xlsx is a zip');

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Activity log');
  assert.ok(ws, 'the sheet is named');
  assert.deepEqual(ws.getRow(1).values.slice(1), [
    'Date', 'Project', 'Phase', 'Task', 'What was done', 'Completion',
    'Hours', 'Blockers', 'Requested by', 'Output links',
  ]);
  assert.equal(ws.getRow(1).font.bold, true, 'the header is bold');
  assert.ok(ws.views?.[0]?.ySplit >= 1, 'the header is frozen');

  // The same rows, in the same order as the screen.
  assert.equal(ws.getRow(2).getCell(4).value, 'Draft proposal');
  assert.equal(ws.getRow(3).getCell(4).value, 'Ship the build');
  assert.equal(ws.getRow(2).getCell(7).value, 2.5, 'hours are numbers, not text');
}, { timeout: 60_000 });

test('the WBS exports a real .xlsx, phases in the project’s own order', async () => {
  const project = { id: 'p1', name: 'Bridged', phases: [{ id: 'ph2', name: 'Zeta' }, { id: 'ph1', name: 'Alpha' }] };
  const tasks = [
    { id: 't1', title: 'In Alpha', phaseId: 'ph1', status: 'todo' },
    { id: 't2', title: 'In Zeta', phaseId: 'ph2', status: 'done' },
  ];
  const { name, buffer } = await bytesOf('xlsx', 'Bridged-WBS', buildWbsDocument(project, tasks));
  assert.match(name, /^Bridged-WBS-\d{4}-\d{2}-\d{2}\.xlsx$/, 'date-stamped, per the convention');

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Work breakdown');
  assert.equal(ws.getRow(2).getCell(1).value, 'Zeta', 'the plan’s order, not alphabetical');
  assert.equal(ws.getRow(3).getCell(1).value, 'Alpha');
}, { timeout: 60_000 });

test('the CSV that used to be the only option is still one of the formats', () => {
  const offered = formatsFor('table').map((f) => f.value);
  assert.ok(offered.includes('csv'), 'nothing is lost by adding the others');
  assert.ok(offered.includes('xlsx'));
  assert.ok(offered.includes('pdf'));
});

test('an empty log still produces a file rather than failing', async () => {
  const { buffer } = await bytesOf('csv', 'activity-log', buildActivityLogDocument([], {}));
  assert.ok(buffer.length > 0, 'a person who exports nothing should get an empty sheet, not an error');
});

// ─── all four surfaces, and no hand-rolled CSV left ─────────────────────────

const SURFACES = [
  ['TableView.jsx', 'the Activity Log'],
  ['WBSView.jsx', 'the WBS page’s activity modal'],
  ['WbsModal.jsx', 'the WBS modal'],
  ['ProjectsView.jsx', 'the per-project activity log'],
];

for (const [file, where] of SURFACES) {
  test(`${where} offers the Export menu`, () => {
    const src = read('src', 'components', file);
    assert.match(src, /<ExportButton /, `${file} has no Export ▾`);
    assert.match(src, /kind: 'table'/, `${file} must offer the spreadsheet formats`);
  });

  test(`${where} no longer hand-rolls a CSV`, () => {
    const src = read('src', 'components', file);
    assert.doesNotMatch(src, /downloadFile\(/, `${file} still writes its own file`);
    assert.doesNotMatch(src, /const escape = \(v\) => \{/, `${file} still has a CSV escaper`);
  });
}

test('the Activity Log’s bulk bar exports the selection, not the whole log', () => {
  const src = read('src', 'components', 'TableView.jsx');
  assert.match(src, /exportPropsFor\(selectedRows, 'activity-log-selection'/);
  assert.match(src, /exportPropsFor\(sorted, 'activity-log'/);
});

test('build() runs only when a format is picked', () => {
  for (const [file] of SURFACES) {
    const src = read('src', 'components', file);
    assert.match(src, /build: \(\) =>/, `${file} must not prepare an export nobody asked for`);
  }
});

// ─── T-0117: the docs carry it too ──────────────────────────────────────────

test('CLAUDE.md records where these documents are built', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /activityExport\.js/, 'the module belongs in the exports map');
  assert.match(claude, /buildActivityLogDocument|buildWbsDocument/);
});

test('the README lists the new suites', () => {
  const readme = read('README.md');
  assert.match(readme, /src\/services\/activityExport\.test\.mjs/);
  assert.match(readme, /tests\/ui\/activityExportUi\.test\.mjs/);
});

test('the changelog records both halves of the fix', () => {
  const log = read('CHANGELOG.md');
  assert.match(log, /T-0115 — Activity Log and WBS/);
  assert.match(log, /T-0116 — Activity Log and WBS/);
});

test('no page in the app hand-rolls a CSV any more', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))) {
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    // downloadFile() itself is fine (it is the one place a file is named);
    // building CSV lines by hand beside it is not.
    if (/const escape = \(v\) => \{[\s\S]{0,200}?replace\(\/"\/g/.test(src)) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    'go through services/exporters.js so every page offers the same formats');
});
