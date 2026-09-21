// src/services/activityExport.js — the activity log and the WBS, as documents
// anybody can open.
//
// Four surfaces still handed over a hand-rolled CSV: the Activity Log's "Export
// all" and its bulk bar, the WBS page, the WBS modal and the per-project
// activity log in Projects. Those are exactly the pages somebody sends to a
// client or a manager, and CSV is the one format nobody wants to receive
// (BUG-031).
//
// Pure: rows in, a document out. The heavy writers stay behind the dynamic
// imports in exporters.js, so nothing here is downloaded by a person who never
// exports.

import { heading, paragraph, sheetFromRows, table, keyValues } from './exporters';

const COMPLETION_LABEL = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
};

/** Columns, in the order a person reads them — and the order the CSV had. */
export const ACTIVITY_COLUMNS = [
  'Date', 'Project', 'Phase', 'Task', 'What was done', 'Completion',
  'Hours', 'Blockers', 'Requested by', 'Output links',
];

const linksOf = (a) => (a.attachments || [])
  .map((x) => x?.url || x?.name || '')
  .filter(Boolean)
  .join(' | ');

/** One activity as a row of ACTIVITY_COLUMNS. */
export function activityRow(a, { projectById = {}, taskById = {} } = {}) {
  const project = projectById[a.projectId];
  const phase = project?.phases?.find((p) => p.id === a.phaseId);
  return [
    a.date || '',
    // The denormalized snapshot first: an activity keeps the names it was
    // logged against even after the task is renamed or deleted.
    project?.name || a.projectName || '',
    phase?.name || '',
    taskById[a.taskId]?.title || a.taskTitle || '',
    a.comment || '',
    COMPLETION_LABEL[a.completionStatus] || a.completionStatus || '',
    Number(a.hoursSpent) || 0,
    a.bottleneckRemarks || '',
    a.requestedBy || '',
    linksOf(a),
  ];
}

/** Total hours, rounded the way the app shows them. */
export function totalHours(activities = []) {
  return Math.round(activities.reduce((n, a) => n + (Number(a.hoursSpent) || 0), 0) * 100) / 100;
}

/** A short line describing what is in the file. */
export function describeActivityScope({ projectName, from, to, count, hours }) {
  const parts = [projectName ? `Project: ${projectName}` : 'All projects'];
  if (from || to) parts.push(`Dates: ${from || 'the beginning'} → ${to || 'today'}`);
  parts.push(`${count} entr${count === 1 ? 'y' : 'ies'}`);
  parts.push(`${hours}h logged`);
  return parts.join(' · ');
}

/**
 * The exportable document for a list of activities.
 *
 * Grouped by day in the readable formats — which is how somebody reads a work
 * log — and flat in the spreadsheet, where people sort and filter themselves.
 */
export function buildActivityLogDocument(activities = [], opts = {}) {
  const rows = activities.map((a) => activityRow(a, opts));
  const hours = totalHours(activities);
  const title = opts.title || 'Activity log';
  const subtitle = describeActivityScope({ ...opts, count: activities.length, hours });

  const blocks = [];
  if (!activities.length) {
    blocks.push(paragraph('There are no activities matching the current filters.'));
  } else {
    const byDay = new Map();
    for (const a of activities) {
      const day = a.date || 'No date';
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(a);
    }
    // Newest first, the way the log itself reads.
    for (const [day, group] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      blocks.push(heading(`${day} · ${totalHours(group)}h`, 1));
      blocks.push(table(
        ['Task', 'What was done', 'Completion', 'Hours', 'Blockers'],
        group.map((a) => {
          const r = activityRow(a, opts);
          return [r[3], r[4], r[5], r[6], r[7]];
        }),
      ));
    }
  }

  return {
    title,
    subtitle,
    blocks,
    sheets: [sheetFromRows('Activity log', ACTIVITY_COLUMNS, rows)],
  };
}

// ─── WBS ────────────────────────────────────────────────────────────────────

/** Columns for the work breakdown. */
export const WBS_COLUMNS = [
  'Phase', 'Task', 'Status', 'Assigned to', 'Start', 'Finish', 'Progress', 'Hours logged',
];

const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };

const startOf = (t) => t.plan?.startDate || t.actual?.startDate || '';
const endOf = (t) => t.plan?.endDate || t.actual?.endDate || '';

/** The percentage the WBS shows for a task. */
export function taskPercent(t) {
  if (t.status === 'done') return 100;
  if (Number.isFinite(t.progress)) return Math.max(0, Math.min(100, Math.round(t.progress)));
  return 0;
}

/** The average of a group, weighted by nothing — the same arithmetic on screen. */
export function groupPercent(tasks = []) {
  if (!tasks.length) return 0;
  return Math.round(tasks.reduce((n, t) => n + taskPercent(t), 0) / tasks.length);
}

export function wbsRow(task, { phaseName = '', memberProfiles = {} } = {}) {
  const people = [
    ...(task.assignedTo || []).map((uid) => memberProfiles[uid]?.displayName || memberProfiles[uid]?.email || ''),
    ...(task.assignedToExternal || []),
  ].filter(Boolean);
  return [
    phaseName,
    task.title || '(untitled)',
    STATUS_LABEL[task.status] || task.status || '',
    people.join(', '),
    startOf(task),
    endOf(task),
    taskPercent(task),
    task.totalHoursLogged ?? 0,
  ];
}

/**
 * The exportable document for one project's work breakdown.
 *
 * Phases in the project's own order — not alphabetical — because that order is
 * the plan. Tasks with no phase come last, under a heading that says so rather
 * than being silently dropped.
 */
export function buildWbsDocument(project, tasks = [], opts = {}) {
  const phases = project?.phases || [];
  const title = opts.title || `${project?.name || 'Project'} — work breakdown`;

  const groups = phases.map((p) => ({
    name: p.name || 'Unnamed phase',
    tasks: tasks.filter((t) => t.phaseId === p.id),
  }));
  const loose = tasks.filter((t) => !t.phaseId || !phases.some((p) => p.id === t.phaseId));
  if (loose.length) groups.push({ name: 'No phase', tasks: loose });

  const blocks = [
    keyValues([
      ['Project', project?.name || ''],
      ['Tasks', String(tasks.length)],
      ['Complete', `${groupPercent(tasks)}%`],
      ['Hours logged', String(tasks.reduce((n, t) => n + (t.totalHoursLogged || 0), 0))],
    ]),
  ];

  if (!tasks.length) {
    blocks.push(paragraph('This project has no tasks yet.'));
  } else {
    for (const g of groups) {
      blocks.push(heading(`${g.name} — ${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'}, ${groupPercent(g.tasks)}% complete`, 1));
      if (!g.tasks.length) {
        blocks.push(paragraph('Nothing in this phase yet.'));
        continue;
      }
      blocks.push(table(
        ['Task', 'Status', 'Assigned to', 'Start', 'Finish', 'Progress'],
        g.tasks.map((t) => {
          const r = wbsRow(t, { phaseName: g.name, memberProfiles: opts.memberProfiles });
          return [r[1], r[2], r[3], r[4], r[5], `${r[6]}%`];
        }),
      ));
    }
  }

  const rows = groups.flatMap((g) => g.tasks.map((t) => wbsRow(t, { phaseName: g.name, memberProfiles: opts.memberProfiles })));
  return {
    title,
    subtitle: `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${groupPercent(tasks)}% complete`,
    blocks,
    sheets: [sheetFromRows('Work breakdown', WBS_COLUMNS, rows)],
  };
}
