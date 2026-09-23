// src/services/writeBatches.js — splitting a list of writes into commits
// Firestore will accept.
//
// Lifted out of `services/bulkTasks.js` when the bulk bar and the task table
// were removed (T-0152). The chunking itself is not about bulk editing: three
// callers in `firebase.js` rely on it, `duplicateProject` above all, which
// writes a whole project's tasks and would otherwise be one round trip per
// task.
//
// Pure — no Firebase, no clock — so `node --test` can check the boundaries.

/**
 * Firestore's own ceiling is 500 operations per batch. 400 leaves room for the
 * counter updates a write may carry with it.
 */
export const BATCH_LIMIT = 400;

/** Split `writes` into chunks of at most `size`. */
export function chunkWrites(writes = [], size = BATCH_LIMIT) {
  const out = [];
  for (let i = 0; i < writes.length; i += size) out.push(writes.slice(i, i + size));
  return out;
}
