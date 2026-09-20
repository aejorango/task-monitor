// Unit tests for the recurring-task date maths and the payload handed to
// addTask for the next occurrence (T-0006 / BUG-004).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysISO, addMonthsClampedISO, buildNextRecurrenceTask,
  isoOf, nextRecurrenceDates, parseISO, todayLocal,
} from './recurrence.js';

const base = (over = {}) => ({
  id: 'task-1',
  userId: 'u1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  phaseId: 'phase-1',
  title: 'Weekly report',
  description: 'Write it',
  category: 'BRIDGED',
  priority: 'high',
  requestedBy: 'Ace',
  status: 'done',
  plan: { startDate: '2026-09-14', endDate: '2026-09-18' },
  actual: { startDate: '2026-09-14', endDate: '2026-09-18' },
  tags: ['report'],
  subtasks: [{ id: 's1', text: 'Draft', done: true }, { id: 's2', text: 'Send', done: true }],
  dependsOn: ['other-task'],
  links: [{ targetId: 'x', type: 'related-to' }],
  customValues: { client: 'Acme' },
  assignedTo: ['u2'],
  assignedToExternal: ['Jordan'],
  recurrence: { rule: 'weekly', interval: 1 },
  ...over,
});

// ─── date helpers ───────────────────────────────────────────────────────────

test('parseISO / isoOf round-trip in local time', () => {
  assert.equal(isoOf(parseISO('2026-09-20')), '2026-09-20');
  assert.equal(parseISO(''), null);
  assert.equal(parseISO(null), null);
});

test('addDaysISO crosses month and year boundaries', () => {
  assert.equal(addDaysISO('2026-09-30', 1), '2026-10-01');
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysISO('2026-03-01', -1), '2026-02-28');
});

test('addMonthsClampedISO clamps instead of overflowing', () => {
  assert.equal(addMonthsClampedISO('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(addMonthsClampedISO('2028-01-31', 1, 31), '2028-02-29', 'leap year');
  assert.equal(addMonthsClampedISO('2026-01-15', 1, 15), '2026-02-15');
});

test('todayLocal is a YYYY-MM-DD string in the local timezone', () => {
  const t = todayLocal();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(t, isoOf(new Date()));
});

// ─── nextRecurrenceDates ────────────────────────────────────────────────────

test('a non-recurring task has no next occurrence', () => {
  assert.equal(nextRecurrenceDates(base({ recurrence: null })), null);
  assert.equal(nextRecurrenceDates(undefined), null);
});

test('daily recurrence steps by the interval and keeps the duration', () => {
  const r = nextRecurrenceDates(base({ recurrence: { rule: 'daily', interval: 3 } }));
  assert.deepEqual(r, { start: '2026-09-17', end: '2026-09-21' });
});

test('weekly recurrence lands on the configured weekday, not on drift', () => {
  // 2026-09-18 is a Friday. dayOfWeek 1 = Monday.
  const r = nextRecurrenceDates(base({ recurrence: { rule: 'weekly', interval: 1, dayOfWeek: 1 } }));
  assert.equal(parseISO(r.end).getDay(), 1);
  assert.equal(r.end, '2026-09-28');
  assert.equal(r.start, '2026-09-24', 'four-day duration preserved');
});

test('weekly recurrence with no dayOfWeek keeps the current weekday', () => {
  const r = nextRecurrenceDates(base());
  assert.equal(r.end, '2026-09-25');
  assert.equal(parseISO(r.end).getDay(), parseISO('2026-09-18').getDay());
});

test('monthly recurrence clamps a 31st to a short month', () => {
  const r = nextRecurrenceDates(base({
    plan: { startDate: '2026-01-31', endDate: '2026-01-31' },
    recurrence: { rule: 'monthly', interval: 1, dayOfMonth: 31 },
  }));
  assert.equal(r.end, '2026-02-28');
});

test('the series stops after `until`', () => {
  const r = nextRecurrenceDates(base({
    recurrence: { rule: 'weekly', interval: 1, until: '2026-09-20' },
  }));
  assert.equal(r, null);
});

test('a recurring task with no dates starts today', () => {
  const r = nextRecurrenceDates(base({ plan: { startDate: null, endDate: null } }));
  assert.deepEqual(r, { start: todayLocal(), end: todayLocal() });
});

// ─── buildNextRecurrenceTask — the BUG-004 regression ───────────────────────

test('the next instance carries the workspaceId', () => {
  const payload = buildNextRecurrenceTask(base());
  assert.equal(payload.workspaceId, 'ws-1',
    'without this the task is refused by the rules and invisible on the Board');
});

test('the next instance carries every v9+ field the editor can set', () => {
  const payload = buildNextRecurrenceTask(base());
  assert.deepEqual(payload.assignedTo, ['u2']);
  assert.deepEqual(payload.assignedToExternal, ['Jordan']);
  assert.deepEqual(payload.links, [{ targetId: 'x', type: 'related-to' }]);
  assert.deepEqual(payload.customValues, { client: 'Acme' });
  assert.deepEqual(payload.tags, ['report']);
  assert.equal(payload.projectId, 'proj-1');
  assert.equal(payload.phaseId, 'phase-1');
  assert.equal(payload.priority, 'high');
  assert.equal(payload.requestedBy, 'Ace');
  assert.equal(payload.category, 'BRIDGED');
});

test('the next instance resets the checklist and drops finished dependencies', () => {
  const payload = buildNextRecurrenceTask(base());
  assert.deepEqual(payload.subtasks.map((s) => s.done), [false, false]);
  assert.deepEqual(payload.subtasks.map((s) => s.text), ['Draft', 'Send']);
  assert.deepEqual(payload.dependsOn, []);
});

test('the next instance points at the original parent, not at each copy', () => {
  const first  = buildNextRecurrenceTask(base());
  assert.equal(first.recurrenceParentId, 'task-1');
  const second = buildNextRecurrenceTask(base({ id: 'task-2', recurrenceParentId: 'task-1' }));
  assert.equal(second.recurrenceParentId, 'task-1');
});

test('the next instance keeps the recurrence rule so the series continues', () => {
  const payload = buildNextRecurrenceTask(base());
  assert.deepEqual(payload.recurrence, { rule: 'weekly', interval: 1 });
});

test('no payload once the series has ended', () => {
  assert.equal(buildNextRecurrenceTask(base({ recurrence: null })), null);
  assert.equal(
    buildNextRecurrenceTask(base({ recurrence: { rule: 'weekly', interval: 1, until: '2026-09-19' } })),
    null,
  );
});

test('the payload never carries a stale actual-date or counter', () => {
  const payload = buildNextRecurrenceTask(base());
  assert.equal('actual' in payload, false);
  assert.equal('activityCount' in payload, false);
  assert.equal('totalHoursLogged' in payload, false);
  assert.equal('status' in payload, false, 'addTask always starts a task at todo');
});
