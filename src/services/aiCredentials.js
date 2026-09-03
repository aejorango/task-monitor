// src/services/aiCredentials.js — who pays for an Anthropic API call.
//
// Split out of anthropic.js so both the AI provider layer (services/ai.js)
// and the feature functions can read it without an import cycle. The rules
// themselves are unchanged:
//
//   1. The signed-in user's company key (set by an admin) — normal path.
//   2. A personal localStorage key — superadmins only, as a fallback.
//
// None of this applies to the Claude Code CLI provider: that runs on the
// operator's own subscription and needs no key at all.

const STORAGE_KEY   = 'task-monitor.anthropic-api-key.v1';
const MODEL_KEY     = 'task-monitor.anthropic-model.v1';
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/* ── personal (localStorage) key — legacy / superadmin fallback ────────── */

export function getApiKey() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}
export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode */ }
}
export function getModel() {
  try { return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
export function setModel(model) {
  try { localStorage.setItem(MODEL_KEY, model); } catch { /* private mode */ }
}

/* ── company key (in-memory; pushed by the useMyCompany hook) ──────────── */

let _companyKey   = '';
let _companyModel = '';
let _companyMeta  = null;   // { id, name } for diagnostics
let _companyAi    = true;   // company-level AI switch (aiEnabled on the doc)
let _userRole     = '';     // '', 'user', or 'superadmin'

export function setCurrentUserRole(role) { _userRole = role || ''; }

export function setCurrentCompanyContext({ apiKey, model, id, name, aiEnabled } = {}) {
  _companyKey   = apiKey || '';
  _companyModel = model  || '';
  _companyMeta  = (id || name) ? { id: id || null, name: name || '' } : null;
  // Absent field on legacy docs means "allowed" — only an explicit false
  // (the superadmin flipping the switch off) revokes access.
  _companyAi    = aiEnabled !== false;
}
export function clearCurrentCompanyContext() {
  _companyKey = '';
  _companyModel = '';
  _companyMeta = null;
  _companyAi = true;
}
export function getCurrentCompanyMeta() { return _companyMeta; }
export function isUsingCompanyKey() { return !!_companyKey; }

// Is this user's company allowed to reach the AI brain at all? The AI brain
// panel is superadmin-only UI, but *access* is granted per company from
// Settings → Companies, so this is the one gate every provider respects.
// Superadmins are never locked out — they are the ones granting access.
export function isAiAllowedForUser() {
  if (_userRole === 'superadmin') return true;
  return _companyAi;
}

export function getEffectiveApiKey() {
  if (!isAiAllowedForUser()) return '';
  if (_companyKey) return _companyKey;
  if (_userRole === 'superadmin') return getApiKey();
  return '';
}
export function getEffectiveModel() {
  if (_companyModel) return _companyModel;
  if (_userRole === 'superadmin') return getModel();
  return '';
}

// The message shown when no API key is available AND no other brain is live.
export function noKeyMessage() {
  if (!isAiAllowedForUser()) {
    const who = _companyMeta?.name ? `"${_companyMeta.name}"` : 'your company';
    return `AI features are turned off for ${who}. Contact your company admin or reach out to hello@blueinnovation.ph to enable them.`;
  }
  if (_companyMeta) {
    return `The AI feature is not available on your end — "${_companyMeta.name}" hasn't enabled it yet. Contact your company admin or reach out to hello@blueinnovation.ph to enable.`;
  }
  if (_userRole === 'superadmin') {
    return 'No AI brain available. Start the Claude Code bridge (npm run bridge), assign yourself to a company with a key, or set a personal fallback in Settings → AI.';
  }
  return 'The AI feature is not available on your end. To enable, contact your company admin or reach out to hello@blueinnovation.ph.';
}
