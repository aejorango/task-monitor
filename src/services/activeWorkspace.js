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

// ── "All workspaces": a VIEW of every workspace at once ─────────────────────
//
// The active workspace stays a real workspace. "All workspaces" is a separate
// flag that widens what the pages READ — tasks, projects, activities, goals,
// minutes from every workspace you belong to — while everything that WRITES
// keeps a real home: an edit goes to the item's own workspace (it always
// did), a new task goes to its project's workspace (shared projects already
// required that), and anything else new lands in the active workspace, which
// the switcher names as where new items go. A sentinel id in place of the
// active one would have leaked into every one of those writes instead.

/** The workspace ids a page should read. Archived and deleted ones are left out. */
export function scopeWorkspaceIds({ all, activeId, workspaces = [] }) {
  if (!all) return activeId ? [activeId] : [];
  const ids = workspaces.filter((w) => w && w.id && !w.deleted && !w.archived).map((w) => w.id);
  // The active one first, so a merged list's ties break the way a single one did.
  return activeId && ids.includes(activeId) ? [activeId, ...ids.filter((id) => id !== activeId)] : ids;
}

/**
 * Every member's profile across the given workspaces, keyed by uid. A person
 * is the same person in every workspace, so the union is safe — and it is what
 * lets a task from another workspace show its owner's name, not a uid.
 */
export function mergedMemberProfiles(workspaces = []) {
  const out = {};
  workspaces.forEach((w) => {
    Object.entries(w?.memberProfiles || {}).forEach(([uid, p]) => {
      out[uid] = { ...(p || {}), ...(out[uid] || {}) };
    });
  });
  return out;
}

/**
 * The workspace a page is looking at: the active one, or — across all of
 * them — a combined stand-in with every member and every profile. `id` stays
 * the ACTIVE workspace's, because that is where anything new is written.
 */
export function viewWorkspace({ all, activeId, workspaces = [] }) {
  const active = workspaces.find((w) => w.id === activeId) || null;
  if (!all) return active;
  const live = workspaces.filter((w) => w && !w.deleted && !w.archived);
  const members = [...new Set(live.flatMap((w) => w.members || []))];
  return {
    ...(active || {}),
    id: activeId,
    name: 'All workspaces',
    all: true,
    home: active,
    count: live.length,
    members,
    memberProfiles: mergedMemberProfiles(live),
  };
}
