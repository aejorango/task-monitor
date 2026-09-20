// src/services/workload.js — who is carrying what, week by week.
//
// The Dashboard could say how loaded the team is *this* week. What a manager
// actually needs is the next six: where the pile-up is, and the ability to move
// a task to a different person or a different week before the deadline slips.
//
// Pure: it builds the grid and works out what a drop MEANS. The component
// renders it and `moveTaskPlan` hands the patch to `updateTask` — nothing here
// touches Firebase.

import { memberLabel } from './invites';
import { addDaysISO, todayLocal } from './recurrence';
import { weekDays, weekLabel } from './timesheet';

/** How many weeks the planner shows. Six is a quarter of planning horizon. */
export const WEEKS_AHEAD = 6;

/** Nobody's lane. A task with no assignee is work waiting to be given out. */
export const UNASSIGNED = '__unassigned__';

/** Hours a person is assumed to have in a week, when nothing says otherwise. */
export const DEFAULT_CAPACITY_HOURS = 40;

/** What one unplanned task is taken to cost, so a count still makes a bar. */
export const HOURS_PER_TASK = 4;

/**
 * The columns: `count` weeks starting with the one containing `from`.
 * @returns {{ key, days, label, start, end }[]}  `key` is the week's first day
 */
export function planningWeeks({ from = todayLocal(), count = WEEKS_AHEAD, weekStart = 1 } = {}) {
  const first = weekDays(from, weekStart);
  if (!first.length) return [];
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const days = weekDays(addDaysISO(first[0], i * 7), weekStart);
    return { key: days[0], days, label: weekLabel(days), start: days[0], end: days[6] };
  });
}

/** The week a date belongs to, or null when it is outside the planner. */
export function weekKeyOf(date, weeks = []) {
  if (!date) return null;
  const hit = weeks.find((w) => date >= w.start && date <= w.end);
  return hit ? hit.key : null;
}

/**
 * What a task is taken to weigh.
 *
 * Nobody logs an estimate, so a task counts as a fixed number of hours less
 * whatever has already been logged against it — work already done is not work
 * still to do.
 */
export function taskHours(task, { hoursPerTask = HOURS_PER_TASK } = {}) {
  if (task?.status === 'done') return 0;
  const estimate = Number(task?.estimateHours);
  const planned = Number.isFinite(estimate) && estimate > 0 ? estimate : hoursPerTask;
  const spent = Number(task?.totalHoursLogged) || 0;
  return Math.max(0, planned - spent);
}

/** Everybody a task is on. An unassigned task sits in its own lane. */
export function ownersOf(task) {
  const people = (task?.assignedTo || []).filter(Boolean);
  return people.length ? people : [UNASSIGNED];
}

/**
 * How loaded one cell is, as a word: the colour key is explained rather than
 * left to be guessed from a shade.
 */
export function loadLevel(hours, capacity = DEFAULT_CAPACITY_HOURS) {
  if (hours <= 0) return 'free';
  const share = hours / Math.max(1, capacity);
  if (share <= 0.7) return 'ok';
  if (share <= 1) return 'full';
  return 'over';
}

export const LOAD_LABEL = {
  free: 'Nothing planned',
  ok: 'Room to spare',
  full: 'A full week',
  over: 'More than a full week',
};

/**
 * The grid.
 *
 * Rows are people (plus the unassigned lane when it has anything in it),
 * columns are weeks, each cell holds the tasks planned to END in that week —
 * the deadline is what slips, so that is what the planner is about.
 *
 * A task with no due date cannot be placed; it is handed back separately rather
 * than silently dropped.
 *
 * @returns {{ weeks, rows, unscheduled, byWeekTotals }}
 */
export function buildWorkload(tasks = [], {
  weeks = planningWeeks(),
  members = [],
  memberProfiles = {},
  capacity = DEFAULT_CAPACITY_HOURS,
  hoursPerTask = HOURS_PER_TASK,
  includeDone = false,
} = {}) {
  const lanes = new Map();
  const lane = (uid) => {
    if (!lanes.has(uid)) {
      lanes.set(uid, {
        userId: uid,
        name: uid === UNASSIGNED ? 'Not assigned' : memberLabel(uid, memberProfiles),
        cells: Object.fromEntries(weeks.map((w) => [w.key, { tasks: [], hours: 0 }])),
        total: 0,
      });
    }
    return lanes.get(uid);
  };
  // Everybody in the workspace gets a row, even an empty one: a person with
  // nothing on is exactly who a manager is looking for.
  members.filter(Boolean).forEach(lane);

  const unscheduled = [];
  for (const task of tasks) {
    if (task?.deleted || task?.archived) continue;
    if (!includeDone && task?.status === 'done') continue;

    const due = task?.plan?.endDate || null;
    const key = weekKeyOf(due, weeks);
    if (!key) {
      if (!due) unscheduled.push(task);
      continue;   // outside the window: not this planner's business
    }

    const hours = taskHours(task, { hoursPerTask });
    for (const uid of ownersOf(task)) {
      const row = lane(uid);
      row.cells[key].tasks.push(task);
      row.cells[key].hours += hours;
      row.total += hours;
    }
  }

  const rows = [...lanes.values()]
    .filter((r) => r.userId !== UNASSIGNED || r.total > 0 || hasAny(r))
    .map((r) => ({
      ...r,
      cells: Object.fromEntries(Object.entries(r.cells).map(([key, cell]) => [key, {
        ...cell,
        hours: round(cell.hours),
        level: loadLevel(cell.hours, capacity),
      }])),
      total: round(r.total),
    }))
    .sort(byNameWithUnassignedLast);

  const byWeekTotals = Object.fromEntries(weeks.map((w) => [
    w.key,
    round(rows.reduce((sum, r) => sum + r.cells[w.key].hours, 0)),
  ]));

  return { weeks, rows, unscheduled, byWeekTotals };
}

