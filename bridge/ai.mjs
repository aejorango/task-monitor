// bridge/ai.mjs — the AI provider layer. This is the ONLY place in the
// bridge that talks to a model.
//
// Three providers, auto-detected:
//   1. claude-code — spawn the local `claude` CLI. No API key, billed to the
//      operator's Claude subscription. This is the default and the point of
//      this module.
//   2. api         — Anthropic Messages API with ANTHROPIC_API_KEY. Per-token.
//   3. mock        — canned offline replies so the app is always runnable.
//
// The CLI is invoked HERMETICALLY: --safe-mode + --strict-mcp-config +
// --tools "" so it behaves as a one-shot LLM instead of booting as a coding
// agent that loads CLAUDE.md, skills, plugins, hooks and every MCP server the
// operator has connected. Skipping that costs ~99k input tokens per question
// instead of ~300.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLI_TIMEOUT_MS     = 120_000;
export const CLI_WEB_TIMEOUT_MS = 300_000;   // web research is much slower
export const DETECT_TTL_MS      = 60_000;
export const WEB_TOOLS = ['WebSearch', 'WebFetch'];
export const API_PRICE = { input: 3, output: 15 };  // USD per 1M tokens
export const PROVIDERS = ['claude-code', 'api', 'mock'];

const CONFIG_DIR  = path.join(os.homedir(), '.task-monitor');
const CONFIG_FILE = path.join(CONFIG_DIR, 'bridge-config.json');

const DEFAULT_SETTINGS = {
  provider:  'auto',   // 'auto' | 'claude-code' | 'api' | 'mock'
  cliModel:  '',       // '' → whatever the CLI is configured to use
  apiModel:  'claude-sonnet-4-5-20250929',
  maxTokens: 2048,
  cliPath:   '',       // '' → resolve `claude` on PATH
};

/* ── settings ─────────────────────────────────────────────────────────── */

let _settings = null;

export function aiSettings() {
  if (_settings) return _settings;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* first run */ }
  _settings = { ...DEFAULT_SETTINGS, ...saved };
  return _settings;
}

export function setAiSettings(patch = {}) {
  const next = { ...aiSettings() };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (patch[k] !== undefined && patch[k] !== null) next[k] = patch[k];
  }
  next.maxTokens = Math.max(256, Math.min(8192, Number(next.maxTokens) || DEFAULT_SETTINGS.maxTokens));
  if (!['auto', ...PROVIDERS].includes(next.provider)) next.provider = 'auto';
  _settings = next;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn(`[bridge] could not persist settings to ${CONFIG_FILE}: ${err.message}`);
  }
  recheckProvider();   // a provider/model change invalidates the detection cache
  return next;
}

/* ── detection (cached, with manual re-check) ─────────────────────────── */

let _cached = null;
let _cachedAt = 0;
let _cliVersion = null;

function cliBin() {
  return aiSettings().cliPath || 'claude';
}

export function claudeCliAvailable() {
  try {
    const r = spawnSync(cliBin(), ['--version'], { timeout: 8000, encoding: 'utf8' });
    if (r.status !== 0) return false;
    _cliVersion = String(r.stdout || '').trim() || null;
    return true;
  } catch {
    return false;
  }
}

export function cliVersion() { return _cliVersion; }

export function detectProvider({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cached && now - _cachedAt < DETECT_TTL_MS) return _cached;
  const preferred = String(process.env.AI_PROVIDER || aiSettings().provider || 'auto').toLowerCase();
  if (PROVIDERS.includes(preferred)) _cached = preferred;
  else if (claudeCliAvailable())    _cached = 'claude-code';
  else if (process.env.ANTHROPIC_API_KEY) _cached = 'api';
  else _cached = 'mock';
  _cachedAt = now;
  return _cached;
}

export const recheckProvider = () => detectProvider({ force: true });

/* ── usage log ────────────────────────────────────────────────────────── */

const USAGE_CAP = 1000;
const _usage = [];

export function recordAiCall(row) {
  _usage.push({ at: new Date().toISOString(), ...row });
  if (_usage.length > USAGE_CAP) _usage.splice(0, _usage.length - USAGE_CAP);
}

