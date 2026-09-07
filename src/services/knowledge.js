// src/services/knowledge.js — the frontend's only door to the NotebookLM
// knowledge base.
//
// Same rule as services/ai.js: the page never spawns anything and never talks
// to Google. Everything goes through the local bridge (`npm run bridge`),
// which owns the `notebooklm` CLI. Here we add one shared probe + cache on
// top, so that a picker, a validator and three settings panels rendering at
// once cost one HTTP call rather than five subprocesses.
//
// The whole layer is OPTIONAL. Nothing here throws just because the operator
// has never installed the CLI — that is a state with a hint attached.

import { bridgeFetch, bridgeEnabled, aiSettings } from './ai';

export const STATUS_TTL_MS = 60_000;
export const ASK_TIMEOUT_MS = 310_000;   // the bridge budgets 300 s for an ask
export const SOURCE_TIMEOUT_MS = 310_000;

export const BRIDGE_DOWN_HINT =
  'Start the AI bridge on this machine (`npm run bridge`) to use the knowledge base.';

const BRIDGE_OFF_HINT =
  'The AI bridge is switched off in Settings → AI brain, so the knowledge base is unreachable.';

/* ── one shared probe ──────────────────────────────────────────────────── */

const EMPTY = {
  probed: false,
  loading: false,
  bridgeOk: false,
  cliFound: false,
  authenticated: false,
  hint: null,
  notebooks: null,     // null = never fetched (≠ [] = signed in with none)
  error: null,
  at: 0,
};

let _state = { ...EMPTY };
let _inflight = null;

const _listeners = new Set();
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function set(patch) {
  _state = { ..._state, ...patch };
  const snap = knowledgeState();
  _listeners.forEach((fn) => { try { fn(snap); } catch { /* listener's problem */ } });
}

// A synchronous snapshot for render paths. Never triggers a request.
export function knowledgeState() {
  return {
    ..._state,
    available: !!(_state.bridgeOk && _state.cliFound && _state.authenticated),
  };
}

export function knowledgeAvailable() { return knowledgeState().available; }

// Pickers and validators read THIS, never fetchNotebooks() — a dropdown
// opening must not be able to start a Google round-trip.
export function cachedNotebooks() { return _state.notebooks; }

function applyStatus(data) {
  set({
    probed: true,
    loading: false,
    bridgeOk: true,
    cliFound: !!data.cliFound,
    authenticated: !!data.authenticated,
    hint: data.hint || null,
    notebooks: Array.isArray(data.notebooks) ? data.notebooks : _state.notebooks,
    error: data.error || null,
    at: Date.now(),
  });
  return knowledgeState();
}

function applyBridgeDown(err) {
  set({
    probed: true,
    loading: false,
    bridgeOk: false,
    cliFound: false,
    authenticated: false,
    hint: bridgeEnabled() ? BRIDGE_DOWN_HINT : BRIDGE_OFF_HINT,
    error: err?.message || String(err || ''),
    at: Date.now(),
  });
  return knowledgeState();
}

export async function fetchKnowledgeStatus({ force = false } = {}) {
  if (!bridgeEnabled()) return applyBridgeDown(new Error(BRIDGE_OFF_HINT));
  if (!force && _state.probed && Date.now() - _state.at < STATUS_TTL_MS) return knowledgeState();
  if (_inflight && !force) return _inflight;

  set({ loading: true });
  _inflight = (async () => {
    try {
      return applyStatus(await bridgeFetch('/knowledge/status', { timeout: 70_000 }));
    } catch (err) {
      return applyBridgeDown(err);
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// Re-check: the operator has just run `notebooklm login` in a terminal and
// wants the app to notice without restarting anything.
export async function refreshKnowledge() {
  if (!bridgeEnabled()) return applyBridgeDown(new Error(BRIDGE_OFF_HINT));
  set({ loading: true });
  try {
    return applyStatus(await bridgeFetch('/knowledge/status/refresh', { method: 'POST', timeout: 120_000 }));
  } catch (err) {
    return applyBridgeDown(err);
  }
}

/* ── operations ────────────────────────────────────────────────────────── */

export async function fetchNotebooks({ force = false } = {}) {
  const { notebooks } = await bridgeFetch(`/knowledge/notebooks${force ? '?force=1' : ''}`, { timeout: 100_000 });
  set({ notebooks: Array.isArray(notebooks) ? notebooks : [] });
  return knowledgeState().notebooks;
}

export async function fetchSources(notebookId) {
  const { sources } = await bridgeFetch(
    `/knowledge/sources?notebook=${encodeURIComponent(notebookId)}`, { timeout: 100_000 },
  );
  return sources || [];
}

// payload: { kind: 'url', url } | { kind: 'text', title, text }
export async function addSource(notebookId, payload) {
  return bridgeFetch('/knowledge/sources', {
    method: 'POST',
    timeout: SOURCE_TIMEOUT_MS,
    body: { notebook: notebookId, ...payload },
  });
}

// → { answer, citations, conversationId, ms, askId }
export async function askNotebook({
  notebook, question, conversationId = null, source = 'manual',
  workspaceId = null, projectId = null, taskId = null,
}) {
  return bridgeFetch('/knowledge/ask', {
    method: 'POST',
    timeout: ASK_TIMEOUT_MS,
    body: { notebook, question, conversationId, source, workspaceId, projectId, taskId },
  });
}

export function fetchNotebookUsage(notebookId) {
  return bridgeFetch(`/knowledge/usage?notebook=${encodeURIComponent(notebookId)}`, { timeout: 10_000 });
}

// Ratings live in the bridge's local log only. Nothing is ever sent to Google.
export function rateAsk(askId, helpful) {
  return bridgeFetch(`/knowledge/asks/${encodeURIComponent(askId)}`, {
    method: 'PATCH', timeout: 10_000, body: { helpful },
  });
}

/* ── notebook resolution ───────────────────────────────────────────────── */

// A project's own notebook wins; otherwise it inherits the workspace's.
export function resolveNotebookFor({ project, workspace } = {}) {
  return project?.knowledge?.notebookId || workspace?.knowledge?.notebookId || null;
}

export function resolveNotebookMeta({ project, workspace } = {}) {
  if (project?.knowledge?.notebookId) return { ...project.knowledge, from: 'project' };
  if (workspace?.knowledge?.notebookId) return { ...workspace.knowledge, from: 'workspace' };
  return null;
}

// Validation NEVER calls the CLI, and never discards a saved id: a notebook
// missing from the cache may just mean the operator is offline right now.
// → { level: 'ok'|'warning'|'error', message } | null
export function validateNotebookChoice(notebookId, { required = false } = {}) {
  if (!notebookId) {
    return required ? { level: 'error', message: 'Pick a NotebookLM notebook.' } : null;
  }
  const cache = cachedNotebooks();
  if (cache === null) return null;                       // we simply don't know
  if (cache.some((n) => n.id === notebookId)) return null;
  return {
    level: 'warning',
    message: "The selected notebook wasn't found in your NotebookLM account — " +
             'it may have been deleted or renamed. The setting is kept as-is.',
  };
}

export function bridgeUrl() { return aiSettings().bridgeUrl; }
