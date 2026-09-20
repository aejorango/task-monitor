// src/services/aiCredentials.js — who pays for an Anthropic API call.
//
// Split out of anthropic.js so both the AI provider layer (services/ai.js)
// and the feature functions can read it without an import cycle. The rules
// themselves are unchanged:
//
//   1. The company's key — held SERVER-SIDE by the aiProxy Cloud Function.
//      The browser never sees it; it asks the function, which checks the
//      caller and forwards to Anthropic. (Before this, the key was on the
//      company document, so every member could read and spend it.)
//   2. A personal localStorage key — superadmins only, on their own device,
//      spending their own money. Never distributed to anyone.
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

/* ── company context (in-memory; pushed by the useMyCompany hook) ─────────
   Deliberately no key: the company's key is not readable from a browser any
   more. What the client needs to know is only whether AI is available and
   whose budget it is, so the UI can say so. */

let _companyHasKey = false;
let _companyModel = '';
let _companyMeta  = null;   // { id, name } for diagnostics
let _companyAi    = true;   // company-level AI switch (aiEnabled on the doc)
let _userRole     = '';     // '', 'user', or 'superadmin'

export function setCurrentUserRole(role) { _userRole = role || ''; }

export function setCurrentCompanyContext({ hasApiKey, model, id, name, aiEnabled } = {}) {
  _companyHasKey = !!hasApiKey;
  _companyModel = model  || '';
  _companyMeta  = (id || name) ? { id: id || null, name: name || '' } : null;
  // Absent field on legacy docs means "allowed" — only an explicit false
  // (the superadmin flipping the switch off) revokes access.
  _companyAi    = aiEnabled !== false;
}
export function clearCurrentCompanyContext() {
  _companyHasKey = false;
  _companyModel = '';
  _companyMeta = null;
  _companyAi = true;
}
export function getCurrentCompanyMeta() { return _companyMeta; }
/** Is a company budget behind this user's AI? (The key itself stays server-side.) */
export function isUsingCompanyKey() { return _companyHasKey; }

/** Can this user reach the server-side proxy — i.e. does their company pay? */
export function canUseAiProxy() {
  return isAiAllowedForUser() && _companyHasKey;
}

// Is this user's company allowed to reach the AI brain at all? The AI brain
// panel is superadmin-only UI, but *access* is granted per company from
// Settings → Companies, so this is the one gate every provider respects.
// Superadmins are never locked out — they are the ones granting access.
export function isAiAllowedForUser() {
  if (_userRole === 'superadmin') return true;
  return _companyAi;
}

// The ONLY key a browser may hold: a superadmin's own, typed into their own
// device. A company key is never returned here — it is not readable any more.
export function getEffectiveApiKey() {
  if (!isAiAllowedForUser()) return '';
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
    return 'No AI brain available. Start the Claude Code bridge (npm run bridge), give your company an API key in Settings → Companies, or set a personal fallback in Settings → AI.';
  }
  return 'The AI feature is not available on your end. To enable, contact your company admin or reach out to hello@blueinnovation.ph.';
}
