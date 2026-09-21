// src/services/ai.js — the AI provider layer. This is the ONLY place in the
// frontend that talks to a model.
//
// Task Monitor is a static browser app, so the page cannot spawn the `claude`
// CLI itself. Instead the operator runs the local bridge (`npm run bridge`)
// and this module detects it on 127.0.0.1. Three providers, in order:
//
//   1. claude-code — the local bridge shells out to the Claude Code CLI.
//                    Billed to the operator's Claude subscription. Default.
//   2. api         — direct Anthropic Messages API with the company (or
//                    superadmin personal) key. Billed per token.
//   3. mock        — canned offline text so the app is always runnable.
//
// Detection is cached for 60s and can be re-checked from Settings, so logging
// into the CLI while the app is open is picked up without a reload.

import {
  getEffectiveApiKey, getEffectiveModel, DEFAULT_MODEL, noKeyMessage,
  isAiAllowedForUser, canUseAiProxy,
} from './aiCredentials';
import { callAiProxy } from './aiProxyClient';

// What a user may PICK in Settings. 'bridge-api' is not here: nobody chooses
// it — it is what "the bridge" turns out to be when the bridge is running on an
// API key rather than the CLI.
export const PROVIDERS = ['claude-code', 'api', 'mock'];

// Providers that reach a model through the local bridge. Both route the same
// way; they differ in who pays and in what the bridge can do.
export const BRIDGE_PROVIDERS = ['claude-code', 'bridge-api'];

// 'proxy' — the aiProxy Cloud Function. It holds the company's Anthropic key
// server-side and checks the caller before forwarding, so a member's browser
// never sees a spendable secret. This is the normal path for everyone who is
// not the operator running the local bridge.
export const isBridgeProvider = (p) => BRIDGE_PROVIDERS.includes(p);

// Only the Claude Code CLI can browse the web or read a NotebookLM notebook —
// they are CLI capabilities, not bridge capabilities. A bridge running on an
// API key has neither, and must say so rather than quietly answering without.
export const canBrowse = (p) => p === 'claude-code';
export const canGround = (p) => p === 'claude-code';
export const DETECT_TTL_MS   = 60_000;
export const BRIDGE_PROBE_MS = 2_500;
export const BRIDGE_TIMEOUT_MS     = 130_000;
export const BRIDGE_WEB_TIMEOUT_MS = 310_000;
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4319';

const SETTINGS_KEY = 'task-monitor.ai-settings.v1';

const DEFAULT_SETTINGS = {
  provider:  'auto',                 // 'auto' | 'claude-code' | 'api' | 'mock'
  bridge:    'auto',                 // 'auto' (probe on localhost only) | 'on' | 'off'
  bridgeUrl: DEFAULT_BRIDGE_URL,
  cliModel:  '',                     // '' → whatever the CLI defaults to
  apiModel:  '',                     // '' → the company/personal model
  maxTokens: 2048,
  // The bridge prints an admin code on startup. It is only needed to CHANGE
  // the bridge's own configuration — asking questions never needs it. Stored
  // per device, like every other setting on this page.
  bridgeToken: '',
  // Placeholder answers are useful in development, but a real user with no
  // brain connected should get the honest "not available" error instead.
  allowMock: !!import.meta.env?.DEV,
};

/* ── settings ─────────────────────────────────────────────────────────── */

let _settings = null;

export function aiSettings() {
  if (_settings) return _settings;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* ignore */ }
  _settings = { ...DEFAULT_SETTINGS, ...saved };
  return _settings;
}

export function setAiSettings(patch = {}) {
  const next = { ...aiSettings() };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (patch[k] !== undefined && patch[k] !== null) next[k] = patch[k];
  }
  if (!['auto', ...PROVIDERS].includes(next.provider)) next.provider = 'auto';
  if (!['auto', 'on', 'off'].includes(next.bridge)) next.bridge = 'auto';
  next.bridgeUrl = String(next.bridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
  next.bridgeToken = String(next.bridgeToken || '').trim();
  next.maxTokens = Math.max(256, Math.min(8192, Number(next.maxTokens) || DEFAULT_SETTINGS.maxTokens));
  _settings = next;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  recheckProvider();   // a provider change invalidates the detection cache
  return next;
}

/* ── detection ────────────────────────────────────────────────────────── */