export function getUsage() {
  const totals = _usage.reduce((acc, r) => {
    acc.calls += 1;
    acc.inputTokens  += r.inputTokens  || 0;
    acc.outputTokens += r.outputTokens || 0;
    acc.costUsd      += r.costUsd      || 0;
    acc.ms           += r.ms           || 0;
    return acc;
  }, { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, ms: 0 });
  // What the same tokens would have cost on the API — the concrete value of
  // running on the CLI subscription.
  totals.apiEquivalentUsd =
    (totals.inputTokens  / 1e6) * API_PRICE.input +
    (totals.outputTokens / 1e6) * API_PRICE.output;
  return { calls: _usage.slice(-200).reverse(), totals };
}

/* ── the CLI provider ─────────────────────────────────────────────────── */

// Exported so it can be unit-tested without spawning anything.
export function claudeCliArgs(system, userPrompt, { web = false } = {}) {
  const args = [
    '-p', userPrompt,
    '--output-format', 'json',
    '--system-prompt', system,   // REPLACES Claude Code's agent prompt
    '--safe-mode',               // no CLAUDE.md, skills, plugins, hooks, agents
    '--strict-mcp-config',       // ignore every MCP config we didn't pass
  ];
  if (web) {
    // --tools makes them available; --allowedTools pre-approves them so the
    // non-interactive session doesn't silently deny them.
    args.push('--tools', WEB_TOOLS.join(','));
    args.push('--allowedTools', ...WEB_TOOLS);
  } else {
    args.push('--tools', '');    // "" = no tools at all (pure text completion)
  }
  const { cliModel } = aiSettings();
  if (cliModel) args.push('--model', cliModel);
  return args;
}

export function parseCliResult(out) {
  let parsed;
  try { parsed = JSON.parse(String(out).trim()); }
  catch { return { text: String(out).trim(), usage: null }; }  // older CLI: plain text

  if (parsed.is_error) {
    throw new Error(`Claude Code CLI error: ${String(parsed.result).slice(0, 400)}`);
  }

  // A denied tool is NOT is_error: the CLI exits 0 and `result` holds the
  // model's polite apology. Returning that as an answer ships confident
  // garbage, so throw instead.
  const denied = [...new Set((parsed.permission_denials || []).map((d) => d.tool_name))];
  if (denied.length) {
    throw new Error(
      `Claude Code denied these tools: ${denied.join(', ')}. ` +
      'Enable the matching capability (e.g. turn on web access for this request).'
    );
  }

  return {
    text: String(parsed.result ?? '').trim(),
    usage: {
      inputTokens:  parsed.usage?.input_tokens  ?? null,
      outputTokens: parsed.usage?.output_tokens ?? null,
      costUsd: 0,   // subscription-billed: the real cost to the operator is $0
    },
  };
}

function callClaudeCode(system, userPrompt, { web = false } = {}) {
  return new Promise((resolve, reject) => {
    const timeout = web ? CLI_WEB_TIMEOUT_MS : CLI_TIMEOUT_MS;
    let child;
    try {
      child = spawn(cliBin(), claudeCliArgs(system, userPrompt, { web }), {
        timeout,
        env: { ...process.env },
      });
    } catch (e) {
      return reject(new Error(`Claude Code CLI failed to start: ${e.message}`));
    }
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(
      `Claude Code CLI failed to start: ${e.message}. Is it installed? ` +
      '(npm i -g @anthropic-ai/claude-code)'
    )));
    child.on('close', (code, signal) => {
      if (code !== 0) {
        return reject(new Error(signal
          ? `Claude Code CLI timed out after ${Math.round(timeout / 1000)}s (killed with ${signal}).`
          : `Claude Code CLI exited ${code}: ${(err || out).slice(0, 400)}`));
      }
      try { resolve(parseCliResult(out)); } catch (e) { reject(e); }
    });
  });
}

/* ── the API provider ─────────────────────────────────────────────────── */

async function callApi(system, userPrompt, { maxTokens } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  const { apiModel, maxTokens: defaultMax } = aiSettings();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: apiModel,
      max_tokens: maxTokens || defaultMax,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const inputTokens  = data.usage?.input_tokens  ?? null;
  const outputTokens = data.usage?.output_tokens ?? null;
  return {
    text: text.trim(),
    usage: {
      inputTokens,
      outputTokens,
      costUsd: ((inputTokens || 0) / 1e6) * API_PRICE.input
             + ((outputTokens || 0) / 1e6) * API_PRICE.output,
    },
  };
}

/* ── the mock provider ────────────────────────────────────────────────── */

