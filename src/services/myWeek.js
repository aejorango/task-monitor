// src/services/myWeek.js — what one person is doing this week, across every
// workspace they belong to (T-0130 / NEW-020).
//
// The app could already answer "what is the team carrying" (Workload, a
// manager's grid of other people) and "what is on this board" (the My-tasks
// chip, one workspace at a time). It could not answer the question somebody who
// runs several workspaces asks every morning: what am I doing this week, across
// everything.
//
// Pure: it buckets tasks into day columns and says what a drop means. The
// component renders it; the write goes through `moveTaskToDay` in workload.js,
// which is the module that already owns what a drop means.

import { addDaysISO, todayLocal } from './recurrence';
import { weekDays } from './timesheet';

/** How far ahead "this week" can be pushed before it stops being this week. */
export const MAX_WEEK_OFFSET = 8;
export const MIN_WEEK_OFFSET = -8;

/** A task nobody has given a date to. It is real work; it just has no day yet. */
export const UNSCHEDULED = '__unscheduled__';

/** Is this task one of mine? */
export function isMine(task, uid) {
  if (!task || !uid) return false;
  return (task.assignedTo || []).includes(uid);
}

/**
 * The days of the week `offset` weeks from the one containing `today`,
 * honouring the week-start preference (0 = Sunday, 1 = Monday).
 *
 * Seven days, not five: a person who works Saturdays should still be able to
 * see and schedule Saturday. The component may choose to dim the weekend.
 */
export function weekOf({ today = todayLocal(), weekStart = 1, offset = 0 } = {}) {
  const anchor = addDaysISO(today, clampOffset(offset) * 7) || today;
  const days = weekDays(anchor, weekStart);
  return {
    days,
    start: days[0] || null,
    end: days[days.length - 1] || null,
    offset: clampOffset(offset),
  };
}

export function clampOffset(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(MIN_WEEK_OFFSET, Math.min(MAX_WEEK_OFFSET, Math.round(v)));
}

/** How a day column is titled: "Mon 22 Sep", and whether it is today. */
export function dayLabel(iso, today = todayLocal()) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return { weekday: '', date: '', isToday: false, isWeekend: false };
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  return {
    weekday: date.toLocaleDateString('en', { weekday: 'short' }),
    date: date.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    isToday: iso === today,
    isWeekend: dow === 0 || dow === 6,
  };
}

/**
 * The week, as columns.
 *
 * @param {object} opts
 * @param {Array}  opts.tasks        every task from every workspace
 * @param {string} opts.userId       whose week this is
 * @param {Array}  opts.workspaces   `[{ id, name, color }]` — the point of the
 *                                   screen is that they are mixed, so each card
 *                                   has to say which one it came from
 * @param {string} opts.today
 * @param {number} opts.weekStart
 * @param {number} opts.offset
 *
 * @returns {{
 *   days: Array<{ date, label, tasks, hours, isToday, isWeekend }>,
 *   unscheduled: Array,      // mine, not done, no due date — the rail
 *   overdue: Array,          // mine, not done, due before this week started
 *   week: object,
 *   counts: { total, done, unscheduled, overdue },
 * }}
 */
export function buildMyWeek({
  tasks = [], userId, workspaces = [], today = todayLocal(), weekStart = 1, offset = 0,
} = {}) {
  const week = weekOf({ today, weekStart, offset });
  const wsById = {};
  for (const w of workspaces) wsById[w.id] = w;

  const decorate = (t) => ({
    ...t,
    workspaceName: wsById[t.workspaceId]?.name || 'Another workspace',
    workspaceColor: wsById[t.workspaceId]?.color || null,
  });

  const mine = tasks
    .filter((t) => t && !t.deleted && !t.archived && isMine(t, userId))
    .map(decorate);

  const byDay = new Map(week.days.map((d) => [d, []]));
  const unscheduled = [];
  const overdue = [];

  for (const task of mine) {
    const due = task.plan?.endDate || null;
    if (!due) {
      // Not "nothing to do" — work waiting for a day. It belongs on screen, in
      // a rail you can drag from, not hidden because it lacks a field.
      if (task.status !== 'done') unscheduled.push(task);
      continue;
    }
    if (byDay.has(due)) { byDay.get(due).push(task); continue; }
    // Before this week, and still not finished: it did not stop existing when
    // the week rolled over.
    if (week.start && due < week.start && task.status !== 'done') overdue.push(task);
  }

  const days = week.days.map((date) => {
    const list = byDay.get(date).sort(compareTasks);
    const label = dayLabel(date, today);
    return {
      date,
      label,
      tasks: list,
      isToday: label.isToday,
      isWeekend: label.isWeekend,
      done: list.filter((t) => t.status === 'done').length,
    };
  });

  unscheduled.sort(compareTasks);
  overdue.sort((a, b) => (a.plan.endDate).localeCompare(b.plan.endDate) || compareTasks(a, b));

  const onDays = days.reduce((n, d) => n + d.tasks.length, 0);
  return {
    week,
    days,
    unscheduled,
    overdue,
    counts: {
      total: onDays + unscheduled.length + overdue.length,
      onDays,
      done: days.reduce((n, d) => n + d.done, 0),
      unscheduled: unscheduled.length,
      overdue: overdue.length,
    },
  };
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/** Unfinished before finished, then priority, then title. */
function compareTasks(a, b) {
  const ad = a.status === 'done' ? 1 : 0;
  const bd = b.status === 'done' ? 1 : 0;
  if (ad !== bd) return ad - bd;
  const ap = PRIORITY_RANK[a.priority] ?? 1;
  const bp = PRIORITY_RANK[b.priority] ?? 1;
  if (ap !== bp) return ap - bp;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

/** The heading over the week: "This week", "Next week", or the dates. */
export function weekTitle(week, today = todayLocal()) {
  if (!week?.start) return '';
  if (week.offset === 0) return 'This week';
  if (week.offset === 1) return 'Next week';
  if (week.offset === -1) return 'Last week';
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  };
  const sameYear = week.start.slice(0, 4) === today.slice(0, 4);
  return `${fmt(week.start)} – ${fmt(week.end)}${sameYear ? '' : ` ${week.end.slice(0, 4)}`}`;
}
