// functions/src/authorize.js — may this caller spend the company's AI budget?
//
// Pure: it is handed the caller's claims and the two documents, and returns a
// decision. That keeps the rule readable and testable without a Firebase
// emulator — the proxy itself is then a thin shell around it.

export const DENY = {
  UNAUTHENTICATED: 'unauthenticated',
  NOT_APPROVED:    'not-approved',
  NO_COMPANY:      'no-company',
  COMPANY_OFF:     'company-ai-disabled',
  NO_KEY:          'company-has-no-key',
  BAD_REQUEST:     'bad-request',
};

/** One sentence per refusal, written for the person who sees it. */
export const DENY_MESSAGE = {
  [DENY.UNAUTHENTICATED]: 'You are signed out. Reload the page and sign in again.',
  [DENY.NOT_APPROVED]:    'Your account is still waiting for approval, so AI features are off.',
  [DENY.NO_COMPANY]:      'AI features are not enabled for your account. Ask your administrator.',
  [DENY.COMPANY_OFF]:     'AI features are switched off for your organisation. Ask your administrator.',
  [DENY.NO_KEY]:          'Your organisation has not finished setting up AI. Ask your administrator.',
  [DENY.BAD_REQUEST]:     'That request could not be understood.',
};

export const MAX_PROMPT_CHARS = 200_000;
export const MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * @param {{ uid?: string }|null} auth      the callable's auth context
 * @param {object|null} userDoc             users/{uid}
 * @param {object|null} companyDoc          companies/{companyId}
 * @param {string} apiKey                   the key, read server-side only
 * @returns {{ ok: true, companyId, model } | { ok: false, code, message }}
 */
export function authorizeAiCall(auth, userDoc, companyDoc, apiKey) {
  const deny = (code) => ({ ok: false, code, message: DENY_MESSAGE[code] });

  if (!auth?.uid) return deny(DENY.UNAUTHENTICATED);
  if (!userDoc) return deny(DENY.NOT_APPROVED);
  if (userDoc.status !== 'approved') return deny(DENY.NOT_APPROVED);

  const companyId = userDoc.companyId || null;
  if (!companyId) return deny(DENY.NO_COMPANY);
  if (!companyDoc) return deny(DENY.NO_COMPANY);
  if (companyDoc.deleted) return deny(DENY.NO_COMPANY);
  // A missing field is a company created before the switch existed; only an
  // explicit false revokes access.
  if (companyDoc.aiEnabled === false) return deny(DENY.COMPANY_OFF);
  if (!String(apiKey || '').trim()) return deny(DENY.NO_KEY);

  return {
    ok: true,
    companyId,
    model: String(companyDoc.anthropicModel || '').trim() || DEFAULT_MODEL,
  };
}

/**
 * Normalise and bound what the client asked for. The client cannot choose the
 * key, cannot choose an unbounded token budget, and cannot send an arbitrary
 * body through to Anthropic.
 */
export function normalizeAiRequest(data) {
  const system = typeof data?.system === 'string' ? data.system : '';
  const user   = typeof data?.user === 'string' ? data.user : '';
  if (!system.trim() || !user.trim()) {
    return { ok: false, code: DENY.BAD_REQUEST, message: DENY_MESSAGE[DENY.BAD_REQUEST] };
  }
  if (system.length + user.length > MAX_PROMPT_CHARS) {
    return {
      ok: false,
      code: DENY.BAD_REQUEST,
      message: 'That request is too long. Shorten it and try again.',
    };
  }

  const asked = Number(data?.maxTokens);
  const maxTokens = Number.isFinite(asked)
    ? Math.max(256, Math.min(MAX_OUTPUT_TOKENS, Math.round(asked)))
    : 2048;

  return { ok: true, system, user, maxTokens };
}
