import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBandOpen, expandAll, collapseAll } from './boardBands.js';

const BANDS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('with nothing said, the FIRST band is open and the rest are not', () => {
  assert.equal(isBandOpen({}, 'a', 0), true);
  assert.equal(isBandOpen({}, 'b', 1), false);
  assert.equal(isBandOpen({}, 'c', 2), false);
});

test('an undefined map behaves the same as an empty one', () => {
  assert.equal(isBandOpen(undefined, 'a', 0), true);
  assert.equal(isBandOpen(null, 'b', 1), false);
});

test('what the reader said beats the default, in both directions', () => {
  assert.equal(isBandOpen({ a: false }, 'a', 0), false, 'shutting the first band must stick');
  assert.equal(isBandOpen({ b: true }, 'b', 1), true);
});

test('Expand all opens every band', () => {
  const next = expandAll(BANDS);
  BANDS.forEach((b, i) => assert.equal(isBandOpen(next, b.id, i), true));
});

// The regression this module exists for.
test('Collapse all really shuts the first band', () => {
  const next = collapseAll(BANDS);
  assert.equal(isBandOpen(next, 'a', 0), false,
    'writing {} here would let the default reopen it — the button would visibly not work');
  BANDS.forEach((b, i) => assert.equal(isBandOpen(next, b.id, i), false));
});

test('Collapse all states every band, rather than relying on absence', () => {
  assert.deepEqual(collapseAll(BANDS), { a: false, b: false, c: false });
  assert.notDeepEqual(collapseAll(BANDS), {});
});

test('neither helper throws on an empty board', () => {
  assert.deepEqual(expandAll([]), {});
  assert.deepEqual(collapseAll([]), {});
  assert.deepEqual(expandAll(), {});
  assert.deepEqual(collapseAll(), {});
});

test('a band that was shut stays shut when it moves to first place', () => {
  // Bands are rebuilt on every render — a project whose tasks all get filtered
  // out drops out of the list and the next one becomes index 0. An explicit
  // `false` must survive that, or filtering would silently reopen things.
  assert.equal(isBandOpen({ b: false }, 'b', 0), false);
});
