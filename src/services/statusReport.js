// src/services/statusReport.js — the portfolio status report.
//
// The one document a manager asks for: how is every project doing, what is
// late, what is stuck, and what should happen next. The numbers come from the
// same digest the Ask AI page computes, so the report and the app can never
// disagree.

import { bullets, heading, keyValues, paragraph, sheetFromRows, table } from './exporters';
import { formatHours, formatVariance, totalVariance, variance } from './effort';

/** Red / amber / green, with what each one means spelled out. */
export const RAG = {
  red:   { label: 'Red',   meaning: 'Needs attention now' },
  amber: { label: 'Amber', meaning: 'Watch it' },
  green: { label: 'Green', meaning: 'On track' },
  grey:  { label: 'Grey',  meaning: 'Nothing scheduled yet' },
};

const RAG_ORDER = { red: 0, amber: 1, green: 2, grey: 3 };

export const ragLabel = (tone) => RAG[tone]?.label || 'Grey';

/** One line per project, worst first — the table the report opens with. */
export function ragRows(digest) {
  return [...(digest?.projects || [])]
    .sort((a, b) => (RAG_ORDER[a.tone] ?? 9) - (RAG_ORDER[b.tone] ?? 9)
      || (b.overdue || 0) - (a.overdue || 0)
      || String(a.name).localeCompare(String(b.name)))
    .map((p) => ({
      name: p.name,
      tone: p.tone,
      status: ragLabel(p.tone),
      donePct: p.donePct ?? 0,
      elapsedPct: p.elapsedPct,
      overdue: p.overdue || 0,
      blocked: p.blocked || 0,
      hours: p.hours || 0,
      end: p.end || null,
      // Positive gap = more time gone than work done.
      gap: p.gap ?? null,
    }));
}

/**
 * Estimated hours against logged hours, for the tasks anybody estimated.
 *
 * Silent when nobody has estimated anything: an "Effort" section that is all
 * dashes tells a reader the feature is broken rather than unused. And when
 * some tasks are unestimated it says so — hours logged against nothing inflate
 * the overrun, and a total that hides that is a misleading total.
 */
export function effortBlocks(digest) {
  const tasks = (digest?.taskIndex || []).map((t) => t.task).filter(Boolean);
  const total = totalVariance(tasks);
  if (total.estimated === 0) return [];

  const worst = tasks
    .map((t) => ({ t, v: variance(t) }))
    .filter((r) => r.v.state === 'over')
    .sort((a, b) => b.v.delta - a.v.delta)
    .slice(0, 10);

  const blocks = [
    heading('Effort against estimate', 1),
    keyValues([
      ['Estimated', formatHours(total.estimate)],
      ['Logged', formatHours(total.logged)],
      ['Variance', formatVariance(total)],
      ['Tasks estimated', `${total.estimated} of ${total.estimated + total.unestimated}`],
    ]),
  ];

  if (total.unestimated > 0) {
    blocks.push(paragraph(
      `${total.unestimated} task${total.unestimated === 1 ? ' has' : 's have'} no estimate, so any `
      + 'hours logged against them count towards the total logged but not towards the total estimated.',
    ));
  }

  if (worst.length) {
    blocks.push(heading('Costing more than expected', 2));
    blocks.push(table(
      ['Task', 'Project', 'Estimated', 'Logged', 'Variance'],
      worst.map(({ t, v }) => [
        t.title || 'Untitled task',
        (digest?.taskIndex || []).find((x) => x.id === t.id)?.project || '—',
        formatHours(v.estimate),
        formatHours(v.logged),
        formatVariance(v),
      ]),
    ));
  } else {
    blocks.push(paragraph('Nothing has overrun its estimate.'));
  }
  return blocks;
}

/** Why a project is the colour it is, in one sentence. */
export function explainRag(row) {
  if (row.tone === 'grey') return 'No tasks scheduled yet.';
  const bits = [];
  if (row.overdue) bits.push(`${row.overdue} task${row.overdue === 1 ? '' : 's'} overdue`);
  if (row.blocked) bits.push(`${row.blocked} blocked entr${row.blocked === 1 ? 'y' : 'ies'}`);
  if (row.gap != null && row.gap >= 10) bits.push(`${Math.round(row.gap)}% behind its schedule`);
  if (!bits.length) return `${row.donePct}% done and on schedule.`;
  return `${bits.join(', ')}.`;
}

