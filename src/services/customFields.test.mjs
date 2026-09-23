// T-0074 / MISS-009 — a project's own fields must be usable for reporting, not
// just visible inside the task editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allFields, fieldsOf, formatValue,
  hasValue, sortValue, taskChips,
} from './customFields.js';

const project = {
  id: 'p1', name: 'SBLAF rollout',
  customFields: [
    { id: 'f1', name: 'Client', type: 'select', options: ['Acme', 'Globex'] },
    { id: 'f2', name: 'Contract value', type: 'number' },
    { id: 'f3', name: 'Go-live', type: 'date' },
  ],
};
const other = {
  id: 'p2', name: 'Website revamp',
  customFields: [{ id: 'f4', name: 'Client', type: 'text' }],
};

const task = {
  id: 't1', title: 'Disbursement report', projectId: 'p1',
  customValues: { f1: 'Acme', f2: '250000', f3: '2026-10-01' },
};

// ─── reading a project's fields ─────────────────────────────────────────────

test('a field with no name or no id is not a field', () => {
  const messy = { customFields: [
    { id: 'a', name: 'Good', type: 'text' },
    { id: 'b', name: '   ' },
    { name: 'No id', type: 'text' },
    null,
  ] };
  assert.deepEqual(fieldsOf(messy).map((f) => f.name), ['Good']);
});

test('an unknown type falls back to text rather than rendering nothing', () => {
  const odd = { customFields: [{ id: 'a', name: 'Odd', type: 'rocket' }] };
  assert.equal(fieldsOf(odd)[0].type, 'text');
});

test('a project with no fields is not an error', () => {
  assert.deepEqual(fieldsOf(undefined), []);
  assert.deepEqual(fieldsOf({}), []);
});

// ─── naming them across projects ────────────────────────────────────────────

test('every project’s fields are collected, each one once', () => {
  const ids = allFields([project, other, project]).map((f) => f.id);
  assert.deepEqual(ids, ['f1', 'f2', 'f3', 'f4']);
});

test('two projects with a field of the same name are told apart by project', () => {
  const labels = Object.fromEntries(allFields([project, other]).map((f) => [f.id, f.label]));
  assert.equal(labels.f1, 'Client (SBLAF rollout)');
  assert.equal(labels.f4, 'Client (Website revamp)');
});

test('a name that is not ambiguous is left alone', () => {
  const labels = Object.fromEntries(allFields([project]).map((f) => [f.id, f.label]));
  assert.equal(labels.f1, 'Client');
  assert.equal(labels.f2, 'Contract value');
});

// ─── values ─────────────────────────────────────────────────────────────────

test('zero is a value; blank and missing are not', () => {
  assert.equal(hasValue(0), true);
  assert.equal(hasValue(false), true);
  assert.equal(hasValue(''), false);
  assert.equal(hasValue('   '), false);
  assert.equal(hasValue(null), false);
  assert.equal(hasValue(undefined), false);
});

test('a number sorts as a number, so 1000 comes after 90', () => {
  const field = { type: 'number' };
  assert.equal(sortValue(field, '1000') > sortValue(field, '90'), true);
});

test('text sorts case-insensitively, and a date sorts as a date', () => {
  assert.equal(sortValue({ type: 'text' }, 'Acme'), 'acme');
  assert.equal(sortValue({ type: 'date' }, '2026-10-01') < sortValue({ type: 'date' }, '2026-11-01'), true);
});

test('an empty value sorts as nothing, not as an empty string', () => {
  assert.equal(sortValue({ type: 'text' }, ''), null);
  assert.equal(sortValue({ type: 'number' }, undefined), null);
});

test('a number that is not a number is shown as typed rather than as NaN', () => {
  assert.equal(formatValue({ type: 'number' }, 'about ten'), 'about ten');
  assert.equal(formatValue({ type: 'number' }, '250000'), '250000');
});

// ─── chips on a card ────────────────────────────────────────────────────────

test('a card shows every field the task has a value for, in the project’s order', () => {
  assert.deepEqual(taskChips(task, project), [
    { id: 'f1', label: 'Client', text: 'Acme' },
    { id: 'f2', label: 'Contract value', text: '250000' },
    { id: 'f3', label: 'Go-live', text: '2026-10-01' },
  ]);
});

test('a field nobody filled in does not become an empty chip', () => {
  const half = { customValues: { f1: 'Acme', f2: '' } };
  assert.deepEqual(taskChips(half, project).map((c) => c.label), ['Client']);
});

test('a task with no values, or no project, shows no chips', () => {
  assert.deepEqual(taskChips({}, project), []);
  assert.deepEqual(taskChips(task, null), []);
});

// ─── columns ────────────────────────────────────────────────────────────────

