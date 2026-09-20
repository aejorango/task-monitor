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
