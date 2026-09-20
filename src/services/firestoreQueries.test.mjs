// T-0037 / IMP-003 — queries must be bounded by Firestore, not by the client.
//
// These read the source rather than running it: the point is the SHAPE of each
// query (an orderBy and a limit that the server applies), and an emulator test
// would not show that a `.slice(0, 500)` happened after the whole collection
// had already been downloaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'services', 'firebase.js').replace('/services/', '/src/services/'), 'utf8');
const indexes = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8'));

function bodyOf(name) {
  const start = src.indexOf(`export function ${name}`) >= 0
    ? src.indexOf(`export function ${name}`)
    : src.indexOf(`export async function ${name}`);
  assert.ok(start > -1, `${name} not found`);
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

test('the workspace activity listener is ordered and limited by Firestore', () => {
  const body = bodyOf('subscribeToAllActivities');
  assert.match(body, /orderBy\('date', 'desc'\)/);
  assert.match(body, /limit\(pageSize\)/);
  assert.doesNotMatch(body, /\.slice\(0, \d+\)/,
    'slicing after the download does not save a single read');
  assert.doesNotMatch(body, /\.sort\(/, 'Firestore already returned them in order');
});

test('the recent-activity listener bounds the date range server-side', () => {
  const body = bodyOf('subscribeToRecentActivities');
  assert.match(body, /where\('date', '>=', sinceDate\)/);
  assert.match(body, /limit\(pageSize\)/);
  assert.doesNotMatch(body, /\.filter\(\(a\) => .*sinceDate/,
    'filtering in the browser means the rows were already paid for');
});

test('older pages are a one-shot read, not another live listener', () => {
  const body = bodyOf('loadMoreActivities');
  assert.match(body, /getDocs/);
  assert.doesNotMatch(body, /onSnapshot/, 'a listener per page is the original problem again');
  assert.match(body, /startAfter\(beforeDate\)/);
  assert.match(body, /hasMore/, 'the caller needs to know whether to offer "Load more"');
});

test('paging asks for one extra row to know whether more exist', () => {
  const body = bodyOf('loadMoreActivities');
  assert.match(body, /limit\(pageSize \+ 1\)/);
  assert.match(body, /rows\.slice\(0, pageSize\)/, 'and does not show the extra one');
});

test('paging without a cursor returns nothing rather than the whole collection', () => {
  assert.match(bodyOf('loadMoreActivities'), /if \(!workspaceId \|\| !beforeDate\) return/);
});

test('the page size is one named constant, not a number sprinkled about', () => {
  assert.match(src, /export const ACTIVITY_PAGE_SIZE = \d+/);
});

// ─── the indexes those queries need ─────────────────────────────────────────

const hasIndex = (collection, fields) => indexes.indexes.some((idx) =>
  idx.collectionGroup === collection
  && fields.every(([p, o], i) => idx.fields[i]?.fieldPath === p && idx.fields[i]?.order === o));

test('every ordered query has a composite index to run on', () => {
  assert.ok(hasIndex('activities', [['workspaceId', 'ASCENDING'], ['date', 'DESCENDING']]),
    'workspace activity log');
  assert.ok(hasIndex('activities', [['taskId', 'ASCENDING'], ['date', 'DESCENDING']]),
    "one task's activity");
  assert.ok(hasIndex('activities', [['projectId', 'ASCENDING'], ['date', 'DESCENDING']]),
    "one project's activity");
});

test('the index file is deployable and complete', () => {
  assert.ok(Array.isArray(indexes.indexes));
  assert.ok(indexes.indexes.length > 0);
  for (const idx of indexes.indexes) {
    assert.ok(idx.collectionGroup, 'every index names its collection');
    assert.equal(idx.queryScope, 'COLLECTION');
    assert.ok(idx.fields.length >= 2, 'single-field indexes are automatic');
    for (const f of idx.fields) {
      assert.ok(f.fieldPath, 'every field has a path');
      assert.match(f.order, /^(ASCENDING|DESCENDING)$/);
    }
  }
});

test('firebase.json points at the index file and npm can deploy it', () => {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  assert.equal(firebaseJson.firestore.indexes, 'firestore.indexes.json');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['deploy:indexes'], /indexes/);
});
