// src/services/dueAlerts.js — pure decision logic for the in-app due-task
// alert. Deliberately free of firebase.js and import.meta.env imports so it
// runs under `node --test` (see dueAlerts.test.mjs).
//
// A task "alerts" when it is not done, has a plan end date, and that date is
// on or before today + leadDays. The modal shows one task at a time in queue
// order; snooze and skip are per-device localStorage state (tasks are shared
// across workspace members, so one person's snooze must never silence a
// teammate — never persist this on the task document).

export const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

export const SNOOZE_PRESETS_MIN = [5, 15, 30, 60, 120];

export const DEFAULT_DUE_ALERT_SETTINGS = {
  enabled: true,
  leadDays: 0,          // 0 = due today or overdue; 1 = also tomorrow; ...
  defaultSnoozeMin: 15,
  quietFrom: '',        // 'HH:MM' local; '' = no quiet hours
  quietTo: '',
};

/* ── date helpers (YYYY-MM-DD strings, local calendar) ─────────────────── */

export function parseISODate(s) {
  if (!s || typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(s, n) {
  const d = parseISODate(s);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Whole days between two ISO dates (b - a). Positive when b is later.
export function daysBetween(a, b) {
  const da = parseISODate(a), db = parseISODate(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86_400_000);
}

/* ── eligibility ───────────────────────────────────────────────────────── */

export function isDueForAlert(task, { today, leadDays = 0 } = {}) {
  if (!task || !today) return false;
  if (task.status === 'done') return false;
  if (task.deleted || task.archived) return false;
  const due = task.plan?.endDate;
  if (!due) return false;
  const horizon = addDaysISO(today, Math.max(0, Number(leadDays) || 0));
  return due <= horizon;
}

// Stable key for "skip this alert for the rest of today". Includes the due
// date so a rescheduled task alerts again, and today so it returns tomorrow.
export function alertKey(task, today) {
  return `${task.id}|${task.plan?.endDate || ''}|${today}`;
}

export function overdueDays(task, today) {
  return daysBetween(task.plan?.endDate, today);
}

function priorityRank(p) {
  const r = PRIORITY_RANK[String(p || '').toLowerCase()];
  return r === undefined ? PRIORITY_RANK.medium : r;
}

// Sorted list of tasks that should alert right now. Most overdue first, then
// priority, then title so the order is stable between ticks.
export function buildAlertQueue(tasks = [], {
  today,
  leadDays = 0,
  snoozes = {},
  skips = [],
  now = Date.now(),
} = {}) {
  const skipSet = skips instanceof Set ? skips : new Set(skips || []);
  return tasks
    .filter((t) => isDueForAlert(t, { today, leadDays }))
    .filter((t) => !(snoozes && snoozes[t.id] > now))
    .filter((t) => !skipSet.has(alertKey(t, today)))
    .sort((a, b) => {
      const od = overdueDays(b, today) - overdueDays(a, today);
      if (od !== 0) return od;
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
}

/* ── quiet hours ───────────────────────────────────────────────────────── */

function minutesOf(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// True when `date` falls inside [quietFrom, quietTo). Handles ranges that
// cross midnight (22:00 → 07:00). Empty / equal bounds = no quiet hours.
export function isQuietNow({ quietFrom, quietTo } = {}, date = new Date()) {
  const from = minutesOf(quietFrom), to = minutesOf(quietTo);
  if (from === null || to === null || from === to) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  return from < to ? (cur >= from && cur < to) : (cur >= from || cur < to);
}

/* ── per-device snooze / skip store ────────────────────────────────────── */

export const SNOOZE_KEY_PREFIX = 'task-monitor.dueAlerts.snooze.v1.';
export const SKIP_KEY_PREFIX   = 'task-monitor.dueAlerts.skip.v1.';

function storage(explicit) {
  if (explicit) return explicit;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; }
  catch { return null; }
}

function readJson(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

// Returns { snoozes: { [taskId]: epochMs }, skips: [alertKey, ...] } with
// expired snoozes and other-day skips pruned so the store cannot grow forever.
export function loadAlertState(userId, { today, now = Date.now(), store } = {}) {
  const s = storage(store);
  const empty = { snoozes: {}, skips: [] };
  if (!s || !userId) return empty;
  const rawSnoozes = readJson(s, SNOOZE_KEY_PREFIX + userId, {});
  const rawSkips   = readJson(s, SKIP_KEY_PREFIX + userId, []);
  const snoozes = {};
  for (const [id, until] of Object.entries(rawSnoozes || {})) {
    if (typeof until === 'number' && until > now) snoozes[id] = until;
  }
  const skips = (Array.isArray(rawSkips) ? rawSkips : [])
    .filter((k) => typeof k === 'string' && (!today || k.endsWith(`|${today}`)));
  return { snoozes, skips };
}

export function saveAlertState(userId, { snoozes = {}, skips = [] } = {}, { store } = {}) {
  const s = storage(store);
  if (!s || !userId) return false;
  try {
    s.setItem(SNOOZE_KEY_PREFIX + userId, JSON.stringify(snoozes));
    s.setItem(SKIP_KEY_PREFIX + userId, JSON.stringify([...new Set(skips)]));
    return true;
  } catch { return false; }
}

export function snoozeUntil(minutes, now = Date.now()) {
  const m = Math.min(1440, Math.max(1, Number(minutes) || 1));
  return now + m * 60_000;
}

export function formatClock(epochMs) {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ── prompt fallback (AI offline) ──────────────────────────────────────── */

// Deterministic prompt built from task metadata alone. Used when no AI brain
// is available so the alert still hands the user something paste-ready.
export function buildFallbackPrompt(task, project) {
  if (!task) return '';
  const lines = [];
  lines.push(`You are an expert assistant helping me finish a task on time. Produce the actual deliverable, ready to use — not advice about how to do it.`);
  lines.push('');
  lines.push('## Task');
  lines.push(`Title: ${task.title || '(untitled)'}`);
  if (task.description) lines.push(`Description: ${task.description}`);
  if (project?.name) lines.push(`Project: ${project.name}`);
  if (project?.description) lines.push(`Project context: ${project.description}`);
  if (task.requestedBy) lines.push(`Requested by: ${task.requestedBy}`);
  if (task.priority) lines.push(`Priority: ${task.priority}`);
  if (task.plan?.endDate) lines.push(`Due: ${task.plan.endDate}`);
  if (task.tags?.length) lines.push(`Tags: ${task.tags.join(', ')}`);
  const open = (task.subtasks || []).filter((s) => s && !s.done && s.text);
  if (open.length) {
    lines.push('');
    lines.push('## Steps still open');
    open.forEach((s, i) => lines.push(`${i + 1}. ${s.text}`));
  }
  lines.push('');
  lines.push('## What to produce');
  lines.push('1. State in one line what the deliverable is (e.g. an email, a document outline, a file).');
  lines.push('2. Produce it in full, in the most useful format for the recipient.');
  lines.push('3. End with a 3-item checklist I can use to confirm the task is complete.');
  return lines.join('\n');
}
