// T-0046 / MISS-003 — the .xlsx, .docx and .pdf writers, run for real.
//
// A builder test proves the content is right; this proves the BYTES are right.
// Each file is inspected: an xlsx and a docx are ZIPs with known entries, a PDF
// starts with %PDF. Anything less and "export to Word" ships a broken file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

const {
  bullets, exportDocument, heading, keyValues, paragraph, sheetFromRows, table,
} = await import('../../src/services/exporters.js');

after(() => teardownDom());
before(() => { saved.length = 0; });

const DOC = {
  title: 'Weekly status',
  subtitle: 'SBLAF rollout',
  blocks: [
    heading('Where we are', 1),
    paragraph('Two of five phases are complete.'),
    keyValues([['Hours logged', 37.5], ['Overdue', 2]]),
    bullets(['Bank sign-off is late']),
    table(['Task', 'Owner'], [['Disbursement report', 'Ace'], ['Partner API', 'Sam']]),
  ],
};

async function bytesOf(format, doc = DOC) {
  saved.length = 0;
  const name = await exportDocument(format, 'weekly status', doc);
  assert.equal(saved.length, 1, `${format} saved nothing`);
  return { name, buffer: Buffer.from(await saved[0].arrayBuffer()) };
}

test('the Markdown file is real Markdown', async () => {
  const { name, buffer } = await bytesOf('md');
  assert.match(name, /^weekly-status-\d{4}-\d{2}-\d{2}\.md$/);
  assert.match(buffer.toString('utf8'), /^# Weekly status/);
});

test('the HTML file opens on its own', async () => {
  const { buffer } = await bytesOf('html');
  const html = buffer.toString('utf8');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Disbursement report/);
});

test('the CSV falls back to the table in the document', async () => {
  const { name, buffer } = await bytesOf('csv');
  assert.match(name, /\.csv$/);
  assert.equal(buffer.toString('utf8').split('\n')[0], 'Task,Owner');
});

test('the .xlsx is a real workbook with the rows in it', async () => {
  const { name, buffer } = await bytesOf('xlsx', {
    ...DOC,
    sheets: [sheetFromRows('Tasks', ['Task', 'Owner'], [['Disbursement report', 'Ace']])],
  });
  assert.match(name, /\.xlsx$/);
  assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK', 'an xlsx is a zip');

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Tasks');
  assert.ok(ws, 'the sheet must be named as asked');
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Task', 'Owner']);
  assert.deepEqual(ws.getRow(2).values.slice(1), ['Disbursement report', 'Ace']);
  assert.equal(ws.getRow(1).font.bold, true, 'the header is bold');
  assert.ok(ws.getColumn(1).width > 10, 'columns are sized, not ####');
}, { timeout: 60_000 });

test('a document with no table cannot be a spreadsheet, and says so', async () => {
  await assert.rejects(
    () => exportDocument('xlsx', 'x', { title: 'x', blocks: [paragraph('no table')] }),
    /no table in this to save as a spreadsheet/,
  );
});

test('the .docx is a real Word document', async () => {
  const { name, buffer } = await bytesOf('docx');
  assert.match(name, /\.docx$/);
  assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK', 'a docx is a zip');
  // Word refuses a package without these two entries.
  const asText = buffer.toString('latin1');
  assert.match(asText, /\[Content_Types\]\.xml/);
  assert.match(asText, /word\/document\.xml/);
}, { timeout: 60_000 });

test('the .pdf is a real PDF with pages', async () => {
  const { name, buffer } = await bytesOf('pdf');
  assert.match(name, /\.pdf$/);
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.match(buffer.toString('latin1'), /\/Type\s*\/Page/);
  assert.ok(buffer.length > 1000, 'an empty PDF would be a broken deliverable');
}, { timeout: 60_000 });

test('a long table pages rather than running off the bottom', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => [`Task ${i}`, 'Ace']);
  const { buffer } = await bytesOf('pdf', {
    title: 'Everything', blocks: [table(['Task', 'Owner'], rows)],
  });
  const pages = (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(pages > 1, `expected several pages, got ${pages}`);
}, { timeout: 60_000 });

test('an unknown format is refused in plain words', async () => {
  await assert.rejects(() => exportDocument('wat', 'x', DOC), /Cannot save as/);
});

test('every offered format produces a file', async () => {
  const { EXPORT_FORMATS } = await import('../../src/services/exporters.js');
  for (const f of EXPORT_FORMATS) {
    const { buffer } = await bytesOf(f.value, {
      ...DOC,
      sheets: [sheetFromRows('Tasks', ['Task'], [['A']])],
    });
    assert.ok(buffer.length > 0, `${f.value} produced an empty file`);
  }
}, { timeout: 120_000 });
