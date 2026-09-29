// src/services/boardScope.js — the Board hub's one shared filter.
//
// The Board hub's filters sit at the right-hand end of its tab strip —
// Project · Status · a person · Find item — above Calendar, Gantt, Kanban, WBS
// and Workload alike, so the five pages have to agree about what "Stuck",
// "Working on it" and "assigned to Rob" mean. They agree by calling this
// module; a second copy inside one page is how Board and Timeline come to
// disagree about how much work there is.
//
// "Stuck" is defined here, once, and it is deliberately narrow: an item is
// stuck when somebody has written down a bottleneck against it, or when it is
// open and past its own plan date. Not "in progress for a while" — that is
// ageing, which the Flow page measures separately and which is not the same
// claim. `describeScope` is the sentence the page shows, so the filter can
// never be applied silently.

import { TASK_STATUSES } from './taskStatus.js';

/**
 * The status a task is SHOWN as, which is not always the status it is in.
 *
 * A task sitting in In Progress with its plan date behind it is not "working
 * on it" in any sense a reader cares about — it is stuck, and the board
 * saying otherwise is the board taking the task's word for it. So the chip
 * follows `isStuck`: a logged bottleneck, or open and past its own plan date.
 *
 * Deliberately the SAME rule as the Stuck pill and the breadcrumb's count, so
 * three surfaces cannot disagree about how many stuck items there are. The
 * corollary is that a not-yet-started item that is past due also reads Stuck,
 * which is the right word for it: nobody has moved it and the date has gone.
 *
 * The underlying `status` is untouched — this is what to print, not what to
 * write. Nothing here saves anything.
 */
export const STATUS_TEXT = { todo: 'Not started', doing: 'Working on it', review: 'In review', done: 'Done' };
export const STATUS_TONE = { todo: 'navy', doing: 'amber', review: 'info', done: 'green' };

export function displayStatus(task, blockedIds, today) {
  if (!task) return { id: 'todo', label: STATUS_TEXT.todo, tone: 'navy', stuck: false };
  if (task.status !== 'done' && isStuck(task, blockedIds, today)) {
    return { id: 'stuck', label: 'Stuck', tone: 'red', stuck: true };
  }
  return {
    id: task.status,
    label: STATUS_TEXT[task.status] || task.status,
    tone: STATUS_TONE[task.status] || 'navy',
    stuck: false,
  };
}

/** The ids of tasks somebody has logged a bottleneck against. */
export function blockedTaskIds(activities = []) {
  return new Set(
    activities
      .filter((a) => a?.bottleneckRemarks && String(a.bottleneckRemarks).trim())
      .map((a) => a.taskId)
      .filter(Boolean),
  );
}

/** Is this one item stuck, by the definition above? */
export function isStuck(task, blockedIds, today) {
  if (!task) return false;
  if (blockedIds?.has?.(task.id)) return true;
  if (task.status === 'done') return false;
  const end = task.plan?.endDate;
  return !!(end && today && end < today);
}

/**
 * Apply the toolbar to a list of tasks.
 *
 * Every argument is optional and an absent one filters nothing — a page that
 * has not been given `activities` yet must show all its work, not none of it.
 *
 * @param {Array} tasks
 * @param {{ scope?: 'all'|'mine'|'stuck', who?: string|null, userId?: string|null,
 *           blockedIds?: Set<string>, today?: string, q?: string|null,
 *           status?: string|null }} opts
 */
export function scopeTasks(tasks = [], opts = {}) {
  const {
    scope = 'all', who = null, userId = null,
    blockedIds = new Set(), today = null, q = null, status = null,
  } = opts;
  let out = tasks;
  // The Status menu. Every Board page passes `status: route.statusFilter`,
  // so one choice narrows all five tabs — not only the Kanban, which was the
  // only page that read `?status=` before.
  if (TASK_STATUSES.includes(status)) out = out.filter((t) => t.status === status);
  if (scope === 'mine' && userId) {
    out = out.filter((t) => (t.assignedTo || []).includes(userId));
  } else if (scope === 'stuck') {
    out = out.filter((t) => isStuck(t, blockedIds, today));
  }
  if (who) out = out.filter((t) => (t.assignedTo || []).includes(who));
  // "Find item" — the box in the tab strip. It matches the title and the
  // description, because a task people find by a word in its body is a task
  // they would otherwise swear had vanished.
  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    out = out.filter((t) => `${t.title || ''} ${t.description || ''}`.toLowerCase().includes(needle));
  }
  return out;
}

/**
 * The tab row's Status menu. It is the board's own status language — the
 * words the Kanban chip prints — plus Stuck, which is a DERIVED status
 * (`displayStatus`) rather than a column, and which is how the Stuck filter
 * stayed reachable when the All · Mine · Stuck pills were replaced by this
 * menu. (Mine lives in the Assigned-to menu now: pick yourself.)
 */
export const STATUS_OPTIONS = [
  { id: 'all',    label: 'All',          hint: 'Every item, whatever its status' },
  { id: 'todo',   label: STATUS_TEXT.todo,   hint: 'Not started yet' },
  { id: 'doing',  label: STATUS_TEXT.doing,  hint: 'In progress' },
  { id: 'review', label: STATUS_TEXT.review, hint: 'Finished, waiting on somebody else' },
  { id: 'done',   label: STATUS_TEXT.done,   hint: 'Finished' },
  { id: 'stuck',  label: 'Stuck',            hint: 'Blocked, or open and past its plan date' },
];

/** Which Status option is chosen, from the route. */
export function statusOf(route = {}) {
  if (route.stuckOnly) return 'stuck';
  return TASK_STATUSES.includes(route.statusFilter) ? route.statusFilter : 'all';
}

/**
 * The route patch choosing a Status option writes. Stuck rides on the
 * existing `stuckOnly` flag; a real status on `statusFilter` (`?status=`,
 * which saved views already carry). Choosing one always clears the other,
 * so the two can never both be set from here.
 */
export function statusPatch(id) {
  return {
    stuckOnly: id === 'stuck',
    statusFilter: TASK_STATUSES.includes(id) ? id : null,
  };
}

/** Which scope is on, from the route: `?mine=1` (⌘K, a link) or Stuck. */
export function scopeOf(route = {}) {
  if (route.stuckOnly) return 'stuck';
  if (route.onlyMine) return 'mine';
  return 'all';
}


/**
 * The sentence under the title. It names the filter AND says what it means,
 * because "3 items" with a silent filter on is a wrong number, not a short one.
 */
export function describeScope({ scope = 'all', who = null, whoName = null, q = null } = {}) {
  const parts = [];
  if (scope === 'mine') parts.push('assigned to you');
  if (scope === 'stuck') parts.push('blocked or past due');
  if (who) parts.push(`${whoName || 'one member'} only`);
  if (q && String(q).trim()) parts.push(`matching “${String(q).trim()}”`);
  return parts.length ? parts.join(' · ') : null;
}
