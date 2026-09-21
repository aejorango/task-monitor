// src/services/bulkTasks.js — what "do this to the ten tasks I picked" means
// (T-0127 / IMP-017).
//
// The Activity Log has had multi-select and a bulk bar since the beginning; the
// task table — the surface anybody coming from Linear or Asana reaches for
// first — had no row selection at all, so there was nowhere in the app to
// reassign, reschedule, re-prioritise, tag or close ten tasks at once.
//
// Everything about that except the actual write lives here, pure: the
// vocabulary of actions, the patch each one produces for one task, the plan for
// a whole selection, the inverse plan that Undo replays, and the batching. The
// component renders what this returns and calls one function in firebase.js.
//
// Three rules this module exists to keep:
//
//   · A status change goes through `statusStamps()`. Deriving progress and the
//     actual dates by hand is how a task reaches "done" with different stamps
//     depending on which screen it was done from.
//   · Nothing is ever hard-deleted. "Delete" writes `deleted: true`, because
//     activities reference tasks.
//   · Undo restores the PREVIOUS values, captured before the write. An undo
//     built from the action alone cannot know what a task was before.

import { statusStamps, normalizeTaskStatus, TASK_STATUSES } from './taskStatus';

// Firestore's hard limit is 500 writes per batch. The rest of the app commits
// in 400s, and so does this.
export const BATCH_LIMIT = 400;

// What a picker has to ask for before the action can run. 'none' means the
// action needs no value at all.
export const VALUE_KINDS = {
  STATUS:   'status',
  PRIORITY: 'priority',
  ASSIGNEE: 'assignee',
  DATE:     'date',
  TAG:      'tag',
  NONE:     'none',
};

export const PRIORITIES = ['high', 'medium', 'low'];

export const STATUS_LABELS  = { todo: 'To Do', doing: 'In Progress', done: 'Done' };
export const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

/**
 * The bulk actions, in the order a bar should offer them.
 *
 * `label` is what the button says. `valueKind` tells the UI which plain-language
 * picker to show — never a free-text field for something that has a fixed set of
 * answers, and never an id typed by hand.
 */
export const BULK_ACTIONS = [
  { id: 'status',   label: 'Set status',    valueKind: VALUE_KINDS.STATUS },
  { id: 'priority', label: 'Set priority',  valueKind: VALUE_KINDS.PRIORITY },
  { id: 'assignee', label: 'Assign to',     valueKind: VALUE_KINDS.ASSIGNEE },
  { id: 'dueDate',  label: 'Set due date',  valueKind: VALUE_KINDS.DATE },
  { id: 'addTag',   label: 'Add tag',       valueKind: VALUE_KINDS.TAG },
  { id: 'delete',   label: 'Delete',        valueKind: VALUE_KINDS.NONE, danger: true },
];

export const bulkAction = (id) => BULK_ACTIONS.find((a) => a.id === id) || null;

/* ── selection ─────────────────────────────────────────────────────────── */

/**
 * The ids between two rows, inclusive, in the order the table is showing them.
 * Order of the arguments does not matter — a shift-click upwards selects the
 * same range as a shift-click downwards.
 */
