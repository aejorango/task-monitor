// src/services/logTime.js — which task the Dashboard's "Log time" button is
// about, and what it should therefore say (T-0122 / POL-012).
//
// The button used to choose a task silently and then open a READ-ONLY list of
// entries already logged against it. Two separate problems, and the pick is the
// half that belongs in a pure module:
//
//   · It named its choice only in a `title` attribute, so on a touch device —
//     where there is no hover — nothing told you which task you were about to
//     log against until the modal was already open.
//   · When nothing was overdue and nothing was in progress it fell through to
//     `filtered[0]`: whichever task happened to sort first. That is not a
//     choice, it is a coin toss with the user's timesheet.
//
// So: pick only when there is a real reason to (something is late, something
// is due today, something is in progress), say which task on the button face,
// and when there is no such reason ask rather than guess.

// A button is not a paragraph. Past this many characters the title is cut at a
// word boundary, and the whole thing stays in the tooltip and the form heading.
const MAX_LABEL = 32;

export function shortTitle(title, max = MAX_LABEL) {
  const text = String(title || '').trim();
  if (!text) return '(untitled task)';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Which task "Log time" should open on.
 *
 * @param {object}   ctx
 * @param {Array}    ctx.actionQueue  the Dashboard's queue: [{ task, isLate }]
 * @param {Array}    ctx.inProgress   tasks whose status is 'doing'
 * @param {Array}    ctx.tasks        everything in scope, for the empty check
 * @returns {{ task: object|null, reason: string }}
 *   reason is 'overdue' | 'due-today' | 'in-progress' | 'choose' | 'empty'.
 *   A null task with reason 'choose' means: open the picker, do not guess.
 */
export function logTimeTarget({ actionQueue = [], inProgress = [], tasks = [] } = {}) {
  const queued = actionQueue.find((entry) => entry && entry.task);
  if (queued) {
    return { task: queued.task, reason: queued.isLate ? 'overdue' : 'due-today' };
  }
  const doing = inProgress.find(Boolean);
  if (doing) return { task: doing, reason: 'in-progress' };
  // Nothing is late, due or under way. There is no defensible first choice, so
  // the button opens the picker instead of inventing one.
  return { task: null, reason: tasks.some(Boolean) ? 'choose' : 'empty' };
}

const WHY = {
  'overdue':     'your most overdue task',
  'due-today':   'the task due today',
  'in-progress': 'the task you have in progress',
};

/**
 * What the button says and what its tooltip says. The label carries the task
 * title so a touch user sees it too; the tooltip carries the full title and
 * the reason it was chosen, and always says the choice can be changed.
 */
export function logTimeLabel(target) {
  const { task, reason } = target || {};
  if (!task) {
    return {
      label: 'Log time',
      title: reason === 'empty'
        ? 'Add a task first — hours are recorded against a task'
        : 'Pick a task and record the hours you spent on it',
      disabled: reason === 'empty',
    };
  }
  return {
    label: `Log time · ${shortTitle(task.title)}`,
    title: `Record hours against "${task.title}" — ${WHY[reason] || 'your next task'}. You can pick a different task.`,
    disabled: false,
  };
}
