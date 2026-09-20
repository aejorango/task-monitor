// T-0063 / NEW-010 — the portfolio status report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAG, buildStatusReport, explainRag, ragLabel, ragRows, statusReportFileBase,
} from './statusReport.js';
import { toMarkdown } from './exporters.js';

const DIGEST = {
  counts: { open: 12, overdue: 3, people: 4 },
  hours: { total7: 37.5 },
  projects: [
    { id: 'p1', name: 'Website revamp', tone: 'green', donePct: 80, overdue: 0, blocked: 0, hours: 12, end: '2026-10-31', gap: -5 },
    { id: 'p2', name: 'SBLAF rollout', tone: 'red', donePct: 20, overdue: 3, blocked: 2, hours: 20, end: '2026-09-30', gap: 45 },
    { id: 'p3', name: 'Brand refresh', tone: 'amber', donePct: 50, overdue: 1, blocked: 0, hours: 5, end: null, gap: 12 },
    { id: 'p4', name: 'Someday pile', tone: 'grey', donePct: 0, overdue: 0, blocked: 0, hours: 0, end: null, gap: null },
  ],
  taskIndex: [
    { id: 't1', title: 'Disbursement report', project: 'SBLAF rollout', due: '2026-09-10', overdue: true, assignees: ['Ace'] },
    { id: 't2', title: 'Homepage copy', project: 'Website revamp', due: '2026-12-01', overdue: false, assignees: [] },
  ],
  blockers: [{ taskTitle: 'Disbursement report', project: 'SBLAF rollout', note: 'Waiting on the bank' }],
};

test('every status has a label and a meaning a reader can act on', () => {
  for (const [tone, v] of Object.entries(RAG)) {
    assert.ok(v.label && v.meaning, tone);
    assert.match(v.meaning, /^[A-Z]/);
  }
  assert.equal(ragLabel('red'), 'Red');
  assert.equal(ragLabel('nonsense'), 'Grey');
});

test('the worst projects come first', () => {
  assert.deepEqual(ragRows(DIGEST).map((r) => r.name),
    ['SBLAF rollout', 'Brand refresh', 'Website revamp', 'Someday pile']);
});

test('each colour is explained, never just asserted', () => {
  const rows = ragRows(DIGEST);
  assert.match(explainRag(rows[0]), /3 tasks overdue, 2 blocked entries, 45% behind its schedule\./);
  assert.match(explainRag(rows[1]), /1 task overdue/);
  assert.match(explainRag(rows[2]), /80% done and on schedule\./);
  assert.equal(explainRag(rows[3]), 'No tasks scheduled yet.');
});

test('singular and plural both read correctly', () => {
  assert.match(explainRag({ tone: 'red', overdue: 1, blocked: 1, donePct: 0 }), /1 task overdue, 1 blocked entry\./);
  assert.match(explainRag({ tone: 'red', overdue: 2, blocked: 2, donePct: 0 }), /2 tasks overdue, 2 blocked entries\./);
});

test('the report opens with the numbers, then the table', () => {
  const md = toMarkdown(buildStatusReport(DIGEST, { workspaceName: 'Blue Innovation' }));
  assert.match(md, /# Status report — Blue Innovation/);
  assert.match(md, /\*\*Projects:\*\* 4/);
  assert.match(md, /\*\*Needing attention:\*\* 1/);
  assert.match(md, /\*\*Overdue:\*\* 3/);
  assert.match(md, /## Where every project stands/);
  assert.match(md, /\| SBLAF rollout \| Red \|/);
});

test('the colour key is printed, so the table stands alone', () => {
  const md = toMarkdown(buildStatusReport(DIGEST, {}));
  assert.match(md, /Red = Needs attention now/);
  assert.match(md, /Green = On track/);
});

test('overdue and blocked get their own sections', () => {
  const md = toMarkdown(buildStatusReport(DIGEST, {}));
  assert.match(md, /## Overdue/);
  assert.match(md, /\| Disbursement report \| SBLAF rollout \| 2026-09-10 \| Ace \|/);
  assert.match(md, /## Blocked/);
  assert.match(md, /Waiting on the bank/);
});

test('a task nobody owns says so, rather than leaving a blank', () => {
  const md = toMarkdown(buildStatusReport({
    ...DIGEST,
    taskIndex: [{ id: 't', title: 'Orphan', project: 'X', due: '2026-01-01', overdue: true, assignees: [] }],
  }, {}));
  assert.match(md, /\| Orphan \| X \| 2026-01-01 \| Nobody \|/);
});

test('AI prose is included only when there is some, and is attributed', () => {
  const without = toMarkdown(buildStatusReport(DIGEST, {}));
  assert.doesNotMatch(without, /## Summary/);

  const withAi = toMarkdown(buildStatusReport(DIGEST, { narrative: 'Two projects need attention.' }));
  assert.match(withAi, /## Summary/);
  assert.match(withAi, /Two projects need attention\./);
  assert.match(withAi, /written by the AI assistant/, 'nobody must mistake it for a computed number');
});

test('a clean portfolio says so rather than printing empty tables', () => {
  const md = toMarkdown(buildStatusReport({ counts: {}, projects: [], taskIndex: [], blockers: [] }, {}));
  assert.match(md, /no projects in this workspace yet/);
  assert.match(md, /Nothing is overdue\./);
  assert.match(md, /Nothing is blocked\./);
});

test('an empty digest does not throw', () => {
  assert.doesNotThrow(() => buildStatusReport(undefined, {}));
  assert.doesNotThrow(() => buildStatusReport({}, {}));
});

test('the spreadsheet carries the projects and the overdue list', () => {
  const doc = buildStatusReport(DIGEST, {});
  assert.deepEqual(doc.sheets.map((s) => s.name), ['Projects', 'Overdue']);
  assert.equal(doc.sheets[0].rows.length, 4);
  assert.equal(doc.sheets[0].rows[0][2], 20, 'a number, so Excel can chart it');
});

test('the filename names the workspace', () => {
  assert.equal(statusReportFileBase('Blue Innovation'), 'status-report-Blue Innovation');
  assert.equal(statusReportFileBase(''), 'status-report-portfolio');
});