const hasAny = (row) => Object.values(row.cells).some((c) => c.tasks.length > 0);
const round = (n) => Math.round(n * 100) / 100;

function byNameWithUnassignedLast(a, b) {
  if (a.userId === UNASSIGNED) return 1;
  if (b.userId === UNASSIGNED) return -1;
  return a.name.localeCompare(b.name);
}

/**
 * What dropping a task on a cell means, as a patch for `updateTask`.
 *
 * - Moving to another week shifts `plan.endDate` to the same weekday of that
 *   week and carries `plan.startDate` with it, so a three-day task stays three
 *   days long instead of collapsing onto its due date.
 * - Moving to another person replaces `assignedTo` with that one person: the
 *   planner is about who carries it, not about adding another watcher.
 * - A drop that changes nothing returns null, so no write happens.
 *
 * @returns {object|null} the patch, or null when there is nothing to do
 */
export function moveTaskPlan(task, { toUserId = null, toWeek = null } = {}) {
  if (!task) return null;
  const patch = {};

  if (toWeek?.days?.length) {
    const due = task.plan?.endDate || null;
    const start = task.plan?.startDate || null;

    // Keep the weekday: a Friday deadline stays a Friday deadline. A task with
    // no deadline at all lands on the last day of the week it was dropped in.
    const nextDue = due
      ? toWeek.days[dayOffsetWithinWeek(due, toWeek)]
      : toWeek.days[toWeek.days.length - 1];

    if (nextDue !== due) {
      patch['plan.endDate'] = nextDue;
      if (start && due) {
        const span = daysBetween(start, due);
        patch['plan.startDate'] = addDaysISO(nextDue, -span);
      }
    }
  }

  if (toUserId && toUserId !== UNASSIGNED) {
    const current = task.assignedTo || [];
    if (current.length !== 1 || current[0] !== toUserId) patch.assignedTo = [toUserId];
  } else if (toUserId === UNASSIGNED && (task.assignedTo || []).length) {
    patch.assignedTo = [];
  }

  return Object.keys(patch).length ? patch : null;
}

/** Which day of the target week matches the weekday the task is due on. */
function dayOffsetWithinWeek(due, week) {
  const dueDay = new Date(`${due}T00:00:00`).getDay();
  const index = week.days.findIndex((d) => new Date(`${d}T00:00:00`).getDay() === dueDay);
  return index >= 0 ? index : week.days.length - 1;
}

function daysBetween(a, b) {
  const ms = new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`);
  return Math.max(0, Math.round(ms / 86400000));
}

/**
 * A droppable cell's id carries both halves of where it is: who, and which
 * week. Kept here so the component that writes one and the handler that reads
 * one cannot drift apart.
 */
export const cellId = (userId, weekKey) => `wl:${userId}::${weekKey}`;

export function parseCellId(id) {
  const m = /^wl:(.*)::(.+)$/.exec(String(id || ''));
  return m ? { userId: m[1], weekKey: m[2] } : null;
}

/** What a move just did, as a sentence for the toast that confirms it. */
export function describeMove(patch, memberProfiles = {}) {
  const parts = [];
  if (patch?.['plan.endDate']) parts.push(`due ${patch['plan.endDate']}`);
  if (patch?.assignedTo) {
    parts.push(patch.assignedTo.length
      ? `assigned to ${memberLabel(patch.assignedTo[0], memberProfiles)}`
      : 'unassigned');
  }
  return parts.length ? `Moved: ${parts.join(', ')}.` : 'Moved.';
}

/** One sentence describing a cell, for a tooltip and for a screen reader. */
export function describeCell(row, week, cell) {
  const n = cell?.tasks?.length || 0;
  if (!n) return `${row.name}, ${week.label}: nothing planned`;
  return `${row.name}, ${week.label}: ${n} task${n === 1 ? '' : 's'}, `
    + `about ${cell.hours} hour${cell.hours === 1 ? '' : 's'} — ${LOAD_LABEL[cell.level].toLowerCase()}`;
}
