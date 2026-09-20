// Tests for the CSV import/export layer (T-0009 / IMP-005).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildColumnMap, csvCell, findCol, normalizeCompletion, normalizeDate,
  normalizeHours, parseAttachments, parseCsv, readActivityCsv, toCsv,
} from './csv.js';
import { todayLocal } from './recurrence.js';

test('plain rows parse', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('quoted cells keep their commas and newlines', () => {
  assert.deepEqual(
    parseCsv('name,note\n"Doe, John","line one\nline two"'),
    [['name', 'note'], ['Doe, John', 'line one\nline two']],
  );
});

test('doubled quotes become one quote', () => {
  assert.deepEqual(parseCsv('a\n"He said ""hi"""'), [['a'], ['He said "hi"']]);
});

test('CRLF and a trailing newline do not produce phantom rows', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1,2\n\n\n'), [['a', 'b'], ['1', '2']]);
});

test('an Excel BOM does not corrupt the first heading', () => {
  const rows = parseCsv('﻿Task,Date\nWrite,2026-09-20');
  assert.equal(rows[0][0], 'Task', 'a BOM here silently breaks column matching');
});

test('empty cells survive as empty strings, not as dropped columns', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
});

test('parseCsv and toCsv round-trip, quoting only what needs it', () => {
  const rows = [['Task', 'Note'], ['Ship', 'Doe, John said "go"'], ['Wait', 'line\nbreak']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
});

test('findCol is case- and whitespace-insensitive and honours candidate order', () => {
  const headers = ['  Project ', 'Task title', 'DATE'];
  assert.equal(findCol(headers, ['project']), 0);
  assert.equal(findCol(headers, ['Task', 'Task title']), 1);
  assert.equal(findCol(headers, ['Date']), 2);
  assert.equal(findCol(headers, ['Nope']), -1);
});

test('buildColumnMap recognises our own export headings', () => {
  const map = buildColumnMap([
    'Project', 'Phase', 'Task', 'Activity details', 'Date',
    'Completion', 'Output link', 'Bottlenecks', 'Requested by', 'Hours',
  ]);
  assert.deepEqual(map, {
    project: 0, phase: 1, task: 2, comment: 3, date: 4,
    completion: 5, output: 6, bottleneck: 7, requestedBy: 8, hours: 9,
  });
});

test('readActivityCsv accepts a good file', () => {
  const out = readActivityCsv('Task,Date,Hours\nWrite report,2026-09-20,2');
  assert.equal(out.ok, true);
  assert.deepEqual(out.headers, ['Task', 'Date', 'Hours']);
  assert.equal(out.body.length, 1);
  assert.equal(out.map.task, 0);
});

test('readActivityCsv explains a bad file in plain language', () => {
  const empty = readActivityCsv('');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /empty/i);

  const wrong = readActivityCsv('Name,Amount\nx,1');
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /"Task" column and a "Date" column/);
  assert.match(wrong.error, /Name, Amount/, 'tell them what was actually found');
  assert.doesNotMatch(wrong.error, /undefined|-1|null/);

  const headersOnly = readActivityCsv('Task,Date');
  assert.equal(headersOnly.ok, false);
  assert.match(headersOnly.error, /no rows/i);
});

test('readActivityCsv drops blank rows rather than importing empty activities', () => {
  const out = readActivityCsv('Task,Date\nWrite,2026-09-20\n,\nShip,2026-09-21');
  assert.equal(out.body.length, 2);
});

test('completion status maps every wording we export or a human types', () => {
  assert.equal(normalizeCompletion('Completed'), 'completed');
  assert.equal(normalizeCompletion('done'), 'completed');
  assert.equal(normalizeCompletion('FINISHED'), 'completed');
  assert.equal(normalizeCompletion('Blocked'), 'blocked');
  assert.equal(normalizeCompletion('on hold'), 'blocked');
  assert.equal(normalizeCompletion('Not started'), 'not-started');
  assert.equal(normalizeCompletion('to-do'), 'not-started');
  assert.equal(normalizeCompletion('pending'), 'not-started');
  assert.equal(normalizeCompletion(''), 'in-progress');
  assert.equal(normalizeCompletion('anything else'), 'in-progress');
});

test('attachments split on pipes and newlines and tag Drive links', () => {
  const out = parseAttachments('https://drive.google.com/x | https://example.com/y');
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'drive');
  assert.equal(out[1].type, 'external');
  assert.equal(out[1].url, 'https://example.com/y');
  assert.deepEqual(parseAttachments(''), []);
  assert.deepEqual(parseAttachments('  |  '), []);
});

test('an ISO date is taken verbatim, never shifted by a timezone', () => {
  assert.equal(normalizeDate('2026-05-19'), '2026-05-19');
  assert.equal(normalizeDate('2026-05-19T15:00:00Z'), '2026-05-19');
});

test('other date spellings are normalised, and nonsense falls back to today', () => {
  assert.equal(normalizeDate('5/19/2026'), '2026-05-19');
  assert.equal(normalizeDate(''), todayLocal());
  assert.equal(normalizeDate('not a date'), todayLocal());
});

test('hours accept decimals and units, and never go negative', () => {
  assert.equal(normalizeHours('3'), 3);
  assert.equal(normalizeHours('3.5'), 3.5);
  assert.equal(normalizeHours('3.5 hrs'), 3.5);
  assert.equal(normalizeHours(''), 0);
  assert.equal(normalizeHours('abc'), 0);
  assert.equal(normalizeHours('-2'), 0);
});
