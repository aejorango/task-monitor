// src/services/taskStatus.js — what a task's status implies about its progress
// and its actual dates.
//
// Pure: no Firestore, no clock of its own (today is passed in). It exists
// because three places were deriving the same thing — setTaskStatus when a card
// is dragged, the task editor when Status is changed on the form, and (as of
// BUG-015) addTask when a spreadsheet import says a row is already Done. A
// fourth copy is how an imported task came to land in To Do while the preview
// promised otherwise.

/** The only statuses a task may have. Anything else is not a status. */
export const TASK_STATUSES = ['todo', 'doing', 'done'];

/** `value` if it is a real status, otherwise `fallback`. */
export function normalizeTaskStatus(value, fallback = 'todo') {
  return TASK_STATUSES.includes(value) ? value : fallback;
}

/**
 * The progress and actual dates a task should carry at `status`.
 *
 * Returns a plain `{ progress, actualStartDate, actualEndDate }` — nested, not
 * dotted, because the caller decides how to write it. `today` is required: this
 * module never reads the clock, so a test can pin the day and a Manila morning
 * is never stamped with yesterday.
 *
 * `current` lets an existing stamp survive: a task that started on Monday and
 * is finished on Friday keeps Monday as its actual start.
 */
export function statusStamps(status, { today, current = {} } = {}) {
  const startDate = current.startDate || null;
  const endDate = current.endDate || null;

  if (status === 'doing') {
    return {
      progress: current.progress ?? 0,
      actualStartDate: startDate || today || null,
      actualEndDate: endDate,
    };
  }
  if (status === 'done') {
    return {
      progress: 100,
      // Something finished has to have started. Without this a task imported
      // as Done has an end date and no start, and every duration is wrong.
      actualStartDate: startDate || today || null,
      actualEndDate: endDate || today || null,
    };
  }
  // todo — nothing has happened yet, so nothing is stamped.
  return { progress: 0, actualStartDate: null, actualEndDate: null };
}

/**
 * A progress percentage, or null when the caller did not state one.
 *
 * Clamped rather than rejected: a spreadsheet that says 150% means "finished",
 * and refusing the whole row over it would lose the task. A non-number — an
 * empty cell, "n/a", undefined — is not a statement about progress at all, so
 * it returns null and the caller falls back to what the status implies.
 */
export function clampProgress(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}
