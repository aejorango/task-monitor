// src/services/dueAlerts.test.mjs — run with `npm test` (node --test).
// Pure logic only: no Firestore, no DOM, no CLI.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDueForAlert, buildAlertQueue, alertKey, overdueDays, isQuietNow,
  loadAlertState, saveAlertState, snoozeUntil, buildFallbackPrompt,
  addDaysISO, daysBetween, isMutedToday, setMutedOn, loadMutedOn,
} from './dueAlerts.js';

const TODAY = '2026-09-07';
const t = (id, endDate, extra = {}) => ({ id, title: id, status: 'todo', priority: 'medium', plan: { endDate }, ...extra });

class MemStore {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

test('date helpers cross month and year boundaries', () => {
  assert.equal(addDaysISO('2026-09-30', 1), '2026-10-01');
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-09-01', TODAY), 6);
  assert.equal(daysBetween(TODAY, '2026-09-01'), -6);
});

test('due-today task is eligible with leadDays 0', () => {
  assert.equal(isDueForAlert(t('a', TODAY), { today: TODAY, leadDays: 0 }), true);
});

test('overdue task is eligible', () => {
  assert.equal(isDueForAlert(t('a', '2026-09-01'), { today: TODAY }), true);
  assert.equal(overdueDays(t('a', '2026-09-01'), TODAY), 6);
});

test('future task is eligible only when leadDays covers it', () => {
  const due2 = t('a', addDaysISO(TODAY, 2));
  assert.equal(isDueForAlert(due2, { today: TODAY, leadDays: 0 }), false);
  assert.equal(isDueForAlert(due2, { today: TODAY, leadDays: 1 }), false);
  assert.equal(isDueForAlert(due2, { today: TODAY, leadDays: 2 }), true);
});

test('done, deleted, archived and undated tasks are excluded', () => {
  assert.equal(isDueForAlert(t('a', TODAY, { status: 'done' }), { today: TODAY }), false);
  assert.equal(isDueForAlert(t('a', TODAY, { deleted: true }), { today: TODAY }), false);
  assert.equal(isDueForAlert(t('a', TODAY, { archived: true }), { today: TODAY }), false);
  assert.equal(isDueForAlert(t('a', null), { today: TODAY }), false);
  assert.equal(isDueForAlert({ id: 'a', status: 'todo' }, { today: TODAY }), false);
});

test('snoozed task is excluded until its timestamp, then included', () => {
  const now = 1_000_000;
  const tasks = [t('a', TODAY)];
  assert.equal(buildAlertQueue(tasks, { today: TODAY, snoozes: { a: now + 1 }, now }).length, 0);
  assert.equal(buildAlertQueue(tasks, { today: TODAY, snoozes: { a: now - 1 }, now }).length, 1);
  assert.equal(buildAlertQueue(tasks, { today: TODAY, snoozes: { a: now }, now }).length, 1);
});

test('skipped task is excluded for that day only', () => {
  const task = t('a', TODAY);
  const skips = [alertKey(task, TODAY)];
  assert.equal(buildAlertQueue([task], { today: TODAY, skips }).length, 0);
  const tomorrow = addDaysISO(TODAY, 1);
  assert.equal(buildAlertQueue([task], { today: tomorrow, skips }).length, 1);
  // rescheduling the task changes the key, so it alerts again
  const moved = { ...task, plan: { endDate: '2026-09-06' } };
  assert.equal(buildAlertQueue([moved], { today: TODAY, skips }).length, 1);
});

test('alertKey format is taskId|dueDate|today', () => {
  assert.equal(alertKey(t('x1', '2026-09-05'), TODAY), 'x1|2026-09-05|2026-09-07');
});

test('ordering: most overdue first, then priority, then title', () => {
  const q = buildAlertQueue([
    t('b-today-low',  TODAY, { priority: 'low',  title: 'B' }),
    t('a-today-high', TODAY, { priority: 'high', title: 'A' }),
    t('c-yesterday',  '2026-09-06', { priority: 'low' }),
    t('z-today-med',  TODAY, { priority: 'medium', title: 'Z' }),
    t('m-today-med',  TODAY, { priority: 'medium', title: 'M' }),
  ], { today: TODAY });
  assert.deepEqual(q.map((x) => x.id), ['c-yesterday', 'a-today-high', 'm-today-med', 'z-today-med', 'b-today-low']);
});

test('quiet hours handle same-day and cross-midnight ranges', () => {
  const at = (h, m = 0) => new Date(2026, 8, 7, h, m);
  assert.equal(isQuietNow({ quietFrom: '09:00', quietTo: '10:00' }, at(9, 30)), true);
  assert.equal(isQuietNow({ quietFrom: '09:00', quietTo: '10:00' }, at(10, 0)), false);
  assert.equal(isQuietNow({ quietFrom: '22:00', quietTo: '07:00' }, at(23)), true);
  assert.equal(isQuietNow({ quietFrom: '22:00', quietTo: '07:00' }, at(3)), true);
  assert.equal(isQuietNow({ quietFrom: '22:00', quietTo: '07:00' }, at(12)), false);
  assert.equal(isQuietNow({ quietFrom: '', quietTo: '' }, at(12)), false);
  assert.equal(isQuietNow({ quietFrom: '08:00', quietTo: '08:00' }, at(8)), false);
});

test('loadAlertState prunes expired snoozes and other-day skips', () => {
  const store = new MemStore();
  const now = 5_000_000;
  saveAlertState('u1', {
    snoozes: { live: now + 60_000, dead: now - 1 },
    skips: ['a|2026-09-07|2026-09-07', 'b|2026-09-06|2026-09-06'],
  }, { store });
  const state = loadAlertState('u1', { today: TODAY, now, store });
  assert.deepEqual(state, { snoozes: { live: now + 60_000 }, skips: ['a|2026-09-07|2026-09-07'] });
  // other users' state is isolated
  assert.deepEqual(loadAlertState('u2', { today: TODAY, now, store }), { snoozes: {}, skips: [] });
});

test('loadAlertState survives garbage and a missing store', () => {
  const store = new MemStore();
  store.setItem('task-monitor.dueAlerts.snooze.v1.u1', '{not json');
  assert.deepEqual(loadAlertState('u1', { today: TODAY, store }), { snoozes: {}, skips: [] });
  assert.deepEqual(loadAlertState('u1', { today: TODAY, store: null }), { snoozes: {}, skips: [] });
});

test('snoozeUntil clamps to 1..1440 minutes', () => {
  assert.equal(snoozeUntil(15, 0), 15 * 60_000);
  assert.equal(snoozeUntil(0, 0), 60_000);
  assert.equal(snoozeUntil(99_999, 0), 1440 * 60_000);
  assert.equal(snoozeUntil('abc', 0), 60_000);
});

test('buildFallbackPrompt names title, due date and each open subtask', () => {
  const p = buildFallbackPrompt({
    title: 'Send Q3 report', plan: { endDate: TODAY }, requestedBy: 'CFO',
    subtasks: [{ id: 1, text: 'Collect numbers', done: true }, { id: 2, text: 'Draft email', done: false }],
  }, { name: 'Finance' });
  assert.match(p, /Send Q3 report/);
  assert.match(p, /Due: 2026-09-07/);
  assert.match(p, /Draft email/);
  assert.doesNotMatch(p, /Collect numbers/);
  assert.match(p, /Project: Finance/);
  assert.equal(buildFallbackPrompt(null), '');
});

test('close-all mute applies to the day it was set and lifts tomorrow', () => {
  const store = new MemStore();
  assert.equal(isMutedToday('u1', TODAY, { store }), false);
  setMutedOn('u1', TODAY, { store });
  assert.equal(isMutedToday('u1', TODAY, { store }), true);
  assert.equal(isMutedToday('u1', addDaysISO(TODAY, 1), { store }), false);
  assert.equal(isMutedToday('u2', TODAY, { store }), false);
  setMutedOn('u1', null, { store });
  assert.equal(loadMutedOn('u1', { store }), null);
  assert.equal(setMutedOn('u1', TODAY, { store: null }), false);
});

// ─── T-0025 / IMP-009: the notification "already shown" set must not grow ───

import { daysBeforeISO, pruneShownKeys, SHOWN_RETENTION_DAYS } from './dueAlerts.js';

test('daysBeforeISO walks back across month and year boundaries', () => {
  assert.equal(daysBeforeISO('2026-03-01', 1), '2026-02-28');
  assert.equal(daysBeforeISO('2026-01-01', 1), '2025-12-31');
  assert.equal(daysBeforeISO('2026-09-20', 30), '2026-08-21');
  assert.equal(daysBeforeISO('not-a-date', 30), null);
});

test('keys older than the retention window are dropped', () => {
  const today = '2026-09-20';
  const old = `t1|${daysBeforeISO(today, SHOWN_RETENTION_DAYS + 1)}`;
  const recent = `t2|${daysBeforeISO(today, 5)}`;
  const kept = pruneShownKeys([old, recent], { today });
  assert.deepEqual([...kept], [recent]);
});

test('a key exactly on the boundary is kept', () => {
  const today = '2026-09-20';
  const edge = `t1|${daysBeforeISO(today, SHOWN_RETENTION_DAYS)}`;
  assert.ok(pruneShownKeys([edge], { today }).has(edge));
});

test('a future due date is kept — a task announced early must not repeat', () => {
  const key = 't1|2099-01-01';
  assert.ok(pruneShownKeys([key], { today: '2026-09-20' }).has(key));
});

test('malformed keys are discarded rather than carried forever', () => {
  const kept = pruneShownKeys(
    ['no-separator', '|2026-09-19', 't|not-a-date', '', null, 42, 't1|2026-09-19'],
    { today: '2026-09-20' },
  );
  assert.deepEqual([...kept], ['t1|2026-09-19']);
});

test('a task id containing a pipe still parses — the LAST separator wins', () => {
  const key = 'weird|id|2026-09-19';
  assert.ok(pruneShownKeys([key], { today: '2026-09-20' }).has(key));
});

test('ten years of keys collapse to the retention window', () => {
  const today = '2026-09-20';
  const keys = [];
  for (let i = 0; i < 3650; i++) keys.push(`t${i}|${daysBeforeISO(today, i)}`);
  const kept = pruneShownKeys(keys, { today });
  assert.equal(kept.size, SHOWN_RETENTION_DAYS + 1, 'today plus the retention window');
});

test('pruning without a date is a no-op on well-formed keys', () => {
  const kept = pruneShownKeys(['t1|2000-01-01'], {});
  assert.equal(kept.size, 1, 'no "today" means we cannot judge age');
});

test('empty and missing input produce an empty set, not a crash', () => {
  assert.equal(pruneShownKeys([], { today: '2026-09-20' }).size, 0);
  assert.equal(pruneShownKeys(undefined, { today: '2026-09-20' }).size, 0);
});
