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
  { id: 'projects',       label: 'Portfolio',      icon: 'projects',  words: ['projects', 'portfolio', 'phases', 'templates', 'health', 'rag', 'segment'] },
  { id: 'timeline',       label: 'Timeline',       icon: 'gantt',     words: ['timeline', 'roadmap', 'project spans', 'milestones', 'when'] },
  { id: 'board',          label: 'Kanban',         icon: 'board',     words: ['board', 'kanban', 'tasks', 'columns'] },
  { id: 'calendar',       label: 'Calendar',       icon: 'calendar',  words: ['month', 'due dates'] },
  { id: 'gantt',          label: 'Gantt chart',    icon: 'gantt',     words: ['timeline', 'schedule', 'bars'] },
  { id: 'wbs',            label: 'WBS',            icon: 'wbs',       words: ['breakdown', 'work breakdown'] },
  { id: 'workload',       label: 'Workload',       icon: 'goals',     words: ['workload', 'capacity', 'who is busy', 'rebalance', 'people'] },
  { id: 'goals',          label: 'Goals',          icon: 'goals',     words: ['objectives', 'okr'] },
  { id: 'automations',    label: 'Automations',    icon: 'bolt',      words: ['automations', 'rules', 'when this then that', 'triggers', 'runs'] },
  { id: 'people',         label: 'People',         icon: 'goals',     words: ['people', 'members', 'utilization', 'capacity', 'on-time', 'throughput'] },
  { id: 'variance',       label: 'Variance',       icon: 'review',    words: ['variance', 'plan vs actual', 'over plan', 'under plan', 'estimate'] },
  { id: 'library',        label: 'Library',        icon: 'list',      words: ['library', 'saved reports', 'scheduled', 'report templates'] },
  { id: 'messages',       label: 'Messages',       icon: 'messages',  words: ['chat', 'conversations'] },
  { id: 'inbox',          label: 'Inbox',          icon: 'alert',     words: ['inbox', 'notices', 'notifications', 'mentions', 'assigned to me', 'unread'] },
  { id: 'minutes',        label: 'Minutes',        icon: 'minutes',   words: ['meetings', 'notes'] },
  { id: 'table',          label: 'Activity Log',   icon: 'list',      words: ['log', 'activities', 'entries'] },
  { id: 'work-performed', label: 'Work Performed', icon: 'clock',     words: ['work', 'performed', 'swimlane'] },
  { id: 'timesheet',      label: 'Timesheet',      icon: 'clock',     words: ['hours', 'week', 'time'] },
  { id: 'review',         label: 'Review',         icon: 'review',    words: ['summary', 'weekly', 'kpi'] },
  { id: 'artifacts',      label: 'Artifacts',      icon: 'artifacts', words: ['artifacts', 'files', 'attachments', 'outputs', 'documents'] },
  // Analytics IS the old Monitoring page now (T-0157). Its own charts were
  // deleted on request and the `monitoring` route retired, so this entry
  // carries Monitoring's search words — otherwise ⌘K for "cycle time" or
  // "throughput" would find nothing, which is how a moved page becomes a
  // lost one. `MOVED_VIEWS` below keeps the old hash working.
  { id: 'analytics',      label: 'Analytics',      icon: 'analytics', words: ['charts', 'trends', 'monitoring', 'cycle time', 'throughput', 'blocked rate', 'on-time', 'alert rules', 'health', 'flow'] },
  { id: 'trash',          label: 'Trash',          icon: 'trash',     words: ['trash', 'deleted', 'restore', 'undelete', 'bin', 'recover'] },
  { id: 'how-to-use',     label: 'How to Use',     icon: 'help',      words: ['help', 'how', 'guide'] },
  { id: 'settings',       label: 'Preferences',    icon: 'settings',  words: ['settings', 'preferences', 'theme', 'week start', 'defaults', 'due alerts'] },
  { id: 'notifications',  label: 'Notifications',  icon: 'alert',     words: ['notifications', 'alerts', 'browser', 'permission', 'due alerts'] },
  { id: 'workspaces',     label: 'Workspaces',     icon: 'workspace', words: ['workspaces', 'switch workspace', 'create workspace'] },
  { id: 'user-management',label: 'User management',icon: 'lock',      words: ['user management', 'approve', 'superadmin', 'companies', 'security'] },
  { id: 'ai-data',        label: 'AI & data',      icon: 'sparkles',  words: ['ai', 'brain', 'knowledge base', 'notebooklm', 'webhooks', 'export', 'data'] },
  { id: 'tutorial',       label: 'Tutorial',       icon: 'play',      words: ['tutorial', 'tutorials', 'tour', 'walkthrough', 'guide', 'walk me through', 'show me how'] },
];

