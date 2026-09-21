// src/services/tableViews.js — the shape of a configurable task table.
//
// A saved view used to remember only which project, tag and status you were
// filtered to. That is a bookmark, not a report. This adds the three things
// that make a table a report: which columns are shown and in what order, what
// it is grouped by, and how it is sorted — persisted so reopening a view gives
// you back exactly the table you built.
//
// Pure: the column definitions carry their own accessor, so a component renders
// what this returns without knowing anything about task shape.

import { customFieldColumns } from './customFields';
import { estimateOf, formatHours, formatVariance, variance } from './effort';
import { memberLabel } from './invites';

const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { todo: 0, doing: 1, done: 2 };

/**
 * Every column a task table can show.
 *  value  — what to sort and group by (a string, number, or null)
 *  text   — what to display
 *  align  — 'right' for numbers
 */
export const TASK_TABLE_COLUMNS = [
  {
    id: 'title', label: 'Task', always: true,
    value: (t) => (t.title || '').toLowerCase(),
    text: (t) => t.title || '(untitled)',
  },
  {
    id: 'project', label: 'Project',
    value: (t, ctx) => (ctx.projectById?.[t.projectId]?.name || '').toLowerCase(),
    text: (t, ctx) => ctx.projectById?.[t.projectId]?.name || '—',
  },
  {
    id: 'phase', label: 'Phase',
    value: (t, ctx) => (phaseName(t, ctx) || '').toLowerCase(),
    text: (t, ctx) => phaseName(t, ctx) || '—',
  },
  {
    id: 'status', label: 'Status',
    value: (t) => STATUS_RANK[t.status] ?? 9,
    text: (t) => STATUS_LABEL[t.status] || t.status || '—',
  },
  {
    id: 'priority', label: 'Priority',
    value: (t) => PRIORITY_RANK[t.priority] ?? 9,
    text: (t) => PRIORITY_LABEL[t.priority] || t.priority || '—',
  },
  {
    id: 'assignee', label: 'Assigned to',
    value: (t, ctx) => assigneeNames(t, ctx).join(', ').toLowerCase(),
    text: (t, ctx) => assigneeNames(t, ctx).join(', ') || 'Unassigned',
  },
  {
    id: 'due', label: 'Due',
    value: (t) => t.plan?.endDate || null,
    text: (t) => t.plan?.endDate || '—',
  },
  {
    id: 'start', label: 'Start',
    value: (t) => t.plan?.startDate || null,
    text: (t) => t.plan?.startDate || '—',
  },
  {
    id: 'finished', label: 'Finished',
    value: (t) => t.actual?.endDate || null,
    text: (t) => t.actual?.endDate || '—',
  },
  {
    id: 'progress', label: 'Progress', align: 'right',
    value: (t) => (t.status === 'done' ? 100 : (t.progress ?? 0)),
    text: (t) => `${t.status === 'done' ? 100 : (t.progress ?? 0)}%`,
  },
  {
    id: 'hours', label: 'Hours', align: 'right',
    value: (t) => t.totalHoursLogged ?? 0,
    text: (t) => String(t.totalHoursLogged ?? 0),
  },
  // Plan-versus-actual on EFFORT, the half the app had never had (T-0137).
  // Sorting puts "no estimate" last rather than at zero: an unestimated task is
  // not a task estimated at nothing.
  {
    id: 'estimate', label: 'Estimate', align: 'right',
    value: (t) => estimateOf(t) ?? Number.POSITIVE_INFINITY,
    text: (t) => formatHours(estimateOf(t)),
  },
  {
    id: 'variance', label: 'Variance', align: 'right',
    value: (t) => {
      const v = variance(t);
      return v.state === 'none' ? Number.NEGATIVE_INFINITY : v.delta;
    },
    text: (t) => formatVariance(variance(t)),
  },
  {
    id: 'tags', label: 'Tags',
    value: (t) => (t.tags || []).join(', ').toLowerCase(),
    text: (t) => (t.tags || []).join(', ') || '—',
  },
  {
    id: 'requestedBy', label: 'Requested by',
    value: (t) => (t.requestedBy || '').toLowerCase(),
    text: (t) => t.requestedBy || '—',
  },
];

function phaseName(task, ctx) {
  const project = ctx?.projectById?.[task.projectId];
  return project?.phases?.find((p) => p.id === task.phaseId)?.name || '';
}

function assigneeNames(task, ctx) {
  const profiles = ctx?.memberProfiles || {};
  return [
    ...(task.assignedTo || []).map((uid) => memberLabel(uid, profiles)),
    ...(task.assignedToExternal || []),
  ].filter((n) => n && n !== 'Invited member');
}

export const COLUMN_BY_ID = Object.fromEntries(TASK_TABLE_COLUMNS.map((c) => [c.id, c]));

// A project's own fields are columns too, but they are not known until the
// projects are loaded — so every function below takes the context and looks the
// catalogue up from it. Memoised on the projects array, because a table with
// 500 rows asks for the catalogue once per row.
const catalogueCache = new WeakMap();

/** Every column available given these projects: the built-ins plus custom fields. */
export function columnCatalogue(ctx = {}) {
  const projects = ctx.projects;
  if (!Array.isArray(projects) || projects.length === 0) {
    return { list: TASK_TABLE_COLUMNS, byId: COLUMN_BY_ID };
  }
  const cached = catalogueCache.get(projects);
  if (cached) return cached;

  const list = [...TASK_TABLE_COLUMNS, ...customFieldColumns(projects)];
  const built = { list, byId: Object.fromEntries(list.map((c) => [c.id, c])) };
  catalogueCache.set(projects, built);
  return built;
}

