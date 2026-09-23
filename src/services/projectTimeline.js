// src/services/projectTimeline.js — where a project sits on the Projects
// Explorer's Timeline, and what the ruler above it says (T-0153).
//
// Pure: no Firebase, no clock of its own. The component renders what this
// returns, so the arithmetic — which is the part that can be wrong without
// looking wrong — can be checked with `node --test`.
//
// Note this is a PROJECT timeline, one row per project, and the Board's Gantt
// is a TASK timeline. They answer different questions and neither is the other
// one zoomed out: a project's span here is derived from its tasks' dates, so a
// project whose tasks nobody has dated has no bar, and says so.

const DAY = 86_400_000;

export const UNITS = [
  { id: 'month',   label: 'Month',   days: 7,  columns: 8 },   // eight weeks
  { id: 'quarter', label: 'Quarter', days: 30, columns: 8 },   // eight months
];

export function parseISO(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

export function toISO(d) {
  return d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a, b) => Math.round((b - a) / DAY);

/**
 * A project's own span: the earliest and latest date anything in it carries.
 *
 * Plan dates first, actual dates as a fallback, so a project that was worked
 * on without ever being planned still appears. Returns null when nothing in
 * it has a date at all — which the row then states rather than drawing a bar
 * from nowhere to nowhere.
 */
export function spanOfProject(tasks = []) {
  let first = null;
  let last = null;
  for (const t of tasks) {
    for (const iso of [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]) {
      const d = parseISO(iso);
      if (!d) continue;
      if (!first || d < first) first = d;
      if (!last || d > last) last = d;
    }
  }
  return first && last ? { start: toISO(first), end: toISO(last) } : null;
}

/**
 * The window every bar is measured against: the extent of all the spans, with
 * today always inside it.
 *
 * A window that does not contain today would draw the Today line off the edge
 * — and a timeline whose "now" is not on it is a picture of somebody else's
 * project.
 */
export function timelineRange(spans = [], today) {
  const dates = [];
  for (const s of spans) {
    const a = parseISO(s?.start);
    const b = parseISO(s?.end);
    if (a) dates.push(a);
    if (b) dates.push(b);
  }
  const now = parseISO(today);
  if (now) dates.push(now);
  if (dates.length === 0) return null;

  let min = dates[0];
  let max = dates[0];
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  // A single-day extent would divide by zero; give it a fortnight to sit in.
  if (diffDays(min, max) < 14) max = addDays(min, 14);
  // A little air either side so a bar never runs into the edge.
  min = addDays(min, -3);
  max = addDays(max, 3);
  return { start: toISO(min), end: toISO(max), total: diffDays(min, max) + 1 };
}

/** Where `iso` falls in the window, 0–100. Null when it is not a date. */
export function pctOf(iso, range) {
  const d = parseISO(iso);
  const min = parseISO(range?.start);
  if (!d || !min || !range?.total) return null;
  return (diffDays(min, d) / (range.total - 1)) * 100;
}

/**
 * One bar: where it starts and how wide, clamped into the window.
 *
 * Clamping matters — without it a project that began before the window opens
 * gets a negative `left` and paints over the label column, which is the bug
 * the Gantt had in T-0145.
 */
export function barOf(span, range) {
  const left = pctOf(span?.start, range);
  const right = pctOf(span?.end, range);
  if (left == null || right == null) return null;
  const from = Math.max(0, Math.min(100, left));
  const to = Math.max(0, Math.min(100, right));
  return { left: from, width: Math.max(1.2, to - from) };
}

/**
 * The ruler's columns. `month` counts weeks, `quarter` counts months, and both
 * are labelled from the window's own dates rather than from a fixed list — a
 * hard-coded "Jun W27 W28" is a ruler that lies in July.
 */
export function rulerColumns(range, unitId = 'month') {
  const unit = UNITS.find((u) => u.id === unitId) || UNITS[0];
  const min = parseISO(range?.start);
  if (!min || !range?.total) return [];
  const step = range.total / unit.columns;
  return Array.from({ length: unit.columns }, (_, i) => {
    const at = addDays(min, Math.round(i * step));
    return {
      key: `${unitId}-${i}`,
      label: unitId === 'quarter'
        ? at.toLocaleDateString('en', { month: 'short' })
        : at.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    };
  });
}

/**
 * Phase ends, as the diamonds on a row.
 *
 * The mockup draws a "milestone"; this app has no such field, so rather than
 * invent one the diamond marks the last dated thing in each phase — which IS
 * the moment that phase is finished, and is a real date off real tasks.
 */
export function phaseMarksOf(project, tasks = [], range) {
  const phases = [...(project?.phases || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return phases
    .map((ph) => {
      const own = tasks.filter((t) => t.phaseId === ph.id);
      const span = spanOfProject(own);
      if (!span) return null;
      const at = pctOf(span.end, range);
      if (at == null || at < 0 || at > 100) return null;
      return { id: ph.id, name: ph.name, at, date: span.end };
    })
    .filter(Boolean);
}
