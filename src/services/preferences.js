// src/services/preferences.js — per-device preference resolution.
//
// Small, but not trivial: "which project should the quick-add box start on"
// has three inputs (the page's project filter, the user's saved default, and
// what projects actually exist) and the wrong answer files work in the wrong
// place. Pure, so it is tested rather than eyeballed.

/**
 * Which project the quick-add form should preselect.
 *
 * Order of precedence:
 *   1. The project the Board is already filtered to — you are looking at it.
 *   2. Settings → Defaults → "Default project for quick-add", if it still exists.
 *   3. The first project in the list.
 *
 * @param {object[]} projects       projects visible to the user
 * @param {{ projectFilter?: string, defaultProject?: string|null }} opts
 * @returns {string|null} a project id, or null when there are no projects
 */
export function pickDefaultProjectId(projects = [], { projectFilter, defaultProject } = {}) {
  const exists = (id) => !!id && projects.some((p) => p.id === id);

  if (projectFilter && projectFilter !== 'all' && exists(projectFilter)) return projectFilter;
  // A saved default that points at a deleted or unshared project must fall
  // through rather than leaving the box empty.
  if (exists(defaultProject)) return defaultProject;
  return projects[0]?.id ?? null;
}
