// src/services/dueChip.js — the due date as it appears on a board card
// (T-0123 / POL-013).
//
// The card used to carry a bare "Overdue" badge and nothing else about dates:
// a comment in Board.jsx removed them on purpose, back when the card held far
// less than it does now. "Overdue" tells you a task is late but not by how
// much, and it says nothing at all about the task due tomorrow — so a board of
// things due today, Friday and next month all looked the same.
//
// The rule lives here rather than in the component so the wording can be read
// and tested without a board around it.

import { parseISODate, daysBetween } from './dueAlerts';

// Inside this many days the weekday alone is unambiguous and shorter than a
// date ("Due Fri"). Beyond it a weekday would be a guess about which week.
export const NEAR_DAYS = 6;

const fmt = (ymd, opts) => {
  const d = parseISODate(ymd);
  return d ? d.toLocaleDateString('en', opts) : String(ymd);
};

const weekday  = (ymd) => fmt(ymd, { weekday: 'short' });
const longDay  = (ymd) => fmt(ymd, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// "Oct 12", or "Oct 12, 2027" when that is not this year — a bare "Oct 12" on a
// task due in fifteen months would read as two weeks away.
//
// Month-first, matching `fmtDay` in ActivityTimeline.jsx, which is what the
// task editor, the project editor and the Gantt already print. The audit wrote
// the example as "12 Oct"; two date orders for one task across two surfaces
// would be worse than either order on its own.
const shortDate = (ymd, today) => {
  const sameYear = String(ymd).slice(0, 4) === String(today).slice(0, 4);
  return fmt(ymd, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
};

const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * The due chip for one card, or null when there is nothing worth showing.
 *
 * @param {object} task   a task document
 * @param {string} today  YYYY-MM-DD in the user's own day (todayLocal())
 * @returns {{ text: string, tone: string, title: string, late: boolean }|null}
 *   `tone` is one of danger / warn / info / muted — the component maps it to a
 *   badge class. `late` is what the card's own overdue styling keys on.
 */
export function dueChip(task, today) {
  if (!task || !today) return null;
  // Done: the plan date has stopped being the interesting number — whether the
  // task landed early or late is, and the card already says that in its own
  // badge. A "Due 12 Oct" chip on a finished task is just noise.
  if (task.status === 'done') return null;

  const due = task.plan?.endDate;
  if (!due || !parseISODate(due)) return null;

  const delta = daysBetween(today, due);   // negative → the date has passed

  if (delta < 0) {
    const late = -delta;
    return {
      text:  `${late}d late`,
      tone:  'danger',
      title: `Was due ${longDay(due)} — ${days(late)} ago`,
      late:  true,
    };
  }
  if (delta === 0) {
    return { text: 'Due today', tone: 'warn', title: `Due today, ${longDay(due)}`, late: false };
  }
  if (delta === 1) {
    return { text: 'Due tomorrow', tone: 'warn', title: `Due tomorrow, ${longDay(due)}`, late: false };
  }
  if (delta <= NEAR_DAYS) {
    return {
      text:  `Due ${weekday(due)}`,
      tone:  'info',
      title: `Due ${longDay(due)} — in ${days(delta)}`,
      late:  false,
    };
  }
  return {
    text:  `Due ${shortDate(due, today)}`,
    tone:  'muted',
    title: `Due ${longDay(due)} — in ${days(delta)}`,
    late:  false,
  };
}
