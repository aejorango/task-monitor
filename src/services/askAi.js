// src/services/askAi.js — the analysis engine behind the Ask AI view.
//
// Two halves:
//   1. buildDigest()  — turns live tasks/projects/activities/workspaces into a
//      compact, CORRECT set of facts (health, blockers, hours, workload).
//      Everything numeric the UI shows comes from here, never from the model.
//   2. narrate()      — hands those facts to Claude for the prose summary,
//      the "what I'd do next" list and follow-up questions. If AI isn't
//      available (no company key) or the call fails, every answer still has a
//      locally-written summary + actions, so the page works without AI.

import { callClaudeJson } from './anthropic';
import { isAiAvailable as aiBrainAvailable } from './ai';
import { parseQuickAdd } from './nlpQuickAdd';
import {
  todayLocal,
  addProject, updateProject, softDeleteProject,
  addTask, updateTask, softDeleteTask,
  addActivity, editActivity, deleteActivity,
} from './firebase';

/* ── small helpers ───────────────────────────────────────── */

const DAY_MS = 86400000;

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateToStr(d);
}
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function daysBetween(a, b) {
  const from = parseDate(a), to = parseDate(b);
  if (!from || !to) return null;
  return Math.round((to - from) / DAY_MS);
}
function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}
function clampPct(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmtHours(h) {
  return `${Math.round(h * 10) / 10}h`;
}
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ── constants shared with the view ──────────────────────── */

export const SCOPES = ['Everything', 'Workspaces', 'Projects', 'Tasks'];

export const THINKING = [
  'Reading your workspaces, projects and activity log',
  'Checking plan vs. actual dates across your tasks',
  'Cross-referencing the last 30 days of activity',
  'Looking at assignments and logged hours',
];

// True when ANY brain is live — the Claude Code CLI bridge, an API key, or
// (in development) the mock provider.
export function isAiAvailable() {
  return aiBrainAvailable();
}

/* ── digest: live data → facts ───────────────────────────── */

// projects/tasks/activities are the active workspace's; workspaces spans all
// the workspaces the user belongs to (used only for the "pulse" answer).
export function buildDigest({
  tasks = [],
  projects = [],
  activities = [],
  workspaces = [],
  allWorkspaceProjects = [],
  allWorkspaceTasks = [],
  memberProfiles = {},
  activeWorkspaceId = null,
} = {}) {
  const today = todayLocal();
  const live = (t) => !t.deleted && !t.archived;
  const openTasks = tasks.filter((t) => live(t) && t.status !== 'done');
  const doneTasks = tasks.filter((t) => live(t) && t.status === 'done');
  const overdueTasks = openTasks.filter((t) => t.plan?.endDate && t.plan.endDate < today);

  const since30 = daysAgoStr(30);
  const since7  = daysAgoStr(7);
  const acts30 = activities.filter((a) => !a.deleted && (a.date || '') >= since30);
  const acts7  = activities.filter((a) => !a.deleted && (a.date || '') >= since7);

  /* per-project health */
  const projectHealth = projects.filter(live).map((p) => {
    const own = tasks.filter((t) => live(t) && t.projectId === p.id);
    const done = own.filter((t) => t.status === 'done').length;
    const overdue = own.filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today).length;
    const starts = own.map((t) => t.plan?.startDate).filter(Boolean).sort();
    const ends   = own.map((t) => t.plan?.endDate).filter(Boolean).sort();
    const start = starts[0] || null;
    const end   = ends[ends.length - 1] || null;
    const span    = start && end ? daysBetween(start, end) : null;
    const elapsed = start ? daysBetween(start, today) : null;
    const elapsedPct = span && span > 0 && elapsed != null ? clampPct((elapsed / span) * 100)
                     : end && end < today ? 100 : null;
    const donePct = pct(done, own.length);
    const gap = elapsedPct == null ? null : elapsedPct - donePct;
    const hours = acts30
      .filter((a) => a.projectId === p.id)
      .reduce((s, a) => s + num(a.hoursSpent), 0);
    const blocked = acts30.filter((a) => a.projectId === p.id && isBlockedAct(a)).length;

    let tone = 'green';
    if ((gap != null && gap >= 20) || overdue >= 3) tone = 'red';
    else if ((gap != null && gap >= 10) || overdue >= 1) tone = 'amber';
    if (own.length === 0) tone = 'grey';

    return {
      id: p.id, name: p.name || 'Untitled project', color: p.color || '#0051BA',
      total: own.length, done, open: own.length - done, overdue, blocked,
      donePct, elapsedPct, gap, start, end, hours, tone,
      inDoing: own.filter((t) => t.status === 'doing').length,
    };
  });

  const projectPhases = projects.filter(live).flatMap((p) =>
    (p.phases || []).map((ph) => ({ id: ph.id, name: ph.name, projectId: p.id })));

  /* blockers */
  const blockedActs = acts30.filter(isBlockedAct);
  const blockersByProject = projectHealth
    .map((p) => ({
      ...p,
      themes: topThemes(blockedActs.filter((a) => a.projectId === p.id)),
      count: blockedActs.filter((a) => a.projectId === p.id).length,
    }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);
  const blockedTasks = openTasks
    .map((t) => {
      const last = blockedActs
        .filter((a) => a.taskId === t.id)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return last ? { task: t, since: last.date, days: daysBetween(last.date, today) || 0, why: (last.bottleneckRemarks || last.comment || '').trim() } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.days - a.days);
  const blockerThemes = topThemes(blockedActs);

  /* hours */
  const hoursByProject = projectHealth
    .map((p) => ({
      ...p,
      hours7: acts7.filter((a) => a.projectId === p.id).reduce((s, a) => s + num(a.hoursSpent), 0),
      acts7:  acts7.filter((a) => a.projectId === p.id).length,
    }))
    .sort((a, b) => b.hours7 - a.hours7);
  const hoursByDay = {};
  acts7.forEach((a) => { hoursByDay[a.date] = (hoursByDay[a.date] || 0) + num(a.hoursSpent); });
  const busiestDay = Object.entries(hoursByDay).sort((a, b) => b[1] - a[1])[0] || null;
  const hours7Total = acts7.reduce((s, a) => s + num(a.hoursSpent), 0);
  const hoursPrev7  = activities
    .filter((a) => !a.deleted && (a.date || '') >= daysAgoStr(14) && (a.date || '') < since7)
    .reduce((s, a) => s + num(a.hoursSpent), 0);

  /* people — assignees across open tasks, plus hours from the activity log */
  const nameFor = (uid) => memberProfiles[uid]?.displayName || memberProfiles[uid]?.email || `User ${String(uid).slice(0, 5)}`;
  const peopleMap = new Map();
  const bump = (key, label, patch) => {
    const cur = peopleMap.get(key) || { key, label, open: 0, doing: 0, overdue: 0, hours: 0 };
    peopleMap.set(key, { ...cur, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, cur[k] + v])) });
  };
  openTasks.forEach((t) => {
    const late = t.plan?.endDate && t.plan.endDate < today ? 1 : 0;
    (t.assignedTo || []).forEach((uid) => bump(uid, nameFor(uid), { open: 1, doing: t.status === 'doing' ? 1 : 0, overdue: late }));
    (t.assignedToExternal || []).forEach((n) => bump(`ext:${n}`, n, { open: 1, doing: t.status === 'doing' ? 1 : 0, overdue: late }));
  });
  acts30.forEach((a) => { if (a.userId && peopleMap.has(a.userId)) bump(a.userId, nameFor(a.userId), { hours: num(a.hoursSpent) }); });
  const people = [...peopleMap.values()].sort((a, b) => b.open - a.open);
  const unassigned = openTasks.filter((t) => !(t.assignedTo || []).length && !(t.assignedToExternal || []).length).length;

  /* recent movement */
  const recentMovement = acts7
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 6)
    .map((a) => ({
      title: a.taskTitle || 'Activity',
      project: projectHealth.find((p) => p.id === a.projectId)?.name || '—',
      color: projectHealth.find((p) => p.id === a.projectId)?.color || '#b0bcc8',
      date: a.date,
      hours: num(a.hoursSpent),
      status: a.completionStatus || 'in-progress',
      note: (a.bottleneckRemarks || a.comment || '').trim(),
    }));
  const doneThisWeek = doneTasks.filter((t) => tsToDateStr(t.updatedAt) >= since7).length;

  /* workspace pulse */
  const wsPulse = workspaces.filter((w) => !w.deleted && !w.archived).map((w) => {
    const wp = allWorkspaceProjects.filter((p) => live(p) && p.workspaceId === w.id);
    const wt = allWorkspaceTasks.filter((t) => live(t) && wp.some((p) => p.id === t.projectId));
    const wDone = wt.filter((t) => t.status === 'done').length;
    return {
      id: w.id, name: w.name || 'Workspace', color: w.color || '#e2892e',
      projects: wp.length, tasks: wt.length, done: wDone,
      donePct: pct(wDone, wt.length),
      members: (w.members || []).length,
      pendingInvites: (w.pendingInvites || []).length,
      active: w.id === activeWorkspaceId,
    };
  }).sort((a, b) => b.tasks - a.tasks);

  /* activity log — the raw entries, so answers can go down to a single log line */
  const projName = (id) => projectHealth.find((p) => p.id === id)?.name || '—';
  const projColor = (id) => projectHealth.find((p) => p.id === id)?.color || '#b0bcc8';
  const activityLog = acts30
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map((a) => ({
      id: a.id,
      taskId: a.taskId,
      title: a.taskTitle || 'Activity',
      projectId: a.projectId,
      project: projName(a.projectId),
      color: projColor(a.projectId),
      date: a.date || '',
      hours: num(a.hoursSpent),
      status: a.completionStatus || 'in-progress',
      who: a.userId ? nameFor(a.userId) : '',
      note: (a.comment || '').trim(),
      bottleneck: (a.bottleneckRemarks || '').trim(),
      attachments: (a.attachments || []).length,
    }));

  /* per-task rollup — lets a question about one task answer from its own log */
  const taskIndex = tasks.filter(live).map((t) => {
    const own = activityLog.filter((a) => a.taskId === t.id);
    return {
      id: t.id, title: t.title || 'Untitled task', status: t.status,
      description: (t.description || '').trim(),
      priority: t.priority || 'medium',
      tags: t.tags || [],
      projectId: t.projectId, project: projName(t.projectId), color: projColor(t.projectId),
      due: t.plan?.endDate || null,
      start: t.plan?.startDate || null,
      overdue: !!(t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today),
      blocked: own.some((a) => a.status === 'blocked' || a.bottleneck),
      hours: num(t.totalHoursLogged),
      activityCount: own.length,
      lastEntry: own[0] || null,
      entries: own,
      assignees: [...(t.assignedTo || []).map(nameFor), ...(t.assignedToExternal || [])],
      subtasks: t.subtasks || [],
      task: t,
    };
  });

  return {
    today,
    counts: {
      workspaces: wsPulse.length,
      projects: projectHealth.length,
      tasks: tasks.filter(live).length,
      open: openTasks.length,
      done: doneTasks.length,
      overdue: overdueTasks.length,
      activities30: acts30.length,
      activities7: acts7.length,
      blocked: blockedTasks.length,
      unassigned,
      people: people.length,
    },
    projects: projectHealth,
    projectPhases,
    tasks: { open: openTasks, done: doneTasks, overdue: overdueTasks },
    blockers: { byProject: blockersByProject, tasks: blockedTasks, themes: blockerThemes, total: blockedActs.length },
    hours: { byProject: hoursByProject, byDay: hoursByDay, busiestDay, total7: hours7Total, prev7: hoursPrev7, acts7: acts7.length },
    people, unassigned,
    week: { movement: recentMovement, doneThisWeek, blockedCount: acts7.filter(isBlockedAct).length, hours: hours7Total },
    workspaces: wsPulse,
    activityLog,
    taskIndex,
  };
}

