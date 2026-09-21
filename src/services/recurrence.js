// src/services/recurrence.js — recurring-task date maths and the payload for
// the next instance. Pure: no Firestore, no SDK, no clock beyond todayLocal().
// Lives on its own so it can be unit-tested with `node --test` (see
// recurrence.test.mjs) without booting the Firebase client.

const DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD for today in the user's own timezone (Asia/Manila in practice). */
export function todayLocal() {
  const d = new Date();
  return isoOf(d);
}

export function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(s, n) {
  const d = parseISO(s); if (!d) return null;
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

// Add `n` months to an ISO date, clamped to the last day of the target
// month instead of overflowing into the following month (the classic
// setMonth() bug: Jan 31 + 1 month must land on Feb 28, not Mar 3).
export function addMonthsClampedISO(s, n, targetDay) {
  const d = parseISO(s); if (!d) return null;
  const targetMonth = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const daysInTargetMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  targetMonth.setDate(Math.min(targetDay, daysInTargetMonth));
  return isoOf(targetMonth);
}

// Given a recurring task, compute the next (start, end) plan dates.
// The result always lands on the exact weekday/day-of-month the user
// defined in the recurrence rule (dayOfWeek / dayOfMonth) — it does not
// just drift forward by interval from whatever the previous instance's
// dates happened to be. Returns { start, end } or null if no further
// occurrences (past `until`).
export function nextRecurrenceDates(task) {
  const r = task?.recurrence;
  if (!r) return null;
  const interval = r.interval || 1;
  const oldStart = task.plan?.startDate;
  const oldEnd   = task.plan?.endDate;

  if (!oldStart && !oldEnd) {
    // No anchoring dates → schedule starting today
    const t = todayLocal();
    return { start: t, end: t };
  }

  // Anchor off the due (end) date when available — that's the date the
  // task is actually "placed on" in Calendar/Gantt.
  const anchor = oldEnd || oldStart;
  let nextAnchor;

  if (r.rule === 'daily') {
    nextAnchor = addDaysISO(anchor, interval);
  } else if (r.rule === 'weekly') {
    const targetDow = r.dayOfWeek ?? parseISO(anchor).getDay();
    const base = addDaysISO(anchor, 7 * interval);
    const drift = (targetDow - parseISO(base).getDay() + 7) % 7;
    nextAnchor = drift === 0 ? base : addDaysISO(base, drift);
  } else {
    const targetDom = r.dayOfMonth ?? parseISO(anchor).getDate();
    nextAnchor = addMonthsClampedISO(anchor, interval, targetDom);
  }
  if (!nextAnchor) return null;

  // Respect `until`
  if (r.until && nextAnchor > r.until) return null;

  // Preserve the original start→end duration, re-anchored on the new due date.
  if (oldStart && oldEnd) {
    const durationDays = Math.round((parseISO(oldEnd) - parseISO(oldStart)) / DAY);
    return { start: addDaysISO(nextAnchor, -durationDays), end: nextAnchor };
  }
  return { start: nextAnchor, end: nextAnchor };
}

/**
 * The task payload for the next occurrence, shaped for addTask().
 *
 * This deliberately carries EVERY field that makes the copy a real member of
 * the workspace — workspaceId above all. A recurrence instance written without
 * it is refused by the security rules, and even when it slips through it never
 * appears on the Board, because the Board subscribes by workspaceId.
 *
 * Returns null when the series has ended.
 */
export function buildNextRecurrenceTask(task) {
  const next = nextRecurrenceDates(task);
  if (!next) return null;

  return {
    // Scope — the whole point of this function.
    workspaceId: task.workspaceId,
    projectId:   task.projectId || null,
    phaseId:     task.phaseId   || null,

    title:       task.title,
    description: task.description || '',
    category:    task.category || 'Personal',
    priority:    task.priority || 'medium',
    requestedBy: task.requestedBy || '',

    plan: { startDate: next.start, endDate: next.end },

    // Carried over: who it's for, what it links to, project custom fields.
    assignedTo:         task.assignedTo         || [],
    assignedToExternal: task.assignedToExternal || [],
    links:              task.links              || [],
    customValues:       task.customValues       || {},
    tags:               task.tags               || [],

    // Reset for a fresh run: the checklist starts unticked, and blockers from
    // the previous occurrence do not carry into the next one.
    subtasks:  (task.subtasks || []).map((s) => ({ ...s, done: false })),
    dependsOn: [],

    recurrence: task.recurrence,
    recurrenceParentId: task.recurrenceParentId || task.id,
  };
}

/**
 * Has this save just finished a recurring task?
 *
 * There is more than one way to finish a task — dragging the card into Done,
 * the status dropdown in the activities modal, and Save in the task editor —
 * and all three must mean the same thing. They did not: only the first two
 * went through setTaskStatus, so whether a weekly task came round depended on
 * which button you happened to press (BUG-013). The rule lives here, once.
 *
 * `after` is the task as it is AFTER the save, so an occurrence created from
 * the editor uses the dates and the rule the user just typed — not the ones
 * they opened the modal with.
 */
export function shouldSpawnRecurrence(before, after) {
  if (!after?.recurrence) return false;
  if (after.status !== 'done') return false;
  // Already done before this save: saving an edit to a finished task must not
  // produce another occurrence every time.
  if (before?.status === 'done') return false;
  if (after.deleted || after.archived) return false;
  return true;
}

/**
 * Is this occurrence already on the board?
 *
 * A series is identified by `recurrenceParentId` and an occurrence within it by
 * its plan dates — the same pair the scheduled catch-up pass keys on
 * (services/recurrenceSchedule.js). That shared key is what makes the two paths
 * safe to run at the same time: whichever gets there first, the other finds it
 * and does nothing.
 */
export function alreadySpawned(payload, siblings = []) {
  if (!payload) return false;
  return siblings.some((t) => (
    !t.deleted
    && (t.recurrenceParentId || t.id) === payload.recurrenceParentId
    && t.plan?.startDate === payload.plan.startDate
    && t.plan?.endDate === payload.plan.endDate
  ));
}
