// T-0123 / POL-013 — a board card shows when its task is due.
//
//   1. Given a task due in three days
//   2. When its card renders on the board
//   3. Then the card shows its due date in a compact, local-day format, and an
//      overdue task shows how many days late it is
//
// The card is the real CardBody from Board.jsx; the wording rule it renders is
// covered on its own in src/services/dueChip.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, muteConsoleError, text } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const boardSrc = () => fs.readFileSync(path.join(root, 'src', 'components', 'Board.jsx'), 'utf8');

setupDom();

const { CardBody } = await import('../../src/components/Board.jsx');
const { todayLocal } = await import('../../src/services/recurrence.js');
const { addDaysISO } = await import('../../src/services/dueAlerts.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const TODAY = todayLocal();
const inDays = (n) => addDaysISO(TODAY, n);

const card = (task) => mount(h(CardBody, {
  task: { id: 't', title: 'A task', status: 'todo', ...task },
  project: null,
  expanded: false,
  onToggleExpand() {}, onLog() {}, onEdit() {}, onEditActivity() {},
  dragging: false,
}));

// T-0148: the Board Explorer's own class. The chip is the same rule.
const chipIn = (ui) => ui.container.querySelector('.bx-kc-due');

test('a task due today says so', async () => {
  const ui = await card({ plan: { endDate: TODAY } });
  assert.equal(chipIn(ui).textContent.trim(), 'Due today');
  ui.unmount();
});

// The acceptance case.
test('a task due in three days shows that date, compactly', async () => {
  const ui = await card({ plan: { endDate: inDays(3) } });
  const chip = chipIn(ui);
  assert.ok(chip, 'this is what the card never had');
  const expected = new Date(`${inDays(3)}T00:00:00`).toLocaleDateString('en', { weekday: 'short' });
  assert.equal(chip.textContent.trim(), `Due ${expected}`);
  assert.match(chip.getAttribute('title'), /in 3 days/, 'the full date is one hover away');
  ui.unmount();
});

test('a task due next month shows a date rather than a weekday', async () => {
  const due = inDays(40);
  const ui = await card({ plan: { endDate: due } });
  const expected = new Date(`${due}T00:00:00`)
    .toLocaleDateString('en', due.slice(0, 4) === TODAY.slice(0, 4)
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  assert.equal(chipIn(ui).textContent.trim(), `Due ${expected}`);
  ui.unmount();
});

test('an overdue task says how many days late it is', async () => {
  const ui = await card({ plan: { endDate: inDays(-3) } });
  assert.equal(chipIn(ui).textContent.trim(), '3d late');
  // The Board Explorer puts the date in the card's footer rather than in a
  // pill, so lateness is carried by `.late` (bold, red, mono) instead of the
  // old badge tone class. Same claim, new place (T-0145).
  assert.ok(chipIn(ui).classList.contains('late'));
  ui.unmount();
});

// "Overdue" told you a task was late and nothing more — not by how much, and
// nothing at all about the one due tomorrow.
test('the bare Overdue badge is gone, and the card still marks itself overdue', async () => {
  const ui = await card({ plan: { endDate: inDays(-3) } });
  assert.doesNotMatch(text(ui.container), /\bOverdue\b/);
  // The mockup marks lateness on the DUE DATE — bold and red — rather than
  // tinting the whole card, so that is where the styling keys off now.
  assert.ok(chipIn(ui).classList.contains('late'),
    'the card styling must still key on lateness');
  ui.unmount();

  const fine = await card({ plan: { endDate: inDays(3) } });
  assert.ok(!chipIn(fine).classList.contains('late'));
  fine.unmount();
});

test('three cards due today, next month and three days late all read differently', async () => {
  const seen = [];
  for (const endDate of [TODAY, inDays(40), inDays(-3)]) {
    const ui = await card({ plan: { endDate } });
    seen.push(chipIn(ui).textContent.trim());
    ui.unmount();
  }
  assert.equal(new Set(seen).size, 3, `all three looked the same: ${seen.join(' | ')}`);
});

test('a done task shows no due chip — early or late is the fact that matters', async () => {
  const ui = await card({
    status: 'done',
    plan: { endDate: inDays(-3) },
    actual: { endDate: inDays(-1) },
  });
  assert.equal(chipIn(ui), null);
  assert.match(text(ui.container), /Done late/, 'the badge that belongs there is still there');
  ui.unmount();
});

test('a task with no due date shows no chip at all', async () => {
  const ui = await card({ plan: {} });
  assert.equal(chipIn(ui), null);
  ui.unmount();
});

test('the card no longer claims dates are hidden on purpose', () => {
  assert.doesNotMatch(boardSrc(), /dates are intentionally hidden/,
    'the comment outlived the decision it described');
  assert.match(boardSrc(), /from '\.\.\/services\/dueChip'/,
    'the wording rule belongs in a pure module, not inline in the card');
});
