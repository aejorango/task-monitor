import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCrash, detailOf } from './errorMessages.js';

const noJargon = (s) => {
  assert.doesNotMatch(s, /stack|undefined is not|TypeError|null\b|console|chunk/i,
    `user-facing text leaked jargon: ${s}`);
};

test('a view crash keeps the user oriented and offers Try again', () => {
  const d = describeCrash(new TypeError("Cannot read properties of undefined (reading 'map')"), {
    scope: 'view', viewName: 'Gantt',
  });
  assert.match(d.title, /Gantt/);
  assert.equal(d.primaryAction, 'retry');
  assert.match(d.body, /rest of the app still works/);
  noJargon(d.title); noJargon(d.body);
});

test('an app-level crash offers Reload instead', () => {
  const d = describeCrash(new Error('boom'), { scope: 'app' });
  assert.equal(d.primaryAction, 'reload');
  noJargon(d.body);
});

test('a stale-deploy chunk failure is named for what it is', () => {
  const d = describeCrash(
    new TypeError('Failed to fetch dynamically imported module: /assets/GanttView-abc.js'),
    { scope: 'view', viewName: 'Gantt' },
  );
  assert.match(d.title, /new version/i);
  assert.equal(d.primaryAction, 'reload');
});

test('a dropped connection is named for what it is', () => {
  const d = describeCrash(new TypeError('NetworkError when attempting to fetch resource.'), {
    scope: 'view', viewName: 'Board',
  });
  assert.match(d.title, /No connection/);
  assert.equal(d.primaryAction, 'retry');
});

test('the technical detail is one bounded line, never a stack', () => {
  const err = new Error('x'.repeat(2000));
  err.stack = 'at Foo (bundle.js:1:1)\n'.repeat(50);
  const d = detailOf(err);
  assert.ok(d.length <= 500);
  assert.doesNotMatch(d, /bundle\.js/);
  assert.equal(detailOf(null), 'Unknown error (nothing was thrown).');
});

test('every crash says the user has not lost work', () => {
  for (const scope of ['app', 'view']) {
    assert.match(describeCrash(new Error('boom'), { scope }).body, /nothing you saved is lost/i);
  }
});
