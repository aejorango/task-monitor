// The chunking that keeps a multi-hundred-task write inside Firestore's limit.
// Carried over from bulkTasks.test.mjs when the bulk bar was removed (T-0152);
// `duplicateProject` still depends on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_LIMIT, chunkWrites } from './writeBatches.js';

test('a short list is one commit', () => {
  assert.equal(chunkWrites([{ id: 'a' }, { id: 'b' }]).length, 1);
});

test('nothing is an empty list of commits, not one empty commit', () => {
  assert.deepEqual(chunkWrites([]), []);
  assert.deepEqual(chunkWrites(), []);
});

test('800 writes become two commits, and nothing is lost between them', () => {
  const writes = Array.from({ length: 800 }, (_, i) => ({ id: `t${i}` }));
  const chunks = chunkWrites(writes);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, BATCH_LIMIT);
  assert.equal(chunks[1].length, 800 - BATCH_LIMIT);
  assert.deepEqual(chunks.flat(), writes, 'every write survives the split, in order');
});

test('exactly the limit is one commit, not two with an empty one', () => {
  const writes = Array.from({ length: BATCH_LIMIT }, (_, i) => ({ id: `t${i}` }));
  assert.equal(chunkWrites(writes).length, 1);
});

test('the limit leaves Firestore room for the counters a write carries', () => {
  assert.ok(BATCH_LIMIT < 500, 'Firestore refuses a batch over 500 operations');
});
