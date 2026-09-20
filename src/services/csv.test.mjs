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

// ─── import preview (T-0010) ────────────────────────────────────────────────

import { buildImportPreview, importTaskKey, summarizeImport } from './csv.js';

const PROJECTS = [
  { id: 'p1', name: 'SBLAF rollout', workspaceId: 'ws1', phases: [{ id: 'ph1', name: 'Discovery' }] },
  { id: 'p2', name: 'Website revamp', workspaceId: 'ws1', phases: [] },
];
const TASKS = [
  { id: 't1', title: 'Kick-off', projectId: 'p1' },
  { id: 't2', title: 'Kick-off', projectId: 'p2' },
];

const previewOf = (csv) => {
  const read = readActivityCsv(csv);
  assert.equal(read.ok, true, read.error);
  return buildImportPreview({ body: read.body, map: read.map, projects: PROJECTS, tasks: TASKS });
};

test('a row matches the project and phase named in the file', () => {
  const [row] = previewOf('Project,Phase,Task,Date\nSBLAF rollout,Discovery,Kick-off,2026-09-20');
  assert.equal(row.project.id, 'p1');
  assert.equal(row.phase.id, 'ph1');
  assert.equal(row.valid, true);
});

test('project and phase matching ignores case', () => {
  const [row] = previewOf('Project,Phase,Task,Date\nsblaf ROLLOUT,discovery,Kick-off,2026-09-20');
  assert.equal(row.project.id, 'p1');
  assert.equal(row.phase.id, 'ph1');
});

test('the same task title in two projects resolves to the right one', () => {
  const [a] = previewOf('Project,Task,Date\nSBLAF rollout,Kick-off,2026-09-20');
  const [b] = previewOf('Project,Task,Date\nWebsite revamp,Kick-off,2026-09-20');
  assert.equal(a.existingTask.id, 't1');
  assert.equal(b.existingTask.id, 't2');
});

test('an unknown task will be created, not silently attached to a similar one', () => {
  const [row] = previewOf('Project,Task,Date\nSBLAF rollout,Brand new task,2026-09-20');
  assert.equal(row.existingTask, null);
  assert.equal(row.valid, true);
});

test('an unknown project leaves the row unassigned rather than guessing', () => {
  const [row] = previewOf('Project,Task,Date\nNot a project,Kick-off,2026-09-20');
  assert.equal(row.project, null);
  assert.equal(row.projectName, 'Not a project');
});

test('a row with no task name is rejected with a reason a person can act on', () => {
  const rows = previewOf('Project,Task,Date\nSBLAF rollout,,2026-09-20\nSBLAF rollout,Kick-off,2026-09-20');
  assert.equal(rows[0].valid, false);
  assert.match(rows[0].reason, /no task name/i);
  assert.equal(rows[1].valid, true);
});

test('cell values are normalised on the way into the preview', () => {
  const [row] = previewOf(
    'Project,Task,Date,Hours,Completion,Output link,Bottlenecks,Requested by\n'
    + 'SBLAF rollout,Kick-off,5/19/2026,2.5 hrs,Done,https://drive.google.com/x|https://e.com/y,Waiting on legal, Ace ',
  );
  assert.equal(row.date, '2026-05-19');
  assert.equal(row.hours, 2.5);
  assert.equal(row.completion, 'completed');
  assert.equal(row.attachments.length, 2);
  assert.equal(row.bottleneck, 'Waiting on legal');
  assert.equal(row.requestedBy, 'Ace');
});

test('rows for the same new task share one key, so it is created once', () => {
  const rows = previewOf(
    'Project,Task,Date\nSBLAF rollout,Brand new,2026-09-20\nSBLAF rollout,brand NEW,2026-09-21',
  );
  assert.equal(importTaskKey(rows[0]), importTaskKey(rows[1]));
});

test('the same title in different projects does NOT share a key', () => {
  const rows = previewOf(
    'Project,Task,Date\nSBLAF rollout,Brand new,2026-09-20\nWebsite revamp,Brand new,2026-09-21',
  );
  assert.notEqual(importTaskKey(rows[0]), importTaskKey(rows[1]));
});

test('the summary says exactly what the import will do', () => {
  const rows = previewOf(
    'Project,Task,Date,Hours\n'
    + 'SBLAF rollout,Kick-off,2026-09-20,2\n'
    + 'SBLAF rollout,Brand new,2026-09-20,1.5\n'
    + 'SBLAF rollout,,2026-09-20,9',
  );
  assert.deepEqual(summarizeImport(rows), {
    rows: 3, willImport: 2, willSkip: 1,
    newTasks: 1, existingTasks: 1, totalHours: 3.5,
  });
});

test('an empty preview summarises to zeroes rather than NaN', () => {
  assert.deepEqual(summarizeImport([]), {
    rows: 0, willImport: 0, willSkip: 0, newTasks: 0, existingTasks: 0, totalHours: 0,
  });
});

// ─── Generalised import (T-0059 / NEW-006) ──────────────────────────────────

import {
  IMPORT_BATCH_SIZE, IMPORT_KINDS, chunkForImport, guessMapping, missingRequired,
  normalizePriority, normalizeStatus, parseImportRows, splitList,
  summarizeImportRows,
} from './csv.js';

test('every importable kind describes itself in plain words', () => {
  for (const [key, spec] of Object.entries(IMPORT_KINDS)) {
    assert.ok(spec.label, key);
    assert.match(spec.describe, /^[A-Z].*\.$/, key);
    assert.ok(spec.fields.length >= 3, key);
    for (const f of spec.fields) {
      assert.ok(f.key && f.label && typeof f.parse === 'function', `${key}.${f.key}`);
      assert.ok(f.aliases.length, `${key}.${f.key} has no aliases to guess from`);
      assert.doesNotMatch(f.label, /^[a-z]/, `${key}.${f.key} label reads like a field name`);
    }
  }
});

