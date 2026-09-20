// src/services/projects.js — project-list shaping, as pure functions.
//
// A user sees projects from two places: the workspace-scoped query, and
// projects in that workspace they were added to individually (a share). They
// must appear once, in one order, with the shared ones marked.

/**
 * Merge the workspace-scoped list with the shared-project list.
 *
 * A project belongs to exactly ONE workspace and must appear only there, so
 * shared projects from other workspaces are dropped rather than bleeding into
 * the current one. Shared-only projects carry `_shared: true` — the picker and
 * the Projects page render a "Shared" badge off that flag.
 *
 * @param {object[]} workspaceProjects  projects from the active workspace
 * @param {object[]} sharedProjects     projects the user is a member of, any workspace
 * @param {string}   workspaceId        the active workspace
 */
export function mergeProjectLists(workspaceProjects = [], sharedProjects = [], workspaceId = null) {
  const map = new Map();
  workspaceProjects.forEach((p) => map.set(p.id, p));

  sharedProjects.forEach((p) => {
    if (p.workspaceId === workspaceId && !map.has(p.id)) {
      map.set(p.id, { ...p, _shared: true });
    }
  });

  // Latest first by createdAt, matching the underlying subscribers' sort.
  return [...map.values()].sort((a, b) => {
    const at = a.createdAt?.toMillis?.() ?? 0;
    const bt = b.createdAt?.toMillis?.() ?? 0;
    return bt - at;
  });
}
