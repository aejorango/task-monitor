// src/services/duplicate.js — "do that again" (T-0139 / NEW-019).
//
// Templates cover the planned case: you knew in advance this shape would
// recur. The far commoner case is decided after the fact — do that again for
// the next client — and the app had no answer for it anywhere.
//
// A duplicate is a template payload plus the things that make it the same TASK
// rather than the same shape: its plan dates, its estimate, its links. What it
// must never carry is anything that belongs to the original's history —
// counters, activity, actual dates — or an id.
//
// Pure: it builds the payloads. `firebase.js` writes them.

import { addDaysISO } from './recurrence';

export const COPY_SUFFIX = ' (copy)';

/**
 * "Board pack" → "Board pack (copy)" → "Board pack (copy 2)" → "(copy 3)".
 *
 * Duplicating a duplicate is normal — that is how somebody makes five of
 * something — and "Board pack (copy) (copy) (copy)" is a worse answer than a
 * number.
 */
export function copiedTitle(title, suffix = COPY_SUFFIX) {
  const base = String(title || 'Untitled');
  const word = suffix.trim().replace(/^\(|\)$/g, '');
  const re = new RegExp(`\\s*\\(${word}(?:\\s+(\\d+))?\\)$`);
  const hit = re.exec(base);
  if (!hit) return `${base}${suffix}`;
  const n = Number(hit[1] || 1) + 1;
  return `${base.slice(0, hit.index)} (${word} ${n})`;
}

/** Whole days from `a` to `b`, or 0 when either is missing. */
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const [ay, am, ad] = String(a).split('-').map(Number);
  const [by, bm, bd] = String(b).split('-').map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return 0;
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86_400_000);
}

const shifted = (iso, days) => (iso && days ? addDaysISO(iso, days) : (iso || null));

/**
 * One task, as a new task.
 *
 * @param {object} task
 * @param {object} opts
 * @param {string} [opts.titleSuffix]  '' to keep the title as it is
 * @param {object} [opts.phaseMap]     old phase id → new phase id, for a
 *                                     project copy whose phases are new
 * @param {string} [opts.projectId]    the project it lands in
 * @param {number} [opts.dayShift]     move every plan date by this many days
 * @param {object} [opts.taskMap]      old task id → new task id, so a
 *                                     dependency inside the copy points at the
 *                                     COPY rather than back at the original
 */
export function duplicateTaskPayload(task, {
  titleSuffix = COPY_SUFFIX, phaseMap = null, projectId, dayShift = 0, taskMap = null,
} = {}) {
  if (!task) return null;

  const phaseId = phaseMap
    ? (phaseMap[task.phaseId] ?? null)
    : (task.phaseId || null);

  // A dependency on a task that was NOT copied would point back into the
  // original — the copy would wait on the thing it was copied from. Those are
  // dropped; the ones inside the copy are remapped.
  const remap = (ids) => (taskMap
    ? (ids || []).map((id) => taskMap[id]).filter(Boolean)
    : [...(ids || [])]);

  return {
    title: copiedTitle(task.title, titleSuffix),
    description: task.description || '',
    priority: task.priority || 'medium',
    requestedBy: task.requestedBy || '',
    category: task.category || undefined,
    workspaceId: task.workspaceId,
    projectId: projectId !== undefined ? projectId : (task.projectId || null),
    phaseId,
    tags: [...(task.tags || [])],
    // Fresh ids and every box unticked: a copy has not been started.
    subtasks: (task.subtasks || []).map((s, i) => ({
      id: `${Date.now().toString(36)}${i}`, text: s.text, done: false,
    })),
    recurrence: task.recurrence || null,
    estimateHours: task.estimateHours ?? null,
    assignedTo: [...(task.assignedTo || [])],
    assignedToExternal: [...(task.assignedToExternal || [])],
    customValues: { ...(task.customValues || {}) },
    dependsOn: remap(task.dependsOn),
    links: taskMap
      ? (task.links || []).map((l) => ({ ...l, targetId: taskMap[l.targetId] })).filter((l) => l.targetId)
      : (task.links || []).map((l) => ({ ...l })),

    // The plan comes with it; the HISTORY does not.
    plan: {
      startDate: shifted(task.plan?.startDate, dayShift),
      endDate:   shifted(task.plan?.endDate, dayShift),
    },
    // Explicitly: a copy has not started, has not finished, has no hours
    // against it and no activity. `addTask` derives these from status anyway,
    // and stating them here is what makes that impossible to get wrong.
    status: 'todo',
    progress: 0,
    actual: { startDate: null, endDate: null },
  };
}

