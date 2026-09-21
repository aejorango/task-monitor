// T-0092 / BUG-015 — the Status column the wizard promised is the Status the
// task gets.
//
//   1. Given a CSV whose Status column reads "Done" for one row
//   2. When that column is mapped and the import runs
//   3. Then the created task has status done, progress 100 and an actual end
//      date, and the summary counts it as imported
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  IMPORT_KINDS, importedTaskPayload, parseImportRows, summarizeImportRows,
  guessMapping, parseCsv, normalizeStatus,
} from '../../src/services/csv.js';
import { statusStamps, normalizeTaskStatus, clampProgress } from '../../src/services/taskStatus.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const firebase = read('src', 'services', 'firebase.js');
const wizard = read('src', 'components', 'ImportWizard.jsx');

const TODAY = '2026-09-21';

const CSV = [
  'Task name,Project,Status,Priority,Due date',
  'Ship the pilot,Bridged,Done,High,2026-09-18',
  'Draft the brief,Bridged,In progress,Medium,2026-09-25',
  'Book the venue,Bridged,,Low,2026-09-30',
].join('\n');

// ─── the whole path, from the file to the payload ───────────────────────────

test('a "Done" cell survives the header guess, the parse and the payload', () => {
  const [headers, ...body] = parseCsv(CSV);
  const mapping = guessMapping(headers, 'tasks');
  assert.equal(headers[mapping.status], 'Status', 'the Status heading is recognised without being told');

  const parsed = parseImportRows(body, mapping, 'tasks');
  assert.equal(parsed[0].record.status, 'done');
  assert.equal(parsed[1].record.status, 'doing', '"In progress" is a status, not a new one');
  assert.equal(parsed[2].record.status, 'todo', 'a blank cell falls back rather than failing the row');

  const payload = importedTaskPayload(parsed[0].record, { workspaceId: 'ws1', project: { id: 'p1' } });
  assert.equal(payload.status, 'done', 'this is the field the import used to drop');
});

test('the summary counts the Done row as importable, not as an error', () => {
  const [headers, ...body] = parseCsv(CSV);
  const parsed = parseImportRows(body, guessMapping(headers, 'tasks'), 'tasks');
  const summary = summarizeImportRows(parsed);
  assert.equal(summary.willImport, 3, 'the acceptance criterion: the Done row is counted as imported');
  assert.equal(summary.willSkip, 0);
  assert.deepEqual(summary.reasons, []);
});

// ─── what the created task ends up carrying ─────────────────────────────────

test('a task imported as Done has full progress and both actual dates', () => {
  const stamps = statusStamps(normalizeTaskStatus('done'), { today: TODAY });
  assert.equal(stamps.progress, 100);
  assert.equal(stamps.actualEndDate, TODAY, 'the acceptance criterion');
  assert.ok(stamps.actualStartDate, 'something finished must have started');
});

test('a task imported as In progress is started but not finished', () => {
  const stamps = statusStamps(normalizeTaskStatus('doing'), { today: TODAY });
  assert.equal(stamps.progress, 0);
  assert.equal(stamps.actualStartDate, TODAY);
  assert.equal(stamps.actualEndDate, null);
});

test('a task imported with no status is plain To Do, as before', () => {
  assert.deepEqual(statusStamps(normalizeTaskStatus(undefined), { today: TODAY }), {
    progress: 0, actualStartDate: null, actualEndDate: null,
  });
});

test('a status the file invented does not become one', () => {
  assert.equal(normalizeStatus('shipped to production'), 'todo');
  assert.equal(normalizeTaskStatus('shipped'), 'todo');
});

// ─── no field the wizard offers may be dropped again ────────────────────────

test('every field the mapping step offers reaches the payload', () => {
  // Which payload path each offered field lands on. A field added to
  // IMPORT_KINDS without a line here fails this test — which is exactly how
  // Status came to be mapped, previewed and then thrown away.
  const LANDS_ON = {
    title: 'title',
    project: 'projectId',
    phase: 'phaseId',
    description: 'description',
    status: 'status',
    priority: 'priority',
    startDate: 'plan.startDate',
    endDate: 'plan.endDate',
    tags: 'tags',
    requestedBy: 'requestedBy',
    estimateHours: 'estimateHours',
  };

  const offered = IMPORT_KINDS.tasks.fields.map((f) => f.key);
  assert.deepEqual(offered.slice().sort(), Object.keys(LANDS_ON).sort(),
    'a new importable field needs a line in LANDS_ON and a line in importedTaskPayload');

  const record = {
    title: 'Ship the pilot', project: 'Bridged', phase: 'Delivery',
    description: 'The first one', status: 'done', priority: 'high',
    startDate: '2026-09-14', endDate: '2026-09-18',
    tags: ['pilot', 'q3'], requestedBy: 'Ace', estimateHours: 8,
  };
  const payload = importedTaskPayload(record, {
    workspaceId: 'ws1', project: { id: 'p1' }, phase: { id: 'ph1' },
  });
  const at = (p) => p.split('.').reduce((o, k) => o?.[k], payload);

  for (const [field, dest] of Object.entries(LANDS_ON)) {
    assert.notEqual(at(dest), undefined, `${field} must reach ${dest}`);
  }
  assert.equal(payload.projectId, 'p1');
  assert.equal(payload.phaseId, 'ph1');
  assert.equal(payload.plan.endDate, '2026-09-18');
  assert.deepEqual(payload.tags, ['pilot', 'q3']);
  assert.equal(payload.workspaceId, 'ws1', 'without this the task never shows on the Board');
  assert.equal(payload.estimateHours, 8);
});

