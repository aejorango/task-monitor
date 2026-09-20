// src/services/recurrenceSchedule.js — a recurring task appears on schedule,
// not only when the last one was ticked off.
//
// The old rule was: marking an instance done creates the next one. So a weekly
// ritual that nobody completed simply stopped — the series died at the first
// missed week, which is the opposite of what a recurring task is for.
//
// This works out which occurrences SHOULD exist by now and which of them are
// missing, so they can be created. It is deliberately bounded:
//
//   · nothing is created more than `horizonDays` ahead — by default an
//     occurrence appears on the day it is due, not a week early;
//   · nothing is created for an occurrence more than `staleDays` past — coming
//     back to a year-dormant series should not produce fifty-two overdue
//     copies of the same task;
//   · at most `maxPerRun` per series per run, so catching up is gradual and a
//     mistake is small.
//
// Pure: the date maths comes from recurrence.js, and the writing is done by
// services/firebase.js.

import { buildNextRecurrenceTask, nextRecurrenceDates, todayLocal } from './recurrence';

// Zero: an occurrence is created when it is due, not a week early. A schedule
// that ran ahead of itself would put next week's copy on the board beside this
// week's, which is clutter rather than foresight.
export const HORIZON_DAYS = 0;
export const STALE_DAYS = 30;
export const MAX_PER_RUN = 8;

/** How many occurrences the catch-up will step over to reach the present. */
export const WALK_LIMIT = 5000;

const DAY = 86400000;
const shift = (iso, days) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(new Date(y, m - 1, d).getTime() + days * DAY)
    .toLocaleDateString('en-CA');   // YYYY-MM-DD, in local time
};

/** The id that ties a series together: the first instance's. */
export const seriesIdOf = (task) => task?.recurrenceParentId || task?.id || null;

/** Is this task part of a live recurring series? */
export function isRecurring(task) {
  return Boolean(task?.recurrence?.rule) && !task?.deleted && !task?.archived;
}

/**
 * Group tasks into series, and pick the instance each series should grow from:
 * the one scheduled furthest ahead, because that is where the series has got to.
 *
 * @returns {Map<string, { anchor, dates: Set<string>, tasks }>}
 */
export function seriesOf(tasks = []) {
  const series = new Map();
  for (const task of tasks) {
    if (!isRecurring(task)) continue;
    const id = seriesIdOf(task);
    if (!id) continue;
    if (!series.has(id)) series.set(id, { anchor: null, dates: new Set(), tasks: [] });
    const entry = series.get(id);
    entry.tasks.push(task);
    if (task.plan?.endDate) entry.dates.add(task.plan.endDate);
    const best = entry.anchor?.plan?.endDate || '';
    if (!entry.anchor || (task.plan?.endDate || '') > best) entry.anchor = task;
  }
  return series;
}

/**
 * Every occurrence that should exist for one series between now and the
 * horizon, walking forward from where the series actually got to.
 *
 * @returns {{ start, end }[]} in date order, possibly empty
 */
export function plannedOccurrences(anchor, {
  today = todayLocal(), horizonDays = HORIZON_DAYS, staleDays = STALE_DAYS,
  maxPerRun = MAX_PER_RUN,
} = {}) {
  if (!isRecurring(anchor)) return [];

  const horizon = shift(today, horizonDays);
  const floor = shift(today, -staleDays);

  const out = [];
  let cursor = anchor;

  // The walk has to cross every occurrence between where the series stopped and
  // today, which for a long-dormant daily schedule is thousands of steps of
  // plain date arithmetic. WALK_LIMIT bounds that; a series dormant longer than
  // it covers stays asleep rather than costing an unbounded loop.
  for (let i = 0; i < WALK_LIMIT && out.length < maxPerRun; i += 1) {
    const next = nextRecurrenceDates(cursor);
    if (!next?.end) break;                              // the series has ended
    if (next.end <= (cursor.plan?.endDate || '')) break; // not moving: give up
    if (next.end > horizon) break;                      // far enough ahead

    if (next.end >= floor) out.push(next);
    // Too old to be worth creating: skip it, but keep walking so the series
    // catches up to the present rather than stalling on ancient history.
    cursor = { ...cursor, plan: { startDate: next.start, endDate: next.end } };
  }

  return out;
}

/** The occurrences a series is missing: planned, minus the ones already there. */
export function missingOccurrences(anchor, existingDates = new Set(), opts = {}) {
  return plannedOccurrences(anchor, opts)
    .filter((occurrence) => !existingDates.has(occurrence.end));
}

/**
 * Everything that should be created right now, across every series in a
 * workspace, as payloads ready for `addTask`.
 *
 * @param {object[]} tasks   every live task in the workspace
 * @returns {{ seriesId, payload }[]}
 */
export function catchUpPlan(tasks = [], opts = {}) {
  const plan = [];

  for (const [seriesId, entry] of seriesOf(tasks)) {
    const { anchor, dates } = entry;
    let cursor = anchor;

    for (const occurrence of missingOccurrences(anchor, dates, opts)) {
      const payload = buildNextRecurrenceTask({
        ...cursor,
        // buildNextRecurrenceTask computes the NEXT dates from what it is
        // given, so hand it the instance before this occurrence.
        plan: cursor.plan,
      });
      if (!payload) break;
      // Trust the occurrence we already worked out, so one walk decides the
      // dates and the payload cannot disagree with the plan.
      payload.plan = { startDate: occurrence.start, endDate: occurrence.end };
      payload.recurrenceParentId = seriesId;
      // Whose task this is: the series' own owner, not whoever happens to have
      // the app open when the catch-up runs.
      plan.push({ seriesId, userId: anchor.userId || null, payload });
      cursor = { ...cursor, plan: payload.plan };
    }
  }

  return plan;
}

/** What just happened, for the log line and the toast. */
export function describeCatchUp(created = []) {
  if (!created.length) return 'Nothing was due.';
  const series = new Set(created.map((c) => c.seriesId)).size;
  return `Added ${created.length} recurring task${created.length === 1 ? '' : 's'} `
    + `across ${series} schedule${series === 1 ? '' : 's'}.`;
}
