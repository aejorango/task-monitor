// src/services/aiProxyClient.js — the browser half of the server-side AI proxy.
//
// One job: send a prompt to the aiProxy Cloud Function and hand back the
// answer. It carries no key, no model and no budget — the function decides all
// three after checking who is calling. That is the whole point: a company's
// Anthropic key must never be readable from a browser.
//
// Kept apart from services/ai.js so the Functions SDK is loaded only when a
// user actually reaches for it.

import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Must match the region in functions/index.js.
export const FUNCTIONS_REGION = 'asia-southeast1';

let _callable = null;
function callable() {
  if (!_callable) {
    _callable = httpsCallable(getFunctions(getApp(), FUNCTIONS_REGION), 'aiProxy', {
      timeout: 130_000,
    });
  }
  return _callable;
}

/** Turn a Functions error into one sentence a person can act on. */
export function proxyErrorMessage(err) {
  // The function sends its own plain-language message for every refusal it
  // makes; anything else is infrastructure and gets a generic sentence.
  const code = err?.code || '';
  if (code === 'functions/unauthenticated') {
    return 'You are signed out. Reload the page and sign in again.';
  }
  if (code === 'functions/permission-denied' || code === 'functions/invalid-argument') {
    return err?.message || 'AI features are not available for your account.';
  }
  if (code === 'functions/not-found') {
    return 'AI is not set up on this deployment yet. Ask your administrator.';
  }
  if (code === 'functions/deadline-exceeded') {
    return 'The AI took too long to answer. Try a shorter question.';
  }
  if (code === 'functions/resource-exhausted') {
    return 'AI is busy right now. Try again in a moment.';
  }
  return 'The AI service could not be reached. Try again in a moment.';
}

export async function callAiProxy({ system, user, maxTokens }) {
  try {
    const { data } = await callable()({ system, user, maxTokens });
    return {
      text: String(data?.text || '').trim(),
      model: data?.model || null,
      usage: data?.usage || null,
    };
  } catch (err) {
    const e = new Error(proxyErrorMessage(err));
    e.code = err?.code || 'proxy-failed';
    throw e;
  }
}
