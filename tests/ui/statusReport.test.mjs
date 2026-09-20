// T-0063 / NEW-010 — the status report a manager asks for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const dash = fs.readFileSync(path.join(root, 'src', 'components', 'DashboardView.jsx'), 'utf8');

test('the Dashboard offers a status report', () => {
  assert.match(dash, /<ExportButton/);
  assert.match(dash, /label="Status report"/);
  assert.match(dash, /kind="document"/, 'a report, not a spreadsheet');
});

test('the report is named for the workspace and the day', () => {
  assert.match(dash, /baseName=\{statusReportFileBase\(activeWorkspace\?\.name\)\}/);
});

test('it is built from the same digest the app shows', () => {
  assert.match(dash, /buildDigest\(\{/);
  assert.match(dash, /buildStatusReport\(digest, \{/,
    'computing the numbers twice is how a report starts disagreeing with the app');
});

test('the AI narrative is passed only when there is one', () => {
  assert.match(dash, /narrative: aiOutput\?\.trim\(\) \|\| null/);
});

test('building it is deferred until somebody asks', () => {
  assert.match(dash, /const buildStatusReportDoc = \(\) => \{/,
    'a function, not a value — the digest is not computed on every render');
  assert.match(dash, /build=\{buildStatusReportDoc\}/);
});

test('the report offers the document formats, PDF among them', async () => {
  const { formatsFor } = await import('../../src/services/exporters.js');
  const values = formatsFor('document').map((f) => f.value);
  assert.ok(values.includes('pdf'));
  assert.ok(values.includes('docx'));
});
