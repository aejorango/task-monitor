// src/services/taskExport.js — a task list as a document anyone can open.
//
// "Get the task list into Excel" was not possible: the only exports were the
// activity CSV and a developer JSON dump. This builds the same list the user is
// looking at — filters applied — into the exporters' document model, so the
// Board, Gantt and Projects pages all hand over the same thing.

import { heading, paragraph, sheetFromRows, table } from './exporters';

const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

/** Columns, in the order a person reads them. */
export const TASK_COLUMNS = [
  'Task', 'Project', 'Phase', 'Status', 'Priority', 'Assigned to',
  'Start (plan)', 'Due (plan)', 'Start (actual)', 'Finished (actual)',
  'Progress', 'Hours logged', 'Tags', 'Requested by',
];

const names = (uids, memberProfiles = {}) => (uids || [])
  .map((uid) => memberProfiles[uid]?.displayName || memberProfiles[uid]?.email || '')
  .filter(Boolean);

/** One task as a row of TASK_COLUMNS. */
export function taskRow(task, { projectById = {}, memberProfiles = {} } = {}) {
  const project = projectById[task.projectId];
  const phase = project?.phases?.find((p) => p.id === task.phaseId);
  const people = [...names(task.assignedTo, memberProfiles), ...(task.assignedToExternal || [])];

  return [
    task.title || '(untitled)',
    project?.name || '',
    phase?.name || '',
    STATUS_LABEL[task.status] || task.status || '',
    PRIORITY_LABEL[task.priority] || task.priority || '',
    people.join(', '),
    task.plan?.startDate || '',
    task.plan?.endDate || '',
    task.actual?.startDate || '',
    task.actual?.endDate || '',
    task.status === 'done' ? 100 : (task.progress ?? 0),
    task.totalHoursLogged ?? 0,
    (task.tags || []).join(', '),
    task.requestedBy || '',
  ];
}

/** A short line describing which tasks are in the file. */
export function describeScope({ projectName, statusFilter, tagFilter, count }) {
  const parts = [];
  parts.push(projectName ? `Project: ${projectName}` : 'All projects');
  if (statusFilter && statusFilter !== 'all') parts.push(`Status: ${STATUS_LABEL[statusFilter] || statusFilter}`);
  if (tagFilter) parts.push(`Tag: ${tagFilter}`);
  parts.push(`${count} task${count === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * The exportable document for a list of tasks.
 * @param {object[]} tasks
 * @param {{ title?, projectById?, memberProfiles?, projectName?, statusFilter?, tagFilter? }} opts
 */
export function buildTaskListDocument(tasks = [], opts = {}) {
  const rows = tasks.map((t) => taskRow(t, opts));
  const title = opts.title || 'Task list';
  const subtitle = describeScope({ ...opts, count: tasks.length });

  // Grouped by project in the readable formats; flat in the spreadsheet, where
  // people sort and filter for themselves.
  const byProject = new Map();
  tasks.forEach((t) => {
    const name = opts.projectById?.[t.projectId]?.name || 'No project';
    if (!byProject.has(name)) byProject.set(name, []);
    byProject.get(name).push(t);
  });

  const blocks = [];
  if (!tasks.length) {
    blocks.push(paragraph('There are no tasks matching the current filters.'));
  } else {
    for (const [name, group] of [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      blocks.push(heading(`${name} (${group.length})`, 1));
      blocks.push(table(
        ['Task', 'Status', 'Priority', 'Assigned to', 'Due', 'Progress'],
        group.map((t) => {
          const r = taskRow(t, opts);
          return [r[0], r[3], r[4], r[5], r[7], `${r[10]}%`];
        }),
      ));
    }
  }

  return {
    title,
    subtitle,
    blocks,
    sheets: [sheetFromRows('Tasks', TASK_COLUMNS, rows)],
  };
}