/** Fields a duplicate must never carry out of the original. */
export const NEVER_COPIED = [
  'id', 'createdAt', 'updatedAt', 'lastActivityAt',
  'activityCount', 'totalHoursLogged', 'attachmentCount',
  'recurrenceParentId', 'deleted', 'archived',
];

/**
 * A project and, optionally, its tasks.
 *
 * Plan dates keep their relative offsets: the earliest date in the copy lands
 * on `startOn` (today by default), and everything else moves with it. A set of
 * tasks planned across three weeks is still planned across three weeks.
 *
 * @returns {{ project: object, tasks: object[], dayShift: number, skipped: number }}
 */
export function duplicateProjectPlan(project, tasks = [], {
  withTasks = true, titleSuffix = COPY_SUFFIX, startOn = null, includeDone = false,
} = {}) {
  if (!project) return { project: null, tasks: [], dayShift: 0, skipped: 0 };

  // New phase ids: two projects must not share a phase id, or moving a task in
  // one would move it in the other.
  const phaseMap = {};
  const phases = (project.phases || []).map((p, i) => {
    const id = `${Date.now().toString(36)}p${i}`;
    phaseMap[p.id] = id;
    return { id, name: p.name, order: p.order ?? i };
  });

  const copiedProject = {
    workspaceId: project.workspaceId,
    name: copiedTitle(project.name, titleSuffix),
    description: project.description || '',
    color: project.color,
    icon: project.icon,
    segment: project.segment,
    phases,
    customFields: (project.customFields || []).map((f) => ({ ...f })),
    assignedTo: [...(project.assignedTo || [])],
    assignedToExternal: [...(project.assignedToExternal || [])],
    knowledge: project.knowledge || null,
    wipLimits: { ...(project.wipLimits || {}) },
    wipAgeingDays: project.wipAgeingDays ?? null,
  };

  if (!withTasks) return { project: copiedProject, tasks: [], dayShift: 0, skipped: 0 };

  const own = tasks.filter((t) => t
    && t.projectId === project.id
    && !t.deleted && !t.archived
    && (includeDone || t.status !== 'done'));
  const skipped = tasks.filter((t) => t && t.projectId === project.id
    && !t.deleted && !t.archived).length - own.length;

  // The shift: move the earliest planned day to `startOn`. With no dates at
  // all, nothing moves — a copy of an undated backlog is an undated backlog.
  const earliest = own
    .flatMap((t) => [t.plan?.startDate, t.plan?.endDate])
    .filter(Boolean)
    .sort()[0] || null;
  const dayShift = startOn && earliest ? daysBetween(earliest, startOn) : 0;

  // Two passes: the ids have to exist before a dependency can point at one.
  const taskMap = {};
  own.forEach((t, i) => { taskMap[t.id] = `__new_${i}__`; });

  const copiedTasks = own.map((t) => ({
    ...duplicateTaskPayload(t, {
      titleSuffix: '',                 // the PROJECT is the copy, not each task
      phaseMap,
      projectId: '__new_project__',
      dayShift,
      taskMap,
    }),
    // The placeholder this task will be known by while dependencies are wired.
    _tempId: taskMap[t.id],
  }));

  return { project: copiedProject, tasks: copiedTasks, dayShift, skipped };
}

/** What to tell the user before they commit to it. */
export function describeDuplicate({ project, tasks, skipped, dayShift }) {
  const n = tasks?.length || 0;
  const parts = [`“${project?.name}”`];
  parts.push(n === 0 ? 'with no tasks' : `with ${n} task${n === 1 ? '' : 's'}`);
  if (skipped > 0) parts.push(`(${skipped} finished ${skipped === 1 ? 'one is' : 'ones are'} left behind)`);
  if (dayShift) {
    parts.push(dayShift > 0
      ? `, moved ${dayShift} day${dayShift === 1 ? '' : 's'} later`
      : `, moved ${-dayShift} day${dayShift === -1 ? '' : 's'} earlier`);
  }
  return parts.join(' ').replace(' ,', ',');
}
