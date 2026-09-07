// bridge/notebooklm.mjs — the knowledge-base layer. This is the ONLY place in
// the whole repo that spawns the `notebooklm` CLI.
//
// NotebookLM is Google's document-grounded RAG product. The unofficial
// `notebooklm` CLI (pipx: notebooklm-py) drives the operator's own notebooks
// from the terminal, so the bridge — which already owns every subprocess —
// exposes it over localhost and the frontend never sees a process.
//
// The whole feature is OPTIONAL: with the CLI missing or signed out, every
// export here resolves to a readable setup hint instead of throwing, and the
// app installs, starts and passes its tests exactly as before.
//
// ── CLI surface (verified on this machine 2026-09-07, notebooklm 0.7.3) ────
//   notebooklm --version                       → "NotebookLM CLI, version 0.7.3"
//   notebooklm --quiet auth check --test --json
//       → { status: 'ok'|'error', checks: { storage_exists, json_valid,
//           cookies_present, sid_cookie, token_fetch }, details: {...} }
//   notebooklm --quiet list --json             → notebooks (see normalizeNotebooks)
//   notebooklm --quiet source list -n <id> --json
//   notebooklm --quiet source add <content> -n <id> --type url|text
//                                  [--title <t>] --json
//   notebooklm --quiet ask [QUESTION] -n <id> [-c <conversationId>] --json
//                                  [--prompt-file -]   ← question on stdin
//
// Global flags come BEFORE the subcommand (`--quiet` is a group option).
// `--prompt-file -` reads the prompt from stdin, which is how a long question
// gets past the OS argv length limit.
// `ask --new` is DESTRUCTIVE — it deletes the notebook's server-side
// conversation, and turns are not recoverable. This module NEVER passes it.
//
// Failure contract: a signed-out CLI answers on stdout with
//   {"error": true, "code": "AUTH_REQUIRED", "message": "Auth not found…"}
// — `error` is a BOOLEAN, so using it as the message ships the literal string
// "true" to the user. Read `message`. See errorMessage() below.

import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ── constants ─────────────────────────────────────────────────────────── */

export const SETUP_HINT =
  'NotebookLM CLI not found. Install it with `pipx install "notebooklm-py[browser]"` ' +
  '(get pipx from `brew install pipx && pipx ensurepath`), then run `notebooklm login` ' +
  'with a DEDICATED Google account. Press Re-check when you are done — no restart needed.';

export const LOGIN_HINT =
  'The NotebookLM CLI is installed but not signed in. Run `notebooklm login` in a ' +
  'terminal (use a dedicated Google account), then press Re-check.';

export const EMPTY_HINT =
  'Signed in, but this account has no notebooks yet. Create one at notebooklm.google.com, ' +
  'add a few sources, then press Re-check.';

// Every call is a subprocess plus a Google round-trip, so the budgets differ
// by an order of magnitude between "check a file" and "ask a question".
export const DEFAULT_TIMEOUT_MS = 120_000;
export const AUTH_TIMEOUT_MS    = 60_000;
export const LIST_TIMEOUT_MS    = 90_000;
export const ASK_TIMEOUT_MS     = 300_000;
export const SOURCE_TIMEOUT_MS  = 300_000;

export const STATUS_TTL_MS    = 60_000;
export const NOTEBOOKS_TTL_MS = 300_000;

export const MAX_CONCURRENT = 2;
const MAX_BUFFER = 16 * 1024 * 1024;

// Long questions go over stdin instead of argv.
const STDIN_THRESHOLD = 2000;

const CONFIG_DIR = path.join(os.homedir(), '.task-monitor');
// TM_KNOWLEDGE_LOG lets the unit tests exercise the log without touching the
// operator's real history.
const ASK_LOG_FILE = process.env.TM_KNOWLEDGE_LOG || path.join(CONFIG_DIR, 'knowledge-asks.json');
export const ASK_LOG_CAP = 500;

/* ── locating the CLI ──────────────────────────────────────────────────── */

let _cliPath;            // undefined = not resolved yet, null = not found
let _resolver = null;    // test hook

// Tests swap the resolver instead of putting a fake binary on PATH.
export function setCliResolver(fn) {
  _resolver = fn;
  _cliPath = undefined;
}

export function findCli() {
  if (_cliPath !== undefined) return _cliPath;
  _cliPath = resolveCli();
  return _cliPath;
}

