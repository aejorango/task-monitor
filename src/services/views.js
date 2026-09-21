// src/services/views.js — the one list of pages this app has.
//
// The sidebar, the topbar title, the not-found check and the ⌘K palette all
// read from here. They used to keep their own copies: `NAV_TARGETS` was a
// hand-maintained duplicate of the sidebar's `VIEWS` and drifted as pages were
// added, so Workload, Trash and Artifacts existed in the sidebar and were
// unreachable from search — Trash above all, which is where somebody goes the
// moment they have deleted something by accident (BUG-029).
//
// `words` is what somebody might type to find the page. The label is matched
// too, so the words are for the things the label does not say.

export const VIEW_REGISTRY = [
  { id: 'ask-ai',         label: 'Ask AI',         icon: 'sparkles',  words: ['ask', 'ai', 'question'] },
  { id: 'dashboard',      label: 'Dashboard',      icon: 'dashboard', words: ['home', 'today', 'overview'] },
  { id: 'my-week',        label: 'My Week',        icon: 'calendar',  words: ['my week', 'mine', 'assigned to me', 'my tasks', 'plan', 'personal', 'week'] },
  { id: 'projects',       label: 'Projects',       icon: 'projects',  words: ['phases', 'templates'] },
  { id: 'board',          label: 'Kanban',         icon: 'board',     words: ['board', 'kanban', 'tasks', 'columns'] },
  { id: 'calendar',       label: 'Calendar',       icon: 'calendar',  words: ['month', 'due dates'] },
  { id: 'gantt',          label: 'Gantt chart',    icon: 'gantt',     words: ['timeline', 'schedule', 'bars'] },
  { id: 'wbs',            label: 'WBS',            icon: 'wbs',       words: ['breakdown', 'work breakdown'] },
  { id: 'workload',       label: 'Workload',       icon: 'goals',     words: ['workload', 'capacity', 'who is busy', 'rebalance', 'people'] },
  { id: 'goals',          label: 'Goals',          icon: 'goals',     words: ['objectives', 'okr'] },
  { id: 'messages',       label: 'Messages',       icon: 'messages',  words: ['chat', 'conversations'] },
  { id: 'minutes',        label: 'Minutes',        icon: 'minutes',   words: ['meetings', 'notes'] },
  { id: 'tasks-table',    label: 'Task table',     icon: 'wbs',       words: ['report', 'columns', 'saved view'] },
  { id: 'table',          label: 'Activity Log',   icon: 'list',      words: ['log', 'activities', 'entries'] },
  { id: 'work-performed', label: 'Work Performed', icon: 'clock',     words: ['work', 'performed', 'swimlane'] },
  { id: 'timesheet',      label: 'Timesheet',      icon: 'clock',     words: ['hours', 'week', 'time'] },
  { id: 'review',         label: 'Review',         icon: 'review',    words: ['summary', 'weekly', 'kpi'] },
  { id: 'artifacts',      label: 'Artifacts',      icon: 'artifacts', words: ['artifacts', 'files', 'attachments', 'outputs', 'documents'] },
  { id: 'analytics',      label: 'Analytics',      icon: 'analytics', words: ['charts', 'trends'] },
  { id: 'trash',          label: 'Trash',          icon: 'trash',     words: ['trash', 'deleted', 'restore', 'undelete', 'bin', 'recover'] },
  { id: 'how-to-use',     label: 'How to Use',     icon: 'help',      words: ['help', 'how', 'guide'] },
  { id: 'settings',       label: 'Settings',       icon: 'settings',  words: ['preferences', 'members', 'workspace', 'notifications'] },
];

/** Views that render inside the shell but have no sidebar entry of their own. */
export const UNLISTED_VIEWS = [
  { id: 'invite', label: 'Invitation' },
];

/** Every view the app can actually render inside the shell. */
export const RENDERABLE_VIEWS = [...VIEW_REGISTRY, ...UNLISTED_VIEWS];

/** Is this hash a page that exists? */
export function isKnownView(view) {
  return RENDERABLE_VIEWS.some((v) => v.id === view);
}

/**
 * What ⌘K can navigate to — every page in the sidebar, derived rather than
 * listed again. A page added to the registry is searchable the same day.
 */
export const NAV_TARGETS = VIEW_REGISTRY.map(({ id, label, words }) => ({
  view: id,
  label: label === 'Kanban' ? 'Kanban board' : label,
  // The label's own words count too, lower-cased, so "gantt chart" finds Gantt
  // without that phrase being written twice.
  words: [...new Set([...label.toLowerCase().split(/\s+/), ...(words || [])])],
}));
