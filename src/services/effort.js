// src/services/effort.js — estimated hours against logged hours (T-0137 / NEW-015).
//
// The app tracks actual effort meticulously — `hoursSpent` per activity,
// `totalHoursLogged` denormalised onto the task, a timesheet, a workload
// planner — and had nothing to compare any of it against. It does plan-versus-
// actual on DATES everywhere and nothing on EFFORT, so it could say a task
// finished late but never that it cost three times what it was meant to.
//
// Pure: no Firestore, no clock. The editor writes the number, this says what it
// means, and the table, the timesheet and the status report render that.

/**
 * Hours a task is expected to take, or null when nobody has said.
 *
 * Null is not zero. "No estimate" and "estimated at zero hours" are different
 * facts, and a variance against an estimate nobody gave is not a number worth
 * showing.
 */
export function estimateOf(task) {
  const raw = task?.estimateHours;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Hours actually logged. Always a number: no logs is genuinely zero hours. */
export function loggedOf(task) {
  const n = Number(task?.totalHoursLogged);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * What an estimate typed into a form should be stored as.
 *
 * An empty field means "no estimate" — `null`, not 0, so clearing it is
 * different from estimating nothing. Negative hours are not a thing; anything
 * unparseable is treated as not having been said.
 */
export function normalizeEstimate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  // Quarter-hours, like every other hours field in the app.
  return Math.round(n * 4) / 4;
}

/**
 * Logged against estimated.
 *
 * @returns {{
 *   estimate: number|null, logged: number,
 *   delta: number|null,      // logged − estimate; positive means it overran
 *   percent: number|null,    // delta as a % of the estimate; null when unknowable
 *   state: 'none'|'under'|'on'|'over',
 * }}
 *
 * `percent` is null when the estimate is 0: something logged against a
 * zero-hour estimate has overrun by an undefined proportion, and "+Infinity%"
 * or "+0%" would both be lies. `delta` is still a real number there.
 */
export function variance(task) {
  const estimate = estimateOf(task);
  const logged = loggedOf(task);

  if (estimate === null) {
    return { estimate: null, logged, delta: null, percent: null, state: 'none' };
  }

  const delta = round2(logged - estimate);
  const percent = estimate > 0 ? Math.round((delta / estimate) * 100) : null;

  let state = 'on';
  if (delta > 0) state = 'over';
  else if (delta < 0) state = 'under';

  return { estimate, logged, delta, percent, state };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** "8h", or an em dash when nobody estimated. */
export function formatHours(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${round2(v)}h`;
}

/**
 * The variance as a person reads it: "+4h (+50%)", "−2h (−25%)", "On estimate".
 *
 * The sign is always explicit — "4h" next to an estimate is ambiguous about
 * which way it went.
 */
export function formatVariance(v) {
  if (!v || v.state === 'none') return '—';
  if (v.delta === 0) return 'On estimate';
  const sign = v.delta > 0 ? '+' : '−';
  const hours = `${sign}${formatHours(Math.abs(v.delta))}`;
  return v.percent === null ? hours : `${hours} (${sign}${Math.abs(v.percent)}%)`;
}

/** A one-line summary for a whole list — a project, a week, a report. */
export function totalVariance(tasks = []) {
  let estimate = 0;
  let logged = 0;
  let estimated = 0;        // how many of them anybody estimated
  for (const task of tasks) {
    const e = estimateOf(task);
    logged += loggedOf(task);
    if (e !== null) { estimate += e; estimated += 1; }
  }
  const delta = round2(logged - estimate);
  return {
    estimate: round2(estimate),
    logged: round2(logged),
    delta,
    percent: estimate > 0 ? Math.round((delta / estimate) * 100) : null,
    state: estimated === 0 ? 'none' : (delta > 0 ? 'over' : delta < 0 ? 'under' : 'on'),
    estimated,
    unestimated: tasks.length - estimated,
  };
}