function resolveCli() {
  if (_resolver) return _resolver() || null;

  const override = String(process.env.TM_NOTEBOOKLM_BIN || '').trim();
  // 'none' is how a test (or an operator) forces the not-installed path.
  if (override === 'none') return null;
  if (override) return fs.existsSync(override) ? override : null;

  try {
    const r = spawnSync('which', ['notebooklm'], { encoding: 'utf8', timeout: 5000 });
    const hit = String(r.stdout || '').split('\n')[0].trim();
    if (hit && fs.existsSync(hit)) return hit;
  } catch { /* fall through to the well-known locations */ }

  // pipx, Homebrew (Apple silicon), Homebrew (Intel) / manual installs. The
  // bridge is often started from a launcher whose PATH is not the shell's.
  for (const dir of [
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]) {
    const p = path.join(dir, 'notebooklm');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// A dedicated Google account deserves a dedicated profile directory, so an
// operator can keep work notebooks out of their personal CLI state.
export function cliEnv() {
  const env = { ...process.env };
  if (env.NOTEBOOKLM_HOME) return env;
  const sandbox = path.join(os.homedir(), '.notebooklm-sandbox');
  try {
    if (fs.statSync(sandbox).isDirectory()) env.NOTEBOOKLM_HOME = sandbox;
  } catch { /* no sandbox: the CLI uses ~/.notebooklm */ }
  return env;
}

/* ── lenient JSON ──────────────────────────────────────────────────────── */

// The CLI prints progress lines before its payload when it feels chatty, and
// --quiet does not always cover every code path. Parse the whole thing first,
// then fall back to the first { or [.
export function parseJsonLenient(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* try harder */ }
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i !== -1);
  if (!starts.length) return null;
  const body = s.slice(Math.min(...starts));
  for (let end = body.length; end > 0; end--) {
    const ch = body[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(body.slice(0, end)); } catch { /* keep shrinking */ }
  }
  return null;
}

/* ── the 2-slot semaphore ──────────────────────────────────────────────── */

let _inFlight = 0;
const _queue = [];

function acquire() {
  if (_inFlight < MAX_CONCURRENT) { _inFlight++; return Promise.resolve(); }
  return new Promise((resolve) => _queue.push(resolve));
}
function release() {
  const next = _queue.shift();
  if (next) next();            // hand the slot straight over, FIFO
  else _inFlight--;
}

/* ── running the CLI ───────────────────────────────────────────────────── */

// Never throws. → { ok: true, data } | { ok: false, error: <readable string> }
export async function runCli(args, { timeoutMs = DEFAULT_TIMEOUT_MS, input = null } = {}) {
  const bin = findCli();
  if (!bin) return { ok: false, error: SETUP_HINT };

  await acquire();
  try {
    const { err, stdout, stderr } = await exec(bin, ['--quiet', ...args], { timeoutMs, input });
    const payload = parseJsonLenient(stdout);
    // A signed-out CLI can exit 0 and still report failure in the payload, so
    // the exit code alone is not the verdict.
    const failed = !!err || (payload && payload.error);
    // `data` rides along on failure too: `auth check` exits non-zero while
    // still printing the diagnosis callers actually want to read.
    if (failed) return { ok: false, error: errorMessage(payload, stderr, err, timeoutMs), data: payload };
    return { ok: true, data: payload ?? { raw: String(stdout).trim() } };
  } finally {
    release();
  }
}

function exec(bin, args, { timeoutMs, input }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(
        bin, args,
        { timeout: timeoutMs, maxBuffer: MAX_BUFFER, encoding: 'utf8', env: cliEnv() },
        (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }),
      );
    } catch (e) {
      return resolve({ err: e, stdout: '', stderr: '' });
    }
    // Writing to a process that already died must not take the bridge with it.
    child.stdin?.on('error', () => {});
    if (input != null) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

// ORDER MATTERS. `payload.error` is a boolean flag in this CLI, so it is only
// a message when it happens to be a string; taking it first unconditionally
// ships the word "true" to the user as the explanation.
export function errorMessage(payload, stderr, err, timeoutMs) {
  if (payload && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }
  if (payload && typeof payload.message === 'string' && payload.message.trim()) {
    const help = typeof payload.help === 'string' && payload.help.trim();
    return help ? `${payload.message.trim()} ${help}` : payload.message.trim();
  }
  const tail = String(stderr || '').trim().slice(-1500);
  if (tail) return tail;
  if (err?.killed) {
    return `The notebooklm CLI timed out after ${Math.round((timeoutMs || 0) / 1000)}s.`;
  }
  return err?.message || 'The notebooklm CLI failed with no output.';
}

/* ── status + notebooks (TTL cached) ───────────────────────────────────── */

let _status = null, _statusAt = 0;
let _notebooks = null, _notebooksAt = 0;

export function resetKnowledgeCaches() {
  _cliPath = undefined;
  _status = null; _statusAt = 0;
  _notebooks = null; _notebooksAt = 0;
}

