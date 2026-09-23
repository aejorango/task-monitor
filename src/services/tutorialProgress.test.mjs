import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  progressKey, readDone, writeDone, markDone, markUndone,
  lessonState, progressOf, lessonNumber, lessonSize, lessonPages,
  STATE_LABEL, STATE_MARK,
} from './tutorialProgress.js';

/** A localStorage stand-in, and one that throws the way a private window does. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    _map: map,
  };
}
const hostile = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
};

test('the key is per reader — one person\'s progress is not another\'s', () => {
  assert.notEqual(progressKey('u1'), progressKey('u2'));
  assert.match(progressKey('u1'), /u1$/);
  assert.match(progressKey(null), /anon$/);
});

test('nothing stored is an empty set, not a crash', () => {
  assert.deepEqual([...readDone('u1', fakeStorage())], []);
});

test('a lesson marked done survives a read', () => {
  const s = fakeStorage();
  markDone('u1', 'create-task', s);
  assert.deepEqual([...readDone('u1', s)], ['create-task']);
});

test('marking done twice is not two lessons', () => {
  const s = fakeStorage();
  markDone('u1', 'a', s); markDone('u1', 'a', s);
  assert.equal(readDone('u1', s).size, 1);
});

test('a lesson can be marked unread again', () => {
  const s = fakeStorage();
  markDone('u1', 'a', s); markDone('u1', 'b', s);
  markUndone('u1', 'a', s);
  assert.deepEqual([...readDone('u1', s)], ['b']);
});

test('a private window forgets, it does not break', () => {
  assert.doesNotThrow(() => readDone('u1', hostile));
  assert.deepEqual([...readDone('u1', hostile)], []);
  assert.doesNotThrow(() => markDone('u1', 'a', hostile));
});

test('corrupt stored JSON is ignored, not rendered', () => {
  assert.deepEqual([...readDone('u1', fakeStorage({ [progressKey('u1')]: 'not json' }))], []);
  assert.deepEqual([...readDone('u1', fakeStorage({ [progressKey('u1')]: '{"a":1}' }))], []);
  assert.deepEqual([...readDone('u1', fakeStorage({ [progressKey('u1')]: '[1,2,"ok"]' }))], ['ok']);
});

test('no storage at all still answers', () => {
  assert.deepEqual([...readDone('u1', null)], []);
  assert.doesNotThrow(() => writeDone('u1', new Set(['a']), null));
});

// ── the rail's three states ───────────────────────────────────────────────
test('looking at a lesson is not finishing it', () => {
  const done = new Set(['a']);
  assert.equal(lessonState('b', done, 'b'), 'active', 'open, but not walked through');
  assert.equal(lessonState('c', done, 'b'), 'todo');
});

test('done beats active — a finished lesson you reopen is still finished', () => {
  assert.equal(lessonState('a', new Set(['a']), 'a'), 'done');
});

test('every state has a label and a mark', () => {
  for (const s of ['done', 'active', 'todo']) {
    assert.equal(typeof STATE_LABEL[s], 'string');
    assert.equal(typeof STATE_MARK[s], 'string');
  }
});

// ── the count and the bar ─────────────────────────────────────────────────
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, steps: [{}, {}, {}] }));

test('the pill counts what is really finished', () => {
  assert.deepEqual(progressOf(SIX, new Set(['a', 'c'])), { done: 2, total: 6, pct: 33 });
  assert.deepEqual(progressOf(SIX, new Set()), { done: 0, total: 6, pct: 0 });
  assert.deepEqual(progressOf(SIX, new Set(SIX.map((t) => t.id))), { done: 6, total: 6, pct: 100 });
});

test('an id that is done but no longer a lesson does not inflate the count', () => {
  assert.equal(progressOf(SIX, new Set(['a', 'deleted-lesson'])).done, 1);
});

test('no lessons is 0%, never NaN', () => {
  assert.deepEqual(progressOf([], new Set()), { done: 0, total: 0, pct: 0 });
  assert.deepEqual(progressOf(undefined, undefined), { done: 0, total: 0, pct: 0 });
});

// ── the facts the mockup prints, in units this app actually has ───────────
test('the number is two digits, so the mono column does not jitter', () => {
  assert.equal(lessonNumber(0), '01');
  assert.equal(lessonNumber(5), '06');
  assert.equal(lessonNumber(9), '10');
});

test('size is STEPS, because nothing here measures minutes', () => {
  assert.equal(lessonSize({ steps: [{}, {}, {}] }), '3 steps');
  assert.equal(lessonSize({ steps: [{}] }), '1 step', 'and it is not "1 steps"');
  assert.equal(lessonSize({}), '0 steps');
  assert.equal(lessonSize(null), '0 steps');
});

test('the pages a tour visits are listed once each, in order', () => {
  const t = { steps: [{ view: 'projects' }, { view: 'projects' }, { view: 'board' }, { view: 'projects' }] };
  assert.deepEqual(lessonPages(t), ['projects', 'board']);
});

test('pages are named the way the rest of the app names them', () => {
  const t = { steps: [{ view: 'projects' }, { view: 'board' }] };
  const label = (v) => ({ projects: 'Portfolio', board: 'Kanban' }[v] || v);
  assert.deepEqual(lessonPages(t, label), ['Portfolio', 'Kanban']);
});

test('a step with no page is skipped, not listed as blank', () => {
  assert.deepEqual(lessonPages({ steps: [{ view: 'board' }, { selector: '.x' }] }), ['board']);
  assert.deepEqual(lessonPages(null), []);
});
