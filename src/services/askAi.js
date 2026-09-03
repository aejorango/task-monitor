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
import { todayLocal } from './firebase';

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
    tasks: { open: openTasks, done: doneTasks, overdue: overdueTasks },
    blockers: { byProject: blockersByProject, tasks: blockedTasks, themes: blockerThemes, total: blockedActs.length },
    hours: { byProject: hoursByProject, byDay: hoursByDay, busiestDay, total7: hours7Total, prev7: hoursPrev7, acts7: acts7.length },
    people, unassigned,
    week: { movement: recentMovement, doneThisWeek, blockedCount: acts7.filter(isBlockedAct).length, hours: hours7Total },
    workspaces: wsPulse,
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
  const named = digest.projects
    .filter((p) => p.name.length >= 3)
    .find((p) => w.includes(p.name.toLowerCase()));
  if (named) return { key: 'project', projectId: named.id };
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
  return {
    key: `project:${p.id}`,
    badge: `${p.name} · ${p.tone.toUpperCase()}`,
    tone: p.tone === 'grey' ? 'navy' : p.tone,
    summary: `${p.name} is ${p.donePct}% complete${p.elapsedPct != null ? ` with ${p.elapsedPct}% of its schedule gone` : ' (no plan dates set)'}. ${plural(p.open, 'task is', 'tasks are')} still open, ${plural(p.overdue, 'is', 'are')} overdue and ${plural(stuck.length, 'is', 'are')} blocked. ${fmtHours(p.hours)} have been logged against it in the last 30 days.`,
    metrics: [
      { label: 'Complete',      value: `${p.donePct}%`, delta: `${p.done} of ${p.total} tasks`, tone: p.donePct >= 70 ? 'green' : 'amber' },
      { label: 'Schedule used', value: p.elapsedPct != null ? `${p.elapsedPct}%` : '—', delta: p.gap != null ? `${p.gap > 0 ? `${p.gap}-point gap` : 'ahead of plan'}` : 'no plan dates', tone: p.gap != null && p.gap >= 20 ? 'red' : p.gap != null && p.gap >= 10 ? 'amber' : 'green' },
      { label: 'Overdue',       value: String(p.overdue), delta: p.overdue ? 'past due date' : 'nothing late', tone: p.overdue ? 'red' : 'green' },
      { label: 'Hours · 30d',   value: fmtHours(p.hours), delta: `${p.inDoing} in Doing`, tone: 'navy' },
    ],
    itemsTitle: rows.length ? 'What is actually stuck' : 'Nothing stuck',
    items: rows,
    actions: localActions([
      stuck[0] && `Unblock "${stuck[0].task.title}" — ${plural(stuck[0].days, 'day', 'days')} stalled is the single biggest drag on this project.`,
      p.gap != null && p.gap >= 15 && `Pick one: move ${p.name}'s end date, or cut scope. A ${p.gap}-point gap does not close on optimism.`,
      overdue.length > 0 && `Re-date the ${plural(overdue.length, 'overdue task', 'overdue tasks')} so the plan reflects reality.`,
      p.inDoing > 4 && `${p.inDoing} tasks are in Doing at once — finish before starting.`,
    ]),
    sources: [p.name, `${plural(p.total, 'task', 'tasks')}`, 'Activity log · 30 days', 'Plan vs. actual'],
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
  if (digest.blockers.tasks.length) lines.push(`Blocked tasks: ${digest.blockers.tasks.slice(0, 5).map((b) => `${b.task.title} (${b.days}d${b.why ? `: ${b.why.slice(0, 80)}` : ''})`).join(' | ')}`);
  if (digest.people.length) lines.push(`Workload: ${digest.people.map((p) => `${p.label} ${p.open} open/${p.doing} doing/${p.overdue} overdue`).join(' | ')}`);
  return lines.join('\n');
}

const NARRATE_SYSTEM = `You are the analyst inside "Task Monitor", a project-management app. You are shown FACTS computed from the user's live database. Those facts are correct and complete — never invent, adjust or contradict a number, name or date, and never mention data you were not given.

Write for a busy operator: direct, concrete, no filler, no praise, no "it looks like". Refer to projects and people by their real names from the facts.

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