// The round-trip rule: a column the app EXPORTS must be an alias the wizard
// RECOGNISES, or the app cannot read its own file back (T-0137).
test('the Estimate column the task table exports is one the wizard takes back', () => {
  const field = IMPORT_KINDS.tasks.fields.find((f) => f.key === 'estimateHours');
  assert.ok(field, 'the export has a column the import does not know');
  for (const heading of ['Estimate', 'estimate (hours)', 'Estimated hours', 'est']) {
    assert.ok(field.aliases.includes(heading.toLowerCase()),
      `the wizard should recognise a column headed "${heading}"`);
  }
});

test('a blank estimate imports as "not estimated", not as zero hours', () => {
  const payload = importedTaskPayload(
    { title: 'No idea how long', estimateHours: '' }, { workspaceId: 'ws1' });
  assert.equal(payload.estimateHours, null, 'zero would claim somebody estimated it at nothing');

  const zero = importedTaskPayload(
    { title: 'Trivial', estimateHours: 0 }, { workspaceId: 'ws1' });
  assert.equal(zero.estimateHours, 0, 'but an explicit zero in the file is a statement');
});

test('a row with no project or phase still builds a payload', () => {
  const payload = importedTaskPayload({ title: 'Loose end', status: 'todo' }, { workspaceId: 'ws1' });
  assert.equal(payload.projectId, null);
  assert.equal(payload.phaseId, null);
  assert.deepEqual(payload.plan, { startDate: null, endDate: null });
});

// ─── and the app really does it this way ────────────────────────────────────

test('addTask takes a status instead of hardcoding one', () => {
  assert.doesNotMatch(firebase, /\n {4}status: 'todo',\n {4}progress: 0,/,
    'the hardcoded pair is what made every imported task To Do');
  assert.match(firebase, /const status = normalizeTaskStatus\(task\.status\);/);
  assert.match(firebase, /const progress = statedProgress === null \? stamps\.progress : statedProgress;/);
  assert.match(firebase, /startDate: task\.actual\?\.startDate \?\? stamps\.actualStartDate,/,
    'since T-0110 an explicitly stated date wins and the stamps fill the gap');
});

test('every create path still defaults to To Do when nothing is supplied', () => {
  assert.equal(normalizeTaskStatus(undefined), 'todo',
    'quick-add and the recurrence spawn pass no status and must not change');
});

test('setTaskStatus and addTask derive the stamps from the same rule', () => {
  const uses = firebase.match(/statusStamps\(/g) || [];
  assert.ok(uses.length >= 2, 'both paths go through the pure module');
  assert.doesNotMatch(firebase, /updates\['actual\.endDate'\] = todayLocal\(\);/,
    'the inline copy in setTaskStatus is gone');
});

test('the wizard builds its payload beside the field list, not by hand', () => {
  assert.match(wizard, /importedTaskPayload\(record, \{ workspaceId, project, phase \}\)/);
  assert.match(wizard, /importedTaskPayload,/, 'imported from services/csv');
});

// ─── T-0110 / BUG-026: addTask stops overwriting what it was handed ─────────

test('addTask honours a stated status, progress and actual dates', () => {
  const body = firebase.slice(
    firebase.indexOf('export async function addTask('),
    firebase.indexOf('export async function updateTask('),
  );
  assert.match(body, /const statedProgress = clampProgress\(task\.progress\);/);
  assert.match(body, /const progress = statedProgress === null \? stamps\.progress : statedProgress;/,
    'an explicit 0 must not be mistaken for "no statement"');
  assert.match(body, /startDate: task\.actual\?\.startDate \?\? stamps\.actualStartDate,/);
  assert.match(body, /endDate:   task\.actual\?\.endDate   \?\? stamps\.actualEndDate,/);
  assert.doesNotMatch(body, /progress: 0,/, 'the hardcoded pair is gone');
  assert.doesNotMatch(body, /startDate: null,\n      endDate:   null,/,
    'the hardcoded empty actual dates are gone');
});

test('the acceptance path: created as done, with full progress and an end date', () => {
  // The three values addTask would write for { status: 'done' } and no more.
  const status = normalizeTaskStatus('done');
  const stamps = statusStamps(status, { today: TODAY });
  const progress = stamps.progress;
  assert.equal(status, 'done');
  assert.equal(progress, 100);
  assert.equal(stamps.actualEndDate, TODAY);
});

test('and a create with no status is still a fresh todo task', () => {
  const status = normalizeTaskStatus(undefined);
  const stamps = statusStamps(status, { today: TODAY });
  assert.equal(status, 'todo');
  assert.equal(stamps.progress, 0);
  assert.equal(stamps.actualStartDate, null);
  assert.equal(stamps.actualEndDate, null);
});

test('an unknown status is coerced, not stored', () => {
  assert.equal(normalizeTaskStatus('archived'), 'todo');
  assert.equal(normalizeTaskStatus('DONE'), 'todo', 'the caller normalises case; the store does not guess');
  assert.equal(normalizeTaskStatus(42), 'todo');
  assert.equal(normalizeTaskStatus({}), 'todo');
});

test('a task created as doing keeps the progress it was given', () => {
  const stamps = statusStamps('doing', { today: TODAY, current: { progress: 60 } });
  assert.equal(stamps.progress, 60);
  assert.equal(stamps.actualStartDate, TODAY, 'something in progress has started');
});
