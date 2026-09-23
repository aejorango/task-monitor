// src/services/activeWorkspace.js — which workspace is the active one, after a
// snapshot of the workspaces you belong to.
//
// This is three lines of arithmetic that were inline in `useWorkspaces`, and
// they cost the Activity log and Work performed pages their contents:
//
//     const stillValid = data.some((w) => w.id === _activeWorkspaceId);
//     if (!stillValid) setActiveWorkspaceId(data[0]?.id || null);
//
// Run that on an EMPTY snapshot and it clears the active workspace — and
// clears the localStorage key with it, so the damage outlives the reload. Every
// `useActiveWorkspaceId()` then returns null, every workspace-scoped listener
// takes its `if (!workspaceId)` branch and sets its list to `[]`, and the two
// pages that are nothing but a list render an empty table. No error, no
// spinner: the data simply disappears.
//
// The flaw is treating an empty snapshot as proof. It is not. It is ALSO what a
// listener that failed looks like, because `listenerError` in firebase.js
// answers any error with `callback([])` — an auth token refreshing, a rules
// evaluation losing a race, a network blip. "I could not read your workspaces"
// and "you are in no workspaces" arrive as the same value, and only one of them
// justifies throwing state away.
//
// So: an empty snapshot changes nothing. The active workspace is re-pointed
// only when there is something real to re-point it AT.
//
// Pure — no Firebase, no localStorage, no clock — so `node --test` can put it
// through every case.

/**
 * The workspace id that should be active after `workspaces` arrives.
 *
 * @param {Array<{id: string}>} workspaces  the snapshot, newest state of the list
 * @param {string|null} current             the currently-active id
 * @returns {string|null} the id to use — `current` when nothing should change
 */
export function nextActiveWorkspaceId(workspaces, current = null) {
  const list = Array.isArray(workspaces) ? workspaces.filter((w) => w && w.id) : [];

  // An empty snapshot is not evidence. Keep whatever was active: if the read
  // really did fail, the next good snapshot puts things right on its own, and
  // if the list really is empty there is nothing better to point at anyway.
  if (list.length === 0) return current ?? null;

  // Still a member — nothing to do. This is the overwhelmingly common path and
  // it must not churn the id, because every workspace-scoped listener in the
  // app tears down and rebuilds when it changes.
  if (current && list.some((w) => w.id === current)) return current;

  // Removed from it, or nothing chosen yet: fall to the first one.
  return list[0].id;
}

/**
 * Whether a workspace-scoped page is still WAITING rather than empty.
 *
 * Signed in but with no workspace resolved yet is a loading state, not a
 * result. Rendering "no activities" there is the same lie in a smaller place:
 * the query has not been asked, so its answer cannot be "none".
 */
export function isResolvingWorkspace({ ready, userId, workspaceId }) {
  return Boolean(ready && userId && !workspaceId);
}
