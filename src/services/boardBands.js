// src/services/boardBands.js — which Kanban bands are open.
//
// The Board Explorer divides the cards under the four column heads into
// collapsible bands: one per project across the whole board, one per phase
// inside a single project. Which of them are open was `expandedSegments[id]
// === true` with "absent means collapsed", so the board opened entirely shut.
//
// Ace asked for the FIRST band to open. That makes the state three-valued
// rather than two, and the distinction is the whole of this module:
//
//   true   — somebody opened it
//   false  — somebody SHUT it
//   absent — nobody has said, so the default applies (first band open)
//
// Collapsing "absent" and "shut" together is what makes this subtle. If
// "Collapse all" writes `{}` — which is what it used to do, and what looks
// right — the first band immediately springs back open, because `{}` means
// "nobody has said" and the default reopens it. So Collapse all has to write
// an explicit `false` for every band. A button that visibly fails to do the
// one thing it is named after is worse than no button.
//
// Pure: no React, no Firebase. `node --test` covers the cases a click-through
// would take a minute each to reach.

/**
 * Is the band at `index` open?
 *
 * @param {Record<string, boolean>} expanded  what the reader has said so far
 * @param {string} bandId
 * @param {number} index                      position in the band list
 */
export function isBandOpen(expanded, bandId, index) {
  const stated = expanded?.[bandId];
  if (typeof stated === 'boolean') return stated;
  // Nobody has said. The first band is open so the board lands on something
  // to read rather than a stack of shut drawers; the rest stay closed, because
  // twenty open projects is a scroll, not a board.
  return index === 0;
}

/** Every band explicitly open. */
export function expandAll(bands = []) {
  return Object.fromEntries(bands.map((b) => [b.id, true]));
}

/**
 * Every band explicitly SHUT.
 *
 * Not `{}`. An empty object means "nobody has said", and the default would
 * reopen the first band the instant it was written.
 */
export function collapseAll(bands = []) {
  return Object.fromEntries(bands.map((b) => [b.id, false]));
}
