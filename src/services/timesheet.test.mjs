// T-0058 / NEW-003 — the weekly grid a manager files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimesheet, buildTimesheetDocument, dayHeading, shiftWeek, timesheetFileBase,
  weekDays, weekLabel,
} from './timesheet.js';
import { toMarkdown } from './exporters.js';

const PROFILES = { u1: { displayName: 'Ace' }, u2: { email: 'sam@example.com' } };
const PROJECTS = { p1: { id: 'p1', name: 'SBLAF rollout' }, p2: { id: 'p2', name: 'Website revamp' } };

const a = (over) => ({ date: '2026-09-16', userId: 'u1', hoursSpent: 1, projectId: 'p1', deleted: false, ...over });

test('a week runs Monday to Sunday by default', () => {
  const days = weekDays('2026-09-18', 1);   // a Friday
  assert.equal(days.length, 7);
  assert.equal(days[0], '2026-09-14', 'Monday');
  assert.equal(days[6], '2026-09-20', 'Sunday');
  assert.ok(days.includes('2026-09-18'));
});

test('the week start preference is honoured', () => {
  assert.equal(weekDays('2026-09-18', 0)[0], '2026-09-13', 'Sunday start');
});

test('a day that IS the week start does not jump back a week', () => {
  assert.equal(weekDays('2026-09-14', 1)[0], '2026-09-14');
});

test('a bad date yields no week rather than an exception', () => {
  assert.deepEqual(weekDays('not-a-date'), []);
});

test('the week reads as a range a person recognises', () => {
  assert.equal(weekLabel(weekDays('2026-09-18', 1)), '14–20 Sep 2026');
  assert.equal(weekLabel(weekDays('2026-09-30', 1)), '28 Sep – 4 Oct 2026', 'across a month');
  assert.equal(weekLabel([]), '');
});

test('day headings name the day', () => {
  assert.equal(dayHeading('2026-09-14'), 'Mon 14');
  assert.equal(dayHeading('2026-09-20'), 'Sun 20');
});

test('stepping a week forward and back returns to where it started', () => {
  const start = '2026-09-18';
  assert.equal(shiftWeek(shiftWeek(start, 1), -1), weekDays(start)[0]);
  assert.equal(shiftWeek(start, -1), '2026-09-07');
});

// ─── the grid ───────────────────────────────────────────────────────────────

const DAYS = weekDays('2026-09-18', 1);
const ACTIVITIES = [
  a({ userId: 'u1', date: '2026-09-14', hoursSpent: 3 }),
  a({ userId: 'u1', date: '2026-09-14', hoursSpent: 1.5 }),
  a({ userId: 'u1', date: '2026-09-16', hoursSpent: 2 }),
  a({ userId: 'u2', date: '2026-09-16', hoursSpent: 8, projectId: 'p2' }),
  a({ userId: 'u2', date: '2026-09-21', hoursSpent: 5 }),          // next week
  a({ userId: 'u1', date: '2026-09-15', hoursSpent: 4, deleted: true }),
];

test('hours land on the right person and the right day', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES });
  const ace = sheet.rows.find((r) => r.name === 'Ace');
  assert.equal(ace.byDay['2026-09-14'], 4.5, 'two entries on one day add up');
  assert.equal(ace.byDay['2026-09-16'], 2);
  assert.equal(ace.total, 6.5);
});

test('another week and deleted entries are left out', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES });
  assert.equal(sheet.grandTotal, 14.5, '6.5 + 8; not the 5 next week or the deleted 4');
  const sam = sheet.rows.find((r) => r.name === 'sam@example.com');
  assert.equal(sam.total, 8);
});

test('people are named, never shown as a uid', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES });
  for (const r of sheet.rows) assert.doesNotMatch(r.name, /^u\d$/);
  const unknown = buildTimesheet([a({ userId: 'ghost' })], { days: DAYS });
  assert.equal(unknown.rows[0].name, 'Invited member');
});

test('busiest person first', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES });
  assert.deepEqual(sheet.rows.map((r) => r.name), ['sam@example.com', 'Ace']);
});

test('day totals and the grand total agree with the rows', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES });
  assert.equal(sheet.dayTotals['2026-09-14'], 4.5);
  assert.equal(sheet.dayTotals['2026-09-16'], 10);
  const fromRows = sheet.rows.reduce((s, r) => s + r.total, 0);
  assert.equal(sheet.grandTotal, fromRows);
  const fromDays = Object.values(sheet.dayTotals).reduce((s, h) => s + h, 0);
  assert.equal(Math.round(fromDays * 100) / 100, sheet.grandTotal);
});

test('filtering to a project changes the grid and the totals together', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES, projectFilter: 'p2' });
  assert.equal(sheet.grandTotal, 8);
  assert.equal(sheet.rows.length, 1);
});

test('fractions do not drift — rounding happens once, at the end', () => {
  const thirds = Array.from({ length: 3 }, () => a({ hoursSpent: 0.1 }));
  const sheet = buildTimesheet(thirds, { days: DAYS });
  assert.equal(sheet.grandTotal, 0.3, 'not 0.30000000000000004');
});

test('hours with no project are still counted, under a readable name', () => {
  const sheet = buildTimesheet([a({ projectId: null, hoursSpent: 2 })], { days: DAYS, projectById: PROJECTS });
  assert.equal(sheet.projectTotals[0].name, 'No project');
  assert.equal(sheet.projectTotals[0].hours, 2);
});

test('an empty week is a valid grid, not a crash', () => {
  const sheet = buildTimesheet([], { days: DAYS });
  assert.deepEqual(sheet.rows, []);
  assert.equal(sheet.grandTotal, 0);
  assert.equal(Object.keys(sheet.dayTotals).length, 7);
});

// ─── the document ───────────────────────────────────────────────────────────

test('the export is the grid, with a totals row', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES, projectById: PROJECTS });
  const doc = buildTimesheetDocument(sheet, { projectName: 'All projects' });
  const md = toMarkdown(doc);
  assert.match(md, /# Timesheet — 14–20 Sep 2026/);
  assert.match(md, /\| Person \| Mon 14 \|/);
  assert.match(md, /\| Ace \|/);
  assert.match(md, /\| All \|/, 'the totals row');
  assert.match(md, /## Hours by project/);
  assert.match(md, /\| SBLAF rollout \| 6\.5 \|/);
});

test('the spreadsheet has both the grid and the project split', () => {
  const sheet = buildTimesheet(ACTIVITIES, { days: DAYS, memberProfiles: PROFILES, projectById: PROJECTS });
  const doc = buildTimesheetDocument(sheet, {});
  assert.deepEqual(doc.sheets.map((s) => s.name), ['Timesheet', 'By project']);
  assert.equal(doc.sheets[0].columns.length, 9, 'person + 7 days + total');
  assert.equal(doc.sheets[0].rows.length, sheet.rows.length + 1, 'rows plus the totals row');
});

test('an empty week exports a file that says so', () => {
  const doc = buildTimesheetDocument(buildTimesheet([], { days: DAYS }), {});
  assert.match(toMarkdown(doc), /No hours were logged in this week/);
});

test('the filename names the week', () => {
  assert.equal(timesheetFileBase(DAYS), 'timesheet-2026-09-14');
  assert.equal(timesheetFileBase([]), 'timesheet-week');
});
