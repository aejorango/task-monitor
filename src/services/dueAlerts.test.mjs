// src/services/dueAlerts.test.mjs — run with `npm test` (node --test).
// Pure logic only: no Firestore, no DOM, no CLI.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDueForAlert, buildAlertQueue, alertKey, overdueDays, isQuietNow,
  loadAlertState, saveAlertState, snoozeUntil, buildFallbackPrompt,
  addDaysISO, daysBetween,
} from './dueAlerts.js';

const TODAY = '2026-09-07';
const t = (id, endDate, extra = {}) => ({ id, title: id, status: 'todo', priority: 'medium', plan: { endDate }, ...extra });

class MemStore {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
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
