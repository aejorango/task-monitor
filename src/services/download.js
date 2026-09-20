// src/services/download.js — the one way this app hands a file to the user.
//
// Two rules live here, and nowhere else:
//
//  1. Every deliverable is date-stamped: <name>-YYYY-MM-DD.<ext>.
//  2. That date is the user's OWN day. `new Date().toISOString()` is UTC, so in
//     Asia/Manila every export made before 08:00 was stamped with yesterday —
//     which is exactly the kind of thing nobody notices until a report is filed
//     against the wrong day.

import { todayLocal } from './recurrence';

/** Strip anything that has no business in a filename, and collapse runs. */
export function safeFileName(name, fallback = 'export') {
  const cleaned = String(name ?? '')
    .replace(/[^\w.-]+/g, '-')     // spaces, slashes, punctuation → dash
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * `<base>-YYYY-MM-DD.<ext>` in the user's local day.
 * @param {string} base  e.g. "task-monitor-activities" or a project name
 * @param {string} ext   without the dot, e.g. "csv"
 * @param {string} [day] override the date (tests)
 */
export function stampedName(base, ext, day = todayLocal()) {
  const cleanExt = String(ext || '').replace(/^\./, '').toLowerCase() || 'txt';
  return `${safeFileName(base)}-${day}.${cleanExt}`;
}

const MIME = {
  csv:  'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  md:   'text/markdown;charset=utf-8',
  txt:  'text/plain;charset=utf-8',
  html: 'text/html;charset=utf-8',
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function mimeFor(ext) {
  return MIME[String(ext || '').replace(/^\./, '').toLowerCase()] || 'application/octet-stream';
}

/**
 * Save `content` as `<base>-<today>.<ext>`.
 *
 * @param {string} base            filename without date or extension
 * @param {string} ext             "csv" | "json" | "md" | "pdf" | …
 * @param {string|Blob|ArrayBuffer|Uint8Array} content
 * @returns {string} the filename that was used (so callers can report it)
 */
export function downloadFile(base, ext, content) {
  const filename = stampedName(base, ext);
  const blob = content instanceof Blob
    ? content
    : new Blob([content], { type: mimeFor(ext) });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the click to have been handed to the download manager.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
