// src/services/ganttGeometry.js — where a task's plan bar sits on the Gantt,
// and what a drag on it means.
//
// Pure: date strings in, numbers and date strings out. No React, no Firestore,
// no clock. That is what makes BUG-014 testable without rendering a timeline.
//
// The bug this module exists to fix: the Gantt admitted any task with ANY one
// of its four dates into the row list, but the bar needed BOTH plan.startDate
// and plan.endDate. The app's dominant create path — quick-add, and the
// natural-language parser behind it — only ever writes an end date, so the most
// common task in the app ("draft proposal next Friday") got a row with a title
// and a completely blank track, and could not even be fixed by dragging.
//
// The rule here: a plan with one date is a one-day MILESTONE on that date, not
// nothing. It draws, and dragging its left edge gives it a real start date.

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseISO(str) {
  if (!str) return null;
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoOf(date) {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function daysBetween(fromIso, toIso) {
  const a = parseISO(fromIso);
  const b = parseISO(toIso);
  if (!a || !b) return null;
  return Math.round((b - a) / DAY_MS);
}

export function shiftIso(iso, days) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/**
 * The plan span the chart should actually draw.
 *
 * A task with only one plan date is a milestone: one day, on the date it has.
 * `derived` says which end was filled in, so the UI can label it honestly
 * rather than claiming the user set a range they never set.
 *
 * Returns null when there is no plan at all — such a task has no plan bar, even
 * though it may still have an actual bar and therefore still earn a row.
 */
export function effectivePlan(task) {
  const start = task?.plan?.startDate || null;
  const end = task?.plan?.endDate || null;

  if (start && end) {
    // A backwards range would draw a negative-width bar. Treat the due date as
    // authoritative and show the single day rather than nothing.
    if (end < start) return { startDate: end, endDate: end, isMilestone: true, derived: 'both' };
    return { startDate: start, endDate: end, isMilestone: start === end, derived: null };
  }
  if (end) return { startDate: end, endDate: end, isMilestone: true, derived: 'start' };
  if (start) return { startDate: start, endDate: start, isMilestone: true, derived: 'end' };
  return null;
}

/**
 * Pixel geometry for the plan bar: `{ left, width }`, or null when there is no
 * plan to draw. `width` is never below one day column, so a milestone is a
 * visible marker rather than a zero-width sliver.
 */
export function planBar(task, { rangeMin, dayWidth, span } = {}) {
  const plan = span || effectivePlan(task);
  if (!plan || !rangeMin || !dayWidth) return null;
  const left = daysBetween(rangeMin, plan.startDate);
  const length = daysBetween(plan.startDate, plan.endDate);
  if (left == null || length == null) return null;
  return {
    left: left * dayWidth,
    width: (Math.max(0, length) + 1) * dayWidth,
    isMilestone: plan.isMilestone,
  };
}

/**
 * Where a drag starts, in whole days from the left edge of the chart.
 *
 * A milestone has a real origin now — both ends on its one date — which is what
 * lets a left-edge drag give it a start date it never had. Returns null only
 * when the task has no plan dates whatsoever.
 */
export function dragOrigin(task, rangeMin) {
  const plan = effectivePlan(task);
  if (!plan) return null;
  const startDay = daysBetween(rangeMin, plan.startDate);
  const endDay = daysBetween(rangeMin, plan.endDate);
  if (startDay == null || endDay == null) return null;
  return { startDay, endDay };
}

/** Where the bar sits mid-drag, after moving `deltaDays` day columns. */
export function dragTo(mode, origin, deltaDays) {
  const { startDay, endDay } = origin;
  if (mode === 'move') return { startDay: startDay + deltaDays, endDay: endDay + deltaDays };
  if (mode === 'resize-left') {
    // Never past its own due date: a bar cannot end before it begins.
    return { startDay: Math.min(endDay, startDay + deltaDays), endDay };
  }
  if (mode === 'resize-right') {
    return { startDay, endDay: Math.max(startDay, endDay + deltaDays) };
  }
  return { startDay, endDay };
}

/**
 * What to write when the pointer is released — or null when nothing moved.
 *
 * Dotted paths, so the task's `actual` dates are never wiped by a whole-object
 * write. A milestone dragged wider gains a real plan.startDate here: that is
 * the acceptance criterion for BUG-014.
 */
export function dragPatch(task, rangeMin, { startDay, endDay }) {
  const startDate = shiftIso(rangeMin, startDay);
  const endDate = shiftIso(rangeMin, endDay);
  if (!startDate || !endDate) return null;
  if (startDate === (task?.plan?.startDate || null) && endDate === (task?.plan?.endDate || null)) {
    return null;
  }
  return { 'plan.startDate': startDate, 'plan.endDate': endDate };
}

/** What the bar's tooltip says — honest about a date the user never set. */
export function planLabel(span) {
  if (!span) return '';
  if (span.derived === 'start') return `Due ${span.endDate} · no start date yet — drag the left edge to set one`;
  if (span.derived === 'end') return `Starts ${span.startDate} · no due date yet — drag the right edge to set one`;
  if (span.isMilestone) return `Plan: ${span.startDate} (one day)`;
  return `Plan: ${span.startDate} → ${span.endDate}`;
}