/** Views that render inside the shell but have no sidebar entry of their own. */
export const UNLISTED_VIEWS = [
  { id: 'invite', label: 'Invitation' },
];

/**
 * Pages that MOVED, and where they went.
 *
 * A page whose content was deleted is a Not Found; a page whose content moved
 * is a redirect, and the two must not be confused. Monitoring's panels are
 * still in the app — they are the Analytics page now — so `#/monitoring` takes
 * you to them rather than to an error that implies they are gone. Saved views
 * and bookmarks pointing at the old id keep working for the same reason.
 *
 * Keep this SMALL. It is a forwarding address, not a second registry: an entry
 * here must name a page that really exists in VIEW_REGISTRY, which
 * `tests/ui/hubs.test.mjs` checks.
 */
export const MOVED_VIEWS = {
  monitoring: 'analytics',
  // The Members tab was removed, but its content did not go anywhere: every
  // workspace card on the Workspaces tab opens the same `WorkspaceMembers` in a
  // modal. So this is a move, not a deletion — a bookmark or saved view
  // pointing at `#/members` lands on the page that now holds it.
  members: 'workspaces',
};

/** Where a view id should actually render — itself, unless it has moved. */
export function resolveView(view) {
  return MOVED_VIEWS[view] || view;
}

/** Every view the app can actually render inside the shell. */
export const RENDERABLE_VIEWS = [...VIEW_REGISTRY, ...UNLISTED_VIEWS];

