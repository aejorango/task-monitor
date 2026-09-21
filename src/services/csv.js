// src/services/csv.js — CSV reading and writing, as pure functions.
//
// Split out of the import screen so the parser can be tested directly: a broken
// CSV importer corrupts a person's activity log silently, and that is exactly
// the kind of code that must not live inside a component.

import { todayLocal } from './recurrence';
import { normalizeEstimate } from './effort';

/**
 * Minimal RFC-4180 parser. Handles quoted cells, escaped quotes ("") and
 * commas/newlines inside quotes. Returns rows as arrays of strings.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  let src = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // A UTF-8 BOM would otherwise become part of the first header name, which
  // silently breaks column matching on files exported from Excel.
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  // Drop trailing all-empty rows from a stray newline at EOF.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

/** Quote a single cell for output. */
export function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows (arrays) → CSV text. Round-trips through parseCsv. */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

/** Find a header column index by any candidate name (case-insensitive). */
export function findCol(headers, candidates) {
  const lower = (headers || []).map((h) => String(h).trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(String(c).toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Map the column layout produced by Export CSV, and close variants of it. */
export function buildColumnMap(headers) {
  return {
    project:     findCol(headers, ['Project']),
    phase:       findCol(headers, ['Phase']),
    task:        findCol(headers, ['Task', 'Task title', 'Task name']),
    comment:     findCol(headers, ['Activity details', 'Comment', 'Details', 'Description']),
    date:        findCol(headers, ['Date']),
    completion:  findCol(headers, ['Completion', 'Completion status', 'Status']),
    output:      findCol(headers, ['Output link', 'Output', 'Attachments', 'Links']),
    bottleneck:  findCol(headers, ['Bottlenecks', 'Bottleneck', 'Remarks', 'Notes']),
    requestedBy: findCol(headers, ['Requested by', 'RequestedBy', 'Requester']),
    hours:       findCol(headers, ['Hours', 'Hours spent', 'HoursSpent', 'Duration']),
  };
}

/** The columns a file must have before we can import anything from it. */
export const REQUIRED_COLUMNS = ['task', 'date'];

/**
 * Validate a parsed file. Returns { ok, headers, body, map, error } where
 * `error` is a sentence for the user — never an exception, never jargon.
 */
export function readActivityCsv(text) {
  const all = parseCsv(text);
  if (all.length === 0) {
    return { ok: false, error: 'That file is empty. Export a CSV from the Activity Log to see the expected columns.' };
  }
  const headers = all[0].map((h) => String(h).trim());
  const body = all.slice(1).filter((row) => row.some((c) => String(c).trim() !== ''));
  const map = buildColumnMap(headers);

  const missing = REQUIRED_COLUMNS.filter((k) => map[k] === -1);
  if (missing.length) {
    return {
      ok: false,
      headers,
      error: `This file needs a "Task" column and a "Date" column. `
           + `The columns we found are: ${headers.filter(Boolean).join(', ') || '(none)'}.`,
    };
  }
  if (body.length === 0) {
    return { ok: false, headers, error: 'That file has column headings but no rows underneath them.' };
  }
  return { ok: true, headers, body, map };
}

/** Normalize a completion-status cell into the four canonical values. */
export function normalizeCompletion(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return 'in-progress';
  if (/(complete|done|finish)/.test(s)) return 'completed';
  if (/(block|stuck|hold)/.test(s))     return 'blocked';
  if (/(not.start|todo|to.?do|pending)/.test(s)) return 'not-started';
  return 'in-progress';
}

/**
 * Normalize an "Output link" cell into an attachments array. Accepts
 * pipe-separated URLs (our own export format) or one per line.
 */
export function parseAttachments(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => ({
      name: u,
      url:  u,
      type: u.includes('drive.google') ? 'drive' : 'external',
    }));
}

/**
 * Normalize a date cell to YYYY-MM-DD, falling back to today.
 * Bare `new Date(s)` parses "2026-05-19" as UTC midnight, which in Asia/Manila
 * is still the 19th but in any negative-offset zone is the 18th — so ISO input
 * is taken verbatim and never round-tripped through Date.
 */
export function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return todayLocal();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return todayLocal();
}

/** Hours cell → a non-negative number. Accepts "3", "3.5", "3.5 hrs", "". */
export function normalizeHours(raw) {
  const n = Number(String(raw ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Resolve each parsed row against the user's real projects and tasks.
 *
 * Pure on purpose: this is where an import decides whether a row joins an
 * existing task or creates a new one, and getting that wrong duplicates a
 * person's whole activity log. The component renders the result; it does not
 * compute it.
 *
 * @param {{ body: string[][], map: object, projects: object[], tasks: object[] }} input
 * @returns {object[]} one preview row per input row
 */
export function buildImportPreview({ body = [], map = {}, projects = [], tasks = [] }) {
  const projectByName = new Map(
    projects.filter((p) => p?.name).map((p) => [p.name.toLowerCase(), p]),
  );

  return body.map((row, idx) => {
    const get = (col) => (col === undefined || col === -1 ? '' : String(row[col] ?? '').trim());

    const projectName = get(map.project);
    const phaseName   = get(map.phase);
    const taskTitle   = get(map.task);

    const project = projectName ? projectByName.get(projectName.toLowerCase()) || null : null;
    const phase = project && phaseName
      ? project.phases?.find((p) => p.name?.toLowerCase() === phaseName.toLowerCase()) || null
      : null;

    // Match by title, and only inside the named project when one was given —
    // two projects may legitimately both have a task called "Kick-off".
    const existingTask = taskTitle
      ? tasks.find((t) =>
          (t.title || '').toLowerCase() === taskTitle.toLowerCase()
          && (project ? t.projectId === project.id : true))
        || null
      : null;

    return {
      idx,
      valid: !!taskTitle,
      // Why a row was rejected, in words the person can act on.
      reason: taskTitle ? null : 'This row has no task name, so there is nothing to log it against.',
      projectName, project, phaseName, phase,
      taskTitle, existingTask,
      comment:     get(map.comment),
      date:        normalizeDate(get(map.date)),
      completion:  normalizeCompletion(get(map.completion)),
      attachments: parseAttachments(get(map.output)),
      bottleneck:  get(map.bottleneck),
      requestedBy: get(map.requestedBy),
      hours:       normalizeHours(get(map.hours)),
    };
  });
}

/** Key used to dedupe tasks created during a single import run. */
export function importTaskKey(row) {
  return `${(row.taskTitle || '').toLowerCase()}|${row.project?.id || ''}`;
}

/** A one-line summary of what an import will do, for the confirm step. */
export function summarizeImport(preview) {
  const valid = preview.filter((r) => r.valid);
  const newTasks = new Set(valid.filter((r) => !r.existingTask).map(importTaskKey));
  return {
    rows: preview.length,
    willImport: valid.length,
    willSkip: preview.length - valid.length,
    newTasks: newTasks.size,
    existingTasks: valid.filter((r) => r.existingTask).length,
    totalHours: valid.reduce((s, r) => s + r.hours, 0),
  };
}

/* ── Generalised import (T-0059 / NEW-006) ─────────────────────────────────
   The first importer only understood activities, and only with our own column
   names. This describes each importable kind as a list of fields, so one screen
   can import tasks, projects or activities — and so the person can map their
   own column names onto ours with a dropdown instead of renaming a
   spreadsheet. */

const STATUS_WORDS = {
  todo: ['todo', 'to do', 'to-do', 'not started', 'backlog', 'new', 'open', 'pending'],
  doing: ['doing', 'in progress', 'in-progress', 'started', 'ongoing', 'wip', 'active'],
  done: ['done', 'complete', 'completed', 'finished', 'closed'],
};
const PRIORITY_WORDS = {
  high: ['high', 'urgent', 'critical', 'p0', 'p1', '1'],
  medium: ['medium', 'med', 'normal', 'p2', '2'],
  low: ['low', 'minor', 'p3', '3'],
};

const matchWord = (raw, table, fallback) => {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return fallback;
  for (const [value, words] of Object.entries(table)) {
    if (words.some((w) => s === w || s.startsWith(w))) return value;
  }
  return fallback;
};

export const normalizeStatus = (raw) => matchWord(raw, STATUS_WORDS, 'todo');
export const normalizePriority = (raw) => matchWord(raw, PRIORITY_WORDS, 'medium');

/** Split a cell holding several values: "a, b; c" or one per line. */
export const splitList = (raw) => String(raw || '')
  .split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

/**
 * What each importable kind needs.
 *  key       — the field on the document
 *  label     — what the mapping dropdown calls it
 *  aliases   — header names we recognise without being told
 *  required  — the import cannot proceed without it
 *  parse     — cell → value
 */
export const IMPORT_KINDS = {
  tasks: {
    label: 'Tasks',
    describe: 'One row per task. Titles are required; everything else is optional.',
    fields: [
      { key: 'title', label: 'Task name', required: true, aliases: ['task', 'title', 'task title', 'task name', 'name', 'summary'], parse: (v) => String(v || '').trim() },
      { key: 'project', label: 'Project', aliases: ['project', 'project name'], parse: (v) => String(v || '').trim() },
      { key: 'phase', label: 'Phase', aliases: ['phase', 'stage', 'milestone'], parse: (v) => String(v || '').trim() },
      { key: 'description', label: 'Description', aliases: ['description', 'details', 'notes'], parse: (v) => String(v || '').trim() },
      { key: 'status', label: 'Status', aliases: ['status', 'state'], parse: normalizeStatus },
      { key: 'priority', label: 'Priority', aliases: ['priority', 'importance'], parse: normalizePriority },
      // Blank means "no date", not "today" — see the note on activities.date.
      { key: 'startDate', label: 'Start date', aliases: ['start', 'start date', 'planned start'], parse: (v) => (String(v || '').trim() ? normalizeDate(v) : '') },
      { key: 'endDate', label: 'Due date', aliases: ['due', 'due date', 'end', 'end date', 'deadline', 'target'], parse: (v) => (String(v || '').trim() ? normalizeDate(v) : '') },
      { key: 'tags', label: 'Tags', aliases: ['tags', 'labels'], parse: splitList },
      { key: 'requestedBy', label: 'Requested by', aliases: ['requested by', 'requester', 'owner', 'assignee', 'assigned to'], parse: (v) => String(v || '').trim() },
      // The Task table exports an Estimate column (T-0137), so the wizard has
      // to recognise it coming back — the app must be able to read its own
      // file. Blank stays blank: "not estimated" is not "estimated at zero".
      // Blank stays '' here, not null: a parsed record never holds null or
      // undefined (a row that did would write one). `importedTaskPayload` turns
      // '' into the null that means "nobody estimated this".
      { key: 'estimateHours', label: 'Estimate (hours)', aliases: ['estimate', 'estimate (hours)', 'estimated hours', 'estimated', 'est', 'est hours', 'budget hours'], parse: (v) => normalizeEstimate(v) ?? '' },
    ],
  },
  projects: {
    label: 'Projects',
    describe: 'One row per project. Names are required.',
    fields: [
      { key: 'name', label: 'Project name', required: true, aliases: ['project', 'name', 'project name', 'title'], parse: (v) => String(v || '').trim() },
      { key: 'description', label: 'Description', aliases: ['description', 'details', 'notes', 'summary'], parse: (v) => String(v || '').trim() },
      { key: 'segment', label: 'Segment', aliases: ['segment', 'group', 'portfolio', 'category'], parse: (v) => String(v || '').trim() },
      { key: 'phases', label: 'Phases', aliases: ['phases', 'stages', 'milestones'], parse: splitList },
    ],
  },
  activities: {
    label: 'Activity log',
    describe: 'One row per logged entry. A task name and a date are required.',
    fields: [
      { key: 'task', label: 'Task', required: true, aliases: ['task', 'task title', 'task name'], parse: (v) => String(v || '').trim() },
      // Deliberately NOT normalizeDate: that falls back to today, which for a
      // single row is helpful and for a 500-row import would silently date
      // everything today. A blank date here is a row the person must fix.
      { key: 'date', label: 'Date', required: true, aliases: ['date', 'logged', 'day'], parse: (v) => (String(v || '').trim() ? normalizeDate(v) : '') },
      { key: 'project', label: 'Project', aliases: ['project'], parse: (v) => String(v || '').trim() },
      { key: 'phase', label: 'Phase', aliases: ['phase'], parse: (v) => String(v || '').trim() },
      { key: 'comment', label: 'What was done', aliases: ['what was done', 'activity details', 'comment', 'details', 'description', 'work'], parse: (v) => String(v || '').trim() },
      { key: 'hours', label: 'Hours', aliases: ['hours', 'hours spent', 'duration', 'time'], parse: normalizeHours },
      { key: 'completion', label: 'Completion', aliases: ['completion', 'completion status', 'status'], parse: normalizeCompletion },
      { key: 'output', label: 'Output links', aliases: ['output link', 'output', 'attachments', 'links'], parse: parseAttachments },
      { key: 'bottleneck', label: 'Blockers', aliases: ['bottlenecks', 'bottleneck', 'remarks', 'blockers'], parse: (v) => String(v || '').trim() },
      { key: 'requestedBy', label: 'Requested by', aliases: ['requested by', 'requester'], parse: (v) => String(v || '').trim() },
    ],
  },
};

/**
 * Guess which column is which, from the header row. The user can override every
 * one of these in the mapping step — this only saves them the common case.
 * @returns {Record<string, number>} field key → column index (-1 = unmapped)
 */
export function guessMapping(headers, kind) {
  const spec = IMPORT_KINDS[kind];
  if (!spec) return {};
  const lower = (headers || []).map((h) => String(h).trim().toLowerCase());
  const taken = new Set();
  const mapping = {};

  for (const field of spec.fields) {
    let idx = -1;
    // Exact alias first, so "Status" does not get grabbed by a fuzzy match.
    for (const alias of field.aliases) {
      const i = lower.indexOf(alias);
      if (i !== -1 && !taken.has(i)) { idx = i; break; }
    }
    if (idx === -1) {
      for (const alias of field.aliases) {
        const i = lower.findIndex((h, j) => !taken.has(j) && h.includes(alias));
        if (i !== -1) { idx = i; break; }
      }
    }
    if (idx !== -1) taken.add(idx);
    mapping[field.key] = idx;
  }
  return mapping;
}

/** Which required fields are still unmapped, by label. */
export function missingRequired(mapping, kind) {
  const spec = IMPORT_KINDS[kind];
  if (!spec) return [];
  return spec.fields
    .filter((f) => f.required && (mapping[f.key] === undefined || mapping[f.key] === -1))
    .map((f) => f.label);
}

/**
 * Body rows → parsed records, with a per-row reason when one cannot be used.
 * Nothing is written: this is the dry run the wizard previews.
 */
export function parseImportRows(body, mapping, kind) {
  const spec = IMPORT_KINDS[kind];
  if (!spec) return [];

  return (body || []).map((row, idx) => {
    const record = {};
    for (const field of spec.fields) {
      const col = mapping[field.key];
      record[field.key] = field.parse(col === undefined || col === -1 ? '' : row[col]);
    }

    const missing = spec.fields
      .filter((f) => f.required && !String(record[f.key] ?? '').trim())
      .map((f) => f.label);

    return {
      idx,
      line: idx + 2,                    // +1 header, +1 for 1-based counting
      record,
      valid: missing.length === 0,
      reason: missing.length ? `Missing ${missing.join(' and ')}.` : null,
    };
  });
}

/** What the confirm step says will happen. */
export function summarizeImportRows(rows) {
  const valid = rows.filter((r) => r.valid);
  return {
    total: rows.length,
    willImport: valid.length,
    willSkip: rows.length - valid.length,
    reasons: [...new Set(rows.filter((r) => !r.valid).map((r) => r.reason))],
  };
}

/** Firestore takes 500 writes per batch; 400 leaves room for counter updates. */
export const IMPORT_BATCH_SIZE = 400;

export function chunkForImport(rows, size = IMPORT_BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * The task document an imported row becomes, shaped for addTask().
 *
 * Every field the mapping step offers has to arrive here, because the preview
 * shows the user what it read — and what the preview promises, the import owes.
 * Status is the one that was missing (BUG-015): the wizard mapped it, guessed
 * it from a "Status" heading, showed it in the preview, and then dropped it, so
 * rows the file said were Done landed in To Do. addTask derives progress and
 * the actual dates from the status it is given.
 *
 * Pure: the caller has already resolved the project and the phase.
 */
export function importedTaskPayload(record, { workspaceId, project, phase } = {}) {
  return {
    workspaceId,
    title: record.title,
    description: record.description,
    projectId: project?.id || null,
    phaseId: phase?.id || null,
    priority: record.priority,
    status: record.status,
    tags: record.tags,
    requestedBy: record.requestedBy,
    estimateHours: normalizeEstimate(record.estimateHours),
    plan: { startDate: record.startDate || null, endDate: record.endDate || null },
  };
}
