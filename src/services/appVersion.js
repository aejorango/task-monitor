// src/services/appVersion.js — what version is running, for the About panel
// and for anyone filing a bug report.
//
// `__APP_VERSION__` and `__BUILD_DATE__` are replaced at build time by Vite
// from package.json (see vite.config.js), so the number on screen is always the
// number that was shipped. Under `node --test` there is no Vite, hence the
// guards — a test must never be the reason this throws.

/* global __APP_VERSION__, __BUILD_DATE__ */

export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

export const BUILD_DATE =
  typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';

/** "v0.2.0 · built 2026-09-20" — the one line to quote in a bug report. */
export function versionLine() {
  return BUILD_DATE ? `v${APP_VERSION} · built ${BUILD_DATE}` : `v${APP_VERSION}`;
}
