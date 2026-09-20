// Tests for the quick-add parser (T-0009 / IMP-005). A pinned `now` keeps
// every date assertion independent of the day the suite runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from './nlpQuickAdd.js';

// Friday 2026-09-18, local midnight.
const NOW = new Date(2026, 8, 18);
const parse = (s) => parseQuickAdd(s, { now: NOW });

test('a bare sentence is all title', () => {
  const r = parse('draft the quarterly proposal');
  assert.equal(r.title, 'draft the quarterly proposal');
  assert.equal(r.priority, null);
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.plan, {});
});

test('priority markers are consumed, not left in the title', () => {
  for (const [input, expected] of [
    ['ship it !urgent', 'high'], ['ship it !high', 'high'], ['ship it !p0', 'high'],
    ['ship it !low', 'low'],  ['ship it !p3', 'low'],
    ['ship it !med', 'medium'], ['ship it !medium', 'medium'], ['ship it !p2', 'medium'],
  ]) {
    const r = parse(input);
    assert.equal(r.priority, expected, input);
    assert.equal(r.title, 'ship it', input);
  }
});

test('tags are collected and stripped', () => {
  const r = parse('write docs #release #client-a');
  assert.deepEqual(r.tags, ['release', 'client-a']);
  assert.equal(r.title, 'write docs');
});

test('@names become requestedBy and several are joined', () => {
  assert.equal(parse('review PR @mark').requestedBy, 'mark');
  assert.equal(parse('review PR @mark @ana.cruz').requestedBy, 'mark, ana.cruz');
  assert.equal(parse('review PR @mark').title, 'review PR');
});

test('today / tomorrow / yesterday resolve against the given day', () => {
  assert.equal(parse('call the vendor today').plan.endDate, '2026-09-18');
  assert.equal(parse('call the vendor tomorrow').plan.endDate, '2026-09-19');
  assert.equal(parse('call the vendor yesterday').plan.endDate, '2026-09-17');
  assert.equal(parse('call the vendor tomorrow').title, 'call the vendor');
});

test('"in N days/weeks/months" counts forward from the given day', () => {
  assert.equal(parse('review in 3 days').plan.endDate, '2026-09-21');
  assert.equal(parse('review in 2 weeks').plan.endDate, '2026-10-02');
  assert.equal(parse('review in 1 month').plan.endDate, '2026-10-18');
});

test('a bare weekday means the next one, and today counts as today', () => {
  assert.equal(parse('standup friday').plan.endDate, '2026-09-18', 'today is Friday');
  assert.equal(parse('standup monday').plan.endDate, '2026-09-21');
});

test('"next <weekday>" always skips a week', () => {
  assert.equal(parse('retro next friday').plan.endDate, '2026-09-25');
  assert.equal(parse('retro next monday').plan.endDate, '2026-09-21');
});

test('explicit dates win over relative words', () => {
  assert.equal(parse('kickoff on 2026-06-01').plan.endDate, '2026-06-01');
  assert.equal(parse('kickoff by 2026-06-01').plan.endDate, '2026-06-01');
  assert.equal(parse('kickoff 2026-06-01').plan.endDate, '2026-06-01');
  assert.equal(parse('kickoff on 2026-06-01').title, 'kickoff');
});

test('MM/DD and MM/DD/YYYY are understood, two-digit years become 20xx', () => {
  assert.equal(parse('invoice 6/1').plan.endDate, '2026-06-01');
  assert.equal(parse('invoice 6/1/2027').plan.endDate, '2027-06-01');
  assert.equal(parse('invoice 6/1/27').plan.endDate, '2027-06-01');
});

test('only the first date is taken — a task has one due date', () => {
  const r = parse('sync tomorrow on 2026-06-01');
  assert.equal(r.plan.endDate, '2026-06-01', 'the explicit date is matched first');
});

test('everything at once still leaves a clean title', () => {
  const r = parse('draft proposal next friday !urgent #client @mark');
  assert.equal(r.title, 'draft proposal');
  assert.equal(r.priority, 'high');
  assert.deepEqual(r.tags, ['client']);
  assert.equal(r.requestedBy, 'mark');
  assert.equal(r.plan.endDate, '2026-09-25');
});

test('every consumed token is reported so the UI can show what it did', () => {
  const r = parse('draft proposal next friday !urgent #client @mark');
  assert.deepEqual(r.tokens.map((t) => t.kind).sort(), ['date', 'priority', 'requestedBy', 'tag']);
  assert.ok(r.tokens.every((t) => t.raw && t.value));
});

test('empty and junk input never throw', () => {
  for (const input of ['', null, undefined, '   ', '#', '@', '!']) {
    const r = parseQuickAdd(input, { now: NOW });
    assert.equal(typeof r.title, 'string');
    assert.ok(Array.isArray(r.tags));
  }
});
