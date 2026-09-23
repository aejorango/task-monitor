// src/services/wipLimits.js — how much a column is allowed to hold, and how
// long a card is allowed to sit in it (T-0138 / NEW-017).
//
// A kanban board without a work-in-progress limit is a list with three
// headings. The numbers were already there — the column header renders a live
// count, and every task carries `actual.startDate` — so both the limit and the
// ageing signal were one step away.
//
// The rule this module encodes, and the reason it is a warning and not a block:
// a hard stop on a personal board is an annoyance, not a discipline. The drop
// always happens; the board says what just went over.

/** Where the limits live on a project: `{ todo: 5, doing: 3, done: null }`. */
export const WIP_STATUSES = ['todo', 'doing', 'review', 'done'];

/** Past this many days in a column, a card is old enough to point at. */
export const DEFAULT_AGEING_DAYS = 5;

/**
 * The limit for one column, or null when there is none.
 *
 * Zero is not a limit — a column you may put nothing in is a column you should
 * delete — so it reads as "no limit" rather than "always breached".
 */
export function limitFor(project, statusId) {
  const raw = project?.wipLimits?.[statusId];
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** What a number typed into the project editor should be stored as. */
export function normalizeLimit(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(999, Math.floor(n));
}

/** The whole map, cleaned: only real limits survive. */
export function normalizeLimits(raw = {}) {
  const out = {};
  for (const id of WIP_STATUSES) {
    const v = normalizeLimit(raw?.[id]);
    if (v !== null) out[id] = v;
  }
  return out;
}

/**
 * How a column header should read.
 *
 * @returns {{ text, over, at, limit, count, title }}
 *   `text` is "5 / 3" when limited and "5" when not — a bare count with nothing
 *   to compare it to is what this row is about.
 */
export function columnState(project, statusId, count = 0) {
  const limit = limitFor(project, statusId);
  if (limit === null) {
    return {
      text: String(count), limit: null, count,
      over: false, at: false,
      title: `${count} ${count === 1 ? 'task' : 'tasks'}`,
    };
  }
  const over = count > limit;
  const at = count === limit;
  return {
    text: `${count} / ${limit}`,
    limit, count, over, at,
    title: over
      ? `${count} tasks, ${count - limit} over the limit of ${limit}`
      : at
        ? `${count} tasks — at the limit of ${limit}`
        : `${count} of ${limit} allowed`,
  };
}

/**
 * What to say when a drop pushes a column past its limit — or null when it
 * does not. The drop has already been decided; this is only the sentence.
 *
 * `countBefore` is the column's size before the card lands, so the message is
 * about the state the user is about to be in.
 */
export function warnOnDrop(project, statusId, countBefore = 0, { columnLabel } = {}) {
  const limit = limitFor(project, statusId);
  if (limit === null) return null;
  const after = countBefore + 1;
  if (after <= limit) return null;
  const name = columnLabel || statusId;
  return `${name} now has ${after} tasks — ${after - limit} over your limit of ${limit}. `
    + 'Finishing one before starting another is usually faster.';
}

/* ── ageing ────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;

/** Whole days between two YYYY-MM-DD dates, or null when either is missing. */
function daysBetween(a, b) {
  if (!a || !b) return null;
  const [ay, am, ad] = String(a).split('-').map(Number);
  const [by, bm, bd] = String(b).split('-').map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return null;
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / DAY);
}

/**
 * How long a card has been sitting where it is, and whether that is too long.
 *
 * Only tasks actually in progress age: a task in To Do has not started, and a
 * task that is done has stopped. `actual.startDate` is when it entered Doing.
 *
 * @returns {{ days: number|null, stale: boolean, title: string|null }}
 */
export function ageing(task, { today, days = DEFAULT_AGEING_DAYS } = {}) {
  if (!task || task.status !== 'doing' || !today) {
    return { days: null, stale: false, title: null };
  }
  const since = task.actual?.startDate;
  const n = daysBetween(since, today);
  if (n === null || n < 0) return { days: null, stale: false, title: null };
  const stale = n >= days;
  return {
    days: n,
    stale,
    title: stale
      ? `In progress for ${n} day${n === 1 ? '' : 's'} — longer than ${days}`
      : `In progress for ${n} day${n === 1 ? '' : 's'}`,
  };
}

/** The ageing threshold a project uses. */
export function ageingDaysFor(project) {
  const raw = project?.wipAgeingDays;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_AGEING_DAYS;
  return Math.min(365, Math.floor(n));
}