test('status and priority understand how people actually write them', () => {
  for (const [raw, expected] of [
    ['To Do', 'todo'], ['Not started', 'todo'], ['Backlog', 'todo'],
    ['In Progress', 'doing'], ['WIP', 'doing'], ['Active', 'doing'],
    ['Complete', 'done'], ['Finished', 'done'], ['Closed', 'done'],
    ['', 'todo'], ['something else', 'todo'],
  ]) assert.equal(normalizeStatus(raw), expected, raw);

  for (const [raw, expected] of [
    ['High', 'high'], ['URGENT', 'high'], ['P1', 'high'],
    ['Normal', 'medium'], ['', 'medium'],
    ['Low', 'low'], ['Minor', 'low'],
  ]) assert.equal(normalizePriority(raw), expected, raw);
});

test('a multi-value cell splits however it was written', () => {
  assert.deepEqual(splitList('a, b; c\nd'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitList(''), []);
});

test('our own export headers are recognised without any mapping', () => {
  const headers = ['Project', 'Phase', 'Task', 'Activity details', 'Date', 'Completion', 'Output link', 'Bottlenecks', 'Requested by', 'Hours'];
  const mapping = guessMapping(headers, 'activities');
  assert.equal(mapping.task, 2);
  assert.equal(mapping.date, 4);
  assert.equal(mapping.hours, 9);
  assert.deepEqual(missingRequired(mapping, 'activities'), []);
});

test('somebody else’s headers are guessed too', () => {
  const mapping = guessMapping(['Summary', 'Deadline', 'Importance', 'State'], 'tasks');
  assert.equal(mapping.title, 0);
  assert.equal(mapping.endDate, 1);
  assert.equal(mapping.priority, 2);
  assert.equal(mapping.status, 3);
});

test('one column is never claimed by two fields', () => {
  const mapping = guessMapping(['Project', 'Project name'], 'projects');
  const used = Object.values(mapping).filter((i) => i !== -1);
  assert.equal(new Set(used).size, used.length);
});

test('an unrecognised header is left unmapped for the user to set', () => {
  const mapping = guessMapping(['Widget', 'Sprocket'], 'tasks');
  assert.equal(mapping.title, -1);
  assert.deepEqual(missingRequired(mapping, 'tasks'), ['Task name']);
});

test('rows are parsed into records, with the values normalised', () => {
  const rows = parseImportRows(
    [['Ship the thing', 'SBLAF rollout', 'In Progress', 'Urgent', '5/19/2026', 'a, b']],
    guessMapping(['Task', 'Project', 'Status', 'Priority', 'Due', 'Tags'], 'tasks'),
    'tasks',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valid, true);
  assert.equal(rows[0].record.title, 'Ship the thing');
  assert.equal(rows[0].record.status, 'doing');
  assert.equal(rows[0].record.priority, 'high');
  assert.equal(rows[0].record.endDate, '2026-05-19');
  assert.deepEqual(rows[0].record.tags, ['a', 'b']);
});

test('a row missing something required says which line and which field', () => {
  const rows = parseImportRows(
    [['Has a name'], ['']],
    guessMapping(['Task'], 'tasks'),
    'tasks',
  );
  assert.equal(rows[0].valid, true);
  assert.equal(rows[1].valid, false);
  assert.equal(rows[1].line, 3, 'the spreadsheet line, not the array index');
  assert.match(rows[1].reason, /Missing Task name/);
});

test('two missing fields read as a sentence, not a list of keys', () => {
  const rows = parseImportRows([['', '']], guessMapping(['Task', 'Date'], 'activities'), 'activities');
  assert.match(rows[0].reason, /Missing Task and Date\./);
});

test('unmapped optional columns produce empty values, never undefined', () => {
  const rows = parseImportRows([['Just a title']], { title: 0 }, 'tasks');
  const r = rows[0].record;
  assert.equal(rows[0].valid, true);
  for (const [k, v] of Object.entries(r)) {
    assert.notEqual(v, undefined, k);
    assert.notEqual(v, null, k);
  }
  assert.deepEqual(r.tags, []);
});

test('the summary says exactly what will happen, and why rows are skipped', () => {
  const rows = parseImportRows([['A'], [''], ['']], { title: 0 }, 'tasks');
  const s = summarizeImportRows(rows);
  assert.equal(s.total, 3);
  assert.equal(s.willImport, 1);
  assert.equal(s.willSkip, 2);
  assert.deepEqual(s.reasons, ['Missing Task name.'], 'one reason, not two copies of it');
});

test('writes are batched under the Firestore limit', () => {
  assert.ok(IMPORT_BATCH_SIZE <= 450, 'Firestore allows 500 per batch and counters use some');
  const chunks = chunkForImport(Array.from({ length: 1000 }, (_, i) => i));
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= IMPORT_BATCH_SIZE));
  assert.equal(chunks.flat().length, 1000, 'nothing is dropped between batches');
  assert.deepEqual(chunkForImport([]), []);
});

test('a bulk import never invents a date for a blank cell', () => {
  // normalizeDate falls back to today, which is right for one row and wrong
  // for five hundred — it would silently date a whole history as "today".
  const rows = parseImportRows([['A task', '']], guessMapping(['Task', 'Due'], 'tasks'), 'tasks');
  assert.equal(rows[0].record.endDate, '');
  assert.equal(rows[0].valid, true, 'a task without a due date is still a task');

  const acts = parseImportRows([['A task', '']], guessMapping(['Task', 'Date'], 'activities'), 'activities');
  assert.equal(acts[0].valid, false, 'an activity with no date is not usable');
  assert.match(acts[0].reason, /Missing Date/);
});
