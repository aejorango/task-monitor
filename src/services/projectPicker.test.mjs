// The project picker: active projects only, A–Z.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerProjects } from './projectPicker.js';

const P = (id, name, o = {}) => ({ id, name, ...o });

test('archived and deleted projects are not offered', () => {
  const list = [P('a', 'Alpha'), P('b', 'Bravo', { archived: true }), P('c', 'Charlie', { deleted: true })];
  assert.deepEqual(pickerProjects(list).map((p) => p.id), ['a']);
});

test('the project already chosen stays, marked, even if it was archived since', () => {
  const list = [P('a', 'Alpha'), P('b', 'Bravo', { archived: true })];
  const out = pickerProjects(list, 'b');
  assert.deepEqual(out.map((p) => p.id), ['a', 'b']);
  assert.equal(out[1]._archived, true);
  assert.equal(out[0]._archived, undefined);
});

test('A to Z by name: case, accents and leading spaces ignored, numbers read as numbers', () => {
  const list = [P('1', 'zeta'), P('2', ' Alpha'), P('3', 'Phase 10'), P('4', 'Phase 2'), P('5', 'Éclair'), P('6', 'beta')];
  assert.deepEqual(pickerProjects(list).map((p) => p.name.trim()), ['Alpha', 'beta', 'Éclair', 'Phase 2', 'Phase 10', 'zeta']);
});