/** Is this hash a page that exists? */
export function isKnownView(view) {
  if (MOVED_VIEWS[view]) return true;   // it has a forwarding address
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

// ─── Hubs: the six destinations on the icon rail ──────────────────────────
//
// The rail holds six icons; the app has twenty-odd pages. A hub is the bridge:
// it owns a set of pages and shows them as the tab strip under the page title,
// exactly as the Explorer mockups do (Board → Kanban · Calendar · Timeline …).
//
// A tab NAVIGATES — it sets the route to that view. The alternative, mounting
// each sibling as a panel inside one hub route, would give the six hubs one URL
// each and make a sub-tab impossible to link, bookmark or save as a view. So
// there is still exactly one implementation and one URL per page; the tab strip
// is a second way to reach it, not a second copy of it.
//
// `label` overrides what the registry calls the page, for the places the mockup
// renames it in context: Gantt chart is "Timeline" under Projects, Review is
// "Summary" under Reports. Everywhere else the registry's own label is used.
//
// EVERY view in VIEW_REGISTRY belongs to exactly one hub. Two hubs claiming the
// same page would make the rail highlight ambiguous; zero hubs claiming it puts
// the page back where Trash and Artifacts were before BUG-029 — reachable only
// by someone who already knows the URL. `tests/ui/hubs.test.mjs` fails the build
// on either.
export const HUBS = [
  {
    id: 'dashboard', label: 'Dashboard', icon: 'dashboard',
    tabs: [
      { view: 'dashboard', label: 'Overview' },
      { view: 'my-week' },
      { view: 'goals' },
      { view: 'ask-ai' },
      { view: 'automations' },
      { view: 'how-to-use', label: 'How to use' },
      { view: 'tutorial' },
    ],
  },
  {
    id: 'projects', label: 'Projects', icon: 'projects',
    // Portfolio · Timeline · Minutes (T-0153). The old cross-workspace
    // `portfolio` page and the `archive` page were deleted: the Projects page
    // already listed archived projects at its foot, and it is itself the
    // portfolio now — so it took the name.
    tabs: [
      { view: 'projects', label: 'Portfolio' },
      { view: 'timeline' },
      { view: 'minutes' },
    ],
  },
  {
    id: 'board', label: 'Board', icon: 'board',
    // Five tabs. The Board Explorer draws eight; Table, Flow and Item were
    // removed in T-0152 at Ace's request and their pages deleted with them,
    // so there is no entry here pointing at a view that no longer exists.
    // What went with them is written down in CLAUDE.md — the bulk editor
    // above all, which had no other home.
    //
    // Kanban sits AFTER Gantt at Ace's request: the strip reads as the
    // schedule first (when the work is) and the board second (what state it is
    // in). It is still where the rail lands, which is why `landing` is stated
    // — see the field's note above.
    landing: 'wbs',
    tabs: [
      { view: 'calendar' },
      { view: 'gantt', label: 'Gantt' },
      { view: 'board', label: 'Kanban' },
      { view: 'wbs' },
      { view: 'workload' },
    ],
  },
  {
    id: 'reports', label: 'Reports', icon: 'analytics',
    tabs: [
      { view: 'review', label: 'Summary' },
      { view: 'table', label: 'Activity log' },
      { view: 'work-performed', label: 'Work performed' },
      { view: 'timesheet' },
      { view: 'people' },
      { view: 'variance' },
      { view: 'artifacts' },
      { view: 'analytics' },
      { view: 'library' },
    ],
  },
  {
    id: 'messages', label: 'Messages', icon: 'messages',
    tabs: [
      { view: 'messages' },
      { view: 'inbox' },
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: 'settings',
    tabs: [
      { view: 'settings', label: 'Preferences' },
      { view: 'notifications' },
      { view: 'workspaces' },
      { view: 'user-management', label: 'User management' },
      { view: 'ai-data', label: 'AI & data' },
      { view: 'trash' },
    ],
  },
];

const LABEL_OF = new Map(RENDERABLE_VIEWS.map((v) => [v.id, v.label]));

/** The hub that owns this page, or null for a page outside the rail (invite). */
export function hubForView(view) {
  return HUBS.find((h) => h.tabs.some((t) => t.view === view)) || null;
}

/**
 * The tab strip to draw under the title, with each tab's final label resolved.
 * Empty for a page no hub owns, and for a hub with only one page — a strip of
 * one tab is a label that looks clickable.
 */
export function tabsForView(view) {
  const hub = hubForView(view);
  if (!hub || hub.tabs.length < 2) return [];
  return hub.tabs.map((t) => ({
    view: t.view,
    label: t.label || LABEL_OF.get(t.view) || t.view,
    active: t.view === view,
  }));
}

/** Where the rail sends you when you click a hub: its first tab. */
/**
 * The page the rail's icon opens for a hub.
 *
 * Defaults to the first tab, which is what you want when the strip's order and
 * the hub's "home" are the same thing. They came apart on the Board: Kanban is
 * the page people mean by "the board", but it is drawn third so the strip can
 * read Calendar → Gantt → Kanban. `landing` states the home explicitly rather
 * than letting a cosmetic reorder silently move it — the failure would be
 * invisible in a screenshot and only noticed by whoever clicks the rail.
 *
 * `tests/ui/hubs.test.mjs` fails the build if a `landing` names a page that is
 * not one of that hub's own tabs.
 */
export function hubLanding(hubId) {
  const hub = HUBS.find((h) => h.id === hubId);
  if (!hub) return 'dashboard';
  return hub.landing || hub.tabs[0].view;
}