function isBlockedAct(a) {
  return a.completionStatus === 'blocked' || (a.bottleneckRemarks || '').trim().length > 0;
}

function tsToDateStr(ts) {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  return d ? dateToStr(d) : '';
}

const STOP = new Set(['the','and','for','with','that','this','from','have','been','they','their','there','were','what','when','which','while','still','into','over','about','waiting','blocked','because','needs','need','will','not','but','are','was','has','had','our','out','due','yet','get','got','can','cannot']);
function topThemes(acts, limit = 3) {
  const freq = {};
  acts.forEach((a) => {
    (a.bottleneckRemarks || a.comment || '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
      .forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w, n]) => ({ word: w, n }));
}

/* ── intent routing ──────────────────────────────────────── */

export function routeIntent(q, digest) {
  const w = (q || '').toLowerCase();

  // "find the tasks about X" / "which tasks are overdue in Y" is a request to
  // search the task list. It beats everything below, or a question naming a
  // task the user just created gets answered with a workload report that
  // never mentions it.
  const search = parseSearch(w, digest);
  if (search?.strong) return { key: 'search', ...search };

  // A named project or task beats any keyword — "how is X going" is a question
  // about X. Longest name wins so "Partner API integration" is not shadowed by
  // a project called "API".
  const named = [
    ...digest.projects.filter((p) => p.name.length >= 4).map((p) => ({ n: p.name, hit: { key: 'project', projectId: p.id } })),
    ...(digest.taskIndex || []).filter((t) => t.title.length >= 8).map((t) => ({ n: t.title, hit: { key: 'task', taskId: t.id } })),
  ]
    .filter((c) => w.includes(c.n.toLowerCase()))
    .sort((a, b) => b.n.length - a.n.length)[0];
  if (named) return named.hit;

  const kw = keywordIntent(w);
  if (kw) return kw;

  // A bare "find/search …" with no topic keyword still means: go look.
  if (search) return { key: 'search', ...search };
  return null;
}

function keywordIntent(w) {
  if (/activity log|activities|logged entr|log entr|what was logged|entries/.test(w)) return { key: 'activity' };
  if (/block|bottleneck|stuck|waiting/.test(w))                        return { key: 'blockers' };
  if (/overload|capacity|who|busy|workload|assign|team/.test(w))       return { key: 'people' };
  if (/workspace|compare|pulse/.test(w))                               return { key: 'workspaces' };
  if (/hour|time logged|logged|timesheet|time spent/.test(w))          return { key: 'hours' };
  if (/week|changed|recent|latest|update|happen|momentum/.test(w))     return { key: 'week' };
  if (/risk|health|behind|off ?track|late|slip|overdue|deadline/.test(w)) return { key: 'risk' };
  if (/project/.test(w))                                               return { key: 'risk' };
  if (/task/.test(w))                                                  return { key: 'people' };
  return null;
}

/* ── task search ─────────────────────────────────────────────────────────
   Turns "find me the SBLAF tasks that are still overdue" into a set of
   filters plus the words worth matching, then ranks every live task against
   them. The result is a clickable list, not prose — the model narrates it
   but never decides what is in it. */

const SEARCH_VERB = /\b(find|search|look\s+for|looking\s+for|locate|filter)\b/;
const SEARCH_LIST = new RegExp([
  '\\b(?:show|list|display|give|pull|get)\\s+(?:me\\s+)?(?:the\\s+|all\\s+|any\\s+|my\\s+)*tasks?\\b',
  '\\b(?:which|what|any|whose|how\\s+many)\\s+(?:of\\s+)?(?:my\\s+|the\\s+|all\\s+)?tasks?\\b',
  '\\bdo\\s+(?:i|we)\\s+have\\s+(?:a|any)\\s+tasks?\\b',
  '\\btasks?\\s+(?:about|named|called|containing|with|matching|related\\s+to|regarding|involving|mentioning|under|tagged)\\b',
  '\\ball\\s+(?:my\\s+|the\\s+)?tasks?\\b',
].join('|'));

// Words that carry no search signal once the intent is known.
const SEARCH_STOP = new Set((
  'a an the my our your all any some each of for on in at about with to from by is are was were be been ' +
  'do does did i we us me you it its this that these those there here and or not no non ' +
  'please pls can could would show me list display give pull get find search searching look looking locate filter ' +
  'task tasks todo todos to-do item items thing things which what who whose where when how many much ' +
  'have has had need needs want wants related regarding containing named called matching mentioning involving ' +
  'under tagged tag tags still yet again just now currently right'
).split(/\s+/));

// Each filter narrows the candidate set AND consumes its own words, so
// "overdue" never doubles as a keyword nothing will ever match.
const SEARCH_FILTERS = [
  { label: 'overdue',     re: /\boverdue\b|\bpast\s+due\b|\blate\b/g,                                    pass: (t) => t.overdue },
  { label: 'blocked',     re: /\bblocked\b|\bblockers?\b|\bstuck\b/g,                                     pass: (t) => t.blocked },
  { label: 'done',        re: /\bdone\b|\bcompleted?\b|\bfinished\b|\bclosed\b/g,                        pass: (t) => t.status === 'done' },
  { label: 'in progress', re: /\bin[-\s]?progress\b|\bdoing\b|\bongoing\b|\bstarted\b/g,                 pass: (t) => t.status === 'doing' },
  { label: 'not started', re: /\bnot[-\s]started\b|\bunstarted\b|\bbacklog\b/g,                          pass: (t) => t.status === 'todo' },
  { label: 'open',        re: /\bopen\b|\bunfinished\b|\bincomplete\b|\boutstanding\b|\bpending\b|\bremaining\b/g, pass: (t) => t.status !== 'done' },
  { label: 'unassigned',  re: /\bunassigned\b|\bnobody\b|\bno[-\s]one\b/g,                                pass: (t) => !t.assignees.length },
  { label: 'high priority', re: /\bhigh[-\s]priority\b|\burgent\b|\bcritical\b/g,                        pass: (t) => t.priority === 'high' },
  { label: 'due today',   re: /\bdue\s+today\b|\btoday\b/g,                                              pass: (t, d) => t.due === d.today },
];

