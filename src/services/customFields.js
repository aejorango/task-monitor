// src/services/customFields.js — a project's own extra fields, everywhere.
//
// A project can define fields of its own ("Client", "Contract value", "Go-live")
// and a task carries the values in `customValues: { [fieldId]: value }`. Until
// now only the task editor read them, so a field you had filled in for fifty
// tasks could not be shown on a card, put in a column, or exported — which is
// most of the reason to have one.
//
// Pure: no Firebase, no React. The table, the board and the exporters all read
// their labels and values from here, so one field is described the same way
// wherever it turns up.

const TYPES = new Set(['text', 'number', 'date', 'select']);

/** The fields one project defines, cleaned of anything unusable. */
export function fieldsOf(project) {
  return (project?.customFields || [])
    .filter((f) => f && f.id && String(f.name || '').trim())
    .map((f) => ({
      id: f.id,
      name: String(f.name).trim(),
      type: TYPES.has(f.type) ? f.type : 'text',
      options: Array.isArray(f.options) ? f.options : [],
    }));
}

/**
 * Every field defined across a set of projects, deduplicated by id and named so
 * two projects that both have a "Client" can be told apart.
 */
export function allFields(projects = []) {
  const byId = new Map();
  const nameCount = new Map();

  for (const project of projects) {
    for (const field of fieldsOf(project)) {
      if (byId.has(field.id)) continue;
      byId.set(field.id, { ...field, projectId: project.id, projectName: project.name || '' });
      nameCount.set(field.name, (nameCount.get(field.name) || 0) + 1);
    }
  }

  return [...byId.values()].map((f) => ({
    ...f,
    // Only disambiguate when it is actually ambiguous — "Client (SBLAF rollout)"
    // on every row of a single-project table would be noise.
    label: nameCount.get(f.name) > 1 && f.projectName ? `${f.name} (${f.projectName})` : f.name,
  }));
}

/** Is this value worth showing at all? `0` and `false` are; blank is not. */
export function hasValue(value) {
  return !(value === undefined || value === null || String(value).trim() === '');
}

/** One value as the text a person reads. */
export function formatValue(field, value) {
  if (!hasValue(value)) return '';
  if (field?.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : String(value);
  }
  return String(value);
}

/** One value as something sortable: numbers as numbers, everything else lower-case. */
export function sortValue(field, value) {
  if (!hasValue(value)) return null;
  if (field?.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : String(value).toLowerCase();
  }
  // A date is already YYYY-MM-DD, which sorts correctly as text.
  return String(value).toLowerCase();
}

/**
 * What a task shows on its card: the project's fields that this task has a
 * value for, in the order the project defines them.
 *
 * @returns {{ id, label, text }[]}
 */
export function taskChips(task, project) {
  return fieldsOf(project)
    .map((field) => ({ id: field.id, label: field.name, text: formatValue(field, task?.customValues?.[field.id]) }))
    .filter((chip) => chip.text !== '');
}
