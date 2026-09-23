// functions/src/automations.js — "when this happens, do that", in plain words.
//
// A rule is three plain-language choices: a TRIGGER (what happened), any number
// of CONDITIONS (when it matters), and an ACTION (what to do). Nobody types
// JSON; the Settings form is dropdowns over the vocabularies below, and this
// module is what evaluates them.
//
// Pure: it decides what SHOULD happen and returns a description. The function
// that performs the writes is functions/automations.js.

export const TRIGGERS = [
  { value: 'task.created',   label: 'A task is created' },
  { value: 'task.completed', label: 'A task is completed' },
  { value: 'task.overdue',   label: 'A task becomes overdue' },
  { value: 'task.assigned',  label: 'A task is assigned to someone' },
  { value: 'task.updated',   label: 'A task is changed' },
  { value: 'activity.logged', label: 'Work is logged on a task' },
];

export const CONDITION_FIELDS = [
  { value: 'project',  label: 'Project',       type: 'project' },
  { value: 'priority', label: 'Priority',      type: 'choice', options: ['low', 'medium', 'high'] },
  { value: 'status',   label: 'Status',        type: 'choice', options: ['todo', 'doing', 'review', 'done'] },
  { value: 'tag',      label: 'Tag',           type: 'text' },
  { value: 'assignee', label: 'Assigned to',   type: 'member' },
  { value: 'title',    label: 'Task name',     type: 'text' },
];

export const OPERATORS = [
  { value: 'is',       label: 'is' },
  { value: 'is_not',   label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'is_empty', label: 'is empty', noValue: true },
  { value: 'is_set',   label: 'is set',   noValue: true },
];

export const ACTIONS = [
  { value: 'notify',      label: 'Tell someone',            needs: 'member' },
  { value: 'assign',      label: 'Assign it to someone',    needs: 'member' },
  { value: 'set_priority', label: 'Set its priority',       needs: 'choice', options: ['low', 'medium', 'high'] },
  { value: 'set_phase',   label: 'Move it to a phase',      needs: 'phase' },
  { value: 'add_tag',     label: 'Add a tag',               needs: 'text' },
  { value: 'follow_up',   label: 'Create a follow-up task', needs: 'text' },
  { value: 'webhook',     label: 'Send it to a webhook',    needs: 'webhook' },
];

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** The value of a condition field on a task. */
export function fieldValue(field, task, context = {}) {
  switch (field) {
    case 'project':  return task?.projectId || '';
    case 'priority': return task?.priority || '';
    case 'status':   return task?.status || '';
    case 'title':    return task?.title || '';
    case 'tag':      return (task?.tags || []).join(' ');
    case 'assignee': return [...(task?.assignedTo || []), ...(task?.assignedToExternal || [])].join(' ');
    default:         return context[field] ?? '';
  }
}

/** Does one condition hold? */
export function conditionHolds(condition, task, context = {}) {
  const actual = fieldValue(condition?.field, task, context);
  const expected = condition?.value;

  switch (condition?.operator) {
    case 'is':       return lower(actual) === lower(expected);
    case 'is_not':   return lower(actual) !== lower(expected);
    case 'contains': return lower(expected) !== '' && lower(actual).includes(lower(expected));
    case 'is_empty': return lower(actual) === '';
    case 'is_set':   return lower(actual) !== '';
    default:         return false;    // an unknown operator never fires
  }
}

/**
 * Should this rule run?
 * Conditions are ANDed — "when ALL of these are true" is what the form says.
 */
export function ruleMatches(rule, event, task, context = {}) {
  if (!rule || rule.enabled === false || rule.deleted) return false;
  if (rule.trigger !== event) return false;
  const conditions = rule.conditions || [];
  return conditions.every((c) => conditionHolds(c, task, context));
}

export function rulesFor(rules, event, task, context = {}) {
  return (rules || []).filter((r) => ruleMatches(r, event, task, context));
}

/**
 * What a rule's action means, as data the runner performs.
 * Never performs anything itself.
 */
