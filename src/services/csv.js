// src/services/csv.js — CSV reading and writing, as pure functions.
//
// Split out of CsvImporter.jsx so the parser can be tested directly: a broken
// CSV importer corrupts a person's activity log silently, and that is exactly
// the kind of code that must not live inside a component.

import { todayLocal } from './recurrence';

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