// → { cliFound, cliPath, authenticated, hint, error }
export async function knowledgeStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && _status && now - _statusAt < STATUS_TTL_MS) return _status;

  const cliPath = findCli();
  if (!cliPath) {
    _status = { cliFound: false, cliPath: null, authenticated: false, hint: SETUP_HINT, error: null };
    _statusAt = now;
    return _status;
  }

  const res = await runCli(['auth', 'check', '--test', '--json'], { timeoutMs: AUTH_TIMEOUT_MS });
  // Field names verified against `auth check --test --json` on this machine:
  // status is 'ok' | 'error', and checks.token_fetch is the network probe.
  const authenticated = !!(res.data?.status === 'ok' && res.data?.checks?.token_fetch);
  // A signed-out CLI answers this command by exiting non-zero with a full
  // diagnosis on stdout. That is a STATE, so it reports as "not signed in"
  // with the login hint — not as a broken integration with a raw exec error.
  const diagnosed = !!res.data?.checks;
  _status = {
    cliFound: true,
    cliPath,
    authenticated,
    hint: authenticated ? null : LOGIN_HINT,
    error: (res.ok || diagnosed) ? null : res.error,
  };
  _statusAt = now;
  return _status;
}

// Google's payload shape has moved between CLI versions, so accept all of
// them and drop anything without an id rather than rendering a blank row.
export function normalizeNotebooks(data) {
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.notebooks) ? data.notebooks
    : Array.isArray(data?.items) ? data.items
    : [];
  return list.map((n) => {
    const id = n?.id ?? n?.notebook_id ?? n?.uuid ?? null;
    if (!id) return null;
    const sourceCount = n?.sourceCount ?? n?.source_count ?? n?.sources_count ??
      (Array.isArray(n?.sources) ? n.sources.length : null);
    return {
      id: String(id),
      title: String(n?.title ?? n?.name ?? 'Untitled notebook'),
      sourceCount: Number.isFinite(Number(sourceCount)) ? Number(sourceCount) : null,
    };
  }).filter(Boolean);
}

