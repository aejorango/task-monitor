// src/services/errorMessages.js — what a person is told when something in the
// app crashes. Pure, so it can be unit-tested without a DOM.
//
// Rule: never show a stack trace, a component name or an SDK code to a user.
// Show what happened in one sentence, what they can do about it, and keep the
// technical detail behind a "Technical details" disclosure for a bug report.

/** A chunk that failed to download — almost always a stale tab after a deploy. */
function isStaleChunkError(error) {
  const msg = String(error?.message || error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i
    .test(msg);
}

/** Offline / network-shaped failures. */
function isNetworkError(error) {
  const msg = String(error?.message || error || '');
  return /NetworkError|Failed to fetch|Load failed|ERR_INTERNET_DISCONNECTED/i.test(msg);
}

/**
 * @param {unknown} error   the thrown value
 * @param {{ scope?: 'app'|'view', viewName?: string }} opts
 * @returns {{ title: string, body: string, primaryAction: 'reload'|'retry', detail: string }}
 */
export function describeCrash(error, { scope = 'view', viewName = '' } = {}) {
  const where = viewName ? `the ${viewName} page` : 'this page';

  if (isStaleChunkError(error)) {
    return {
      title: 'A new version is available',
      body: 'This tab has been open since the app was last updated, so part of it '
          + 'could not load. Reloading picks up the new version. Nothing you saved is lost.',
      primaryAction: 'reload',
      detail: detailOf(error),
    };
  }

  if (isNetworkError(error)) {
    return {
      title: 'No connection',
      body: `We could not load ${where} because the connection dropped. `
          + 'Check your internet and try again — your work is saved.',
      primaryAction: 'retry',
      detail: detailOf(error),
    };
  }

  if (scope === 'app') {
    return {
      title: 'Something went wrong',
      body: 'The app hit an unexpected problem and had to stop. Reloading usually '
          + 'fixes it, and nothing you saved is lost.',
      primaryAction: 'reload',
      detail: detailOf(error),
    };
  }

  return {
    title: `We could not show ${where}`,
    body: 'Something on this page went wrong. The rest of the app still works — '
        + 'use Try again, or pick another page from the sidebar. Nothing you saved is lost.',
    primaryAction: 'retry',
    detail: detailOf(error),
  };
}

/** The one line a developer needs, safe to show behind a disclosure. */
export function detailOf(error) {
  if (!error) return 'Unknown error (nothing was thrown).';
  const name = error.name || 'Error';
  const msg = String(error.message || error);
  return `${name}: ${msg}`.slice(0, 500);
}

// ─── AI failures ────────────────────────────────────────────────────────────
//
// An AI error message is written for whoever has to fix it — "The Claude Code
// bridge is not reachable (…). Start it with `npm run bridge`", or "AI API
// error 429: {…raw upstream body…}". Those went straight onto the screen,
// because inline error rendering never went through friendlyError and the copy
// guard only inspected toasts (BUG-020).
//
// The rule is the same one the knowledge base already follows: a shell command,
// a URL, a status code, a CLI name or a provider name is for the operator, and
// belongs in the console. A user gets one sentence saying what happened and
// what to do about it.

export const AI_FALLBACK_MESSAGE = 'The AI could not answer just now. Try again in a moment.';

/** Sentence per failure code. Nothing here names a command, a host or a vendor. */
const AI_MESSAGE_BY_CODE = {
  'bridge-unreachable': 'The AI is not connected right now. Try again in a moment — if it keeps happening, ask whoever set this up.',
  'no-api-key':         'AI is not set up for this account yet. Ask an administrator to turn it on.',
  'ai-not-configured':  'AI is not set up for this account yet. Ask an administrator to turn it on.',
  'ai-denied':          'You do not have access to AI here. Ask an administrator.',
  'ai-busy':            'The AI is busy right now. Wait a few seconds and try again.',
  'ai-timeout':         'The AI took too long to answer. Try again.',
  'ai-offline':         'You appear to be offline. Check your connection and try again.',
  'ai-unavailable':     'The AI service is having trouble at the moment. Try again shortly.',
  'ai-refused':         'The AI could not answer that one. Try rewording it.',
};

/** HTTP status → which sentence above. */
function codeForStatus(status) {
  if (status === 401 || status === 403) return 'ai-denied';
  if (status === 402) return 'ai-not-configured';
  if (status === 408 || status === 504) return 'ai-timeout';
  if (status === 429) return 'ai-busy';
  if (status >= 500) return 'ai-unavailable';
  if (status >= 400) return 'ai-refused';
  return null;
}

/** Work out which failure this is, from a code, a status or the message text. */
function aiCodeOf(err) {
  const code = typeof err === 'object' && err !== null ? err.code : null;
  if (code && AI_MESSAGE_BY_CODE[code]) return code;

  const status = Number(String(code || '').replace(/^http-/, ''))
    || (typeof err === 'object' && err !== null ? Number(err.status) : NaN);
  if (Number.isFinite(status) && status > 0) {
    const mapped = codeForStatus(status);
    if (mapped) return mapped;
  }

  const raw = typeof err === 'string' ? err : String(err?.message || '');
  const name = typeof err === 'object' && err !== null ? String(err.name || '') : '';
  if (name === 'AbortError' || /timed? ?out|did not respond/i.test(raw)) return 'ai-timeout';
  if (/NetworkError|Failed to fetch|Load failed|offline/i.test(raw)) return 'ai-offline';
  if (/\bnot reachable\b|ECONNREFUSED|bridge/i.test(raw)) return 'bridge-unreachable';
  if (/\b429\b|rate.?limit|overloaded/i.test(raw)) return 'ai-busy';
  if (/\b(401|403)\b|unauthor|forbidden|invalid api key/i.test(raw)) return 'ai-denied';
  if (/\b5\d\d\b/.test(raw)) return 'ai-unavailable';
  return null;
}

/**
 * One plain sentence for the screen, and the operator's version for the console.
 *
 * Order of preference:
 *   1. the operator, when the caller says so — they are the person who can fix
 *      it, and hiding the address and the command from them helps nobody. Same
 *      rule as knowledgeCopy(status, { isOperator }).
 *   2. a message we wrote ourselves that is already safe to show — `noKeyMessage`
 *      names the company and who to ask, which beats anything generic.
 *   3. the sentence for this kind of failure.
 *   4. the caller's fallback.
 *
 * @param {unknown} err
 * @param {string}  fallback  used when the failure is not one we recognise
 * @param {{ isOperator?: boolean }} opts
 * @returns {{ message: string, detail: string, code: string|null, isOperatorMessage: boolean }}
 */
export function describeAiFailure(err, fallback = AI_FALLBACK_MESSAGE, { isOperator = false } = {}) {
  const code = aiCodeOf(err);
  // Whatever the model, the bridge or the SDK actually said — for
  // console.error and a bug report, never for the page.
  const detail = [err?.detail, detailOf(err)].filter(Boolean).join(' · ').slice(0, 800);

  if (isOperator && err?.detail) {
    return { code, message: String(err.detail), detail, isOperatorMessage: true };
  }

  const own = typeof err === 'string' ? err : String(err?.message || '');
  const message = (looksWritten(own) && isPlainUserMessage(own) ? own : null)
    || (code && AI_MESSAGE_BY_CODE[code])
    || fallback;

  return { code, message, detail, isOperatorMessage: false };
}

/**
 * Does this read like a sentence somebody wrote for a person, rather than a
 * thrown word like "aborted" or a shrug? Being safe is not enough to be shown:
 * it also has to be worth reading.
 */
function looksWritten(text) {
  const s = String(text || '').trim();
  return s.length >= 20 && s.length < 200 && / /.test(s)
    && /^[A-Z“"]/.test(s) && /[.!?]$/.test(s);
}

/**
 * True when a string is safe to show a non-technical person: no shell command,
 * no URL, no bracketed command in backticks, no bare status code, no CLI or
 * provider name. Exported so the copy guard can hold every sentence to it.
 */
export function isPlainUserMessage(text) {
  const s = String(text || '');
  if (!s) return false;
  if (/`/.test(s)) return false;                       // a command in backticks
  if (/\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b/i.test(s)) return false;
  if (/https?:\/\/|localhost|127\.0\.0\.1|:\d{4}\b/i.test(s)) return false;
  if (/\b[1-5]\d\d\b/.test(s)) return false;           // an HTTP status
  if (/anthropic|claude code|\bCLI\b|ANTHROPIC_API_KEY|bridge/i.test(s)) return false;
  if (/^[A-Za-z]*Error:/.test(s)) return false;        // an SDK dump
  return true;
}
