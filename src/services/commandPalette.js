// src/services/commandPalette.js — ⌘K as a place to DO something, not only to
// find something.
//
// The Board's quick-add understands "draft proposal next friday !urgent #client
// @mark". Everything else — a project, a set of minutes, a goal, logging an
// hour against a task — needed its own page and its own modal. This turns the
// search box into one entry point for all of them.
//
// Pure: it returns DESCRIPTORS (what to offer, and with what argument). The
// component owns the handlers, so this stays testable and the palette cannot
// accidentally perform anything.

import { parseQuickAdd } from './nlpQuickAdd';

/** Verbs that mean "make one of these". */
const CREATE_VERBS = /^\s*(?:\/|>)?\s*(new|add|create|make|log|start)\b\s*/i;

const NOUNS = [
  { kind: 'task',     words: ['task', 'todo', 'to-do', 'item'], label: 'task' },
  { kind: 'project',  words: ['project'],                       label: 'project' },
  { kind: 'minute',   words: ['minute', 'minutes', 'meeting', 'note'], label: 'meeting minutes' },
  { kind: 'goal',     words: ['goal', 'objective', 'okr'],      label: 'goal' },
  { kind: 'activity', words: ['activity', 'time', 'hours', 'work', 'entry'], label: 'activity' },
];

/** Views ⌘K can jump to, in the order they appear in the sidebar. */
export const NAV_TARGETS = [
  { view: 'ask-ai', label: 'Ask AI', words: ['ask', 'ai', 'question'] },
  { view: 'dashboard', label: 'Dashboard', words: ['dashboard', 'home', 'today'] },
  { view: 'projects', label: 'Projects', words: ['projects'] },
  { view: 'board', label: 'Kanban board', words: ['board', 'kanban', 'tasks'] },
  { view: 'calendar', label: 'Calendar', words: ['calendar', 'month'] },
  { view: 'gantt', label: 'Gantt chart', words: ['gantt', 'timeline', 'schedule'] },
  { view: 'wbs', label: 'WBS', words: ['wbs', 'breakdown'] },
  { view: 'goals', label: 'Goals', words: ['goals', 'objectives'] },
  { view: 'messages', label: 'Messages', words: ['messages', 'chat'] },
  { view: 'minutes', label: 'Minutes', words: ['minutes', 'meetings'] },
  { view: 'tasks-table', label: 'Task table', words: ['table', 'report', 'columns'] },
  { view: 'table', label: 'Activity Log', words: ['log', 'activities', 'activity log'] },
  { view: 'work-performed', label: 'Work Performed', words: ['work', 'performed'] },
  { view: 'timesheet', label: 'Timesheet', words: ['timesheet', 'hours', 'week'] },
  { view: 'review', label: 'Review', words: ['review', 'summary', 'weekly'] },
  { view: 'analytics', label: 'Analytics', words: ['analytics', 'charts', 'trends'] },
  { view: 'settings', label: 'Settings', words: ['settings', 'preferences', 'members', 'workspace'] },
  { view: 'how-to-use', label: 'How to Use', words: ['help', 'how', 'guide'] },
];

/**
 * What the user typed, read as an intent to create something.
 * @returns {{ kind, label, rest } | null}
 */
export function parseCreateIntent(query) {
  const raw = String(query || '');
  if (!CREATE_VERBS.test(raw)) return null;
  const afterVerb = raw.replace(CREATE_VERBS, '');

  for (const noun of NOUNS) {
    // "new project Website revamp" → kind project, rest "Website revamp"
    const re = new RegExp(`^(?:a |an |the )?(?:${noun.words.join('|')})\\b\\s*`, 'i');
    if (re.test(afterVerb)) {
      return { kind: noun.kind, label: noun.label, rest: afterVerb.replace(re, '').trim() };
    }
  }

  // "new " with no noun: offer everything, with what they typed as the name.
  return { kind: null, label: null, rest: afterVerb.trim() };
}

const CREATE_ORDER = ['task', 'project', 'minute', 'goal', 'activity'];
const CREATE_LABEL = {
  task: 'New task', project: 'New project', minute: 'New meeting minutes',
  goal: 'New goal', activity: 'Log an activity',
};
const CREATE_ICON = {
  task: 'board', project: 'projects', minute: 'minutes', goal: 'goals', activity: 'clock',
};

/**
 * The actions to offer for a query.
 *
 * @param {string} query
 * @param {{ now?: Date }} opts  `now` pins the quick-add date parsing
 * @returns {{ id, kind, label, hint, icon, payload }[]}
 */
export function buildCommands(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const out = [];
  const intent = parseCreateIntent(q);

  if (intent) {
    const kinds = intent.kind ? [intent.kind] : CREATE_ORDER;
    for (const kind of kinds) {
      const name = intent.rest;
      let hint = name ? `“${name}”` : 'Opens a blank one';

      if (kind === 'task' && name) {
        // Show what the natural-language parts will actually do, before the
        // user commits — the same parser the Board quick-add uses.
        const parsed = parseQuickAdd(name, opts);
        const bits = [];
        if (parsed.plan?.endDate) bits.push(`due ${parsed.plan.endDate}`);
        if (parsed.priority) bits.push(`${parsed.priority} priority`);
        if (parsed.tags.length) bits.push(parsed.tags.map((t) => `#${t}`).join(' '));
        if (parsed.requestedBy) bits.push(`for ${parsed.requestedBy}`);
        hint = `“${parsed.title || name}”${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
      }

      out.push({
        id: `create:${kind}`,
        kind: 'create',
        entity: kind,
        label: CREATE_LABEL[kind],
        hint,
        icon: CREATE_ICON[kind],
        payload: { text: name },
      });
    }
  }

  // Navigation: "go to gantt", or just "gantt".
  const needle = q.replace(/^\s*(go to|open|show|jump to)\s+/i, '').toLowerCase();
  if (needle) {
    for (const target of NAV_TARGETS) {
      const matches = target.label.toLowerCase().includes(needle)
        || target.words.some((w) => w.startsWith(needle) || needle.startsWith(w));
      if (!matches) continue;
      out.push({
        id: `go:${target.view}`,
        kind: 'navigate',
        label: `Go to ${target.label}`,
        hint: '',
        icon: 'arrow-right',
        payload: { view: target.view },
      });
    }
  }

  return out.slice(0, 8);
}

/** Should the palette lead with commands rather than with search results? */
export function commandsFirst(query) {
  return !!parseCreateIntent(query) || /^\s*(\/|>)/.test(String(query || ''));
}
