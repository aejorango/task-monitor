import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultProjectId } from './preferences.js';

const PROJECTS = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

test('with no preference, the first project is used', () => {
  assert.equal(pickDefaultProjectId(PROJECTS, {}), 'p1');
  assert.equal(pickDefaultProjectId(PROJECTS, { projectFilter: 'all' }), 'p1');
});

test('the saved default wins over the first project', () => {
  assert.equal(
    pickDefaultProjectId(PROJECTS, { projectFilter: 'all', defaultProject: 'p3' }),
    'p3',
  );
});

test('the project you are looking at wins over the saved default', () => {
  assert.equal(
    pickDefaultProjectId(PROJECTS, { projectFilter: 'p2', defaultProject: 'p3' }),
    'p2',
  );
});

test('a default pointing at a project that is gone falls back instead of emptying the box', () => {
  assert.equal(
    pickDefaultProjectId(PROJECTS, { projectFilter: 'all', defaultProject: 'deleted' }),
    'p1',
  );
});

test('a filter pointing at a project the user cannot see falls back too', () => {
  assert.equal(
    pickDefaultProjectId(PROJECTS, { projectFilter: 'not-mine', defaultProject: 'p2' }),
    'p2',
  );
});

test('no projects at all yields null, never undefined', () => {
  assert.equal(pickDefaultProjectId([], { defaultProject: 'p1' }), null);
  assert.equal(pickDefaultProjectId(undefined, undefined), null);
});