const columnById = (id, ctx) => columnCatalogue(ctx).byId[id];

/** Shown when a view does not say otherwise. */
export const DEFAULT_COLUMNS = ['title', 'project', 'status', 'priority', 'assignee', 'due', 'progress'];

/** What a table can be grouped by. 'none' is a flat list. */
export const GROUP_OPTIONS = [
  { value: 'none',     label: 'No grouping' },
  { value: 'project',  label: 'Project' },
  { value: 'phase',    label: 'Phase' },
  { value: 'status',   label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assigned to' },
];

export const DEFAULT_TABLE_CONFIG = {
  columns: [...DEFAULT_COLUMNS],
  groupBy: 'none',
  sortBy: 'due',
  sortDir: 'asc',
};

/**
 * Clean a stored config back into something renderable. A view saved before a
 * column existed — or after one was removed — must still open.
 */
export function normalizeTableConfig(raw, ctx = {}) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const { byId } = columnCatalogue(ctx);

  let columns = Array.isArray(cfg.columns)
    ? cfg.columns.filter((id) => byId[id])
    : [...DEFAULT_COLUMNS];
  columns = [...new Set(columns)];
  // The task title is what makes a row identifiable; never let it be hidden.
  if (!columns.includes('title')) columns = ['title', ...columns];
  if (columns.length === 1 && columns[0] === 'title') columns = [...DEFAULT_COLUMNS];

  const groupBy = groupOptions(ctx).some((g) => g.value === cfg.groupBy) ? cfg.groupBy : 'none';
  const sortBy = byId[cfg.sortBy] ? cfg.sortBy : DEFAULT_TABLE_CONFIG.sortBy;
  const sortDir = cfg.sortDir === 'desc' ? 'desc' : 'asc';

  return { columns, groupBy, sortBy, sortDir };
}

/** Only the four fields, so a whole component's state never lands in Firestore. */
export function tableConfigFields(cfg, ctx = {}) {
  const { columns, groupBy, sortBy, sortDir } = normalizeTableConfig(cfg, ctx);
  return { columns, groupBy, sortBy, sortDir };
}

/**
 * What a table can be grouped by, including the project's own select fields —
 * "group by Client" is the question a custom field is usually there to answer.
 * A free-text or number field would make one group per value, so only `select`
 * fields are offered.
 */
export function groupOptions(ctx = {}) {
  const extra = columnCatalogue(ctx).list
    .filter((c) => c.custom && c.field?.type === 'select')
    .map((c) => ({ value: c.id, label: c.label }));
  return [...GROUP_OPTIONS, ...extra];
}

/** Nulls and blanks sort last in either direction — they are "not yet", not "first". */
function compareValues(a, b, dir) {
  const empty = (v) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  const cmp = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b));
  return dir === 'desc' ? -cmp : cmp;
}

export function sortTasks(tasks, cfg, ctx = {}) {
  const { sortBy, sortDir } = normalizeTableConfig(cfg, ctx);
  const col = columnById(sortBy, ctx);
  return [...tasks].sort((a, b) =>
    compareValues(col.value(a, ctx), col.value(b, ctx), sortDir)
    // A stable tiebreak, so the order does not shuffle between renders.
    || String(a.title || '').localeCompare(String(b.title || '')));
}

/**
 * Rows, grouped and sorted.
 * @returns {{ key, label, tasks }[]} one entry when grouping is off
 */
export function groupTasks(tasks, cfg, ctx = {}) {
  const { groupBy } = normalizeTableConfig(cfg, ctx);
  const sorted = sortTasks(tasks, cfg, ctx);
  if (groupBy === 'none') return [{ key: 'all', label: null, tasks: sorted }];

  const col = columnById(groupBy, ctx);
  const groups = new Map();
  for (const task of sorted) {
    const label = col.text(task, ctx) || '—';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(task);
  }

  // Group order follows the column's own sort value, so Status reads
  // To do → In progress → Done rather than alphabetically.
  return [...groups.entries()]
    .map(([label, groupTasksList]) => ({
      key: label,
      label: `${label} (${groupTasksList.length})`,
      tasks: groupTasksList,
      sortValue: col.value(groupTasksList[0], ctx),
    }))
    .sort((a, b) => compareValues(a.sortValue, b.sortValue, 'asc'))
    .map(({ sortValue, ...rest }) => rest);   // eslint-disable-line no-unused-vars
}

/** The cells of one row, in the view's column order. */
export function rowCells(task, cfg, ctx = {}) {
  const { columns } = normalizeTableConfig(cfg, ctx);
  return columns.map((id) => {
    const col = columnById(id, ctx);
    return { id, label: col.label, text: col.text(task, ctx), align: col.align || 'left' };
  });
}

/** The header, in the view's column order. */
export function headerCells(cfg, ctx = {}) {
  const { columns, sortBy, sortDir } = normalizeTableConfig(cfg, ctx);
  return columns.map((id) => ({
    id,
    label: columnById(id, ctx).label,
    align: columnById(id, ctx).align || 'left',
    sorted: id === sortBy ? sortDir : null,
  }));
}

/** Clicking a header: same column flips the direction, a new column starts ascending. */
export function toggleSort(cfg, columnId, ctx = {}) {
  const current = normalizeTableConfig(cfg, ctx);
  if (!columnById(columnId, ctx)) return current;
  if (current.sortBy === columnId) {
    return { ...current, sortDir: current.sortDir === 'asc' ? 'desc' : 'asc' };
  }
  return { ...current, sortBy: columnId, sortDir: 'asc' };
}