// → { terms, filters, label, strong } or null when this isn't a search.
export function parseSearch(raw, digest) {
  let w = String(raw || '').toLowerCase().trim();
  if (!w) return null;
  const mentionsTask = /\btasks?\b|\bto-?dos?\b/.test(w);
  const verb = SEARCH_VERB.test(w);
  const listy = SEARCH_LIST.test(w);
  if (!verb && !listy) return null;

  // A quoted phrase is taken literally — "find tasks about \"partial release\"".
  const phrases = [];
  w = w.replace(/["'\u201c\u201d]([^"'\u201c\u201d]{2,})["'\u201c\u201d]/g, (_, p) => { phrases.push(p.trim()); return ' '; });

  const filters = [];

  // A project named in the query scopes the search instead of being matched
  // as loose words — "overdue tasks in Website revamp" means that project.
  (digest?.projects || [])
    .filter((p) => p.name && p.name.length >= 4 && w.includes(p.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)
    .slice(0, 1)
    .forEach((p) => {
      filters.push({ label: p.name, scope: true, pass: (t) => t.projectId === p.id });
      w = w.split(p.name.toLowerCase()).join(' ');
    });

  SEARCH_FILTERS.forEach((f) => {
    f.re.lastIndex = 0;
    if (f.re.test(w)) {
      filters.push(f);
      w = w.replace(new RegExp(f.re.source, 'g'), ' ');
    }
  });

  const terms = [
    ...phrases,
    ...w.replace(/[^a-z0-9#\s-]/g, ' ').split(/\s+/)
      .map((x) => x.replace(/^#/, '').trim())
      .filter((x) => x.length >= 2 && !SEARCH_STOP.has(x)),
  ];

  // "show me all tasks" carries no words and no filters — that is still a
  // search, it just means everything. A bare verb with nothing to match is not.
  if (!terms.length && !filters.length && !listy) return null;
  const label = [...phrases.map((p) => `"${p}"`), ...terms.filter((t) => !phrases.includes(t)), ...filters.map((f) => f.label)]
    .filter((v, i, a) => a.indexOf(v) === i).join(' + ');
  return { terms, filters, label, strong: mentionsTask && (verb || listy) };
}

function scoreTask(t, terms) {
  if (!terms.length) return 1;
  const title = t.title.toLowerCase();
  const words = title.split(/[^a-z0-9]+/).filter(Boolean);
  const desc  = (t.description || '').toLowerCase();
  const proj  = (t.project || '').toLowerCase();
  const tags  = (t.tags || []).join(' ').toLowerCase();
  const who   = (t.assignees || []).join(' ').toLowerCase();
  let score = 0;
  if (terms.length > 1 && title.includes(terms.join(' '))) score += 60;
  terms.forEach((term) => {
    if (title.includes(term)) score += 12;
    // Light typo/stem tolerance: "disburse" finds "disbursement".
    else if (words.some((x) => x.startsWith(term) || (term.startsWith(x) && x.length >= 4))) score += 6;
    if (tags.includes(term)) score += 8;
    if (proj.includes(term)) score += 5;
    if (who.includes(term))  score += 5;
    if (desc.includes(term)) score += 4;
  });
  return score;
}

const DUE_LAST = '9999-99-99';
function byDue(a, b) {
  return (a.due || DUE_LAST).localeCompare(b.due || DUE_LAST) || a.title.localeCompare(b.title);
}

export function searchTasks(digest, terms = [], filters = []) {
  const pool = (digest.taskIndex || []).filter((t) => filters.every((f) => f.pass(t, digest)));
  if (!terms.length) return pool.slice().sort(byDue);
  return pool
    .map((t) => ({ t, score: scoreTask(t, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || byDue(a.t, b.t))
    .map((x) => x.t);
}

/* ── answer builders — every number here is computed, not guessed ── */

const SRC = (digest) => [`${plural(digest.counts.projects, 'project', 'projects')}`, `${plural(digest.counts.tasks, 'task', 'tasks')}`, `Activity log · 30 days`];

export function buildAnswer(intent, digest, question) {
  switch (intent?.key) {
    case 'risk':       return riskAnswer(digest);
    case 'week':       return weekAnswer(digest);
    case 'workspaces': return workspacesAnswer(digest);
    case 'people':     return peopleAnswer(digest);
    case 'blockers':   return blockersAnswer(digest);
    case 'hours':      return hoursAnswer(digest);
    case 'project':    return projectAnswer(digest, intent.projectId);
    case 'activity':   return activityAnswer(digest);
    case 'task':       return taskAnswer(digest, intent.taskId);
    case 'search':     return searchAnswer(digest, intent, question);
    default:           return fallbackAnswer(digest, question);
  }
}

function riskAnswer(d) {
  const ranked = d.projects.slice().sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || (b.gap ?? -99) - (a.gap ?? -99));
  const red = ranked.filter((p) => p.tone === 'red');
  const amber = ranked.filter((p) => p.tone === 'amber');
  const green = ranked.filter((p) => p.tone === 'green');
  const worst = red[0] || amber[0] || null;
  return {
    key: 'risk',
    badge: red.length ? `${plural(red.length, 'project', 'projects')} at risk` : amber.length ? `${plural(amber.length, 'project needs', 'projects need')} watching` : 'All projects on track',
    tone: red.length ? 'red' : amber.length ? 'amber' : 'green',
    summary: worst
      ? `${red.length + amber.length} of ${d.projects.length} projects are off-pace. ${worst.name} is the sharpest: ${worst.donePct}% complete${worst.elapsedPct != null ? ` against ${worst.elapsedPct}% of its schedule` : ''}, with ${plural(worst.overdue, 'overdue task', 'overdue tasks')}. ${green.length ? `${plural(green.length, 'project is', 'projects are')} tracking fine.` : ''}`
      : `All ${d.projects.length} projects are keeping pace with their plans — no overdue work and no project lagging its schedule by more than 10 points.`,
    metrics: [
      { label: 'At risk',       value: String(red.length + amber.length), delta: `of ${d.projects.length} projects`, tone: red.length ? 'red' : 'amber' },
      { label: 'Overdue tasks', value: String(d.counts.overdue),          delta: d.counts.overdue ? 'across all projects' : 'nothing late', tone: d.counts.overdue ? 'red' : 'green' },
      { label: 'Blocked',       value: String(d.counts.blocked),          delta: d.blockers.themes[0] ? `top theme: ${d.blockers.themes[0].word}` : 'no blockers logged', tone: d.counts.blocked ? 'amber' : 'green' },
      { label: 'On track',      value: String(green.length),              delta: 'no action needed', tone: 'green' },
    ],
    itemsTitle: 'Projects by health',
    items: ranked.map((p) => ({
      title: p.name,
      meta: `${p.donePct}% done${p.elapsedPct != null ? ` · ${p.elapsedPct}% of schedule elapsed` : ' · no plan dates'} · ${plural(p.overdue, 'overdue', 'overdue')}`,
      tag: p.tone === 'red' ? 'RED' : p.tone === 'amber' ? 'AMBER' : p.tone === 'grey' ? 'EMPTY' : 'GREEN',
      tone: p.tone, bar: p.donePct, dot: p.color,
    })),
    actions: localActions([
      worst && `Look at ${worst.name} first — it carries ${plural(worst.overdue, 'overdue task', 'overdue tasks')} and a ${worst.gap != null ? `${worst.gap}-point` : 'visible'} gap between progress and schedule.`,
      d.counts.blocked > 0 && `Clear the ${plural(d.counts.blocked, 'blocked task', 'blocked tasks')} — blocked work is the cheapest progress you can buy.`,
      d.counts.unassigned > 0 && `Give owners to the ${plural(d.counts.unassigned, 'unassigned task', 'unassigned tasks')}; unowned work is what slips first.`,
      'Either move the end dates or cut scope on the amber projects — the current plan does not fit.',
    ]),
    sources: [...SRC(d), 'Plan vs. actual dates'],
    followUps: [
      { label: 'What is blocking us?', key: 'blockers' },
      { label: 'Who is overloaded right now?', key: 'people' },
      { label: 'What changed this week?', key: 'week' },
    ],
  };
}

function weekAnswer(d) {
  const delta = d.hours.prev7 ? Math.round(((d.hours.total7 - d.hours.prev7) / d.hours.prev7) * 100) : null;
  const top = d.hours.byProject[0];
  return {
    key: 'week',
    badge: 'Last 7 days',
    tone: 'navy',
    summary: d.week.hours || d.week.doneThisWeek
      ? `${fmtHours(d.week.hours)} logged across ${plural(d.hours.acts7, 'activity', 'activities')}${top && top.hours7 ? `, most of it in ${top.name} (${fmtHours(top.hours7)})` : ''}. ${plural(d.week.doneThisWeek, 'task', 'tasks')} moved to Done and ${plural(d.week.blockedCount, 'blocker was', 'blockers were')} logged.`
      : `Nothing has been logged in the last 7 days. Either the work is happening without activity entries, or the week was genuinely quiet.`,
    metrics: [
      { label: 'Hours logged',    value: fmtHours(d.week.hours),      delta: delta == null ? 'no prior week to compare' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last week`, tone: delta == null ? 'navy' : delta >= 0 ? 'green' : 'amber' },
      { label: 'Tasks completed', value: String(d.week.doneThisWeek), delta: 'moved to Done', tone: d.week.doneThisWeek ? 'green' : 'grey' },
      { label: 'Blockers logged', value: String(d.week.blockedCount), delta: d.blockers.themes[0] ? d.blockers.themes[0].word : 'none', tone: d.week.blockedCount ? 'red' : 'green' },
      { label: 'Now overdue',     value: String(d.counts.overdue),    delta: 'open past due date', tone: d.counts.overdue ? 'amber' : 'green' },
    ],
    itemsTitle: 'Notable movement',
    items: d.week.movement.map((m) => ({
      title: m.title,
      meta: `${m.project} · ${fmtHours(m.hours)} · ${m.date}${m.note ? ` · ${m.note.slice(0, 60)}` : ''}`,
      tag: m.status === 'completed' ? 'Done' : m.status === 'blocked' ? 'Blocked' : m.status === 'not-started' ? 'Queued' : 'Doing',
      tone: m.status === 'completed' ? 'green' : m.status === 'blocked' ? 'red' : 'navy',
      dot: m.color,
    })),
    actions: localActions([
      d.blockers.tasks[0] && `Unblock "${d.blockers.tasks[0].task.title}" — it has been stuck ${plural(d.blockers.tasks[0].days, 'day', 'days')}, the longest of anything in flight.`,
      d.counts.overdue > 0 && `Re-date or close the ${plural(d.counts.overdue, 'overdue task', 'overdue tasks')} before they roll into next week.`,
      'Log any sessions you finished but never entered — the hours total is only as good as the log.',
    ]),
    sources: ['Activity log · 7 days', `${plural(d.hours.acts7, 'activity', 'activities')}`, 'Status transitions'],
    followUps: [
      { label: 'Which projects are at risk?', key: 'risk' },
      { label: 'What is blocking us?', key: 'blockers' },
      { label: 'Where did the hours go?', key: 'hours' },
    ],
  };
}

function workspacesAnswer(d) {
  const ws = d.workspaces;
  const busiest = ws[0];
  const dormant = ws.filter((w) => w.tasks === 0);
  return {
    key: 'workspaces',
    badge: `${plural(ws.length, 'workspace', 'workspaces')}`,
    tone: 'navy',
    summary: busiest
      ? `${busiest.name} carries most of the work: ${plural(busiest.projects, 'project', 'projects')} and ${plural(busiest.tasks, 'task', 'tasks')}, ${busiest.donePct}% complete. Across all ${ws.length} workspaces you have ${plural(ws.reduce((s, w) => s + w.projects, 0), 'project', 'projects')} and ${plural(ws.reduce((s, w) => s + w.tasks, 0), 'task', 'tasks')}.${dormant.length ? ` ${plural(dormant.length, 'workspace has', 'workspaces have')} no tasks at all.` : ''}`
      : `You are not a member of any workspace yet.`,
    metrics: [
      { label: 'Workspaces',      value: String(ws.length), delta: `${ws.filter((w) => w.members > 1).length} shared`, tone: 'navy' },
      { label: 'Active projects', value: String(ws.reduce((s, w) => s + w.projects, 0)), delta: busiest ? `${busiest.projects} in ${busiest.name}` : '—', tone: 'navy' },
      { label: 'Activities · 30d', value: String(d.counts.activities30), delta: 'in the active workspace', tone: 'navy' },
      { label: 'Memberships',     value: String(ws.reduce((s, w) => s + w.members, 0)), delta: `${ws.reduce((s, w) => s + w.pendingInvites, 0)} invites pending`, tone: ws.reduce((s, w) => s + w.pendingInvites, 0) ? 'amber' : 'green' },
    ],
    itemsTitle: 'Workspace pulse',
    items: ws.map((w) => ({
      title: `${w.name}${w.active ? ' · active' : ''}`,
      meta: `${plural(w.projects, 'project', 'projects')} · ${plural(w.tasks, 'task', 'tasks')} · ${plural(w.members, 'member', 'members')}`,
      tag: `${w.donePct}%`,
      tone: w.tasks === 0 ? 'grey' : w.donePct >= 70 ? 'green' : w.donePct >= 35 ? 'amber' : 'navy',
      bar: w.donePct, dot: w.color,
    })),
    actions: localActions([
      dormant.length > 0 && `Archive the ${plural(dormant.length, 'empty workspace', 'empty workspaces')} so they stop diluting your views.`,
      ws.reduce((s, w) => s + w.pendingInvites, 0) > 0 && `Chase the pending invites — people who cannot get in cannot pick work up.`,
      busiest && `${busiest.name} holds most of the risk simply by holding most of the work; review it first each week.`,
    ]),
    sources: [`${plural(ws.length, 'workspace', 'workspaces')}`, 'Membership records', 'Activity log · 30 days'],
    followUps: [
      { label: 'Which projects are at risk?', key: 'risk' },
      { label: 'What changed this week?', key: 'week' },
      { label: 'Who is overloaded right now?', key: 'people' },
    ],
  };
}

function peopleAnswer(d) {
  const people = d.people;
  const max = Math.max(1, ...people.map((p) => p.open));
  const heaviest = people[0];
  const light = people.filter((p) => p.open <= max / 2);
  return {
    key: 'people',
    badge: heaviest ? `${heaviest.label} carries the most` : 'No assignments yet',
    tone: heaviest && heaviest.overdue > 0 ? 'red' : heaviest ? 'amber' : 'grey',
    summary: heaviest
      ? `${heaviest.label} holds ${plural(heaviest.open, 'open task', 'open tasks')} (${plural(heaviest.doing, 'in Doing', 'in Doing')}${heaviest.overdue ? `, ${heaviest.overdue} overdue` : ''}) — the heaviest load on the team of ${people.length}. ${light.length ? `${light.map((p) => p.label).slice(0, 3).join(', ')} ${light.length === 1 ? 'has' : 'have'} room.` : ''} ${d.unassigned ? `${plural(d.unassigned, 'task has', 'tasks have')} no owner at all.` : ''}`
      : `No open task has an assignee yet, so there is no workload to compare. Assign owners and this answer becomes useful.`,
    metrics: [
      { label: 'People with work', value: String(people.length), delta: 'have open tasks', tone: 'navy' },
      { label: 'Heaviest load',    value: heaviest ? String(heaviest.open) : '0', delta: heaviest ? heaviest.label : '—', tone: 'amber' },
      { label: 'Overdue owned',    value: String(people.reduce((s, p) => s + p.overdue, 0)), delta: 'past due and assigned', tone: people.reduce((s, p) => s + p.overdue, 0) ? 'red' : 'green' },
      { label: 'Unassigned',       value: String(d.unassigned), delta: 'open tasks with no owner', tone: d.unassigned ? 'amber' : 'green' },
    ],
    itemsTitle: 'Open tasks per person',
    items: people.map((p) => ({
      title: p.label,
      meta: `${plural(p.open, 'open task', 'open tasks')} · ${p.doing} in Doing${p.overdue ? ` · ${p.overdue} overdue` : ''}${p.hours ? ` · ${fmtHours(p.hours)} logged (30d)` : ''}`,
      tag: `${clampPct((p.open / max) * 100)}%`,
      tone: p.overdue > 0 ? 'red' : p.open >= max ? 'amber' : 'green',
      bar: clampPct((p.open / max) * 100),
      dot: p.overdue > 0 ? '#e74c3c' : '#1DA449',
    })),
    actions: localActions([
      heaviest && light[0] && `Move one of ${heaviest.label}'s open tasks to ${light[0].label} — the gap is ${heaviest.open - light[0].open} tasks wide.`,
      d.unassigned > 0 && `Assign the ${plural(d.unassigned, 'ownerless task', 'ownerless tasks')}; unowned work is invisible work.`,
      heaviest && heaviest.doing > 3 && `Cap Doing at 3 per person — ${heaviest.label} is running ${heaviest.doing} in parallel.`,
      'Rebalance before the week starts, not after something slips.',
    ]),
    sources: [`${plural(people.length, 'assignee', 'assignees')}`, `${plural(d.counts.open, 'open task', 'open tasks')}`, 'Assignments'],
    followUps: [
      { label: 'What is blocking us?', key: 'blockers' },
      { label: 'Which projects are at risk?', key: 'risk' },
      { label: 'Where did the hours go?', key: 'hours' },
    ],
  };
}

function blockersAnswer(d) {
  const b = d.blockers;
  const oldest = b.tasks[0];
  const maxCount = Math.max(1, ...b.byProject.map((p) => p.count));
  return {
    key: 'blockers',
    badge: b.total ? `${plural(b.total, 'blocker', 'blockers')} · 30 days` : 'Nothing blocked',
    tone: b.total ? 'red' : 'green',
    summary: b.total
      ? `${plural(b.total, 'blocked activity was', 'blocked activities were')} logged in the last 30 days${b.themes[0] ? `, and "${b.themes[0].word}" is the recurring word — it appears ${plural(b.themes[0].n, 'time', 'times')}` : ''}. ${oldest ? `The oldest live blocker is "${oldest.task.title}", stuck ${plural(oldest.days, 'day', 'days')}.` : ''} ${b.byProject[0] ? `${b.byProject[0].name} is the most blocked project.` : ''}`
      : `Nothing is flagged as blocked in the last 30 days — either the path is clear, or blockers are not being logged with a bottleneck note.`,
    metrics: [
      { label: 'Blocked activities', value: String(b.total), delta: 'last 30 days', tone: b.total ? 'red' : 'green' },
      { label: 'Top theme',          value: b.themes[0] ? b.themes[0].word : '—', delta: b.themes[0] ? `${plural(b.themes[0].n, 'mention', 'mentions')}` : 'no notes logged', tone: 'red' },
      { label: 'Currently blocked',  value: String(b.tasks.length), delta: 'open tasks', tone: b.tasks.length ? 'amber' : 'green' },
      { label: 'Oldest blocker',     value: oldest ? `${oldest.days}d` : '—', delta: oldest ? oldest.task.title.slice(0, 28) : 'nothing stuck', tone: oldest && oldest.days > 7 ? 'red' : 'amber' },
    ],
    itemsTitle: b.tasks.length ? 'What is actually stuck' : 'Blockers by project',
    items: (b.tasks.length ? b.tasks.slice(0, 6).map((x) => ({
      title: x.task.title,
      meta: `${plural(x.days, 'day', 'days')} since flagged${x.why ? ` · ${x.why.slice(0, 70)}` : ''}`,
      tag: 'Blocked', tone: 'red', dot: '#e74c3c',
    })) : b.byProject.map((p) => ({
      title: p.name,
      meta: `${plural(p.count, 'blocked activity', 'blocked activities')}${p.themes[0] ? ` · ${p.themes.map((t) => t.word).join(', ')}` : ''}`,
      tag: String(p.count), tone: p.count >= maxCount ? 'red' : 'amber',
      bar: clampPct((p.count / maxCount) * 100), dot: p.color,
    }))),
    actions: localActions([
      oldest && `Break "${oldest.task.title}" open today — ${plural(oldest.days, 'day', 'days')} in one task means it was never task-sized.`,
      b.themes[0] && `"${b.themes[0].word}" keeps coming back. Fix it structurally instead of case by case.`,
      b.byProject[0] && `Ask ${b.byProject[0].name} to log bottleneck reasons consistently — you can only route what you can read.`,
    ]),
    sources: ['Activity log · 30 days', 'Bottleneck flags', `${plural(d.counts.projects, 'project', 'projects')}`],
    followUps: [
      { label: 'Which projects are at risk?', key: 'risk' },
      { label: 'Who is overloaded right now?', key: 'people' },
      { label: 'What changed this week?', key: 'week' },
    ],
  };
}

function hoursAnswer(d) {
  const h = d.hours;
  const max = Math.max(1, ...h.byProject.map((p) => p.hours7));
  const delta = h.prev7 ? Math.round(((h.total7 - h.prev7) / h.prev7) * 100) : null;
  const idle = h.byProject.filter((p) => p.hours7 === 0 && p.open > 0);
  return {
    key: 'hours',
    badge: 'Time logged',
    tone: 'navy',
    summary: h.total7
      ? `${fmtHours(h.total7)} across ${plural(h.acts7, 'activity', 'activities')} in the last 7 days. ${h.byProject[0] && h.byProject[0].hours7 ? `${h.byProject[0].name} takes the biggest share at ${fmtHours(h.byProject[0].hours7)}.` : ''} ${h.busiestDay ? `${h.busiestDay[0]} was the heaviest day at ${fmtHours(h.busiestDay[1])}.` : ''}${idle.length ? ` ${plural(idle.length, 'project has', 'projects have')} open work but zero logged hours.` : ''}`
      : `No hours were logged in the last 7 days, so there is nothing to break down. Activities carry the hours — log them as you go and this becomes a real timesheet.`,
    metrics: [
      { label: 'Total · 7 days',   value: fmtHours(h.total7), delta: delta == null ? 'no prior week' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs prior week`, tone: delta == null ? 'navy' : delta >= 0 ? 'green' : 'amber' },
      { label: 'Busiest day',      value: h.busiestDay ? fmtHours(h.busiestDay[1]) : '—', delta: h.busiestDay ? h.busiestDay[0] : 'nothing logged', tone: 'navy' },
      { label: 'Activities',       value: String(h.acts7), delta: h.acts7 ? `avg ${fmtHours(h.total7 / h.acts7)} each` : '—', tone: 'navy' },
      { label: 'Projects touched', value: String(h.byProject.filter((p) => p.hours7 > 0).length), delta: `of ${d.counts.projects} active`, tone: idle.length ? 'amber' : 'green' },
    ],
    itemsTitle: 'Hours by project',
    items: h.byProject.map((p) => ({
      title: p.name,
      meta: p.hours7 ? `${fmtHours(p.hours7)} · ${plural(p.acts7, 'activity', 'activities')}` : 'nothing logged this week',
      tag: h.total7 ? `${pct(p.hours7, h.total7)}%` : '0%',
      tone: p.hours7 ? 'navy' : 'grey',
      bar: clampPct((p.hours7 / max) * 100), dot: p.color,
    })),
    actions: localActions([
      idle[0] && `${idle[0].name} has ${plural(idle[0].open, 'open task', 'open tasks')} and zero logged hours — confirm it is paused, not just unlogged.`,
      'Back-date any sessions you finished but never logged, while you still remember them.',
      h.busiestDay && `Protect whatever made ${h.busiestDay[0]} productive — it was your best day this week.`,
    ]),
    sources: ['Activity log · 7 days', `${plural(h.acts7, 'activity', 'activities')}`, `${plural(d.counts.projects, 'project', 'projects')}`],
    followUps: [
      { label: 'What changed this week?', key: 'week' },
      { label: 'Who is overloaded right now?', key: 'people' },
      { label: 'Which projects are at risk?', key: 'risk' },
    ],
  };
}

function projectAnswer(d, projectId) {
  const p = d.projects.find((x) => x.id === projectId);
  if (!p) return fallbackAnswer(d);
  const stuck = d.blockers.tasks.filter((x) => x.task.projectId === p.id);
  const overdue = d.tasks.overdue.filter((t) => t.projectId === p.id);
  const doing = d.tasks.open.filter((t) => t.projectId === p.id && t.status === 'doing');
  // One row per task: blocked wins over overdue, overdue over merely in-progress,
  // so a task that is all three is listed once with its most urgent framing.
  const seen = new Set();
  const rows = [];
  const push = (taskId, row) => {
    if (seen.has(taskId) || rows.length >= 8) return;
    seen.add(taskId);
    rows.push(row);
  };
  stuck.slice(0, 4).forEach((x) => push(x.task.id, {
    title: x.task.title,
    meta: `blocked ${plural(x.days, 'day', 'days')}${x.why ? ` · ${x.why.slice(0, 60)}` : ''}${x.task.plan?.endDate && x.task.plan.endDate < d.today ? ' · overdue' : ''}`,
    tag: 'Blocked', tone: 'red', dot: '#e74c3c',
  }));
  overdue.slice(0, 5).forEach((t) => push(t.id, {
    title: t.title,
    meta: `due ${t.plan.endDate} · ${Math.abs(daysBetween(t.plan.endDate, d.today) || 0)} days late · ${t.status}`,
    tag: 'Overdue', tone: 'red', dot: '#e74c3c',
  }));
  doing.slice(0, 4).forEach((t) => push(t.id, {
    title: t.title,
    meta: `in Doing${t.plan?.endDate ? ` · due ${t.plan.endDate}` : ''}`,
    tag: 'Doing', tone: 'amber', dot: p.color,
  }));
  const projEntries = (d.activityLog || []).filter((e) => e.projectId === p.id);
  return {
    key: `project:${p.id}`,
    badge: `${p.name} · ${p.tone.toUpperCase()}`,
    tone: p.tone === 'grey' ? 'navy' : p.tone,
    summary: `${p.name} is ${p.donePct}% complete${p.elapsedPct != null ? ` with ${p.elapsedPct}% of its schedule gone` : ' (no plan dates set)'}. ${plural(p.open, 'task is', 'tasks are')} still open, ${plural(p.overdue, 'is', 'are')} overdue and ${plural(stuck.length, 'is', 'are')} blocked. ${fmtHours(p.hours)} have been logged against it in the last 30 days${projEntries[0] ? `, most recently on ${projEntries[0].date} against "${projEntries[0].title}"` : ''}.`,
    metrics: [
      { label: 'Complete',      value: `${p.donePct}%`, delta: `${p.done} of ${p.total} tasks`, tone: p.donePct >= 70 ? 'green' : 'amber' },
      { label: 'Schedule used', value: p.elapsedPct != null ? `${p.elapsedPct}%` : '—', delta: p.gap != null ? `${p.gap > 0 ? `${p.gap}-point gap` : 'ahead of plan'}` : 'no plan dates', tone: p.gap != null && p.gap >= 20 ? 'red' : p.gap != null && p.gap >= 10 ? 'amber' : 'green' },
      { label: 'Overdue',       value: String(p.overdue), delta: p.overdue ? 'past due date' : 'nothing late', tone: p.overdue ? 'red' : 'green' },
      { label: 'Hours · 30d',   value: fmtHours(p.hours), delta: `${plural(projEntries.length, 'log entry', 'log entries')}`, tone: 'navy' },
    ],
    itemsTitle: rows.length ? 'What is actually stuck' : projEntries.length ? 'Latest activity' : 'Nothing stuck',
    // Fall back to the project's newest log entries when nothing is stuck, so
    // a healthy project still reports what actually happened on it.
    items: rows.length ? rows : projEntries.slice(0, 6).map(actRow),
    actions: localActions([
      stuck[0] && `Unblock "${stuck[0].task.title}" — ${plural(stuck[0].days, 'day', 'days')} stalled is the single biggest drag on this project.`,
      p.gap != null && p.gap >= 15 && `Pick one: move ${p.name}'s end date, or cut scope. A ${p.gap}-point gap does not close on optimism.`,
      overdue.length > 0 && `Re-date the ${plural(overdue.length, 'overdue task', 'overdue tasks')} so the plan reflects reality.`,
      p.inDoing > 4 && `${p.inDoing} tasks are in Doing at once — finish before starting.`,
      !projEntries.length && `Nothing has been logged against ${p.name} in 30 days — confirm it is paused, not just unrecorded.`,
    ]),
    sources: [p.name, `${plural(p.total, 'task', 'tasks')}`, 'Activity log · 30 days', 'Plan vs. actual'],
    followUps: [
      { label: 'What is blocking us?', key: 'blockers' },
      { label: 'Who is overloaded right now?', key: 'people' },
      { label: 'Which projects are at risk?', key: 'risk' },
    ],
  };
}

const ACT_TONE = { completed: 'green', blocked: 'red', 'not-started': 'grey' };
const ACT_TAG  = { completed: 'Done', blocked: 'Blocked', 'not-started': 'Queued' };
function actRow(e) {
  return {
    title: e.title,
    meta: [
      e.project,
      e.date,
      e.hours ? fmtHours(e.hours) : null,
      e.who || null,
      (e.bottleneck || e.note) ? (e.bottleneck || e.note).slice(0, 80) : null,
    ].filter(Boolean).join(' · '),
    tag: ACT_TAG[e.status] || 'Doing',
    tone: ACT_TONE[e.status] || 'navy',
    dot: e.color,
  };
}

// The activity log itself — "what has been logged", down to individual entries.
function activityAnswer(d) {
  const log = d.activityLog;
  const hours = log.reduce((s, e) => s + e.hours, 0);
  const byPerson = {};
  log.forEach((e) => { if (e.who) byPerson[e.who] = (byPerson[e.who] || 0) + 1; });
  const topPerson = Object.entries(byPerson).sort((a, b) => b[1] - a[1])[0];
  const withNotes = log.filter((e) => e.note || e.bottleneck).length;
  return {
    key: 'activity',
    badge: log.length ? `${plural(log.length, 'entry', 'entries')} · 30 days` : 'Nothing logged',
    tone: log.length ? 'navy' : 'grey',
    summary: log.length
      ? `${plural(log.length, 'activity entry', 'activity entries')} in the last 30 days, carrying ${fmtHours(hours)}${topPerson ? ` — ${topPerson[0]} logged the most (${plural(topPerson[1], 'entry', 'entries')})` : ''}. ${plural(withNotes, 'entry has', 'entries have')} a written note or bottleneck remark. The newest is "${log[0].title}" on ${log[0].date}.`
      : `The activity log is empty for the last 30 days. Log activities against tasks and I can report progress down to the individual entry.`,
    metrics: [
      { label: 'Entries · 30d',  value: String(log.length), delta: `${plural(d.counts.activities7, 'in', 'in')} the last 7 days`, tone: 'navy' },
      { label: 'Hours logged',   value: fmtHours(hours), delta: log.length ? `avg ${fmtHours(hours / log.length)} per entry` : '—', tone: 'navy' },
      { label: 'With remarks',   value: String(withNotes), delta: 'have a note or blocker', tone: withNotes ? 'green' : 'amber' },
      { label: 'Blocked entries', value: String(log.filter((e) => e.status === 'blocked').length), delta: 'flagged as blocked', tone: log.some((e) => e.status === 'blocked') ? 'red' : 'green' },
    ],
    itemsTitle: 'Newest entries',
    items: log.slice(0, 8).map(actRow),
    actions: localActions([
      log[0] && `Newest entry is "${log[0].title}" (${log[0].date}) — check it is still an accurate picture.`,
      log.length - withNotes > 0 && `${plural(log.length - withNotes, 'entry has', 'entries have')} no note; a bare hours figure tells you nothing in a month.`,
      'Ask about a specific task or project by name and I will read its entries in detail.',
    ]),
    sources: ['Activity log · 30 days', `${plural(log.length, 'entry', 'entries')}`, `${plural(d.counts.projects, 'project', 'projects')}`],
    followUps: [
      { label: 'What is blocking us?', key: 'blockers' },
      { label: 'Where did the hours go?', key: 'hours' },
      { label: 'What changed this week?', key: 'week' },
    ],
  };
}

// One task, read through its own activity entries.
function taskAnswer(d, taskId) {
  const t = (d.taskIndex || []).find((x) => x.id === taskId);
  if (!t) return fallbackAnswer(d);
  const entries = t.entries;
  const hours = entries.reduce((s, e) => s + e.hours, 0);
  const blocked = entries.filter((e) => e.status === 'blocked');
  const doneSubs = t.subtasks.filter((x) => x.done).length;
  const lateBy = t.overdue ? Math.abs(daysBetween(t.due, d.today) || 0) : 0;
  return {
    key: `task:${t.id}`,
    badge: `${t.title.slice(0, 40)} · ${t.status}`,
    tone: t.overdue || blocked.length ? 'red' : t.status === 'done' ? 'green' : 'navy',
    summary: `"${t.title}" sits in ${t.project} at status ${t.status}${t.due ? `, due ${t.due}${t.overdue ? ` — ${plural(lateBy, 'day', 'days')} late` : ''}` : ' with no due date'}. ${entries.length ? `${plural(entries.length, 'activity entry has', 'activity entries have')} been logged against it in the last 30 days, totalling ${fmtHours(hours)}.` : 'Nothing has been logged against it in the last 30 days.'}${blocked.length ? ` The latest blocker reads: "${(blocked[0].bottleneck || blocked[0].note).slice(0, 120)}".` : ''}${t.subtasks.length ? ` Subtasks: ${doneSubs} of ${t.subtasks.length} done.` : ''}`,
    metrics: [
      { label: 'Status',        value: t.status, delta: t.assignees.length ? t.assignees.join(', ').slice(0, 28) : 'unassigned', tone: t.status === 'done' ? 'green' : t.status === 'doing' ? 'navy' : 'grey' },
      { label: 'Due',           value: t.due || '—', delta: t.overdue ? `${lateBy} days late` : t.due ? 'on the plan' : 'no date set', tone: t.overdue ? 'red' : 'green' },
      { label: 'Hours logged',  value: fmtHours(hours), delta: `${plural(entries.length, 'entry', 'entries')} · 30d`, tone: 'navy' },
      { label: 'Subtasks',      value: t.subtasks.length ? `${doneSubs}/${t.subtasks.length}` : '—', delta: t.subtasks.length ? 'checked off' : 'none defined', tone: t.subtasks.length && doneSubs === t.subtasks.length ? 'green' : 'amber' },
    ],
    itemsTitle: entries.length ? 'Its activity log' : 'No entries yet',
    items: entries.slice(0, 8).map(actRow),
    actions: localActions([
      blocked[0] && `Clear the blocker logged on ${blocked[0].date}: ${(blocked[0].bottleneck || blocked[0].note).slice(0, 90)}`,
      t.overdue && `It is ${plural(lateBy, 'day', 'days')} past due — re-date it or finish it, but do not leave the plan lying.`,
      !entries.length && 'Log an activity against it so progress is visible to everyone else.',
      t.subtasks.length && doneSubs < t.subtasks.length && `${plural(t.subtasks.length - doneSubs, 'subtask is', 'subtasks are')} still open.`,
    ]),
    sources: [t.title.slice(0, 30), t.project, `${plural(entries.length, 'activity entry', 'activity entries')}`, 'Activity log · 30 days'],
    followUps: [
      { label: 'What is blocking us?', key: 'blockers' },
      { label: 'What changed this week?', key: 'week' },
      { label: 'Which projects are at risk?', key: 'risk' },
    ],
  };
}

const STATUS_LABEL = { todo: 'To do', doing: 'Doing', done: 'Done' };

function taskRow(t) {
  return {
    title: t.title,
    meta: [
      t.project,
      t.due ? `due ${t.due}` : 'no due date',
      t.assignees.length ? t.assignees.join(', ') : 'unassigned',
      t.hours ? fmtHours(t.hours) : null,
      t.tags?.length ? t.tags.map((x) => `#${x}`).join(' ') : null,
    ].filter(Boolean).join(' · '),
    tag: t.overdue ? 'Overdue' : t.blocked ? 'Blocked' : STATUS_LABEL[t.status] || t.status,
    tone: t.overdue || t.blocked ? 'red' : t.status === 'done' ? 'green' : t.status === 'doing' ? 'navy' : 'grey',
    dot: t.color,
    taskId: t.id,
    projectId: t.projectId || null,
  };
}

// A search always answers with the matching tasks — never with a report that
// leaves the user wondering whether their task exists.
function searchAnswer(d, intent, question) {
  const { terms = [], filters = [], label = '' } = intent || {};
  const hits = searchTasks(d, terms, filters);
  const shown = hits.slice(0, 12);
  const total = d.counts.tasks;

  // Nothing matched: say so, and show what the words alone would have found
  // so a too-narrow filter is obvious rather than mysterious.
  if (!hits.length) {
    // Relax the status filters but keep any project scope — "no overdue tasks
    // in Website revamp" should still show that project's tasks, not the
    // whole workspace's.
    const kept    = filters.filter((f) => f.scope);
    const dropped = filters.filter((f) => !f.scope);
    const loose   = dropped.length ? searchTasks(d, terms, kept).slice(0, 6) : [];
    return {
      key: `search:${label}`,
      badge: `No match · ${label || 'search'}`,
      tone: 'amber',
      searchLabel: label,
      matchCount: 0,
      summary: `No task in this workspace matches ${label ? `${label}` : 'that'}. I searched all ${plural(total, 'live task', 'live tasks')} here by title, description, tags, project and assignee.${loose.length ? ` Without the ${dropped.map((f) => f.label).join(' + ')} filter, ${plural(loose.length, 'task matches', 'tasks match')} — listed below.` : ''} If you just created it, check it landed in this workspace: Ask AI only sees the one you have open.`,
      metrics: [],
      itemsTitle: loose.length ? `Same search without "${dropped.map((f) => f.label).join(' + ')}"` : '',
      items: loose.map(taskRow),
      actions: localActions([
        'Try fewer words — a single distinctive one usually finds it.',
        dropped.length && `Drop the ${dropped.map((f) => f.label).join(' + ')} filter and search again.`,
        'If it is in another workspace, switch to it from the sidebar first.',
      ]),
      sources: [`${plural(total, 'task', 'tasks')} searched`, `${plural(d.counts.projects, 'project', 'projects')}`],
      followUps: [
        { label: 'Which projects are at risk?', key: 'risk' },
        { label: 'What is blocking us?', key: 'blockers' },
        { label: 'What changed this week?', key: 'week' },
      ],
    };
  }

  const overdue = hits.filter((t) => t.overdue).length;
  const open    = hits.filter((t) => t.status !== 'done').length;
  const hours   = hits.reduce((s, t) => s + t.hours, 0);
  const projects = [...new Set(hits.map((t) => t.project))];

  return {
    key: `search:${label}`,
    badge: `${plural(hits.length, 'match', 'matches')} · ${label || 'all tasks'}`,
    tone: overdue ? 'red' : open ? 'navy' : 'green',
    searchLabel: label,
    matchCount: hits.length,
    summary: `${plural(hits.length, 'task matches', 'tasks match')} ${label ? `${label}` : 'that'}, out of ${plural(total, 'live task', 'live tasks')} in this workspace. ${plural(open, 'is', 'are')} still open${overdue ? `, and ${plural(overdue, 'is', 'are')} past due` : ''}. ${hits.length === 1 ? `It sits in ${projects[0]}.` : projects.length === 1 ? `All of them sit in ${projects[0]}.` : `They span ${plural(projects.length, 'project', 'projects')}: ${projects.slice(0, 4).join(', ')}${projects.length > 4 ? '…' : ''}.`}${hits.length > shown.length ? ` The ${shown.length} most relevant are listed below.` : ''}`,
    metrics: [
      { label: 'Matches',  value: String(hits.length), delta: label || 'all tasks', tone: 'navy' },
      { label: 'Open',     value: String(open), delta: `${hits.length - open} done`, tone: open ? 'amber' : 'green' },
      { label: 'Overdue',  value: String(overdue), delta: overdue ? 'past the plan' : 'none late', tone: overdue ? 'red' : 'green' },
      { label: 'Logged',   value: fmtHours(hours), delta: 'across the matches', tone: 'navy' },
    ],
    itemsTitle: hits.length > shown.length ? `Top ${shown.length} of ${hits.length} matches` : 'Matching tasks',
    items: shown.map(taskRow),
    actions: localActions([
      overdue && `${plural(overdue, 'match is', 'matches are')} overdue — re-date or close ${overdue === 1 ? 'it' : 'them'}.`,
      hits.some((t) => t.blocked) && 'Some of these are blocked — clear the blocker before adding more work.',
      'Click a row to open the task.',
    ]),
    sources: [`${plural(total, 'task', 'tasks')} searched`, ...projects.slice(0, 2)],
    followUps: [
      { label: 'What is blocking us?', key: 'blockers' },
      { label: 'Who is overloaded right now?', key: 'people' },
      { label: 'Which projects are at risk?', key: 'risk' },
    ],
  };
}

function fallbackAnswer(d, question) {
  return {
    key: 'fallback',
    badge: 'Need a bit more',
    tone: 'amber',
    summary: `I can answer that better with a narrower target. I have live data on ${plural(d.counts.workspaces, 'workspace', 'workspaces')}, ${plural(d.counts.projects, 'project', 'projects')}, ${plural(d.counts.tasks, 'task', 'tasks')} and ${plural(d.counts.activities30, 'activity', 'activities')} in the last 30 days — try naming a project, a person or a timeframe, or pick one of the follow-ups below.`,
    metrics: [],
    items: [],
    actions: [],
    sources: [`${plural(d.counts.workspaces, 'workspace', 'workspaces')}`, `${plural(d.counts.projects, 'project', 'projects')}`, `${plural(d.counts.tasks, 'task', 'tasks')}`],
    followUps: [
      { label: 'Which projects are at risk?', key: 'risk' },
      { label: 'What changed this week?', key: 'week' },
      { label: 'Who is overloaded right now?', key: 'people' },
    ],
    _question: question,
  };
}

function toneRank(t) {
  return { red: 0, amber: 1, green: 2, navy: 3, grey: 4 }[t] ?? 5;
}
function localActions(list) {
  return list.filter(Boolean).slice(0, 3);
}

/* ── AI narration — prose only, never numbers ────────────── */

// Serializes the computed facts so the model reasons over real data.
function factsText(answer, digest, scope) {
  const lines = [];
  lines.push(`Today: ${digest.today}`);
  lines.push(`Scope requested: ${scope}`);
  lines.push(`Totals: ${digest.counts.workspaces} workspaces, ${digest.counts.projects} projects, ${digest.counts.tasks} tasks (${digest.counts.open} open, ${digest.counts.overdue} overdue, ${digest.counts.blocked} blocked), ${digest.counts.activities30} activities in 30 days, ${digest.counts.unassigned} unassigned tasks.`);
  if (answer.metrics?.length) lines.push(`Metrics: ${answer.metrics.map((m) => `${m.label}=${m.value} (${m.delta})`).join('; ')}`);
  if (answer.items?.length) {
    lines.push(`${answer.itemsTitle}:`);
    answer.items.forEach((it) => lines.push(`  - ${it.title} [${it.tag}] — ${it.meta}`));
  }
  lines.push(`Project health: ${digest.projects.map((p) => `${p.name} ${p.donePct}% done${p.elapsedPct != null ? `/${p.elapsedPct}% elapsed` : ''}, ${p.overdue} overdue`).join(' | ') || '(none)'}`);
  // The raw activity log, so answers can quote a specific entry rather than
  // only aggregates. Newest first, capped so the prompt stays small.
  const log = digest.activityLog || [];
  if (log.length) {
    lines.push(`Activity log (newest first, ${Math.min(log.length, 25)} of ${log.length} entries in 30 days):`);
    log.slice(0, 25).forEach((e) => lines.push(
      `  - ${e.date} · ${e.project} · ${e.title} · ${e.hours}h · ${e.status}${e.who ? ` · ${e.who}` : ''}${e.bottleneck ? ` · BLOCKER: ${e.bottleneck.slice(0, 110)}` : e.note ? ` · note: ${e.note.slice(0, 110)}` : ''}`,
    ));
  }
  if (answer.searchLabel !== undefined) {
    lines.push(`Search performed: ${answer.searchLabel || '(no terms)'} — matched ${answer.matchCount} task(s). The list above is the COMPLETE result set.`);
  }
  // The real task inventory, so the model can never claim a task does not
  // exist when it does — it only ever narrates what is actually here.
  const idx = digest.taskIndex || [];
  if (idx.length) {
    lines.push(`Task inventory (${Math.min(idx.length, 40)} of ${idx.length}): ${idx.slice(0, 40).map((t) => `${t.title} [${t.status}${t.overdue ? ', overdue' : ''}]`).join(' | ')}`);
  }
  if (digest.blockers.tasks.length) lines.push(`Blocked tasks: ${digest.blockers.tasks.slice(0, 5).map((b) => `${b.task.title} (${b.days}d${b.why ? `: ${b.why.slice(0, 80)}` : ''})`).join(' | ')}`);
  if (digest.people.length) lines.push(`Workload: ${digest.people.map((p) => `${p.label} ${p.open} open/${p.doing} doing/${p.overdue} overdue`).join(' | ')}`);
  return lines.join('\n');
}

const NARRATE_SYSTEM = `You are the analyst inside "Task Monitor", a project-management app. You are shown FACTS computed from the user's live database. Those facts are correct and complete — never invent, adjust or contradict a number, name or date, and never mention data you were not given.

Write for a busy operator: direct, concrete, no filler, no praise, no "it looks like". Refer to projects, tasks and people by their real names from the facts. Never say something does not exist unless the facts say so — when a search result is given, it is the complete answer, so report it as found. When the activity log is included, quote or paraphrase specific entries (with their date) rather than only aggregates — the user wants updates down to the individual log entry.

Respond ONLY with a JSON object, no markdown and no code fences:
{
  "summary": "2-4 sentences answering the question using the facts",
  "actions": ["3 short, specific, imperative next steps"],
  "followUps": ["3 short follow-up questions the user might ask next, max 40 chars each"]
}`;

// Upgrades a locally-built answer's prose with Claude. Returns the answer
// unchanged (plus `aiError`) when AI is unavailable or the call fails — the
// numbers, items and metrics are never touched either way.
export async function narrate({ question, answer, digest, scope = 'Everything' }) {
  if (!isAiAvailable()) return { ...answer, aiUsed: false };
  try {
    const user = `Question: ${question}

FACTS
${factsText(answer, digest, scope)}

Answer the question from these facts.`;
    const parsed = await callClaudeJson({
      system: NARRATE_SYSTEM, user, maxTokens: 900, meta: { kind: 'ask-ai-narrate', scope },
    });
    return {
      ...answer,
      summary: String(parsed.summary || answer.summary).trim() || answer.summary,
      actions: Array.isArray(parsed.actions) && parsed.actions.length
        ? parsed.actions.slice(0, 4).map((a) => String(a).trim()).filter(Boolean)
        : answer.actions,
      followUps: Array.isArray(parsed.followUps) && parsed.followUps.length
        ? parsed.followUps.slice(0, 3).map((f) => ({ label: String(f).trim(), q: String(f).trim() }))
        : answer.followUps,
      aiUsed: true,
    };
  } catch (err) {
    console.warn('[ask-ai] narration failed, falling back to local summary:', err);
    return { ...answer, aiUsed: false, aiError: err?.message || String(err) };
  }
}

/* ── suggestions (hero cards) ────────────────────────────── */

export function buildSuggestions(digest) {
  const worst = digest.projects
    .slice()
    .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || (b.gap ?? -99) - (a.gap ?? -99))[0];
  const base = [
    { q: 'Which projects are at risk and why?', tag: 'Projects · health',       icon: '▲', intent: { key: 'risk' } },
    { q: 'What changed this week?',             tag: 'Everything · last 7 days', icon: '◷', intent: { key: 'week' } },
    { q: 'How do my workspaces compare?',       tag: 'Workspaces · pulse',       icon: '◫', intent: { key: 'workspaces' } },
    { q: 'Who is overloaded right now?',        tag: 'Tasks · capacity',         icon: '◐', intent: { key: 'people' } },
    { q: 'What is blocking us most often?',     tag: 'Tasks · bottlenecks',      icon: '⊘', intent: { key: 'blockers' } },
  ];
  base.push(worst && (worst.tone === 'red' || worst.tone === 'amber')
    ? { q: `Why exactly is ${worst.name} behind?`, tag: 'Projects · deep dive', icon: '◈', intent: { key: 'project', projectId: worst.id } }
    : { q: 'Where did the hours go?', tag: 'Activity · time logged', icon: '◈', intent: { key: 'hours' } });
  return base;
}

/* ── plain-text export (Share button) ────────────────────── */

export function answerToText(question, answer) {
  const out = [`Q: ${question}`, '', answer.summary];
  if (answer.metrics?.length) {
    out.push('', ...answer.metrics.map((m) => `• ${m.label}: ${m.value} (${m.delta})`));
  }
  if (answer.items?.length) {
    out.push('', `${answer.itemsTitle}:`, ...answer.items.map((i) => `• ${i.title} [${i.tag}] — ${i.meta}`));
  }
  if (answer.actions?.length) {
    out.push('', "What I'd do next:", ...answer.actions.map((a) => `• ${a}`));
  }
  if (answer.sources?.length) out.push('', `Based on: ${answer.sources.join(', ')}`);
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════
   WRITE ACTIONS — propose, confirm, then apply
   ──────────────────────────────────────────────────────────
   Nothing here writes on its own. parseAction() turns a request into a
   PROPOSAL that the view renders for confirmation; applyAction() only runs
   after the user presses Confirm. Every id in a proposal is resolved against
   real live data first, so the model can never invent a target to write to.
   ══════════════════════════════════════════════════════════ */

// The verb has to OPEN the sentence — a write request is an imperative
// ("add a task…", "log 2 hours…"). That keeps "the activity log for SBLAF"
// and "how is X going" on the read path, where a stray verb would otherwise
// look like a command.
const ACTION_START = /^\s*(?:please\s+|can you\s+|could you\s+|pls\s+)?(add|create|new|make|log|record|update|edit|change|rename|reschedule|move|set|assign|mark|delete|remove|archive)\b/i;
const ACTION_NOUN  = /\b(task|project|activity|entry|log|subtask|due date|deadline|hours?|status|priority)\b/i;
// "update me on X" / "any updates on X" are requests for a report, not a write.
const NOT_ACTION   = /^\s*(?:update|give|bring)\s+(?:me|us)\b|^\s*(?:any|status)\s+updates?\b|\bupdates?\s+on\b/i;

// Cheap pre-filter so plain questions never take the write path.
export function looksLikeAction(q, digest) {
  const s = String(q || '').trim();
  if (!s) return false;
  if (NOT_ACTION.test(s)) return false;
  if (!ACTION_START.test(s)) return false;
  if (ACTION_NOUN.test(s)) return true;
  // "mark <task name> as done" — an imperative naming something real.
  const w = s.toLowerCase();
  const names = [
    ...(digest?.projects || []).map((p) => p.name),
    ...(digest?.taskIndex || []).map((t) => t.title),
  ].filter((n) => n && n.length >= 6);
  return names.some((n) => w.includes(n.toLowerCase()));
}

const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES   = ['todo', 'doing', 'done'];
const COMPLETIONS = ['not-started', 'in-progress', 'blocked', 'completed'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ACTION_SYSTEM = `You turn a project-management request into ONE structured write operation against the user's live data.

You are given the real projects, tasks and recent activity entries with their ids. You may ONLY reference ids from those lists — never invent one. If the request names something you cannot find, or is missing something required, or would mean more than one operation, return a "clarify" question instead.

Respond ONLY with a JSON object, no markdown, no code fences:
{
  "op": "create" | "update" | "delete",
  "entity": "project" | "task" | "activity",
  "targetId": "<id from the lists, required for update/delete, null for create>",
  "data": { ...fields to write, omit anything the user did not ask for... },
  "clarify": "<a question, ONLY when you cannot build a safe operation; otherwise null>"
}

Field shapes:
- project: name, description, color (#rrggbb)
- task: title, description, projectId, phaseId, priority (low|medium|high), status (todo|doing|done), plan {startDate, endDate} as YYYY-MM-DD, tags [string], requestedBy
- activity: taskId (required on create), date (YYYY-MM-DD), comment, hoursSpent (number), completionStatus (not-started|in-progress|blocked|completed), bottleneckRemarks

Resolve relative dates ("today", "Friday", "next week") against the given date. For an update, put ONLY the fields that change in "data".`;

// Request → validated proposal. Never writes. Returns { proposal } or { clarify }.
export async function parseAction({ question, digest, workspaceId, userId }) {
  let raw;
  if (isAiAvailable()) {
    const projects = digest.projects.map((p) => `  project id:${p.id} "${p.name}"`).join('\n');
    const phases = (digest.projectPhases || []).map((p) => `  phase id:${p.id} "${p.name}" in project ${p.projectId}`).join('\n');
    const tasks = (digest.taskIndex || []).slice(0, 80)
      .map((t) => `  task id:${t.id} "${t.title}" [${t.status}] project:${t.projectId || 'none'}${t.due ? ` due:${t.due}` : ''}`).join('\n');
    const acts = (digest.activityLog || []).slice(0, 25)
      .map((a) => `  activity id:${a.id} ${a.date} task:${a.taskId} "${a.title}" ${a.hours}h ${a.status}`).join('\n');
    const user = `Today is ${digest.today}.

PROJECTS
${projects || '  (none)'}
${phases ? `\nPHASES\n${phases}` : ''}

TASKS
${tasks || '  (none)'}

RECENT ACTIVITY ENTRIES
${acts || '  (none)'}

Request: ${question}`;
    raw = await callClaudeJson({ system: ACTION_SYSTEM, user, maxTokens: 700, meta: { kind: 'ask-ai-action' } });
  } else {
    raw = localParseAction(question, digest);
    if (!raw) {
      return { clarify: 'I need an AI brain connected to interpret that request — an admin can connect one in Settings. In the meantime you can add it directly from the Projects or Board views.' };
    }
  }

  if (raw?.clarify) return { clarify: String(raw.clarify) };
  return resolveAction(raw, digest, { workspaceId, userId });
}

// Offline fallback: handles the two unambiguous shapes without a model.
//   "add task <text>"  /  "create project <name>"
function localParseAction(question, digest) {
  const s = String(question || '').trim();
  const task = s.match(/^(?:add|create|new)\s+(?:a\s+)?task\s+(.+)$/i);
  if (task) {
    const parsed = parseQuickAdd(task[1]);
    if (!parsed.title) return null;
    return {
      op: 'create', entity: 'task', targetId: null,
      data: {
        title: parsed.title,
        priority: parsed.priority || undefined,
        tags: parsed.tags?.length ? parsed.tags : undefined,
        requestedBy: parsed.requestedBy || undefined,
        plan: parsed.plan?.endDate ? { endDate: parsed.plan.endDate } : undefined,
        projectId: digest.projects.find((p) => s.toLowerCase().includes(p.name.toLowerCase()))?.id,
      },
    };
  }
  const project = s.match(/^(?:add|create|new)\s+(?:a\s+)?project\s+(.+)$/i);
  if (project) {
    return { op: 'create', entity: 'project', targetId: null, data: { name: project[1].replace(/^["']|["']$/g, '').trim() } };
  }
  return null;
}

// Validates the model's output against live data and shapes it for the
// confirmation bubble. Anything unresolvable becomes a clarify question.
function resolveAction(raw, digest, { workspaceId }) {
  const op = String(raw?.op || '').toLowerCase();
  const entity = String(raw?.entity || '').toLowerCase();
  if (!['create', 'update', 'delete'].includes(op)) return { clarify: 'I could not tell whether you want to add, edit or delete something. Try "add a task…", "change …" or "delete …".' };
  if (!['project', 'task', 'activity'].includes(entity)) return { clarify: 'I can add, edit or delete a project, a task or an activity log entry. Which one did you mean?' };

  const data = raw?.data && typeof raw.data === 'object' ? raw.data : {};
  const fields = [];
  const warnings = [];
  const add = (label, value) => { if (value !== undefined && value !== null && value !== '') fields.push({ label, value: String(value) }); };

  const project = (id) => digest.projects.find((p) => p.id === id);
  const task    = (id) => (digest.taskIndex || []).find((t) => t.id === id);
  const act     = (id) => (digest.activityLog || []).find((a) => a.id === id);

  if (op !== 'create' && !raw?.targetId) return { clarify: `Which ${entity} did you mean? Name it and I will show you the change before anything is written.` };

  /* ── project ── */
  if (entity === 'project') {
    if (op === 'create') {
      const name = String(data.name || '').trim();
      if (!name) return { clarify: 'What should the project be called?' };
      add('Name', name);
      add('Description', data.description);
      add('Workspace', digest.workspaces.find((w) => w.id === workspaceId)?.name || 'active workspace');
      return { proposal: {
        op, entity, targetId: null, targetLabel: null,
        title: 'Create project', fields, warnings,
        payload: { workspaceId, name, description: data.description || '', color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : undefined },
      } };
    }
    const p = project(raw.targetId);
    if (!p) return { clarify: 'I could not find that project in this workspace.' };
    if (op === 'delete') {
      add('Project', p.name);
      add('Holds', `${p.total} tasks · ${fmtHours(p.hours)} logged in 30 days`);
      warnings.push('The project is soft-deleted (hidden everywhere, recoverable in Firestore). Its tasks are NOT deleted.');
      return { proposal: { op, entity, targetId: p.id, targetLabel: p.name, title: 'Delete project', fields, warnings, payload: {} } };
    }
    const updates = {};
    add('Project', p.name);
    if (data.name)        { updates.name = String(data.name).trim(); add('Name', `${p.name} → ${updates.name}`); }
    if (data.description !== undefined) { updates.description = String(data.description); add('Description', updates.description || '(cleared)'); }
    if (/^#[0-9a-f]{6}$/i.test(data.color || '')) { updates.color = data.color; add('Color', data.color); }
    if (!Object.keys(updates).length) return { clarify: `What should change on ${p.name}?` };
    return { proposal: { op, entity, targetId: p.id, targetLabel: p.name, title: 'Edit project', fields, warnings, payload: updates } };
  }

  /* ── task ── */
  if (entity === 'task') {
    const clean = {};
    if (data.priority && PRIORITIES.includes(String(data.priority).toLowerCase())) clean.priority = String(data.priority).toLowerCase();
    if (data.status   && STATUSES.includes(String(data.status).toLowerCase()))     clean.status   = String(data.status).toLowerCase();
    const plan = {};
    if (ISO_DATE.test(data.plan?.startDate || '')) plan.startDate = data.plan.startDate;
    if (ISO_DATE.test(data.plan?.endDate   || '')) plan.endDate   = data.plan.endDate;
    if (data.plan && !Object.keys(plan).length) warnings.push('I could not read a valid date out of that, so no date is being set.');
    const proj = data.projectId ? project(data.projectId) : null;
    if (data.projectId && !proj) return { clarify: 'I could not find that project. Which project should this task sit in?' };
    const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : null;

    if (op === 'create') {
      const title = String(data.title || '').trim();
      if (!title) return { clarify: 'What should the task be called?' };
      add('Title', title);
      add('Project', proj ? proj.name : 'none (unfiled)');
      add('Description', data.description);
      add('Priority', clean.priority || 'medium');
      add('Due', plan.endDate);
      add('Starts', plan.startDate);
      add('Tags', tags?.join(', '));
      add('Requested by', data.requestedBy);
      if (!proj) warnings.push('No project matched, so the task will be created unfiled. Name a project to place it.');
      const phase = (digest.projectPhases || []).find((ph) => ph.id === data.phaseId && ph.projectId === proj?.id);
      add('Phase', phase?.name);
      return { proposal: {
        op, entity, targetId: null, targetLabel: null,
        title: 'Create task', fields, warnings,
        payload: {
          workspaceId, title,
          description: data.description || '',
          projectId: proj?.id || null,
          phaseId: phase?.id || null,
          priority: clean.priority || 'medium',
          plan,
          tags: tags || [],
          requestedBy: data.requestedBy || '',
        },
      } };
    }

    const t = task(raw.targetId);
    if (!t) return { clarify: 'I could not find that task. Which one did you mean?' };
    if (op === 'delete') {
      add('Task', t.title);
      add('In', t.project);
      add('Has', `${t.activityCount} activity entries · ${fmtHours(t.hours)} logged`);
      warnings.push('The task is soft-deleted, never hard-deleted — its activity entries stay intact.');
      return { proposal: { op, entity, targetId: t.id, targetLabel: t.title, title: 'Delete task', fields, warnings, payload: { projectId: t.projectId } } };
    }
    const updates = {};
    add('Task', t.title);
    add('In project', t.project);
    if (data.title)       { updates.title = String(data.title).trim(); add('Title', `${t.title} → ${updates.title}`); }
    if (data.description !== undefined) { updates.description = String(data.description); add('Description', updates.description || '(cleared)'); }
    if (clean.priority)   { updates.priority = clean.priority; add('Priority', clean.priority); }
    if (clean.status)     { updates.status = clean.status; add('Status', `${t.status} → ${clean.status}`); }
    if (proj)             { updates.projectId = proj.id; add('Project', `${t.project} → ${proj.name}`); }
    if (Object.keys(plan).length) {
      updates.plan = { ...(t.task.plan || {}), ...plan };
      add('Due', plan.endDate ? `${t.due || 'none'} → ${plan.endDate}` : undefined);
      add('Starts', plan.startDate);
    }
    if (tags)             { updates.tags = tags; add('Tags', tags.join(', ') || '(cleared)'); }
    if (!Object.keys(updates).length) return { clarify: `What should change on "${t.title}"?` };
    return { proposal: { op, entity, targetId: t.id, targetLabel: t.title, title: 'Edit task', fields, warnings, payload: { updates, projectId: t.projectId } } };
  }

  /* ── activity ── */
  const hours = data.hoursSpent === undefined ? undefined : Number(data.hoursSpent);
  if (hours !== undefined && (!Number.isFinite(hours) || hours < 0 || hours > 24)) {
    return { clarify: 'How many hours should I log? It has to be a number between 0 and 24.' };
  }
  const completion = COMPLETIONS.includes(String(data.completionStatus || '').toLowerCase())
    ? String(data.completionStatus).toLowerCase() : undefined;
  const date = ISO_DATE.test(data.date || '') ? data.date : undefined;

  if (op === 'create') {
    const t = task(data.taskId);
    if (!t) return { clarify: 'Which task should this activity be logged against?' };
    add('Task', t.title);
    add('Project', t.project);
    add('Date', date || digest.today);
    add('Hours', hours ?? 0);
    add('Comment', data.comment);
    add('Completion', completion || 'in-progress');
    add('Bottleneck', data.bottleneckRemarks);
    return { proposal: {
      op, entity, targetId: null, targetLabel: t.title,
      title: 'Log activity', fields, warnings,
      payload: {
        taskId: t.id, projectId: t.projectId,
        activity: {
          date: date || digest.today,
          comment: data.comment || '',
          hoursSpent: hours ?? 0,
          completionStatus: completion || 'in-progress',
          bottleneckRemarks: data.bottleneckRemarks || '',
        },
      },
    } };
  }

  const a = act(raw.targetId);
  if (!a) return { clarify: 'I could not find that activity entry in the last 30 days. Which one did you mean?' };
  if (op === 'delete') {
    add('Entry', `${a.date} · ${a.title}`);
    add('Hours', a.hours);
    warnings.push("Activity entries are removed for good, and the task's logged-hours counter is adjusted down.");
    return { proposal: { op, entity, targetId: a.id, targetLabel: `${a.date} · ${a.title}`, title: 'Delete activity entry', fields, warnings, payload: { projectId: a.projectId } } };
  }
  const updates = {};
  add('Entry', `${a.date} · ${a.title}`);
  add('In project', a.project);
  if (date)                 { updates.date = date; add('Date', `${a.date} → ${date}`); }
  if (hours !== undefined)  { updates.hoursSpent = hours; add('Hours', `${a.hours} → ${hours}`); }
  if (data.comment !== undefined)           { updates.comment = String(data.comment); add('Comment', updates.comment || '(cleared)'); }
  if (completion)           { updates.completionStatus = completion; add('Completion', `${a.status} → ${completion}`); }
  if (data.bottleneckRemarks !== undefined) { updates.bottleneckRemarks = String(data.bottleneckRemarks); add('Bottleneck', updates.bottleneckRemarks || '(cleared)'); }
  if (!Object.keys(updates).length) return { clarify: 'What should change on that entry?' };
  return { proposal: { op, entity, targetId: a.id, targetLabel: `${a.date} · ${a.title}`, title: 'Edit activity entry', fields, warnings, payload: { updates, projectId: a.projectId } } };
}

/* ── apply (runs only after Confirm) ─────────────────────── */

function appUrl(hash) {
  if (typeof window === 'undefined') return hash;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${hash}`;
}

// Writes the proposal. Returns { url, hash, label, taskId? } for the receipt.
export async function applyAction(proposal, { userId, digest }) {
  const { op, entity, targetId, payload } = proposal;

  if (entity === 'project') {
    if (op === 'create') {
      const ref = await addProject(userId, payload);
      return { label: payload.name, hash: '#/projects', url: appUrl('#/projects'), id: ref?.id };
    }
    if (op === 'update') {
      await updateProject(targetId, payload);
      return { label: proposal.targetLabel, hash: '#/projects', url: appUrl('#/projects'), id: targetId };
    }
    await softDeleteProject(targetId);
    return { label: proposal.targetLabel, hash: '#/projects', url: appUrl('#/projects'), id: targetId, deleted: true };
  }

  if (entity === 'task') {
    if (op === 'create') {
      const ref = await addTask(userId, payload);
      const hash = `#/board/${payload.projectId || 'all'}`;
      return { label: payload.title, hash, url: appUrl(hash), id: ref?.id, taskId: ref?.id };
    }
    if (op === 'update') {
      await updateTask(targetId, payload.updates);
      const hash = `#/board/${payload.projectId || 'all'}`;
      return { label: proposal.targetLabel, hash, url: appUrl(hash), id: targetId, taskId: targetId };
    }
    await softDeleteTask(targetId);
    const hash = `#/board/${payload.projectId || 'all'}`;
    return { label: proposal.targetLabel, hash, url: appUrl(hash), id: targetId, deleted: true };
  }

  // activity
  if (op === 'create') {
    const t = (digest.taskIndex || []).find((x) => x.id === payload.taskId);
    if (!t) throw new Error('That task no longer exists.');
    await addActivity(userId, t.task, payload.activity);
    const hash = `#/table/${payload.projectId || 'all'}`;
    return { label: `${payload.activity.date} · ${t.title}`, hash, url: appUrl(hash), taskId: t.id };
  }
  const existing = (digest.activityLog || []).find((a) => a.id === targetId);
  // editActivity/deleteActivity only read attachments.length to compute the
  // task's attachmentCount delta, and the digest carries that count (not the
  // array), so stand in an array of the right length. An empty one here would
  // silently leave attachmentCount too high after a delete.
  const raw = existing
    ? {
        id: existing.id,
        taskId: existing.taskId,
        hoursSpent: existing.hours,
        attachments: new Array(existing.attachments || 0).fill(null),
      }
    : null;
  if (!raw) throw new Error('That activity entry no longer exists.');
  if (op === 'update') {
    await editActivity(raw, payload.updates);
    const hash = `#/table/${payload.projectId || 'all'}`;
    return { label: proposal.targetLabel, hash, url: appUrl(hash), taskId: raw.taskId };
  }
  await deleteActivity(raw);
  const hash = `#/table/${payload.projectId || 'all'}`;
  return { label: proposal.targetLabel, hash, url: appUrl(hash), deleted: true };
}