export async function listNotebooks({ force = false } = {}) {
  const now = Date.now();
  if (!force && _notebooks && now - _notebooksAt < NOTEBOOKS_TTL_MS) return _notebooks;
  const res = await runCli(['list', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
  if (!res.ok) throw new Error(res.error);
  _notebooks = normalizeNotebooks(res.data);
  _notebooksAt = now;
  return _notebooks;
}

// Synchronous peek for validators and pickers: they must NEVER cause a spawn,
// so a never-fetched cache is `null` (= "don't know"), not `[]` (= "none").
export function cachedNotebooks() {
  return _notebooks;
}

// The hint a UI should show for the current state, including the "signed in
// but empty" case that only the notebook list can detect.
export function knowledgeHint(status, notebooks) {
  if (!status?.cliFound) return SETUP_HINT;
  if (!status.authenticated) return LOGIN_HINT;
  if (Array.isArray(notebooks) && notebooks.length === 0) return EMPTY_HINT;
  return null;
}

/* ── sources ───────────────────────────────────────────────────────────── */

export function normalizeSources(data) {
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.sources) ? data.sources
    : Array.isArray(data?.items) ? data.items
    : [];
  return list.map((s) => {
    const id = s?.id ?? s?.source_id ?? s?.uuid ?? null;
    if (!id) return null;
    return {
      id: String(id),
      title: String(s?.title ?? s?.name ?? 'Untitled source'),
      kind: String(s?.type ?? s?.kind ?? s?.source_type ?? 'unknown'),
    };
  }).filter(Boolean);
}

export async function listSources(notebookId) {
  const id = requireId(notebookId);
  const res = await runCli(['source', 'list', '-n', id, '--json'], { timeoutMs: LIST_TIMEOUT_MS });
  if (!res.ok) throw new Error(res.error);
  return normalizeSources(res.data);
}

export async function addSourceUrl(notebookId, url) {
  const id = requireId(notebookId);
  const u = String(url || '').trim();
  // The CLI rejects non-http(s) itself, but a client-side message is clearer
  // than a subprocess round-trip that ends in a stack trace.
  if (!/^https?:\/\//i.test(u)) throw new Error('A source URL must start with http:// or https://');
  const res = await runCli(['source', 'add', u, '-n', id, '--type', 'url', '--json'],
    { timeoutMs: SOURCE_TIMEOUT_MS });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// `source add --type text` takes the text inline, so there is no temp file to
// create and no temp file to leak.
export async function addSourceText(notebookId, title, text) {
  const id = requireId(notebookId);
  const body = String(text || '').trim();
  if (!body) throw new Error('Cannot add an empty text source.');
  const name = String(title || '').trim().slice(0, 120) || 'Task Monitor note';
  const res = await runCli(
    ['source', 'add', body, '-n', id, '--type', 'text', '--title', name, '--json'],
    { timeoutMs: SOURCE_TIMEOUT_MS },
  );
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function requireId(notebookId) {
  const id = String(notebookId || '').trim();
  if (!id) throw new Error('A notebook id is required.');
  return id;
}

/* ── asking ────────────────────────────────────────────────────────────── */

export function normalizeAnswer(data) {
  if (data == null) return { answer: '', citations: [], conversationId: null };
  if (typeof data === 'string') return { answer: data, citations: [], conversationId: null };

  const raw = data.answer ?? data.response ?? data.text ?? data.raw ?? '';
  const answer = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);

  const cites = data.citations ?? data.sources ?? data.references ?? [];
  const citations = (Array.isArray(cites) ? cites : []).map((c, i) => {
    if (typeof c === 'string') return { n: i + 1, title: c, sourceId: null, url: null };
    return {
      n: Number(c?.n ?? c?.index ?? i + 1),
      title: String(c?.title ?? c?.name ?? c?.source_title ?? `Source ${i + 1}`),
      sourceId: c?.source_id ?? c?.sourceId ?? c?.id ?? null,
      url: typeof c?.url === 'string' ? c.url : null,
    };
  });

  return {
    answer: String(answer).trim(),
    citations,
    conversationId: data.conversation_id ?? data.conversationId ?? null,
  };
}

// → { answer, citations, conversationId, ms, askId }
export async function askNotebook(notebookId, question, {
  conversationId = null,
  source = 'manual',
  workspaceId = null, projectId = null, taskId = null,
} = {}) {
  const id = requireId(notebookId);
  const q = String(question || '').trim();
  if (!q) throw new Error('A question is required.');

  const args = ['ask'];
  let input = null;
  // Past a couple of thousand characters the question stops fitting argv
  // comfortably, so hand it over on stdin instead.
  if (q.length > STDIN_THRESHOLD) { args.push('--prompt-file', '-'); input = q; }
  else args.push(q);
  args.push('-n', id);
  // Continuing a conversation is the default; `--new` would DELETE the
  // server-side thread, so it is never passed from here.
  if (conversationId) args.push('-c', String(conversationId));
  args.push('--json');

  const started = Date.now();
  const res = await runCli(args, { timeoutMs: ASK_TIMEOUT_MS, input });
  const ms = Date.now() - started;
  if (!res.ok) throw new Error(res.error);

  const out = normalizeAnswer(res.data);
  const askId = recordAsk({
    notebookId: id, question: q, ms, source,
    citationsCount: out.citations.length,
    workspaceId, projectId, taskId,
  });
  return { ...out, conversationId: out.conversationId ?? conversationId ?? null, ms, askId };
}

/* ── the ask log ───────────────────────────────────────────────────────── */
// NotebookLM exposes no history of its own, so "how often is this notebook
// actually used" can only be answered from a log we keep ourselves. It lives
// next to the bridge config, never in Firestore: it is operator-local data.

let _log = null;

function loadLog() {
  if (_log) return _log;
  try { _log = JSON.parse(fs.readFileSync(ASK_LOG_FILE, 'utf8')); } catch { _log = []; }
  if (!Array.isArray(_log)) _log = [];
  return _log;
}

function saveLog() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(ASK_LOG_FILE, JSON.stringify(_log, null, 2));
  } catch (err) {
    console.warn(`[bridge] could not persist the ask log to ${ASK_LOG_FILE}: ${err.message}`);
  }
}

export function recordAsk(row) {
  const log = loadLog();
  const entry = {
    id: `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    notebookId: row.notebookId,
    question: String(row.question || '').slice(0, 300),
    ms: row.ms ?? null,
    source: row.source || 'manual',
    citationsCount: row.citationsCount ?? 0,
    workspaceId: row.workspaceId || null,
    projectId: row.projectId || null,
    taskId: row.taskId || null,
    helpful: null,
  };
  log.push(entry);
  if (log.length > ASK_LOG_CAP) log.splice(0, log.length - ASK_LOG_CAP);
  saveLog();
  return entry.id;
}

export function notebookAskStats(notebookId) {
  const rows = loadLog().filter((r) => r.notebookId === notebookId);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const last7d = rows.filter((r) => Date.parse(r.at) >= weekAgo).length;
  return {
    total: rows.length,
    last7d,
    lastAt: rows.length ? rows[rows.length - 1].at : null,
    helpful: rows.filter((r) => r.helpful === true).length,
    unhelpful: rows.filter((r) => r.helpful === false).length,
  };
}

export function recentAsks(notebookId, n = 10) {
  return loadLog().filter((r) => r.notebookId === notebookId).slice(-n).reverse();
}

export function rateAsk(askId, helpful) {
  const log = loadLog();
  const row = log.find((r) => r.id === askId);
  if (!row) return null;
  row.helpful = helpful === null ? null : !!helpful;
  saveLog();
  return row;
}

// Test hook: point the log somewhere disposable / read it back.
export function _askLogForTests() { return loadLog(); }
export function _resetAskLogForTests(rows = []) { _log = rows; }
