// T-0102 / BUG-018 — a saved view's tag filter, honoured by every page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagsOf, filterByTag, availableTags, tagFilterState } from './tagFilter.js';

const tasks = [
  { id: 't1', title: 'Draft proposal', tags: ['client', 'q3'] },
  { id: 't2', title: 'Fix the build', tags: ['internal'] },
  { id: 't3', title: 'Untagged thing' },
  { id: 't4', title: 'Client review', tags: ['client'] },
];
const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));

const activities = [
  { id: 'a1', taskId: 't1', comment: 'Wrote the draft' },
  { id: 'a2', taskId: 't2', comment: 'Fixed it' },
  { id: 'a3', taskId: 't3', comment: 'Did a thing' },
  { id: 'a4', taskId: 'gone', comment: 'Against a task that is no longer loaded' },
];

// ─── where the tags come from ───────────────────────────────────────────────

test('a task carries its own tags', () => {
  assert.deepEqual(tagsOf(tasks[0]), ['client', 'q3']);
  assert.deepEqual(tagsOf(tasks[2]), [], 'no tags is not a crash');
});

test('an activity borrows its task’s tags', () => {
  assert.deepEqual(tagsOf(activities[0], { taskById }), ['client', 'q3'],
    'an activity has no tags of its own — this is the whole reason the module exists');
  assert.deepEqual(tagsOf(activities[1], { taskById }), ['internal']);
});

test('an activity whose task is gone has no tags, and is left out', () => {
  assert.deepEqual(tagsOf(activities[3], { taskById }), [],
    'better to show less than to show a #client entry to somebody filtering for something else');
  assert.deepEqual(filterByTag(activities, 'client', { taskById }).map((a) => a.id), ['a1']);
});

test('nothing at all is not a crash', () => {
  assert.deepEqual(tagsOf(null), []);
  assert.deepEqual(tagsOf(undefined, { taskById }), []);
  assert.deepEqual(filterByTag(undefined, 'client'), []);
  assert.deepEqual(availableTags(), []);
});

// ─── filtering ──────────────────────────────────────────────────────────────

test('only the tagged tasks survive', () => {
  assert.deepEqual(filterByTag(tasks, 'client').map((t) => t.id), ['t1', 't4']);
  assert.deepEqual(filterByTag(tasks, 'internal').map((t) => t.id), ['t2']);
});

test('a tag nobody carries shows nothing, rather than everything', () => {
  assert.deepEqual(filterByTag(tasks, 'nonexistent'), [],
    'falling back to "show everything" is how the bug went unnoticed');
});

test('no tag means no filtering', () => {
  assert.equal(filterByTag(tasks, null), tasks);
  assert.equal(filterByTag(tasks, ''), tasks);
  assert.equal(filterByTag(tasks, undefined), tasks);
});

test('the filter is exact — #client does not match #clients', () => {
  const more = [...tasks, { id: 't5', tags: ['clients'] }];
  assert.deepEqual(filterByTag(more, 'client').map((t) => t.id), ['t1', 't4']);
});

// ─── the chip strip ─────────────────────────────────────────────────────────

test('the strip offers every tag present, sorted and de-duped', () => {
  assert.deepEqual(availableTags(tasks), ['client', 'internal', 'q3']);
});

test('the strip for the activity log comes from the tasks behind it', () => {
  assert.deepEqual(availableTags(activities, { taskById }), ['client', 'internal', 'q3']);
});

test('an empty tag string is not a tag', () => {
  assert.deepEqual(availableTags([{ tags: ['', 'real'] }]), ['real']);
});

test('the state is everything a page needs in one call', () => {
  const s = tagFilterState(tasks, 'client');
  assert.deepEqual(s.tags, ['client', 'internal', 'q3']);
  assert.equal(s.active, 'client');
  assert.equal(s.missing, false);
  assert.deepEqual(s.filtered.map((t) => t.id), ['t1', 't4']);
});

test('a saved view pointing at a tag nothing carries still shows its chip', () => {
  const s = tagFilterState(tasks, 'renamed-since');
  assert.equal(s.active, 'renamed-since');
  assert.equal(s.missing, true, 'so the page can show the filter is on, and let it be cleared');
  assert.deepEqual(s.filtered, [], 'and it really is filtering');
});

test('no filter is the "All" state', () => {
  const s = tagFilterState(tasks, null);
  assert.equal(s.active, null);
  assert.equal(s.missing, false);
  assert.equal(s.filtered.length, 4);
});
