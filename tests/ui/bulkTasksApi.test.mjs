// T-0127 / IMP-017 — the write path behind the task table's bulk bar.
//
// Medium risk: a new multi-document write path. The pure decisions are in
// src/services/bulkTasks.test.mjs; this exercises the committing itself against
// a recording stand-in, so the batching, the ordering and what happens when a
// commit fails are all covered before it goes near real data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupDom, teardownDom, muteConsoleError } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

setupDom();

const { bulkUpdateTasks } = await import('../../src/services/firebase.js');
const { BATCH_LIMIT, bulkPlan } = await import('../../src/services/bulkTasks.js');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

/** A stand-in for writeBatch(db) that records instead of committing. */
function recorder({ failOnBatch = -1 } = {}) {
  const batches = [];
  const newBatch = () => {
    const writes = [];
    const index = batches.length;
    batches.push(writes);
    return {
      update(ref, data) { writes.push({ ref, data }); },
      async commit() {
        if (index === failOnBatch) throw new Error('permission-denied');
        writes.committed = true;
      },
    };
  };
  return { batches, newBatch, stamp: () => 'SERVER_TIME' };
}

const opts = (rec) => ({ newBatch: rec.newBatch, stamp: rec.stamp });

const tasks = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
  id: `t${i}`, status: 'todo', priority: 'low', plan: {}, actual: {}, tags: [], assignedTo: [], ...over,
}));

// The acceptance case: ten tasks, one batch.
test('ten tasks are committed in a single batch', async () => {
  const plan = bulkPlan(tasks(10), 'priority', 'high');
  const rec = recorder();
  const result = await bulkUpdateTasks(plan.writes, opts(rec));

  assert.equal(rec.batches.length, 1, 'ten writes is one commit, not ten');
  assert.equal(rec.batches[0].length, 10);
  assert.deepEqual(result, { committed: 10, batches: 1 });
});

test('every write carries the patch and a server timestamp', async () => {
  const plan = bulkPlan(tasks(3), 'priority', 'high');
  const rec = recorder();
  await bulkUpdateTasks(plan.writes, opts(rec));

  for (const { data } of rec.batches[0]) {
    assert.equal(data.priority, 'high');
    assert.equal(data.updatedAt, 'SERVER_TIME',
      'updatedAt must be the server clock, not the device clock');
  }
});

test('a status change writes the stamps the plan worked out, not just the status', async () => {
  const plan = bulkPlan(tasks(2, { status: 'todo' }), 'status', 'done', { today: '2026-09-22' });
  const rec = recorder();
  await bulkUpdateTasks(plan.writes, opts(rec));

  const { data } = rec.batches[0][0];
  assert.equal(data.status, 'done');
  assert.equal(data.progress, 100);
  assert.equal(data['actual.endDate'], '2026-09-22');
  assert.equal(data['actual.startDate'], '2026-09-22', 'something finished has to have started');
});

test('more than a batch holds is split, and nothing is lost at the seam', async () => {
  const plan = bulkPlan(tasks(950), 'priority', 'high');
  const rec = recorder();
  const result = await bulkUpdateTasks(plan.writes, opts(rec));

  assert.deepEqual(rec.batches.map((b) => b.length), [400, 400, 150]);
  assert.ok(rec.batches.every((b) => b.length <= BATCH_LIMIT));
  assert.equal(result.committed, 950);
  assert.equal(rec.batches.flat().length, 950);
});

test('the batches commit one after another, not all at once', async () => {
  // Hundreds of writes in flight together is how a bulk edit takes the tab
  // down, and a failure part-way through could not then say how far it got.
  const order = [];
  let live = 0;
  const newBatch = () => {
    const writes = [];
    return {
      update(ref, data) { writes.push({ ref, data }); },
      async commit() {
        live += 1;
        order.push(live);
        await new Promise((r) => setTimeout(r, 1));
        live -= 1;
      },
    };
  };
  const plan = bulkPlan(tasks(900), 'priority', 'high');
  await bulkUpdateTasks(plan.writes, { newBatch, stamp: () => 'T' });
  assert.deepEqual(order, [1, 1, 1], 'never more than one commit in flight');
});

test('a failed commit says how many writes did land', async () => {
  const plan = bulkPlan(tasks(950), 'priority', 'high');
  const rec = recorder({ failOnBatch: 1 });

  await assert.rejects(
    () => bulkUpdateTasks(plan.writes, opts(rec)),
    (err) => {
      assert.equal(err.committed, 400,
        'the first batch is already written — "nothing happened" would be a lie');
      return true;
    },
  );
});

test('an empty plan does not commit at all', async () => {
  const rec = recorder();
  const result = await bulkUpdateTasks([], opts(rec));
  assert.equal(rec.batches.length, 0, 'an empty batch is still a round trip');
  assert.deepEqual(result, { committed: 0, batches: 0 });

  const noArgs = await bulkUpdateTasks(undefined, opts(rec));
  assert.equal(noArgs.committed, 0);
});

test('undo is the same write path, replayed with the previous values', async () => {
  const before = tasks(4, { priority: 'low' });
  const plan = bulkPlan(before, 'priority', 'high');

  const forward = recorder();
  await bulkUpdateTasks(plan.writes, opts(forward));
  assert.ok(forward.batches[0].every(({ data }) => data.priority === 'high'));

  const back = recorder();
  const undone = await bulkUpdateTasks(plan.undo, opts(back));
  assert.equal(undone.committed, 4);
  assert.ok(back.batches[0].every(({ data }) => data.priority === 'low'),
    'Undo must restore what each task WAS, not a guess');
});

/* ── how it is wired, not just what it does ────────────────────────────── */

const firebase = read('src', 'services', 'firebase.js');
const bodyOf = (name) => {
  const start = firebase.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = firebase.indexOf('\nexport ', start + 10);
  return firebase.slice(start, next > 0 ? next : undefined);
};

test('the data layer decides nothing itself — the plan comes from the pure module', () => {
  assert.match(firebase, /import \{ chunkWrites \} from '\.\/bulkTasks'/);
  const body = bodyOf('bulkUpdateTasks');
  assert.match(body, /chunkWrites\(writes\)/);
  assert.doesNotMatch(body, /statusStamps|priority|tags/,
    'what to write belongs in bulkTasks.js, not here');
});

test('a bulk delete is still a soft delete', () => {
  // The one rule that must survive a new write path: activities reference
  // tasks by id, so nothing here may remove a task document.
  const plan = bulkPlan(tasks(3), 'delete');
  assert.ok(plan.writes.every((w) => w.patch.deleted === true));
  assert.match(bodyOf('bulkUpdateTasks'), /batch\.update\(/);
  assert.doesNotMatch(bodyOf('bulkUpdateTasks'), /batch\.delete\(/);
});

test('permissions are left to the rules, and the reason is written down', () => {
  // The doc block sits above the `export`, so read from the comment that opens
  // it rather than from the function body.
  const start = firebase.indexOf('Apply one patch per task');
  assert.ok(start > 0, 'the doc block for bulkUpdateTasks is gone');
  // Normalise the comment's own wrapping before matching a sentence across it.
  const block = firebase
    .slice(start, firebase.indexOf('export async function bulkUpdateTasks'))
    .replace(/\n\s*\*\s?/g, ' ')
    .replace(/\s+/g, ' ');
  assert.match(block, /`firestore\.rules` is the enforcement point/,
    'why there is no client-side ACL check has to be stated, not assumed');
  assert.match(block, /rejected whole/,
    'and what a refused batch does — all or nothing, never a partial edit');
});
