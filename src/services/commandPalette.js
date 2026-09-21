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
// The palette's destinations come from the one view registry, so a page added
// to the sidebar is searchable the same day. This was a hand-maintained copy
// and drifted: Workload, Trash and Artifacts were unreachable from ⌘K.
import { NAV_TARGETS } from './views';

export { NAV_TARGETS };

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

// The create vocabulary. Every entity here must have a receiver — a
// useQuickCreate(<entity>) somewhere in src/components — or the command
// navigates and nothing opens. tests/ui/commandPalette.test.mjs enforces it.
export const CREATE_ORDER = ['task', 'project', 'minute', 'goal', 'activity'];
const CREATE_LABEL = {
  task: 'New task', project: 'New project', minute: 'New meeting minutes',
  goal: 'New goal', activity: 'Log an activity',
};
const CREATE_ICON = {
  task: 'board', project: 'projects', minute: 'minutes', goal: 'goals', activity: 'clock',
};
/**
 * Where each "New …" command goes before it asks that page to open its create
 * flow. Here rather than in AppShell because it is part of the same vocabulary:
 * a fourth list in a component is how "Log an activity" came to navigate to a
 * page that was not listening (BUG-016).
 */
export const CREATE_VIEW = {
  task: 'board', project: 'projects', minute: 'minutes',
  goal: 'goals', activity: 'work-performed',
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

/* ── Recent items (T-0062 / NEW-009) ───────────────────────────────────────
   An empty ⌘K used to show nothing at all. What a person nearly always wants
   is the thing they were just looking at, so the palette opens with that. Kept
   per device — it is a convenience, not shared state. */

const RECENTS_KEY = 'task-monitor.palette.recents.v1';
export const MAX_RECENTS = 6;

const readRecents = (store) => {
  try {
    const raw = store?.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

const storage = (store) => {
  if (store) return store;
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
};

/** Most recent first, deduped, bounded. */
export function loadRecents({ store } = {}) {
  return readRecents(storage(store))
    .filter((r) => r && r.kind && r.id && r.label)
    .slice(0, MAX_RECENTS);
}

/** Record that something was opened. Returns the new list. */
export function rememberRecent(entry, { store } = {}) {
  const s = storage(store);
  if (!s || !entry?.kind || !entry?.id || !entry?.label) return loadRecents({ store: s });
  const next = [
    { kind: entry.kind, id: entry.id, label: entry.label, view: entry.view || null, projectId: entry.projectId || null },
    ...readRecents(s).filter((r) => !(r.kind === entry.kind && r.id === entry.id)),
  ].slice(0, MAX_RECENTS);
  try { s.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function clearRecents({ store } = {}) {
  try { storage(store)?.removeItem(RECENTS_KEY); } catch { /* ignored */ }
}

/** Recents as palette rows, so an empty query still offers something. */
export function recentCommands({ store } = {}) {
  return loadRecents({ store }).map((r) => ({
    id: `recent:${r.kind}:${r.id}`,
    kind: 'recent',
    entity: r.kind,
    label: r.label,
    hint: r.kind === 'task' ? 'Task' : r.kind === 'project' ? 'Project' : 'Recently opened',
    icon: r.kind === 'task' ? 'board' : r.kind === 'project' ? 'projects' : 'clock',
    payload: r,
  }));
}