export function rangeIds(orderedIds, fromId, toId) {
  const a = orderedIds.indexOf(fromId);
  const b = orderedIds.indexOf(toId);
  if (a < 0 || b < 0) return [];
  return orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * What one click on a row does to the selection.
 *
 * Plain click  — select just that row (and clear the rest), or clear it if it
 *                was the only one selected.
 * ⌘/Ctrl click — add or remove that row, leaving the others alone.
 * Shift click  — select everything between the anchor and this row.
 *
 * Returns `{ selected, anchor }`. The anchor is what the NEXT shift-click
 * measures from: shift never moves it, everything else does.
 */
export function selectionAfterClick({
  selected = new Set(), anchor = null, orderedIds = [], id,
  shiftKey = false, metaKey = false,
} = {}) {
  const has = selected.has(id);

  if (shiftKey && anchor && orderedIds.includes(anchor)) {
    const next = new Set(selected);
    for (const rid of rangeIds(orderedIds, anchor, id)) next.add(rid);
    return { selected: next, anchor };
  }
  if (metaKey || shiftKey) {
    // Shift with no anchor yet behaves like ⌘: there is no range to take.
    const next = new Set(selected);
    if (has) next.delete(id); else next.add(id);
    return { selected: next, anchor: next.has(id) ? id : anchor };
  }
  if (has && selected.size === 1) return { selected: new Set(), anchor: null };
  return { selected: new Set([id]), anchor: id };
}

/** Drop ids that are no longer on screen, so a filter change cannot hide a selection. */
export function pruneSelection(selected, visibleIds) {
  const live = new Set(visibleIds);
  const next = new Set();
  for (const id of selected) if (live.has(id)) next.add(id);
  return next;
}

/* ── the patch for one task ────────────────────────────────────────────── */

const sameDate = (a, b) => (a || null) === (b || null);

/**
 * The fields to write on one task, or `null` when the action would change
 * nothing about it. A no-op is not an error — picking "High" for ten tasks of
 * which three are already High writes seven documents, not ten.
 *
 * Dotted keys (`plan.endDate`) are deliberate: Firestore's update merges them
 * into the nested object instead of replacing the whole `plan`.
 */
export function bulkPatch(task, actionId, value, { today = null } = {}) {
  if (!task) return null;

  switch (actionId) {
    case 'status': {
      const status = normalizeTaskStatus(value, null);
      if (!status || status === task.status) return null;
      // The one rule for what a status implies — never re-derived here.
      const stamps = statusStamps(status, {
        today,
        current: {
          startDate: task.actual?.startDate,
          endDate:   task.actual?.endDate,
          progress:  task.progress,
        },
      });
      return {
        status,
        progress: stamps.progress,
        'actual.startDate': stamps.actualStartDate,
        'actual.endDate':   stamps.actualEndDate,
      };
    }

    case 'priority': {
      if (!PRIORITIES.includes(value)) return null;
      if (task.priority === value) return null;
      return { priority: value };
    }

    case 'assignee': {
      // '' means "nobody" — clearing an assignment is a real bulk action, not a
      // missing value.
      const next = value ? [value] : [];
      const current = task.assignedTo || [];
      if (current.length === next.length && current.every((u, i) => u === next[i])) return null;
      return { assignedTo: next };
    }

    case 'dueDate': {
      const next = value || null;
      if (sameDate(task.plan?.endDate, next)) return null;
      return { 'plan.endDate': next };
    }

    case 'addTag': {
      const tag = String(value || '').trim().replace(/^#/, '');
      if (!tag) return null;
      const tags = task.tags || [];
      if (tags.includes(tag)) return null;
      return { tags: [...tags, tag] };
    }

    case 'delete': {
      if (task.deleted) return null;
      return { deleted: true };
    }

    default:
      return null;
  }
}

/** The fields that put ONE task back the way it was before `patch` was written. */
export function inversePatch(task, patch) {
  if (!task || !patch) return null;
  const back = {};
  for (const key of Object.keys(patch)) {
    switch (key) {
      case 'actual.startDate': back[key] = task.actual?.startDate ?? null; break;
      case 'actual.endDate':   back[key] = task.actual?.endDate ?? null; break;
      case 'plan.endDate':     back[key] = task.plan?.endDate ?? null; break;
      case 'assignedTo':       back[key] = [...(task.assignedTo || [])]; break;
      case 'tags':             back[key] = [...(task.tags || [])]; break;
      case 'deleted':          back[key] = !!task.deleted; break;
      case 'progress':         back[key] = task.progress ?? 0; break;
      case 'status':           back[key] = task.status || 'todo'; break;
      default:                 back[key] = task[key] ?? null; break;
    }
  }
  return back;
}

/* ── the plan for a selection ──────────────────────────────────────────── */

/**
 * Everything needed to run one bulk action and to undo it.
 *
 * @returns {{
 *   writes: Array<{ id: string, patch: object }>,
 *   undo:   Array<{ id: string, patch: object }>,
 *   changed: number, skipped: number, batches: number,
 * }}
 *   `skipped` counts tasks the action would not change — worth telling the user
 *   about, because "8 of 10 updated" is a different sentence from "10 updated".
 */
export function bulkPlan(tasks = [], actionId, value, { today = null } = {}) {
  const writes = [];
  const undo = [];
  let skipped = 0;

  for (const task of tasks) {
    const patch = bulkPatch(task, actionId, value, { today });
    if (!patch) { skipped += 1; continue; }
    writes.push({ id: task.id, patch });
    undo.push({ id: task.id, patch: inversePatch(task, patch) });
  }

  return {
    writes,
    undo,
    changed: writes.length,
    skipped,
    batches: Math.ceil(writes.length / BATCH_LIMIT),
  };
}

/** Split writes into commits Firestore will accept. */
export function chunkWrites(writes = [], size = BATCH_LIMIT) {
  const out = [];
  for (let i = 0; i < writes.length; i += size) out.push(writes.slice(i, i + size));
  return out;
}

/* ── what to say about it ──────────────────────────────────────────────── */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * One plain sentence for the toast, naming the value the way a person picked it
 * — never an id, never a field name.
 *
 * `nameFor` turns an assignee uid into a person's name; without it the uid
 * would end up on screen, which is the thing the app's own rules forbid.
 */
export function describeBulk(actionId, value, plan, { nameFor = (v) => v } = {}) {
  const n = plan?.changed ?? 0;
  const tasks = plural(n, 'task', 'tasks');
  const tail = plan?.skipped
    ? ` · ${plan.skipped} already ${actionId === 'delete' ? 'deleted' : 'matched'}`
    : '';

  switch (actionId) {
    case 'status':   return `${tasks} moved to ${STATUS_LABELS[value] || value}${tail}`;
    case 'priority': return `${tasks} set to ${PRIORITY_LABELS[value] || value} priority${tail}`;
    case 'assignee': return value
      ? `${tasks} assigned to ${nameFor(value)}${tail}`
      : `${tasks} unassigned${tail}`;
    case 'dueDate':  return value
      ? `${tasks} due ${value}${tail}`
      : `Due date cleared on ${tasks}${tail}`;
    case 'addTag':   return `#${String(value || '').replace(/^#/, '')} added to ${tasks}${tail}`;
    case 'delete':   return `${tasks} deleted${tail}`;
    default:         return `${tasks} updated${tail}`;
  }
}

/** The confirm a destructive bulk action needs before it runs. */
export function confirmFor(actionId, count) {
  if (actionId !== 'delete') return null;
  return {
    title: `Delete ${plural(count, 'task', 'tasks')}?`,
    message: 'They move to Trash, where you can put them back.',
    confirmLabel: 'Delete',
    danger: true,
  };
}

export { TASK_STATUSES };
