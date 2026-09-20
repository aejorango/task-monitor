// T-0046 / MISS-003 — one document, six formats.
//
// The builders are pure and tested here. The three heavyweight writers (xlsx,
// docx, pdf) are exercised in tests/ui/exporters.test.mjs, where a DOM exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_FORMATS, bullets, exportFileName, firstTableAsSheet, formatsFor,
  heading, keyValues, paragraph, sheetFromRows, table, toHtml, toMarkdown,
  toPlainText,
} from './exporters.js';
import { todayLocal } from './recurrence.js';

const DOC = {
  title: 'Weekly status',
  subtitle: 'SBLAF rollout · 14–20 September',
  blocks: [
    heading('Where we are', 1),
    paragraph('Two of five phases are complete and the third is on track.'),
    keyValues([['Hours logged', 37.5], ['Overdue', 2], ['Blocked', 0]]),
    heading('Open risks', 2),
    bullets(['Bank sign-off is late', 'One task has no owner']),
    table(['Task', 'Owner', 'Due'], [
      ['Disbursement report', 'Ace', '2026-09-18'],
      ['Partner API', 'Sam', '2026-09-30'],
    ]),
  ],
};

// ─── Markdown ───────────────────────────────────────────────────────────────

test('Markdown carries the whole document', () => {
  const md = toMarkdown(DOC);
  assert.match(md, /^# Weekly status/m);
  assert.match(md, /_SBLAF rollout · 14–20 September_/);
  assert.match(md, /^## Where we are/m);
  assert.match(md, /^### Open risks/m);
  assert.match(md, /^- Bank sign-off is late/m);
  assert.match(md, /\*\*Hours logged:\*\* 37\.5/);
});

test('a Markdown table is well-formed', () => {
  const md = toMarkdown(DOC);
  assert.match(md, /\| Task \| Owner \| Due \|/);
  assert.match(md, /\| --- \| --- \| --- \|/);
  assert.match(md, /\| Disbursement report \| Ace \| 2026-09-18 \|/);
});

test('a pipe or a newline in a cell does not break the table', () => {
  const md = toMarkdown({ blocks: [table(['A'], [['x | y'], ['line\nbreak']])] });
  const rows = md.split('\n').filter((l) => l.startsWith('|'));
  assert.equal(rows.length, 4, 'header, separator, two rows — and no stray row');
  assert.match(md, /x \\\| y/);
  assert.match(md, /line break/);
});

test('an empty document is still valid Markdown', () => {
  assert.equal(toMarkdown({ blocks: [] }), '\n');
  assert.equal(toMarkdown({}), '\n');
});

test('Markdown never runs to three blank lines', () => {
  const md = toMarkdown({ title: 'x', blocks: [paragraph(''), paragraph(''), paragraph('a')] });
  assert.doesNotMatch(md, /\n{3}/);
});

// ─── Plain text ─────────────────────────────────────────────────────────────

test('plain text drops the markup but keeps the words', () => {
  const txt = toPlainText(DOC);
  assert.match(txt, /^Weekly status/m);
  assert.match(txt, /^Where we are/m);
  assert.match(txt, /Hours logged: 37\.5/);
  assert.doesNotMatch(txt, /^#/m);
  assert.doesNotMatch(txt, /\*\*/);
});

// ─── HTML ───────────────────────────────────────────────────────────────────

test('HTML is a complete, self-contained page', () => {
  const html = toHtml(DOC);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<style>/, 'it must open correctly from a Downloads folder');
  assert.doesNotMatch(html, /<link[^>]+href/, 'nothing to fetch');
  assert.match(html, /<title>Weekly status<\/title>/);
});

test('HTML escapes anything that would otherwise be markup', () => {
  const html = toHtml({ title: '<script>alert(1)</script>', blocks: [
    paragraph('a < b && c > d'),
    table(['<th>'], [['"quoted"']]),
  ] });
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ''), /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &lt; b &amp;&amp; c &gt; d/);
  assert.match(html, /&quot;quoted&quot;/);
});

test('HTML renders a table as a table', () => {
  const html = toHtml(DOC);
  assert.match(html, /<thead><tr><th>Task<\/th>/);
  assert.match(html, /<td>Disbursement report<\/td>/);
});

// ─── Spreadsheet shaping ────────────────────────────────────────────────────

test('a sheet gets usable column widths', () => {
  const sheet = sheetFromRows('Tasks', ['Task', 'Owner'], [['A very long task title indeed', 'Ace']]);
  assert.equal(sheet.widths.length, 2);
  assert.ok(sheet.widths[0] > sheet.widths[1], 'the long column is wider');
  assert.ok(sheet.widths.every((w) => w >= 10 && w <= 60), 'and bounded');
});

test('a sheet name is made legal for Excel', () => {
  assert.equal(sheetFromRows('Q3: Sales/Marketing', ['a'], []).name, 'Q3- Sales-Marketing');
  assert.equal(sheetFromRows('x'.repeat(50), ['a'], []).name.length, 31);
  assert.equal(sheetFromRows('', ['a'], []).name, 'Sheet1');
});

test('a document containing one table can be a spreadsheet', () => {
  const sheet = firstTableAsSheet(DOC);
  assert.deepEqual(sheet.columns, ['Task', 'Owner', 'Due']);
  assert.equal(sheet.rows.length, 2);
  assert.equal(firstTableAsSheet({ blocks: [paragraph('no table here')] }), null);
});

// ─── The format list ────────────────────────────────────────────────────────

test('every format has a label a person can read', () => {
  for (const f of EXPORT_FORMATS) {
    assert.match(f.label, /\(\.\w+\)$/, f.value);
    assert.ok(f.kinds.length);
  }
});

test('a report offers document formats; a list offers spreadsheet ones', () => {
  const docFormats = formatsFor('document').map((f) => f.value);
  assert.deepEqual(docFormats.sort(), ['docx', 'html', 'md', 'pdf', 'txt']);
  const tableFormats = formatsFor('table').map((f) => f.value);
  assert.ok(tableFormats.includes('xlsx'));
  assert.ok(tableFormats.includes('csv'));
});

test('the standing requirement — every named format is available', () => {
  const have = EXPORT_FORMATS.map((f) => f.value);
  for (const required of ['docx', 'xlsx', 'md', 'txt', 'html', 'pdf', 'csv']) {
    assert.ok(have.includes(required), `${required} missing`);
  }
});

test('the filename is stamped with today, whatever the format', () => {
  for (const f of EXPORT_FORMATS) {
    assert.equal(exportFileName('weekly status', f.value), `weekly-status-${todayLocal()}.${f.value}`);
  }
});

// ─── Goals (T-0047) ─────────────────────────────────────────────────────────

import { buildGoalsDocument } from './exporters.js';

const GOALS = [{
  code: 'G1', title: 'Digitise disbursement', initiative: 'Cut the paper trail',
  kpi: '80% of requests online',
  changeAgenda: [{ from: 'Paper forms', to: 'Online forms' }, { from: '', to: '' }],
  deliverables: [
    { id: 'd1', text: 'Online request form', projectIds: ['p1'], targetDate: '2026-12-01', status: 'On track' },
    { id: 'd2', text: 'Staff training', projectIds: ['p1', 'p2'] },
    { id: 'd3', text: '' },
  ],
}];
const STATS = {
  p1: { id: 'p1', name: 'SBLAF rollout', pct: 60 },
  p2: { id: 'p2', name: 'Website revamp', pct: 20 },
};

test('a goal exports its initiative, KPI, change agenda and deliverables', () => {
  const md = toMarkdown(buildGoalsDocument(GOALS, { projectStats: STATS }));
  assert.match(md, /## G1 — Digitise disbursement/);
  assert.match(md, /\*\*Initiative:\*\* Cut the paper trail/);
  assert.match(md, /\*\*KPI:\*\* 80% of requests online/);
  assert.match(md, /### Change agenda/);
  assert.match(md, /\| Paper forms \| Online forms \|/);
  assert.match(md, /### Deliverables/);
  assert.match(md, /Online request form/);
});

test('deliverable progress is averaged across its projects', () => {
  const doc = buildGoalsDocument(GOALS, { projectStats: STATS });
  const t = doc.blocks.find((b) => b.type === 'table' && b.columns.includes('Deliverable'));
  assert.deepEqual(t.rows[0], [1, 'Online request form', 'SBLAF rollout', '2026-12-01', '60%']);
  assert.deepEqual(t.rows[1], [2, 'Staff training', 'SBLAF rollout, Website revamp', '—', '40%']);
});

test('an empty change-agenda pair is not exported as two dashes', () => {
  const doc = buildGoalsDocument(GOALS, { projectStats: STATS });
  const agenda = doc.blocks.find((b) => b.type === 'table' && b.columns[0] === 'From');
  assert.equal(agenda.rows.length, 1);
});

test('the spreadsheet is one row per deliverable, for tracking', () => {
  const doc = buildGoalsDocument(GOALS, { projectStats: STATS });
  assert.equal(doc.sheets[0].name, 'Goals');
  assert.equal(doc.sheets[0].rows.length, 3);
  assert.equal(doc.sheets[0].rows[0][5], 60, 'progress as a number, so Excel can chart it');
});

test('no goals produces a file that says so', () => {
  assert.match(toMarkdown(buildGoalsDocument([])), /No goals have been set yet/);
});

test('a goal with nothing in it does not export "undefined"', () => {
  const md = toMarkdown(buildGoalsDocument([{}], {}));
  assert.match(md, /## Untitled goal/);
  assert.match(md, /No deliverables listed/);
  assert.doesNotMatch(md, /undefined|null/);
});