export function mockReply(system, userPrompt) {
  const topic = String(userPrompt).split('\n').find((l) => l.trim()) || 'your request';
  return [
    '[MOCK RESPONSE — no AI provider is connected, so this is placeholder text.]',
    '',
    `Asked about: ${topic.slice(0, 160)}`,
    '',
    'To get a real answer, install and log into the Claude Code CLI:',
    '  npm i -g @anthropic-ai/claude-code && claude',
    'then press "Re-check AI" in Settings.',
  ].join('\n');
}

const WEB_UNAVAILABLE = (provider) =>
  `Live web access was requested but the "${provider}" provider cannot browse. ` +
  'This answer comes from training data and may be stale.';

/* ── the public API ───────────────────────────────────────────────────── */

export async function askAI(system, userPrompt, { meta = {}, web = false, maxTokens } = {}) {
  const provider = detectProvider();
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
    return {
      text, provider: prov, usage: usage || null, ms,
      ...(degraded ? { degraded: true, reason: degraded } : {}),
    };
  };

  const webSystem = web
    ? `${system}\n\nYou have live web access via WebSearch and WebFetch. Use them for anything time-sensitive, and cite the source URL for every such claim.`
    : system;

  if (provider === 'claude-code') {
    try {
      const { text, usage } = await callClaudeCode(webSystem, userPrompt, { web });
      return finish(text, provider, usage);
    } catch (err) {
      if (process.env.ANTHROPIC_API_KEY) {
        const { text, usage } = await callApi(system, userPrompt, { maxTokens });
        return finish(text, 'api (fallback)', usage,
          `The Claude Code CLI failed (${err.message}) — used the Anthropic API key instead.` +
          (web ? ` ${WEB_UNAVAILABLE('api')}` : ''));
      }
      return finish(
        `${mockReply(system, userPrompt)}\n\n[claude-code error: ${err.message}]`,
        'mock (fallback)', null,
        `The Claude Code CLI failed (${err.message}) and no ANTHROPIC_API_KEY is set — ` +
        'this is placeholder text, not a real AI response.'
      );
    }
  }

  if (provider === 'api') {
    const { text, usage } = await callApi(system, userPrompt, { maxTokens });
    return finish(text, provider, usage, web ? WEB_UNAVAILABLE('api') : undefined);
  }

  return finish(mockReply(system, userPrompt), 'mock', null,
    web ? WEB_UNAVAILABLE('mock')
        : 'No AI provider is connected — this is placeholder text, not a real AI response.');
}

/* ── structured output ────────────────────────────────────────────────── */

// Tolerates chatty models: strips fences, finds the first [ or {, then shrinks
// the tail until JSON.parse succeeds.
export function extractJson(text) {
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i !== -1);
  if (!starts.length) throw new Error(`No JSON found in response: ${s.slice(0, 200)}`);
  const from = Math.min(...starts);
  const body = s.slice(from);
  for (let end = body.length; end > 0; end--) {
    const ch = body[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(body.slice(0, end)); } catch { /* keep shrinking */ }
  }
  throw new Error(`Could not parse JSON from response: ${s.slice(0, 200)}`);
}

const JSON_RULE = '\n\nRespond with ONLY valid JSON. No prose, no markdown fences.';

export async function askAIJson(system, userPrompt, opts = {}) {
  // In mock mode there is no real JSON to parse — throw so callers keep using
  // their own non-AI fallback paths instead of acting on fake data.
  if (detectProvider() === 'mock') {
    throw new Error('No AI provider is connected, so structured output is unavailable.');
  }

  const first = await askAI(system + JSON_RULE, userPrompt, opts);
  try {
    return { data: extractJson(first.text), provider: first.provider, ...(first.degraded ? { degraded: true, reason: first.reason } : {}) };
  } catch {
    const retry = await askAI(
      system + JSON_RULE,
      `${userPrompt}\n\nYour previous reply was not valid JSON. Return ONLY the JSON object.`,
      opts
    );
    return { data: extractJson(retry.text), provider: retry.provider, ...(retry.degraded ? { degraded: true, reason: retry.reason } : {}) };
  }
}

export function providerLabel(provider) {
  switch (provider) {
    case 'claude-code': return 'CLAUDE-CODE (Claude Code CLI — your subscription, no API billing)';
    case 'api':         return 'API (Anthropic Messages API — billed per token)';
    default:            return 'MOCK (no AI connected — install the Claude Code CLI and run `claude` to log in, or set ANTHROPIC_API_KEY)';
  }
}
