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
  isAiAllowedForUser,
} from './aiCredentials';

export const PROVIDERS = ['claude-code', 'api', 'mock'];
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
  next.maxTokens = Math.max(256, Math.min(8192, Number(next.maxTokens) || DEFAULT_SETTINGS.maxTokens));
  _settings = next;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  recheckProvider();   // a provider change invalidates the detection cache
  return next;
}

/* ── detection ────────────────────────────────────────────────────────── */

// 'claude-code' | 'api' | 'mock' | 'none' | null (not probed yet)
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

function bridgeEnabled() {
  const { bridge } = aiSettings();
  if (bridge === 'off') return false;
  if (bridge === 'on') return true;
  // 'auto': a page served over https can usually only reach 127.0.0.1 in
  // Chromium. Probing from every deployment would just add a failed request
  // per session, so auto means "dev server only".
  return isLocalHost();
}

async function bridgeFetch(path, { method = 'GET', body, timeout = BRIDGE_PROBE_MS } = {}) {
  const { bridgeUrl } = aiSettings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${bridgeUrl}${path}`, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
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
      await probeBridge();
      next = 'claude-code';                       // honoured even if down: askAI reports it
    } else if (provider === 'api' || provider === 'mock') {
      next = provider;
    } else {
      const { ok, aiMode } = await probeBridge();
      // The bridge itself may be in mock mode (CLI not logged in). Only claim
      // 'claude-code' when the CLI is genuinely the bridge's live brain.
      if (ok && aiMode === 'claude-code') next = 'claude-code';
      else if (getEffectiveApiKey())      next = 'api';
      else if (ok && aiMode === 'api')    next = 'claude-code';   // bridge has its own key
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
    case 'api':         return 'Anthropic API — billed per token';
    case 'mock':        return 'Mock — placeholder text, not a real AI response';
    case 'none':        return 'Not connected';
    default:            return 'Checking…';
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
    const err = new Error(`AI API error ${res.status}: ${text.slice(0, 400)}`);
    err.code = `http-${res.status}`;
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

function mockReply(system, userPrompt) {
  const topic = String(userPrompt).split('\n').find((l) => l.trim()) || 'your request';
  return [
    '[MOCK RESPONSE — no AI brain is connected, so this is placeholder text.]',
    '',
    `Asked about: ${topic.slice(0, 160)}`,
    '',
    'To get a real answer, install and log into the Claude Code CLI:',
    '  npm i -g @anthropic-ai/claude-code && claude',
    'start the bridge with `npm run bridge`, then press "Re-check" in Settings → AI brain.',
  ].join('\n');
}

const WEB_UNAVAILABLE = (provider) =>
  `Live web access was requested but the "${provider}" provider cannot browse. ` +
  'This answer comes from training data and may be stale.';

const noBrain = () => {
  const err = new Error(noKeyMessage());
  err.code = 'no-api-key';
  return err;
};

/* ── the public API ───────────────────────────────────────────────────── */

// → { text, provider, usage, ms, degraded?, reason? }
export async function askAI(system, userPrompt, { meta = {}, web = false, maxTokens } = {}) {
  const provider = await detectProvider();
  const started = Date.now();

  const finish = (text, prov, usage, degraded) => {
    const ms = Date.now() - started;
    recordAiCall({
      provider: prov, ms, ...meta,
      inputTokens:  usage?.inputTokens  ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd:      usage?.costUsd      ?? null,
      degraded: !!degraded,
    });
    return { text, provider: prov, usage: usage || null, ms, ...(degraded ? { degraded: true, reason: degraded } : {}) };
  };

  if (provider === 'none') throw noBrain();

  if (provider === 'claude-code') {
    try {
      const out = await bridgeFetch('/ai/complete', {
        method: 'POST',
        timeout: web ? BRIDGE_WEB_TIMEOUT_MS : BRIDGE_TIMEOUT_MS,
        body: { system, user: userPrompt, maxTokens: maxTokens || aiSettings().maxTokens, web, meta },
      });
      // The bridge already recorded this call and may have degraded it itself.
      return { ...out, ms: out.ms ?? (Date.now() - started) };
    } catch (err) {
      const why = err?.name === 'AbortError'
        ? `the AI bridge at ${aiSettings().bridgeUrl} did not respond`
        : (err?.message || String(err));
      if (getEffectiveApiKey()) {
        const { text, usage } = await callApi(system, userPrompt, { maxTokens });
        return finish(text, 'api (fallback)', usage,
          `The Claude Code bridge failed (${why}) — used the Anthropic API key instead.` +
          (web ? ` ${WEB_UNAVAILABLE('api')}` : ''));
      }
      if (aiSettings().allowMock) {
        return finish(`${mockReply(system, userPrompt)}\n\n[bridge error: ${why}]`, 'mock (fallback)', null,
          `The Claude Code bridge failed (${why}) and no API key is available — ` +
          'this is placeholder text, not a real AI response.');
      }
      const e = new Error(
        `The Claude Code bridge is not reachable (${why}). Start it with \`npm run bridge\`, ` +
        'or switch the provider in Settings → AI brain.'
      );
      e.code = 'bridge-unreachable';
      throw e;
    }
  }

  if (provider === 'api') {
    const { text, usage } = await callApi(system, userPrompt, { maxTokens });
    return finish(text, provider, usage, web ? WEB_UNAVAILABLE('api') : undefined);
  }

  return finish(mockReply(system, userPrompt), 'mock', null,
    web ? WEB_UNAVAILABLE('mock')
        : 'No AI brain is connected — this is placeholder text, not a real AI response.');
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
  const wrap = (data, r) => ({ data, provider: r.provider, ...(r.degraded ? { degraded: true, reason: r.reason } : {}) });
  if (String(first.provider).startsWith('mock')) {
    throw new Error(first.reason || 'No AI brain is connected, so structured output is unavailable.');
  }
  try {
    return wrap(extractJson(first.text), first);
  } catch {
    const retry = await askAI(
      system + JSON_RULE,
      `${userPrompt}\n\nYour previous reply was not valid JSON. Return ONLY the JSON object.`,
      opts,
    );
    return wrap(extractJson(retry.text), retry);
  }
}