/**
 * The report.
 *
 * @param {object} digest             from services/askAiCore.js
 * @param {{ workspaceName?, narrative?, periodLabel? }} opts
 *   `narrative` is the AI's prose when it is available — always optional, and
 *   always clearly attributed so nobody mistakes it for a computed number.
 */
export function buildStatusReport(digest, opts = {}) {
  const rows = ragRows(digest);
  const counts = digest?.counts || {};
  const blockers = digest?.blockers || [];
  const overdueTasks = (digest?.taskIndex || []).filter((t) => t.overdue);

  const blocks = [
    keyValues([
      ['Projects', rows.length],
      ['Needing attention', rows.filter((r) => r.tone === 'red').length],
      ['Open tasks', counts.open ?? 0],
      ['Overdue', counts.overdue ?? 0],
      ['Hours logged (7 days)', `${digest?.hours?.total7 ?? 0}h`],
      ['People with work assigned', counts.people ?? 0],
    ]),
  ];

  if (opts.narrative) {
    blocks.push(heading('Summary', 1));
    blocks.push(paragraph(opts.narrative));
    blocks.push(paragraph('— written by the AI assistant from the figures below.'));
  }

  blocks.push(heading('Where every project stands', 1));
  if (rows.length) {
    blocks.push(table(
      ['Project', 'Status', 'Done', 'Overdue', 'Blocked', 'Hours (30d)', 'Ends', 'Why'],
      rows.map((r) => [
        r.name, r.status, `${r.donePct}%`, r.overdue, r.blocked, r.hours,
        r.end || '—', explainRag(r),
      ]),
    ));
    blocks.push(paragraph(
      Object.values(RAG).map((v) => `${v.label} = ${v.meaning}`).join('.  ') + '.',
    ));
  } else {
    blocks.push(paragraph('There are no projects in this workspace yet.'));
  }

  // Plan-versus-actual on effort. The report has always compared DATES; this is
  // the other half, and it is the question a manager actually asks about a
  // project that finished on time (T-0137).
  blocks.push(...effortBlocks(digest));

  blocks.push(heading('Overdue', 1));
  blocks.push(overdueTasks.length
    ? table(['Task', 'Project', 'Was due', 'Assigned to'], overdueTasks.slice(0, 40).map((t) => [
      t.title, t.project || '—', t.due || '—', (t.assignees || []).join(', ') || 'Nobody',
    ]))
    : paragraph('Nothing is overdue.'));

  blocks.push(heading('Blocked', 1));
  blocks.push(blockers.length
    ? bullets(blockers.slice(0, 20).map((b) =>
      `${b.taskTitle || b.title || 'Task'}${b.project ? ` (${b.project})` : ''}: ${b.note || b.bottleneck || b.comment || 'blocked'}`))
    : paragraph('Nothing is blocked.'));

  return {
    title: `Status report — ${opts.workspaceName || 'Portfolio'}`,
    subtitle: [opts.periodLabel, `${rows.length} project${rows.length === 1 ? '' : 's'}`]
      .filter(Boolean).join(' · '),
    blocks,
    sheets: [
      sheetFromRows('Projects',
        ['Project', 'Status', 'Done %', 'Overdue', 'Blocked', 'Hours 30d', 'Ends', 'Why'],
        rows.map((r) => [r.name, r.status, r.donePct, r.overdue, r.blocked, r.hours, r.end || '', explainRag(r)])),
      sheetFromRows('Overdue',
        ['Task', 'Project', 'Was due', 'Assigned to'],
        overdueTasks.map((t) => [t.title, t.project || '', t.due || '', (t.assignees || []).join(', ')])),
    ],
  };
}

/** `status-report-<workspace>` — downloadFile adds the date. */
export const statusReportFileBase = (workspaceName) =>
  `status-report-${workspaceName || 'portfolio'}`;
