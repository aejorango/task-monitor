// src/services/projectPicker.js — which projects the project picker offers,
// and in what order. Pure: no React, no Firebase.
//
// The picker is for choosing what to WORK on, so an archived project is not
// offered: archiving is how somebody says "stop showing me this", and a
// picker that keeps listing it ignores them. Projects → Portfolio is still
// where an archived project is found (folded at the foot) and unarchived.
// The one exception is the project already chosen — a link or a saved view
// can point at one that was archived since — which stays, marked, so the
// menu never hides what the page is currently filtered to.
//
// Order is A–Z by name: case and accents ignored, leading spaces ignored,
// and numbers read as numbers, so "Phase 2" comes before "Phase 10".

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const nameOf = (p) => String(p?.name || '').trim();

export function pickerProjects(projects = [], selectedId = 'all') {
  return projects
    .filter((p) => p && !p.deleted && (!p.archived || p.id === selectedId))
    .map((p) => (p.archived ? { ...p, _archived: true } : p))
    .sort((a, b) => collator.compare(nameOf(a), nameOf(b)) || String(a.id).localeCompare(String(b.id)));
}
