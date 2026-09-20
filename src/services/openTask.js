// src/services/openTask.js — "take me to that task".
//
// Opening a task is two steps: get to the Board with that task's project
// showing, then ask the Board to open its editor. The search results did this
// inline; the inbox needs exactly the same thing, so it lives here rather than
// being written twice with two different delays.

export const OPEN_TASK_EVENT = 'task-monitor:open-task';

/** Ask whatever is on screen to open this task's editor. */
export function requestOpenTask(taskId, { delay = 50, target = globalThis } = {}) {
  if (!taskId || !target?.dispatchEvent) return;
  const fire = () => target.dispatchEvent(
    new CustomEvent(OPEN_TASK_EVENT, { detail: { taskId } }),
  );
  // A delay so the Board has mounted (or received the new project filter)
  // before it is asked to open anything.
  if (delay > 0 && typeof target.setTimeout === 'function') target.setTimeout(fire, delay);
  else fire();
}

/**
 * Navigate to a task and open it.
 *
 * @param {{ id, projectId? }} task
 * @param {(route) => void} navigate   the router from AppShell
 */
export function goToTask(task, navigate, opts = {}) {
  if (!task?.id) return;
  navigate?.({ view: 'board', projectFilter: task.projectId || 'all' });
  requestOpenTask(task.id, opts);
}
