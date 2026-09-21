// T-0123 / POL-013 — board cards show a due date, not only "Overdue".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueChip, NEAR_DAYS } from './dueChip.js';

// A Tuesday, so every weekday in the near window is distinct and checkable.
const TODAY = '2026-09-22';
const at = (endDate, extra = {}) => ({ status: 'todo', plan: { endDate }, ...extra });

test('a task due today says so', () => {
  const chip = dueChip(at(TODAY), TODAY);
  assert.equal(chip.text, 'Due today');
  assert.equal(chip.tone, 'warn');
  assert.equal(chip.late, false);
});

test('a task due tomorrow says so, rather than naming the weekday', () => {
  assert.equal(dueChip(at('2026-09-23'), TODAY).text, 'Due tomorrow');
});

// The acceptance case: three days out.
test('a task due in three days shows the weekday', () => {
  const chip = dueChip(at('2026-09-25'), TODAY);
  assert.equal(chip.text, 'Due Fri');
  assert.equal(chip.tone, 'info');
  assert.match(chip.title, /Friday, September 25, 2026/);
  assert.match(chip.title, /in 3 days/);
});

test('the weekday window ends where a weekday would stop being unambiguous', () => {
  assert.equal(dueChip(at('2026-09-28'), TODAY).text, 'Due Mon', `${NEAR_DAYS} days out is still a weekday`);
  assert.equal(dueChip(at('2026-09-29'), TODAY).text, 'Due Sep 29', 'a week out is a date');
});

test('a task due next month shows a compact date', () => {
  const chip = dueChip(at('2026-10-12'), TODAY);
  assert.equal(chip.text, 'Due Oct 12');
  assert.equal(chip.tone, 'muted');
});

test('a date in another year carries the year, so it cannot read as two weeks away', () => {
  assert.equal(dueChip(at('2027-10-12'), TODAY).text, 'Due Oct 12, 2027');
  assert.equal(dueChip(at('2026-12-31'), TODAY).text, 'Due Dec 31');
});

// This is what replaces the bare "Overdue" badge: it said a task was late but
// never by how much.
test('an overdue task says how many days late it is', () => {
  const chip = dueChip(at('2026-09-19'), TODAY);
  assert.equal(chip.text, '3d late');
  assert.equal(chip.tone, 'danger');
  assert.equal(chip.late, true);
  assert.match(chip.title, /Was due Saturday, September 19, 2026 — 3 days ago/);
});

test('one day late is singular in the tooltip and compact on the chip', () => {
  const chip = dueChip(at('2026-09-21'), TODAY);
  assert.equal(chip.text, '1d late');
  assert.match(chip.title, /1 day ago/);
  assert.doesNotMatch(chip.title, /1 days/);
});

test('a long overdue task still gives a number, not a word', () => {
  assert.equal(dueChip(at('2026-06-22'), TODAY).text, '92d late');
});

test('a done task gets no due chip — early or late is the interesting fact', () => {
  assert.equal(dueChip(at('2026-09-19', { status: 'done' }), TODAY), null);
  assert.equal(dueChip(at('2026-10-12', { status: 'done' }), TODAY), null);
});

test('a task with no due date gets no chip', () => {
  assert.equal(dueChip({ status: 'todo', plan: {} }, TODAY), null);
  assert.equal(dueChip({ status: 'todo' }, TODAY), null);
  assert.equal(dueChip({ status: 'todo', plan: { endDate: '' } }, TODAY), null);
});

test('a malformed date is not rendered as one', () => {
  assert.equal(dueChip(at('not-a-date'), TODAY), null);
  assert.equal(dueChip(at('2026-13'), TODAY), null);
});

test('the date order matches fmtDay, which the editor and the Gantt already use', async () => {
  // Two orders for one task across two surfaces reads as two different dates,
  // so this pins against the REAL helper rather than a copy of it.
  const { fmtDay } = await import('../components/ActivityTimeline.jsx');
  const month = fmtDay('2026-10-12').split(' ')[0];       // 'Oct'
  assert.ok(dueChip(at('2026-10-12'), TODAY).text.startsWith(`Due ${month}`),
    `fmtDay prints "${fmtDay('2026-10-12')}" — the chip must lead with the same part`);
});

test('missing arguments are safe', () => {
  assert.equal(dueChip(null, TODAY), null);
  assert.equal(dueChip(at(TODAY), null), null);
  assert.equal(dueChip(), null);
});

test('the chip is a local-calendar fact, not a UTC one', () => {
  // A Manila morning is still the previous UTC day. Anything that built this
  // from `new Date().toISOString()` would call a task due today "1d late".
  const chip = dueChip(at('2026-09-22'), '2026-09-22');
  assert.equal(chip.text, 'Due today');
  assert.equal(chip.late, false);
});
