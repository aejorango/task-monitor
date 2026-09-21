// src/services/taskTree.js — a promoted subtask that is still a subtask
// (T-0141 / NEW-025).
//
// Subtasks are a flat checklist on the task document, and the only way out was
// `promoteSubtask`: it created a separate task, linked it "related to" and
// removed the line from the checklist — so the hierarchy was lost at exactly
// the moment a checklist item turned out to need dates, an owner or its own
// log.
//
// The `links: [{ targetId, type }]` array is already the right shape. A promote
// writes `child-of` on the new task, and this module reads that back as a tree.
//
// Pure: no Firestore. It is also the one place that knows a parent's progress
// is not just its own — which feeds the dashboard's RAG and the status report,
// so the arithmetic is worth having somewhere it can be checked.

/** A child points at its parent. The parent's own link is the mirror. */
export const CHILD_OF = 'child-of';
export const PARENT_OF = 'parent-of';

/** How deep the tree may go before we stop believing it. */
export const MAX_DEPTH = 10;

/** The parent this task claims, or null. */
export function parentIdOf(task) {
  const link = (task?.links || []).find((l) => l?.type === CHILD_OF && l.targetId);
  return link ? link.targetId : null;
}

/** The tasks that claim `task` as their parent, in the order given. */
export function childrenOf(task, allTasks = []) {
  if (!task?.id) return [];
  return allTasks.filter((t) => t
    && !t.deleted && !t.archived
    && t.id !== task.id
    && parentIdOf(t) === task.id);
}

/**
 * Every descendant, breadth-first, with no task visited twice.
 *
 * A cycle — A child-of B, B child-of A — is data that should not exist, but a
 * rollup that recurses forever on it takes the whole editor down. `seen` is the
 * guard, and MAX_DEPTH is the second one.
 */
export function descendantsOf(task, allTasks = [], { maxDepth = MAX_DEPTH } = {}) {
  const out = [];
  const seen = new Set([task?.id]);
  let frontier = childrenOf(task, allTasks);
  let depth = 0;

  while (frontier.length && depth < maxDepth) {
    const next = [];
    for (const child of frontier) {
      if (seen.has(child.id)) continue;      // a cycle, or a diamond
      seen.add(child.id);
      out.push(child);
      next.push(...childrenOf(child, allTasks));
    }
    frontier = next;
    depth += 1;
  }
  return out;
}

const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);

/**
 * A parent's progress, counting its checklist AND its promoted children.
 *
 * A subtask that grows into a task must not vanish from the parent's progress
 * — that is what promoting used to do. Each counts as one unit of the same
 * weight, because that is what they were before one of them was promoted.
 *
 * @returns {{
 *   progress, hasChildren, children, subtaskCount, subtasksDone,
 *   childCount, childrenDone, units, unitsDone, hours, source,
 * }}
 *   `source` is 'own' when nothing rolls up — the task's stated progress is
 *   then the answer, exactly as before.
 */
export function rollup(task, allTasks = []) {
  const children = childrenOf(task, allTasks);
  const subtasks = task?.subtasks || [];

  const subtaskCount = subtasks.length;
  const subtasksDone = subtasks.filter((s) => s?.done).length;
  const childCount = children.length;
  const childrenDone = children.filter((c) => c.status === 'done').length;

  const units = subtaskCount + childCount;
  const unitsDone = subtasksDone + childrenDone;

  // Hours a parent is really carrying: its own plus everything under it. The
  // whole descendant set, not just the direct children — otherwise a two-level
  // tree under-reports.
  const hours = [task, ...descendantsOf(task, allTasks)]
    .reduce((n, t) => n + (Number(t?.totalHoursLogged) || 0), 0);

  if (units === 0) {
    return {
      progress: task?.status === 'done' ? 100 : (task?.progress ?? 0),
      hasChildren: false, children: [],
      subtaskCount: 0, subtasksDone: 0, childCount: 0, childrenDone: 0,
      units: 0, unitsDone: 0, hours, source: 'own',
    };
  }

  return {
    // A parent explicitly marked done is done, whatever is underneath it —
    // somebody decided, and the app does not argue.
    progress: task?.status === 'done' ? 100 : pct(unitsDone, units),
    hasChildren: childCount > 0,
    children,
    subtaskCount, subtasksDone, childCount, childrenDone,
    units, unitsDone, hours,
    source: childCount > 0 ? (subtaskCount > 0 ? 'both' : 'children') : 'subtasks',
  };
}

/** One line explaining where a rolled-up percentage came from. */
export function explainRollup(r) {
  if (!r || r.source === 'own') return null;
  const bits = [];
  if (r.subtaskCount) bits.push(`${r.subtasksDone}/${r.subtaskCount} subtask${r.subtaskCount === 1 ? '' : 's'}`);
  if (r.childCount) bits.push(`${r.childrenDone}/${r.childCount} task${r.childCount === 1 ? '' : 's'} under it`);
  return `From ${bits.join(' and ')}`;
}

/**
 * Whether `candidate` may become a child of `parent`.
 *
 * Refuses the two ways a tree stops being one: a task being its own parent, and
 * a task being adopted by something already beneath it.
 *
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function canParent(parent, candidate, allTasks = []) {
  if (!parent?.id || !candidate?.id) return { ok: false, reason: 'Nothing to link.' };
  if (parent.id === candidate.id) {
    return { ok: false, reason: 'A task cannot be inside itself.' };
  }
  const beneath = descendantsOf(candidate, allTasks).some((t) => t.id === parent.id);
  if (beneath) {
    return { ok: false, reason: 'That task already sits above this one.' };
  }
  return { ok: true, reason: null };
}

/**
 * Tasks arranged as a tree, for a table that indents them.
 *
 * Every task appears exactly once: a child whose parent is not in the list is
 * shown at the top level rather than dropped, because a filtered view should
 * hide nothing it was asked to show.
 */
export function asTree(tasks = [], { maxDepth = MAX_DEPTH } = {}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = [];
  const placed = new Set();

  const walk = (task, depth) => {
    if (placed.has(task.id) || depth > maxDepth) return;
    placed.add(task.id);
    out.push({ task, depth });
    for (const child of tasks) {
      if (parentIdOf(child) === task.id) walk(child, depth + 1);
    }
  };

  for (const task of tasks) {
    const parentId = parentIdOf(task);
    // A root is a task with no parent, or one whose parent is not on screen.
    if (!parentId || !byId.has(parentId)) walk(task, 0);
  }
  // Anything left is inside a cycle. Show it rather than lose it.
  for (const task of tasks) if (!placed.has(task.id)) out.push({ task, depth: 0 });
  return out;
}