// 'claude-code' | 'bridge-api' | 'proxy' | 'api' | 'mock' | 'none' | null
let _mode = null;
let _modeAt = 0;
let _inflight = null;
let _bridge = { ok: false, aiMode: null, cli: null, error: null };

const _listeners = new Set();
export function subscribeAiStatus(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function notify() {
  const snapshot = aiStatus();
  _listeners.forEach((fn) => { try { fn(snapshot); } catch { /* listener's problem */ } });
}

function isLocalHost() {
  if (typeof location === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(location.hostname);
}

export function bridgeEnabled() {
  const { bridge } = aiSettings();
  if (bridge === 'off') return false;
  if (bridge === 'on') return true;
  // 'auto': a page served over https can usually only reach 127.0.0.1 in
  // Chromium. Probing from every deployment would just add a failed request
  // per session, so auto means "dev server only".
  return isLocalHost();
}

// Exported for services/knowledge.js — the NotebookLM client talks to the same
// bridge over the same origin allowlist, and must not re-implement any of it.
export async function bridgeFetch(path, { method = 'GET', body, timeout = BRIDGE_PROBE_MS } = {}) {
  const { bridgeUrl, bridgeToken } = aiSettings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  // Sent on every call; the bridge only looks at it for the routes that change
  // its configuration. Harmless elsewhere and keeps one code path.
  if (bridgeToken) headers['x-bridge-token'] = bridgeToken;
  try {
    const res = await fetch(`${bridgeUrl}${path}`, {
      method,
      signal: ctrl.signal,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `bridge ${path} returned ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function probeBridge() {
  if (!bridgeEnabled()) {
    _bridge = { ok: false, aiMode: null, cli: null, error: 'Bridge disabled in settings.' };
    return _bridge;
  }
  try {
    const health = await bridgeFetch('/health');
    _bridge = { ok: !!health.ok, aiMode: health.aiMode, cli: health.cli || null, error: null };
  } catch (err) {
    _bridge = {
      ok: false, aiMode: null, cli: null,
      error: err?.name === 'AbortError'
        ? `No response from the AI bridge at ${aiSettings().bridgeUrl}.`
        : (err?.message || String(err)),
    };
  }
  return _bridge;
}

export async function detectProvider({ force = false } = {}) {
  const now = Date.now();
  if (!force && _mode && now - _modeAt < DETECT_TTL_MS) return _mode;
  if (_inflight && !force) return _inflight;

  _inflight = (async () => {
    const { provider, allowMock } = aiSettings();
    let next;

    // Company-level switch first: a company the superadmin hasn't allowed
    // gets no brain at all, not even the bridge or a mock. This is the same
    // gate for every provider, so there is no way around it by picking one.
    if (!isAiAllowedForUser()) {
      next = 'none';
    } else if (provider === 'claude-code') {
      // Honoured even if the bridge is down: askAI reports that. But if the
      // bridge IS up and running on an API key, say so — the AI brain panel
      // must not promise "no API billing" while tokens are being billed.
      const { ok, aiMode } = await probeBridge();
      next = (ok && aiMode === 'api') ? 'bridge-api' : 'claude-code';
    } else if (provider === 'api' || provider === 'mock') {
      next = provider;
    } else {
      const { ok, aiMode } = await probeBridge();
      // The bridge itself may be in mock mode (CLI not logged in). Only claim
      // 'claude-code' when the CLI is genuinely the bridge's live brain.
      if (ok && aiMode === 'claude-code') next = 'claude-code';
      else if (canUseAiProxy())           next = 'proxy';         // company budget, key stays server-side
      else if (getEffectiveApiKey())      next = 'api';           // a superadmin's own key
      else if (ok && aiMode === 'api')    next = 'bridge-api';    // bridge has its own key
      else if (allowMock)                 next = 'mock';
      else                                next = 'none';
    }

    const changed = next !== _mode;
    _mode = next;
    _modeAt = Date.now();
    _inflight = null;
    if (changed) notify();
    return next;
  })();

  return _inflight;
}

export const recheckProvider = () => {
  _mode = null; _modeAt = 0; _inflight = null;
  const p = detectProvider({ force: true });
  notify();
  return p;
};

// Synchronous best-effort view for render paths. Never blocks; kicks off a
// probe the first time so a re-render lands with the real answer.
export function currentProvider() {
  if (_mode === null) { detectProvider().catch(() => {}); return null; }
  return _mode;
}

export function aiStatus() {
  const mode = currentProvider();
  return {
    provider: mode,
    known: mode !== null,
    available: mode !== null && mode !== 'none',
    allowed: isAiAllowedForUser(),
    bridge: { ..._bridge, url: aiSettings().bridgeUrl, enabled: bridgeEnabled() },
    hasApiKey: !!getEffectiveApiKey(),
    settings: aiSettings(),
  };
}

// Sync gate for UI. Optimistic before the first probe resolves: if a key is
// present we already know AI works, otherwise we assume the bridge might be
// there rather than flashing "not available" for a frame.
export function isAiAvailable() {
  if (!isAiAllowedForUser()) return false;
  const mode = currentProvider();
  if (mode === null) return !!getEffectiveApiKey() || bridgeEnabled();
  return mode !== 'none';
}

export function providerLabel(provider) {
  switch (provider) {
    case 'claude-code': return 'Claude Code CLI — your subscription, no API billing';
    case 'bridge-api':  return 'Anthropic API via your local bridge — billed per token';
    case 'proxy':       return 'Your organisation’s AI — billed to your company';
    case 'api':         return 'Anthropic API — billed per token';
    case 'mock':        return 'Mock — placeholder text, not a real AI response';
    case 'none':        return 'Not connected';
    default:            return 'Checking…';
  }
}

// One sentence for the AI brain panel: what is answering, and who pays.
export function providerHeadline(provider, known = true) {
  switch (provider) {
    case 'claude-code':
      return 'Thinking on your Claude subscription — no API billing.';
    case 'bridge-api':
      return 'Answering through the Anthropic API on your local bridge — billed per token. '
           + 'Log in to the Claude Code CLI (`claude`) to use your subscription instead.';
    case 'proxy':
      return 'Answering on your organisation’s account. The key stays on the server — '
           + 'it is never sent to your browser.';
    case 'api':
      return 'Answering through the Anthropic API — billed per token.';
    case 'mock':
      return 'Placeholder answers only. Nothing here is a real AI response.';
    case 'none':
      return 'No AI brain is connected, so AI features are switched off.';
    default:
      return known ? 'No AI brain is connected, so AI features are switched off.'
                   : 'Checking which AI brain is live…';
  }
}

/* ── usage log (calls this tab made directly; the bridge logs its own) ─── */

const USAGE_CAP = 200;
const _usage = [];
export function recordAiCall(row) {
  _usage.push({ at: new Date().toISOString(), ...row });
  if (_usage.length > USAGE_CAP) _usage.splice(0, _usage.length - USAGE_CAP);
}
export function getLocalUsage() { return _usage.slice().reverse(); }
export function fetchBridgeUsage() { return bridgeFetch('/ai/usage', { timeout: 5000 }); }
export function fetchBridgeHealth() { return bridgeFetch('/health', { timeout: 5000 }); }
export function pushBridgeSettings(patch) {
  return bridgeFetch('/ai/settings', { method: 'POST', body: patch, timeout: 5000 });
}
export async function recheckBridge() {
  const out = await bridgeFetch('/ai/recheck', { method: 'POST', timeout: 12_000 });
  await recheckProvider();
  return out;
}

/* ── the API provider (direct from the browser) ───────────────────────── */

// The server-side proxy. The browser sends only the prompt; the function
// supplies the key, the model and the budget, and refuses callers it does not
// recognise. See functions/index.js.
async function callProxy(system, userPrompt, { maxTokens } = {}) {
  const out = await callAiProxy({ system, user: userPrompt, maxTokens: maxTokens || aiSettings().maxTokens });
  return {
    text: out.text,
    usage: {
      inputTokens:  out.usage?.inputTokens  ?? null,
      outputTokens: out.usage?.outputTokens ?? null,
      // The company is billed, not this user; the admin sees the total in the
      // usage log the function writes.
      costUsd: null,
    },
  };
}

async function callApi(system, userPrompt, { maxTokens } = {}) {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    const err = new Error(noKeyMessage());
    err.code = 'no-api-key';
    throw err;
  }
  const model = aiSettings().apiModel || getEffectiveModel() || DEFAULT_MODEL;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || aiSettings().maxTokens,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Same rule: the upstream body is for the console, never for the screen.
    const err = new Error('The AI service refused that request.');
    err.code = `http-${res.status}`;
    err.status = res.status;
    err.detail = `AI API error ${res.status}: ${text.slice(0, 400)}`;
    throw err;
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return {
    text: text.trim(),
    usage: {
      inputTokens:  data.usage?.input_tokens  ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
      costUsd: ((data.usage?.input_tokens || 0) / 1e6) * 3
             + ((data.usage?.output_tokens || 0) / 1e6) * 15,
    },
  };
}

/* ── the mock provider ────────────────────────────────────────────────── */

/**
 * Placeholder text, for when nothing is connected.
 *
 * The body is for whoever is reading the screen, so it names no command, no
 * package and no CLI: those reached every user whose provider resolved to the
 * mock, rendered verbatim into the answer (BUG-028). The runbook is
 * `MOCK_OPERATOR_HINT` below, which travels on the result and is shown only
 * where `isOperator` is true — the same split knowledgeCopy() already makes.
 */
function mockReply(system, userPrompt) {
  const topic = String(userPrompt).split('\n').find((l) => l.trim()) || 'your request';
  return [
    '[Placeholder text — no AI is connected, so this is not a real answer.]',
    '',
    `Asked about: ${topic.slice(0, 160)}`,
    '',
    'Ask an administrator to connect AI for this account, and try again afterwards.',
  ].join('\n');
}

/** The same thing said to the person who can actually fix it. */
export const MOCK_OPERATOR_HINT =
  'No AI brain is connected. Install and log into the Claude Code CLI '
  + '(`npm i -g @anthropic-ai/claude-code && claude`), start the bridge with '
  + '`npm run bridge`, then press "Re-check" in Settings → AI brain.';

// Both of these are shown to anybody, so neither names a CLI or a provider id.
// `providerLabel` exists precisely so a component never writes its own wording.
const GROUND_UNAVAILABLE =
  'This answer is not grounded in your notebook — the AI in use here cannot read it.';

const WEB_UNAVAILABLE = (provider) =>
  `Live web access was asked for, but ${providerLabel(provider).split(' —')[0]} cannot browse. `
  + 'This answer comes from training data and may be out of date.';

const noBrain = () => {
  const err = new Error(noKeyMessage());
  err.code = 'no-api-key';
  return err;
};

/* ── the public API ───────────────────────────────────────────────────── */

// → { text, provider, usage, ms, degraded?, reason? }
// `ground: { notebookId, workspaceId?, projectId?, taskId? }` asks the user's
// own NotebookLM notebook first and hands its answer to the model as source
// material. Only the bridge can do that — it is the only process that can
// reach the CLI — so other providers answer ungrounded and say so.
export async function askAI(system, userPrompt, { meta = {}, web = false, maxTokens, ground = null } = {}) {
  const provider = await detectProvider();
  const started = Date.now();

  // `reason` is shown to anybody; `operatorHint` only where isOperator is true.
  // One message for both audiences is how npm commands reached ordinary users.
  const finish = (text, prov, usage, degraded, operatorHint) => {
    const ms = Date.now() - started;
    recordAiCall({
      provider: prov, ms, ...meta,
      inputTokens:  usage?.inputTokens  ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd:      usage?.costUsd      ?? null,
      degraded: !!degraded,
    });
    return {
      text, provider: prov, usage: usage || null, ms,
      ...(degraded ? { degraded: true, reason: degraded } : {}),
      ...(operatorHint ? { operatorHint } : {}),
    };
  };

  if (provider === 'none') throw noBrain();

  if (isBridgeProvider(provider)) {
    // A bridge running on an API key cannot browse or ground — those are CLI
    // capabilities. Ask for them anyway and the answer comes back degraded
    // rather than silently ungrounded.
    const lostCapabilities = [
      web && !canBrowse(provider) ? WEB_UNAVAILABLE(provider) : null,
      ground && !canGround(provider) ? GROUND_UNAVAILABLE : null,
    ].filter(Boolean).join(' ');

    try {
      const out = await bridgeFetch('/ai/complete', {
        method: 'POST',
        timeout: web ? BRIDGE_WEB_TIMEOUT_MS : BRIDGE_TIMEOUT_MS,
        body: { system, user: userPrompt, maxTokens: maxTokens || aiSettings().maxTokens, web, meta, ground },
      });
      // The bridge already recorded this call and may have degraded it itself.
      const base = { ...out, ms: out.ms ?? (Date.now() - started) };
      if (!lostCapabilities) return base;
      return {
        ...base,
        degraded: true,
        reason: [base.reason, lostCapabilities].filter(Boolean).join(' '),
      };
    } catch (err) {
      const why = err?.name === 'AbortError'
        ? `the AI bridge at ${aiSettings().bridgeUrl} did not respond`
        : (err?.message || String(err));
      if (getEffectiveApiKey()) {
        const { text, usage } = await callApi(system, userPrompt, { maxTokens });
        return finish(text, 'api (fallback)', usage,
          `The Claude Code bridge failed (${why}) — used the Anthropic API key instead.` +
          (web ? ` ${WEB_UNAVAILABLE('api')}` : '') +
          (ground ? ` ${GROUND_UNAVAILABLE}` : ''));
      }
      if (aiSettings().allowMock) {
        return finish(mockReply(system, userPrompt), 'mock (fallback)', null,
          'No AI is connected, so this is placeholder text rather than a real answer.',
          `${MOCK_OPERATOR_HINT} The bridge failed with: ${why}`);
      }
      // The message is what a person may be shown; the operator's version —
      // the address, the cause, the command to start it — goes on `detail`,
      // for console.error and a bug report. Putting it in `message` is how a
      // shell command ended up on the Dashboard (BUG-020).
      const e = new Error('The AI is not connected right now. Try again in a moment — if it keeps happening, ask whoever set this up.');
      e.code = 'bridge-unreachable';
      e.detail = `Claude Code bridge unreachable at ${aiSettings().bridgeUrl} (${why}). `
        + 'Start it with `npm run bridge`, or switch the provider in Settings → AI brain.';
      throw e;
    }
  }

  if (provider === 'proxy') {
    const { text, usage } = await callProxy(system, userPrompt, { maxTokens });
    return finish(text, provider, usage,
      [web ? WEB_UNAVAILABLE('proxy') : null, ground ? GROUND_UNAVAILABLE : null].filter(Boolean).join(' ') || undefined);
  }

  if (provider === 'api') {
    const { text, usage } = await callApi(system, userPrompt, { maxTokens });
    return finish(text, provider, usage,
      [web ? WEB_UNAVAILABLE('api') : null, ground ? GROUND_UNAVAILABLE : null].filter(Boolean).join(' ') || undefined);
  }

  return finish(mockReply(system, userPrompt), 'mock', null,
    web ? WEB_UNAVAILABLE('mock')
        : 'No AI is connected, so this is placeholder text rather than a real answer.',
    MOCK_OPERATOR_HINT);
}

/* ── structured output ────────────────────────────────────────────────── */

// Tolerates chatty models: strips fences, finds the first [ or {, then shrinks
// the tail until JSON.parse succeeds.
export function extractJson(text) {
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i !== -1);
  if (!starts.length) throw new Error(`No JSON found in response: ${s.slice(0, 200)}`);
  const body = s.slice(Math.min(...starts));
  for (let end = body.length; end > 0; end--) {
    const ch = body[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(body.slice(0, end)); } catch { /* keep shrinking */ }
  }
  throw new Error(`Could not parse JSON from response: ${s.slice(0, 200)}`);
}

const JSON_RULE = '\n\nRespond with ONLY valid JSON. No prose, no markdown fences.';

// → { data, provider, degraded?, reason? }. Throws in mock mode so callers
// keep their own non-AI fallback paths instead of acting on fake data.
export async function askAIJson(system, userPrompt, opts = {}) {
  const provider = await detectProvider();
  if (provider === 'none') throw noBrain();
  if (provider === 'mock') {
    throw new Error('No AI brain is connected, so structured output is unavailable.');
  }

  const first = await askAI(system + JSON_RULE, userPrompt, opts);
  const wrap = (data, r) => ({
    data, provider: r.provider, grounding: r.grounding || null,
    ...(r.degraded ? { degraded: true, reason: r.reason } : {}),
  });
  if (String(first.provider).startsWith('mock')) {
    throw new Error(first.reason || 'No AI brain is connected, so structured output is unavailable.');
  }
  try {
    return wrap(extractJson(first.text), first);
  } catch {
    const retry = await askAI(
      system + JSON_RULE,
      `${userPrompt}\n\nYour previous reply was not valid JSON. Return ONLY the JSON object.`,
      // Grounding already ran on the first attempt.
      { ...opts, ground: null },
    );
    return wrap(extractJson(retry.text), retry);
  }
}
