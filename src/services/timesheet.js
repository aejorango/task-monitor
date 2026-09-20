// src/services/timesheet.js — who worked how many hours, on which day.
//
// The hours are already logged, one activity at a time. What nobody could get
// was the grid a manager actually files: people down the side, days across the
// top, totals on both. Pure, so the arithmetic is tested rather than trusted.

import { heading, keyValues, paragraph, sheetFromRows, table } from './exporters';
import { memberLabel } from './invites';

const DAY_MS = 86400000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The week containing `date`, as seven YYYY-MM-DD strings.
 * @param {string} date        YYYY-MM-DD
 * @param {number} weekStart   0 = Sunday, 1 = Monday (the Settings preference)
 */
export function weekDays(date, weekStart = 1) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return [];
  const offset = (d.getDay() - weekStart + 7) % 7;
  const first = new Date(d.getTime() - offset * DAY_MS);
  return Array.from({ length: 7 }, (_, i) => iso(new Date(first.getTime() + i * DAY_MS)));
}

/** "14–20 Sep 2026" — a week a person can recognise. */
export function weekLabel(days) {
  if (!days?.length) return '';
  const a = new Date(`${days[0]}T00:00:00`);
  const b = new Date(`${days[days.length - 1]}T00:00:00`);
  const month = (d) => d.toLocaleDateString('en', { month: 'short' });
  const same = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return same
    ? `${a.getDate()}–${b.getDate()} ${month(b)} ${b.getFullYear()}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`;
}

export const dayHeading = (day) => {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
};

/** Move a week's worth of days back or forward. */
export function shiftWeek(date, weeks, weekStart = 1) {
  const days = weekDays(date, weekStart);
  if (!days.length) return date;
  return iso(new Date(new Date(`${days[0]}T00:00:00`).getTime() + weeks * 7 * DAY_MS));
}

/** Who an activity's hours belong to: its logger. */
const personOf = (activity) => activity.userId || 'unknown';

const round = (n) => Math.round(n * 100) / 100;

/**
 * The grid.
 *
 * @param {object[]} activities
 * @param {{ days, memberProfiles?, projectFilter?, projectById? }} opts
 * @returns {{ days, rows, dayTotals, grandTotal, projectTotals }}
 *   rows: [{ userId, name, byDay: {day: hours}, total }]
 */
export function buildTimesheet(activities = [], opts = {}) {
  const days = opts.days || [];
  const dayset = new Set(days);
  const profiles = opts.memberProfiles || {};

  const inScope = activities.filter((a) =>
    !a.deleted
    && dayset.has(a.date)
    && (!opts.projectFilter || opts.projectFilter === 'all' || a.projectId === opts.projectFilter));

  const byPerson = new Map();
  const dayTotals = Object.fromEntries(days.map((d) => [d, 0]));
  const projectTotals = new Map();

  for (const a of inScope) {
    const hours = Number(a.hoursSpent) || 0;
    const uid = personOf(a);

    if (!byPerson.has(uid)) {
      byPerson.set(uid, {
        userId: uid,
        name: memberLabel(uid, profiles) || 'Unknown',
        byDay: Object.fromEntries(days.map((d) => [d, 0])),
        total: 0,
        entries: 0,
      });
    }
    const row = byPerson.get(uid);
    row.byDay[a.date] += hours;
    row.total += hours;
    row.entries += 1;
    dayTotals[a.date] += hours;

    const pid = a.projectId || '__none__';
    projectTotals.set(pid, (projectTotals.get(pid) || 0) + hours);
  }

  // Round once, at the end: summing rounded numbers drifts.
  const rows = [...byPerson.values()]
    .map((r) => ({
      ...r,
      total: round(r.total),
      byDay: Object.fromEntries(Object.entries(r.byDay).map(([d, h]) => [d, round(h)])),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return {
    days,
    rows,
    dayTotals: Object.fromEntries(Object.entries(dayTotals).map(([d, h]) => [d, round(h)])),
    grandTotal: round(rows.reduce((s, r) => s + r.total, 0)),
    projectTotals: [...projectTotals.entries()]
      .map(([id, hours]) => ({
        id,
        name: id === '__none__' ? 'No project' : (opts.projectById?.[id]?.name || 'Unknown project'),
        hours: round(hours),
      }))
      .sort((a, b) => b.hours - a.hours),
  };
}

/** The exportable document: the grid, plus the project split. */
export function buildTimesheetDocument(sheet, { projectName } = {}) {
  const columns = ['Person', ...sheet.days.map(dayHeading), 'Total'];
  const rows = sheet.rows.map((r) => [
    r.name, ...sheet.days.map((d) => r.byDay[d] || 0), r.total,
  ]);
  const totalsRow = ['All', ...sheet.days.map((d) => sheet.dayTotals[d] || 0), sheet.grandTotal];

  return {
    title: `Timesheet — ${weekLabel(sheet.days)}`,
    subtitle: [projectName || 'All projects', `${sheet.grandTotal}h logged`].join(' · '),
    blocks: [
      keyValues([
        ['Week', weekLabel(sheet.days)],
        ['People', sheet.rows.length],
        ['Total hours', `${sheet.grandTotal}h`],
      ]),
      heading('Hours by person and day', 1),
      sheet.rows.length
        ? table(columns, [...rows, totalsRow])
        : paragraph('No hours were logged in this week.'),
      heading('Hours by project', 1),
      sheet.projectTotals.length
        ? table(['Project', 'Hours'], sheet.projectTotals.map((p) => [p.name, p.hours]))
        : paragraph('No hours were logged in this week.'),
    ],
    sheets: [
      sheetFromRows('Timesheet', columns, [...rows, totalsRow]),
      sheetFromRows('By project', ['Project', 'Hours'], sheet.projectTotals.map((p) => [p.name, p.hours])),
    ],
  };
}

/** `timesheet-<week>` — downloadFile adds the date stamp. */
export const timesheetFileBase = (days) => `timesheet-${days?.[0] || 'week'}`;
