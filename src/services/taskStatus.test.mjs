// T-0092 / BUG-015 — one rule for what a status implies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_STATUSES, normalizeTaskStatus, statusStamps } from './taskStatus.js';

const TODAY = '2026-09-21';

test('there are three statuses, and nothing else is one', () => {
  assert.deepEqual(TASK_STATUSES, ['todo', 'doing', 'done']);
  assert.equal(normalizeTaskStatus('done'), 'done');
  assert.equal(normalizeTaskStatus('Done'), 'todo', 'case is the caller’s job to normalise');
  assert.equal(normalizeTaskStatus('shipped'), 'todo');
  assert.equal(normalizeTaskStatus(undefined), 'todo');
  assert.equal(normalizeTaskStatus(null, 'doing'), 'doing', 'the fallback is the caller’s choice');
});

test('todo stamps nothing', () => {
  assert.deepEqual(statusStamps('todo', { today: TODAY }), {
    progress: 0, actualStartDate: null, actualEndDate: null,
  });
});

test('doing starts the clock but does not stop it', () => {
  assert.deepEqual(statusStamps('doing', { today: TODAY }), {
    progress: 0, actualStartDate: TODAY, actualEndDate: null,
  });
});

test('done is finished: full progress, and both ends stamped', () => {
  assert.deepEqual(statusStamps('done', { today: TODAY }), {
    progress: 100, actualStartDate: TODAY, actualEndDate: TODAY,
  });
});

test('something finished must have started — an import of a Done row is not open-ended', () => {
  const stamps = statusStamps('done', { today: TODAY });
  assert.ok(stamps.actualStartDate, 'an end with no start makes every duration wrong');
});

test('an existing start date survives being finished', () => {
  assert.deepEqual(statusStamps('done', { today: TODAY, current: { startDate: '2026-09-14' } }), {
    progress: 100, actualStartDate: '2026-09-14', actualEndDate: TODAY,
  });
});

test('an existing end date is not moved by finishing again', () => {
  const stamps = statusStamps('done', { today: TODAY, current: { startDate: '2026-09-14', endDate: '2026-09-18' } });
  assert.equal(stamps.actualEndDate, '2026-09-18');
});

test('progress already made is kept while a task is in progress', () => {
  assert.equal(statusStamps('doing', { today: TODAY, current: { progress: 40 } }).progress, 40);
  assert.equal(statusStamps('doing', { today: TODAY }).progress, 0);
});

test('reopening a task clears the stamps, whatever it had', () => {
  assert.deepEqual(statusStamps('todo', { today: TODAY, current: { startDate: '2026-09-14', endDate: '2026-09-18', progress: 100 } }), {
    progress: 0, actualStartDate: null, actualEndDate: null,
  });
});

test('the module never reads the clock itself', () => {
  // No `today` passed: it must not invent one.
  assert.deepEqual(statusStamps('done', {}), {
    progress: 100, actualStartDate: null, actualEndDate: null,
  });
});