export function planAction(rule, task) {
  const value = rule?.actionValue ?? '';
  switch (rule?.action) {
    case 'assign':
      return { kind: 'update', taskId: task?.id, patch: { assignedTo: [value] } };
    case 'set_priority':
      return ['low', 'medium', 'high'].includes(value)
        ? { kind: 'update', taskId: task?.id, patch: { priority: value } }
        : { kind: 'none', reason: `“${value}” is not a priority.` };
    case 'set_phase':
      return { kind: 'update', taskId: task?.id, patch: { phaseId: value } };
    case 'add_tag':
      return lower(value)
        ? { kind: 'update', taskId: task?.id, patch: { tags: [...new Set([...(task?.tags || []), value])] } }
        : { kind: 'none', reason: 'No tag was given.' };
    case 'follow_up':
      return {
        kind: 'create-task',
        task: {
          title: (value || `Follow up: ${task?.title || 'task'}`).slice(0, 200),
          projectId: task?.projectId || null,
          phaseId: task?.phaseId || null,
          workspaceId: task?.workspaceId,
          priority: task?.priority || 'medium',
        },
      };
    case 'notify':
      return {
        kind: 'notify',
        userId: value,
        text: `${task?.title || 'A task'} — ${triggerLabel(rule.trigger)}`,
      };
    case 'webhook':
      return { kind: 'webhook', webhookId: value };
    default:
      return { kind: 'none', reason: 'That rule has no action yet.' };
  }
}

export const triggerLabel = (v) => TRIGGERS.find((t) => t.value === v)?.label || 'Something happened';
const actionLabel = (v) => ACTIONS.find((a) => a.value === v)?.label || 'do nothing';
const operatorLabel = (v) => OPERATORS.find((o) => o.value === v)?.label || v;

/**
 * The rule as one English sentence, for the list in Settings — so somebody can
 * check what they built without re-reading the dropdowns.
 *
 * @param {{ nameFor?: (id) => string }} opts  resolves ids to names
 */
export function describeRule(rule, { nameFor = (id) => id } = {}) {
  if (!rule) return '';
  const when = triggerLabel(rule.trigger).replace(/^A /, 'a ').replace(/^Work /, 'work ');
  const conditions = (rule.conditions || [])
    .filter((c) => c?.field && c?.operator)
    .map((c) => {
      const field = CONDITION_FIELDS.find((f) => f.value === c.field)?.label || c.field;
      const op = OPERATORS.find((o) => o.value === c.operator);
      if (op?.noValue) return `its ${field.toLowerCase()} ${operatorLabel(c.operator)}`;
      // Half-filled: say so rather than showing a pair of empty quotes.
      if (!String(c.value ?? '').trim()) {
        return `its ${field.toLowerCase()} is not chosen yet`;
      }
      return `its ${field.toLowerCase()} ${operatorLabel(c.operator)} “${nameFor(c.value) || c.value}”`;
    });

  const action = actionLabel(rule.action).toLowerCase();
  const target = rule.actionValue ? ` (${nameFor(rule.actionValue) || rule.actionValue})` : '';

  const head = `When ${when}`;
  const mid = conditions.length ? ` and ${conditions.join(' and ')}` : '';
  return `${head}${mid}, ${action}${target}.`;
}

/** What is stopping this rule from being saved? One sentence, or null. */
export function validateRule(rule) {
  if (!rule?.name?.trim()) return 'Give this rule a name so you can find it later.';
  if (!TRIGGERS.some((t) => t.value === rule.trigger)) return 'Pick what should set this rule off.';
  if (!ACTIONS.some((a) => a.value === rule.action)) return 'Pick what this rule should do.';

  for (const c of rule.conditions || []) {
    if (!c.field || !c.operator) return 'Finish the condition, or remove it.';
    const op = OPERATORS.find((o) => o.value === c.operator);
    if (!op) return 'That condition is not one this app understands.';
    if (!op.noValue && !String(c.value ?? '').trim()) {
      const field = CONDITION_FIELDS.find((f) => f.value === c.field)?.label || 'that condition';
      return `Say what ${field.toLowerCase()} should be.`;
    }
  }

  const action = ACTIONS.find((a) => a.value === rule.action);
  if (action.needs !== 'none' && !String(rule.actionValue ?? '').trim()) {
    return `Say what “${action.label}” should use.`;
  }
  return null;
}

/** A rule guards against running away: it never re-triggers itself. */
export function wouldLoop(rule, plan) {
  if (plan?.kind !== 'update') return false;
  // Setting a field this rule also triggers on would fire it again forever.
  const patched = Object.keys(plan.patch || {});
  if (rule.trigger !== 'task.updated') return false;
  return patched.length > 0;
}
