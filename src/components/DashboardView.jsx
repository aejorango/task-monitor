// src/components/DashboardView.jsx — the orientation page, read top to bottom
// in four zones:
//   1. Daily brief    → who you are, what today looks like, one paragraph of
//                       plain English plus the capacity dial and the pulse.
//   2. Needs you now   → the action queue (overdue first) and what is blocking.
//   3. Momentum        → project pace against schedule, and the next five days.
//   4. Context         → recent activity, team load, the workspace itself.
//
// Every number here is computed from live Firestore data. The AI button only
// ever adds prose next to those numbers — it never produces them.

import { useState, useMemo } from 'react';
import { useTasks, useProjects, useAllActivities, useAuth } from '../hooks/useTasks';
import { displayStatus } from '../services/boardScope';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { todayLocal, auth } from '../services/firebase';
import { suggestNextTask } from '../services/anthropic';
import { topThemes } from '../services/askAi';
import { buildDigest } from '../services/askAiCore';
import { buildStatusReport, statusReportFileBase } from '../services/statusReport';
import ExportButton from './ExportButton';
import { useAiStatus } from '../hooks/useAiStatus';
import { useIsOperator } from '../hooks/useUserProfile';
import { describeAiFailure } from '../services/errorMessages';
import { activateProps } from '../hooks/useActivate';
import { rateProjects, RAG_RANK, RAG_MEANING } from '../services/portfolio';
import { PageActions, PageSubtitle } from './PageHeader';
import Markdown from './Markdown';
import LogTimeButton from './LogTimeButton';
import TaskEditor from './TaskEditor';
import TaskForm from './TaskForm';
import WorkspaceEditor from './WorkspaceEditor';
import Icon from './Icon';

// Targets behind the capacity dial and the team-load bars. They are yardsticks,
// not data — labelled as such wherever they are shown.
/**
 * The three statuses as the board shows them. One list, so the legend across
 * the top of the Main board and the badge on each row can never disagree —
 * that is a `sbadge-<id>` class in App.css and nothing else.
 */
const STATUS_LEGEND = [
  { id: 'todo',  label: 'To do' },
  { id: 'doing', label: 'Working on it' },
  { id: 'review', label: 'In review' },
  { id: 'done',  label: 'Done' },
];
const STATUS_LABEL = Object.fromEntries(STATUS_LEGEND.map((s) => [s.id, s.label]));

// An activity's own completion status, as the "Recent activity" rail reads it.
const RUN_TONE  = { completed: 'green', blocked: 'red', 'in-progress': 'amber', 'not-started': 'navy' };
const RUN_LABEL = { completed: 'Completed', blocked: 'Blocked', 'in-progress': 'In progress', 'not-started': 'Not started' };

const DAILY_TARGET_H    = 8;
const WEEKLY_CAPACITY_H = 35;

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return isoOf(x);
}
function isoToday() { return todayLocal(); }
function dateStrToMillis(s) { return new Date(`${s}T00:00:00`).getTime(); }
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((dateStrToMillis(b) - dateStrToMillis(a)) / 86400000);
}

// Deterministic pastel-on-brand color for a member avatar, hashed from uid
// so the same person always gets the same chip color across sessions.
const AVATAR_PALETTE = ['#0051BA', '#7B2D8F', '#1DA449', '#e74c3c', '#1D7CC7', '#c2410c', '#0f766e', '#a21caf'];
function avatarColorFor(uid) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function nameFor(profile, uid) {
  return profile?.displayName || profile?.email || `User ${String(uid).slice(0, 5)}`;
}
function initialsFor(profile, uid) {
  const name = nameFor(profile, uid);
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
function firstNameFor(profile, uid) {
  return nameFor(profile, uid).trim().split(/\s+/)[0];
}
function friendlyDate(s) {
  const today = todayLocal();
  if (s === today)                 return 'Today';
  if (s === addDaysIso(today, 1))  return 'Tomorrow';
  if (s === addDaysIso(today, -1)) return 'Yesterday';
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}
function shortDate(s) {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

const PRIORITY_DOT = { high: 'var(--c-danger)', medium: 'var(--c-amber)', low: 'var(--c-emerald)' };

export default function DashboardView({ projectFilter, navigate }) {
  const { userId } = useAuth();
  const { isOperator } = useIsOperator(userId);
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities, loading: actsLoading } = useAllActivities();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { workspaces, loading: wsLoading } = useWorkspaces();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const { available: aiAvailable } = useAiStatus();

  // The one document a manager asks for. Built on demand from the same digest
  // the Ask AI page computes, so the report and the app can never disagree.
  const buildStatusReportDoc = () => {
    const digest = buildDigest({
      tasks, projects, activities, workspaces,
      memberProfiles: activeWorkspace?.memberProfiles || {},
      activeWorkspaceId,
    });
    return buildStatusReport(digest, {
      workspaceName: activeWorkspace?.name,
      periodLabel: new Date().toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' }),
      narrative: aiOutput?.trim() || null,
    });
  };

  const [editingTask, setEditingTask] = useState(null);
  const [aiOutput, setAiOutput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  const today      = isoToday();
  const weekEnd    = addDaysIso(today, 5);
  const weekStart7 = addDaysIso(today, -6);
  const monthStart = addDaysIso(today, -29);

  const filtered = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.projectId === projectFilter);
  const scopedActivities = useMemo(
    () => activities.filter((a) => projectFilter === 'all' || a.projectId === projectFilter),
    [activities, projectFilter],
  );

  // ───── Pulse ────────────────────────────────────────────────────────────
  const hoursToday = useMemo(
    () => scopedActivities.filter((a) => a.date === today).reduce((s, a) => s + (a.hoursSpent || 0), 0),
    [scopedActivities, today],
  );

  const tasksDueToday = filtered.filter((t) => t.status !== 'done' && t.plan?.endDate === today);
  const overdue       = filtered.filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today);
  const doneThisWeek  = filtered.filter((t) => t.status === 'done' && t.actual?.endDate && t.actual.endDate >= weekStart7 && t.actual.endDate <= today);
  const inProgress    = filtered.filter((t) => t.status === 'doing');

  const upcoming = filtered
    .filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate > today && t.plan.endDate <= weekEnd)
    .sort((a, b) => a.plan.endDate.localeCompare(b.plan.endDate));
  const upcomingByDate = upcoming.reduce((acc, t) => {
    (acc[t.plan.endDate] = acc[t.plan.endDate] || []).push(t);
    return acc;
  }, {});

  const hours7 = useMemo(
    () => scopedActivities.filter((a) => (a.date || '') >= weekStart7).reduce((s, a) => s + (a.hoursSpent || 0), 0),
    [scopedActivities, weekStart7],
  );

  // ───── Blockers ─────────────────────────────────────────────────────────
  // Newest bottleneck per task, so one stubborn task does not fill the panel.
  const blockerActs = useMemo(
    () => scopedActivities.filter((a) => a.bottleneckRemarks?.trim() && (a.date || '') >= monthStart),
    [scopedActivities, monthStart],
  );
  const blockers = useMemo(() => {
    const byTask = new Map();
    [...blockerActs]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .forEach((a) => { if (!byTask.has(a.taskId)) byTask.set(a.taskId, a); });
    return [...byTask.values()]
      .map((a) => ({
        act: a,
        title: a.taskTitle || '(task)',
        reason: a.bottleneckRemarks.trim(),
        days: daysBetween(a.date, today) ?? 0,
        color: projectById[a.projectId]?.color || 'var(--c-border-strong)',
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 3);
  }, [blockerActs, projectById, today]);
  const topTheme = useMemo(() => topThemes(blockerActs, 1)[0] || null, [blockerActs]);
  const blockedTaskIds = useMemo(() => new Set(blockerActs.map((a) => a.taskId)), [blockerActs]);

  // ───── Action queue — overdue first, then due today ─────────────────────
  const actionQueue = useMemo(() => {
    const byPriority = (a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
    };
    const late = [...overdue].sort((a, b) => a.plan.endDate.localeCompare(b.plan.endDate) || byPriority(a, b));
    const now  = [...tasksDueToday].sort(byPriority);
    return [...late, ...now].slice(0, 8).map((t) => {
      const lateDays = t.plan?.endDate && t.plan.endDate < today ? daysBetween(t.plan.endDate, today) : 0;
      const inDoing  = t.status === 'doing' && t.actual?.startDate ? daysBetween(t.actual.startDate, today) : null;
      let flag = null;
      if (blockedTaskIds.has(t.id))        flag = { text: 'Blocked', tone: 'red' };
      else if (inDoing != null && inDoing >= 5) flag = { text: `${inDoing}d in Doing`, tone: 'amber' };
      return {
        task: t,
        isLate: lateDays > 0,
        due: lateDays > 0 ? `${lateDays}d late` : 'today',
        flag,
        project: projectById[t.projectId] || null,
      };
    });
  }, [overdue, tasksDueToday, today, blockedTaskIds, projectById]);

  // ───── Project health — done% against schedule elapsed% ─────────────────
  const projectsForFilter = projectFilter === 'all' ? projects : projects.filter((p) => p.id === projectFilter);
  // The rating lives in services/portfolio.js since T-0142, so the Dashboard
  // and the cross-workspace Portfolio can never disagree about what amber means.
  const projectHealth = useMemo(
    () => rateProjects(projectsForFilter, tasks, today),
    [projectsForFilter, tasks, today],
  );

  // ───── Recent activity ──────────────────────────────────────────────────
  const recentActivities = scopedActivities.slice(0, 5);

  // ───── Team load — hours logged this week against a weekly yardstick ────
  const memberProfiles = activeWorkspace?.memberProfiles || {};
  const memberUids     = activeWorkspace?.members || [];
  const teamLoad = useMemo(() => {
    const hoursBy = {};
    scopedActivities
      .filter((a) => (a.date || '') >= weekStart7)
      .forEach((a) => { if (a.userId) hoursBy[a.userId] = (hoursBy[a.userId] || 0) + (a.hoursSpent || 0); });
    return memberUids
      .map((uid) => {
        const hours = hoursBy[uid] || 0;
        const pct   = Math.round((hours / WEEKLY_CAPACITY_H) * 100);
        const open  = filtered.filter((t) => t.status !== 'done' && (t.assignedTo || []).includes(uid)).length;
        return {
          uid,
          name: nameFor(memberProfiles[uid], uid),
          initials: initialsFor(memberProfiles[uid], uid),
          hours, pct, open,
          tone: pct > 100 ? 'red' : pct >= 85 ? 'amber' : 'green',
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [memberUids, memberProfiles, scopedActivities, weekStart7, filtered]);
  const overCapacity = teamLoad.filter((m) => m.pct > 100).length;

  // ───── The brief — one paragraph, written from the numbers above ────────
  const worst = projectHealth.find((p) => p.rag === 'RED') || projectHealth.find((p) => p.rag === 'AMBER');
  const brief = useMemo(() => {
    const bits = [];
    if (overdue.length) {
      bits.push(`${plural(overdue.length, 'task is', 'tasks are')} overdue${blockers.length ? `, and ${blockers.length === 1 ? 'one traces' : 'several trace'} back to a logged blocker` : ''}.`);
    } else if (tasksDueToday.length) {
      bits.push(`Nothing is overdue — ${plural(tasksDueToday.length, 'task is', 'tasks are')} due today.`);
    } else {
      bits.push('Nothing is overdue and nothing is due today.');
    }
    if (worst && worst.elapsed != null) {
      bits.push(`${worst.project.name} is the one to watch: ${worst.pct}% complete against ${worst.elapsed}% of its schedule.`);
    } else if (projectHealth.length) {
      bits.push('Every project is tracking to its plan.');
    }
    if (topTheme) bits.push(`"${topTheme.word}" is the recurring blocker theme this month, in ${plural(topTheme.n, 'entry', 'entries')}.`);
    else if (inProgress.length) bits.push(`${plural(inProgress.length, 'task is', 'tasks are')} in progress right now.`);
    return bits.join(' ');
  }, [overdue.length, tasksDueToday.length, blockers.length, worst, projectHealth.length, topTheme, inProgress.length]);

  const hour = new Date().getHours();
  const greeting = hour < 5  ? 'Working late'
                 : hour < 12 ? 'Good morning'
                 : hour < 17 ? 'Good afternoon'
                 : hour < 21 ? 'Good evening' : 'Late night';
  const userFirst = auth.currentUser?.displayName?.split(' ')[0] || '';

  const runAiSuggest = async () => {
    setAiBusy(true);
    setAiError(null);
    setAiOutput('');
    try {
      setAiOutput(await suggestNextTask({ tasks: filtered, projects, today }));
    } catch (err) {
      // The error's own message is written for whoever has to fix it — a bridge
      // address, a shell command, a raw upstream body. describeAiFailure keeps
      // that for the console and hands back one plain sentence for the screen
      // (BUG-020), unless the person reading it is the operator.
      const { message, detail } = describeAiFailure(
        err, 'The AI could not plan your day just now. Try again in a moment.',
        { isOperator },
      );
      console.error('[ai] plan-my-day failed:', detail);
      setAiError(message);
    } finally {
      setAiBusy(false);
    }
  };

  // ───── The four tiles across the top ───────────────────────────────────
  const flight = useMemo(() => {
    const open = filtered.filter((t) => t.status !== 'done');
    // "+4" against the same count a week ago — anything created in the last
    // seven days that is still open. A delta with nothing behind it is left
    // off rather than printed as a dash (see Tile).
    const weekAgo = addDaysIso(today, -7);
    const fresh = open.filter((t) => {
      const created = t.createdAt?.toDate?.();
      return created && isoOf(created) >= weekAgo;
    }).length;
    return {
      total: open.length,
      delta: fresh ? `+${fresh}` : null,
      pct: filtered.length ? Math.round((open.length / filtered.length) * 100) : 0,
      projects: new Set(open.map((t) => t.projectId).filter(Boolean)).size,
    };
  }, [filtered, today]);

  const dueThisWeek = useMemo(() => {
    const horizon = addDaysIso(today, 7);
    const due = filtered.filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate <= horizon);
    return { total: due.length, unassigned: due.filter((t) => !(t.assignedTo || []).length).length };
  }, [filtered, today]);

  // ───── Main board — every item, grouped by its project ─────────────────
  // The group header carries the project's RAG and its completion, which is
  // what the separate "Project health" card used to carry; `rateProjects` is
  // the same rating the Portfolio page uses, so two screens cannot disagree.
  const [closedGroups, setClosedGroups] = useState({});
  const toggleGroup = (id) => setClosedGroups((c) => ({ ...c, [id]: !c[id] }));

  const boardGroups = useMemo(() => {
    const healthOf = Object.fromEntries(projectHealth.map((h) => [h.project.id, h]));
    const byProject = new Map();
    filtered.forEach((t) => {
      const key = t.projectId || '__none__';
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(t);
    });

    const rank = { doing: 0, todo: 1, done: 2 };
    return [...byProject.entries()]
      .map(([id, own]) => {
        const project = projectById[id] || null;
        const h = healthOf[id] || null;
        const done = own.filter((t) => t.status === 'done').length;
        return {
          id,
          name: project?.name || 'No project',
          color: project?.color || 'var(--c-text-muted)',
          rag: h?.rag || 'IDLE',
          pct: own.length ? Math.round((done / own.length) * 100) : 0,
          rows: [...own]
            // Overdue first, then what is being worked on, then the rest — the
            // order the Action queue used to impose on its own smaller list.
            .sort((a, b) => {
              const lateA = a.status !== 'done' && a.plan?.endDate && a.plan.endDate < today ? 0 : 1;
              const lateB = b.status !== 'done' && b.plan?.endDate && b.plan.endDate < today ? 0 : 1;
              return lateA - lateB
                || (rank[a.status] ?? 1) - (rank[b.status] ?? 1)
                || String(a.plan?.endDate || '9999').localeCompare(String(b.plan?.endDate || '9999'));
            })
            .slice(0, 8)
            .map((task) => {
              const late = task.status !== 'done' && task.plan?.endDate && task.plan.endDate < today;
              const ownerUid = (task.assignedTo || [])[0] || null;
              return {
                task,
                done: task.status === 'done',
                // Past its plan date a row reads Stuck, whatever column it
                // is in — the same rule the board, the table, the WBS and the
                // item page use (services/boardScope.js). The legend across
                // the top still names the three real statuses.
                ...(({ id, label }) => ({ statusId: id, statusLabel: label }))(
                  displayStatus(task, blockedTaskIds, today),
                ),
                ownerUid,
                ownerInitials: ownerUid ? initialsFor(memberProfiles[ownerUid], ownerUid) : '',
                ownerFirst:    ownerUid ? firstNameFor(memberProfiles[ownerUid], ownerUid) : '',
                late,
                due: task.plan?.endDate
                  ? (late ? `${daysBetween(task.plan.endDate, today)}d late` : shortDate(task.plan.endDate))
                  : '—',
                // A task's own percentage, not a guess: done is 100, and
                // anything else uses the progress it actually carries.
                pct: task.status === 'done' ? 100 : Math.max(0, Math.min(100, task.progress || 0)),
              };
            }),
        };
      })
      // Worst project first, on the same ranking the Portfolio page uses.
      .sort((a, b) => (RAG_RANK[a.rag] ?? 9) - (RAG_RANK[b.rag] ?? 9)
        || String(a.name).localeCompare(String(b.name)));
  }, [filtered, projectById, projectHealth, memberProfiles, blockedTaskIds, today]);

  // ───── Delivery pipeline — five stages of real work ────────────────────
  // Not a build pipeline: this app has no such thing, and inventing one would
  // be a panel that means nothing. These are the five states an item is really
  // in, and "healthy" is a stage that is neither blocked nor over its limit.
  const pipeline = useMemo(() => {
    const open      = filtered.filter((t) => t.status !== 'done');
    const backlog   = open.filter((t) => t.status === 'todo' && !t.plan?.endDate).length;
    const planned   = open.filter((t) => t.status === 'todo' && t.plan?.endDate).length;
    const blockedN  = open.filter((t) => blockedTaskIds.has(t.id)).length;
    const building  = open.filter((t) => t.status === 'doing' && !blockedTaskIds.has(t.id)).length;
    const shipped   = filtered.filter((t) => t.status === 'done').length;
    const stages = [
      { name: 'Backlog',  count: backlog,  tone: 'navy',  state: 'unscheduled' },
      { name: 'Planned',  count: planned,  tone: 'navy',  state: 'has a date' },
      { name: 'Building', count: building, tone: building > 6 ? 'amber' : 'navy', state: building > 6 ? 'at limit' : 'steady' },
      { name: 'Blocked',  count: blockedN, tone: blockedN ? 'red' : 'green', state: blockedN ? 'needs a decision' : 'clear' },
      { name: 'Shipped',  count: shipped,  tone: 'green', state: 'done' },
    ];
    return { stages, healthy: stages.filter((st) => st.tone !== 'red' && st.tone !== 'amber').length };
  }, [filtered, blockedTaskIds]);

  // ───── Active alerts — the three things that are actually wrong ────────
  // Built from the numbers already on this page rather than a second pass, so
  // an alert cannot contradict the tile above it.
  const alerts = useMemo(() => {
    const out = [];
    const worstLate = [...overdue].sort((a, b) => a.plan.endDate.localeCompare(b.plan.endDate))[0];
    if (worstLate) {
      const days = daysBetween(worstLate.plan.endDate, today) ?? 0;
      out.push({
        id: 'overdue', sev: 'Sev 1', tone: 'red',
        title: worstLate.title,
        meta: `${projectById[worstLate.projectId]?.name || 'No project'} · ${plural(days, 'day', 'days')} past due`
            + (overdue.length > 1 ? ` · ${overdue.length - 1} more overdue` : ''),
      });
    }
    if (blockers[0]) {
      out.push({
        id: 'blocked', sev: 'Sev 2', tone: 'red',
        title: blockers[0].title,
        meta: `Blocked ${plural(blockers[0].days, 'day', 'days')} · ${blockers[0].reason}`,
      });
    }
    const over = teamLoad.find((m) => m.pct > 100);
    if (over) {
      out.push({
        id: 'capacity', sev: 'Sev 3', tone: 'amber',
        title: `${over.name} is over capacity`,
        meta: `${over.hours.toFixed(1)}h logged against ${WEEKLY_CAPACITY_H}h · this week`,
      });
    }
    return out;
  }, [overdue, blockers, teamLoad, projectById, today]);

  // An activity row names a task; clicking it opens that task, not the entry.
  // The entry is one line of a log — the task is the thing you came to look at.
  const openTaskOfActivity = (a) => {
    const t = tasks.find((x) => x.id === a.taskId);
    if (t) setEditingTask(t);
  };

  const goToBoard = () => navigate?.({ view: 'board' });

  // Loading & no-workspace gates.
  if (wsLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-3)' }}><div className="spinner" />&nbsp; Loading workspace…</div>;
  }
  if (!activeWorkspaceId || !activeWorkspace) {
    return (
      <>
        <div className="dash-greet">
          <h1 className="dash-greet-title">Welcome to Task Monitor</h1>
          <p className="dash-greet-sub muted">
            You don't have any workspace selected yet. Workspaces contain your projects, tasks, and activities — and let you collaborate with others.
          </p>
        </div>
        <div className="dash-empty-hero">
          <div className="dash-empty-hero-icon">◆</div>
          <h2 className="dash-empty-hero-title">Create your first workspace</h2>
          <p className="dash-empty-hero-sub muted">
            One workspace is usually enough. Most people set up a workspace per company, side-project, or context (e.g. "Personal", "Bridged", "Client work").
          </p>
          <div className="dash-empty-hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => setCreatingWorkspace(true)}>
              + Create workspace
            </button>
          </div>
        </div>
        {creatingWorkspace && (
          <WorkspaceEditor workspace={null} onClose={() => setCreatingWorkspace(false)} />
        )}
      </>
    );
  }
  if (tasksLoading || actsLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-3)' }}><div className="spinner" />&nbsp; Loading dashboard…</div>;
  }

  const hasAnyData = tasks.length > 0 || activities.length > 0;
  const wsRole     = activeWorkspace?.acl?.[userId] || 'editor';
  const dialPct    = Math.max(0, Math.min(100, Math.round((hoursToday / DAILY_TARGET_H) * 100)));
  const needsCount = overdue.length + tasksDueToday.length;

  return (
    <>
      {/* ══ ZONE 1 · The numbers, on the title bar and five tiles ══════════
          The hero this replaced was a greeting, a paragraph, a dial and four
          pulse rows in a coloured slab that filled the fold before a single
          task appeared. The Explorer mockup says the same things in a tile row
          — and the greeting, the workspace and the commands belong to the page
          chrome now, which every other page wears too. */}
      <PageSubtitle>
        {greeting}{userFirst ? `, ${userFirst}` : ''} · {activeWorkspace.name} ·{' '}
        {plural(memberUids.length || 1, 'member', 'members')} · {plural(projects.length, 'project', 'projects')}
      </PageSubtitle>

      <PageActions>
        <button className="cmd" onClick={() => setAddingTask((v) => !v)}>
          <span className="cmd-icon"><Icon name="plus" size={14} /></span>
          {addingTask ? 'Close quick add' : 'New task'}
        </button>
        {aiAvailable && (
          <button className="cmd" onClick={runAiSuggest} disabled={aiBusy}>
            <span className="cmd-icon"><Icon name="sparkles" size={14} /></span>
            {aiBusy ? 'Thinking…' : 'Plan my day'}
          </button>
        )}
        {/* Opens the logging FORM on the task it names — see LogTimeButton and
            services/logTime.js (T-0122). */}
        <LogTimeButton
          tasks={filtered}
          actionQueue={actionQueue}
          inProgress={inProgress}
          projectById={projectById}
          projectFilter={projectFilter}
          userId={userId}
          className="cmd"
        />
        <ExportButton
          build={buildStatusReportDoc}
          baseName={statusReportFileBase(activeWorkspace?.name)}
          kind="document"
          label="Status report"
          className="cmd"
          title="A PDF or Word report of where every project stands, what is overdue and what is blocked"
        />
      </PageActions>

      <div className="tiles">
        <Tile
          tone="navy" icon="◈" label="Items in flight" value={flight.total}
          delta={flight.delta} bar={flight.pct}
          sub={`across ${plural(flight.projects, 'project', 'projects')}`}
        />
        <Tile
          tone="red" icon="!" label="Blocked" value={blockers.length}
          bar={filtered.length ? Math.round((blockers.length / filtered.length) * 100) : 0}
          sub={blockers.length ? `oldest ${plural(blockers[0].days, 'day', 'days')}` : 'nothing blocked'}
        />
        <Tile
          tone="amber" icon="◷" label="Due this week" value={dueThisWeek.total}
          bar={flight.total ? Math.round((dueThisWeek.total / flight.total) * 100) : 0}
          sub={dueThisWeek.unassigned ? `${dueThisWeek.unassigned} unassigned` : 'all assigned'}
        />
        <Tile
          tone="green" icon="✓" label="Throughput" value={doneThisWeek.length}
          delta={`${hoursToday.toFixed(1)}h today`}
          bar={Math.min(100, doneThisWeek.length * 10)}
          sub="completed in the last 7 days"
        />
      </div>

      {/* The brief is one sentence written from those very numbers — worth
          keeping, not worth a slab. */}
      {brief && <p className="db-brief-line">{brief}</p>}

      {aiOutput && (
        <div className="dash-card db-ai">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Plan for today</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => setAiOutput('')}>Dismiss</button>
          </div>
          <Markdown src={aiOutput} />
        </div>
      )}
      {aiError && (
        <div className="auth-error" style={{ marginBottom: 16 }}>
          <p className="auth-error-msg">{aiError}</p>
        </div>
      )}

      {addingTask && (
        <div className="db-quickadd">
          <TaskForm projects={projects} projectFilter={projectFilter} />
        </div>
      )}

      {!hasAnyData && (
        <div className="dash-empty-hero">
          <div className="dash-empty-hero-icon" style={{ background: activeWorkspace.color }}>
            {activeWorkspace.icon || '◆'}
          </div>
          <h2 className="dash-empty-hero-title">
            "{activeWorkspace.name}" is ready for your first task
          </h2>
          <p className="dash-empty-hero-sub muted">
            Add a task above to get started. You can attach it to a project, set a deadline,
            break it into subtasks, and log activity as you make progress.
          </p>
          <div className="dash-empty-hero-actions">
            <button className="btn btn-primary" onClick={goToBoard}>Open Kanban view</button>
            <button className="btn" onClick={() => navigate?.({ view: 'projects' })}>Set up projects first</button>
          </div>
        </div>
      )}

      {hasAnyData && (
        <>
          {/* ══ Main board — every item, grouped by project ══════════════════
              The Dashboard Explorer's centre panel. It replaced four separate
              cards (Action queue, What's blocking us, Project health, Next 5
              days) that each showed a slice of the same list: one table shows
              the lot, and the group header carries the health the "Project
              health" card used to carry on its own. */}
          <section className="mboard">
            <div className="mboard-head">
              <h2 className="mboard-title">Main board</h2>
              <span className="mboard-chip">grouped by project</span>
              <div className="mboard-legend">
                {STATUS_LEGEND.map((s) => (
                  <span key={s.id} className={`sbadge sbadge-${s.id}`}>{s.label}</span>
                ))}
              </div>
            </div>

            <div className="mboard-cols">
              <span />
              <span>Item</span><span>Status</span><span>Owner</span><span>Due</span><span>Progress</span>
            </div>

            {boardGroups.length === 0 ? (
              <p className="db-empty" style={{ padding: '26px 18px' }}>Nothing matches the current filter.</p>
            ) : boardGroups.map((g) => (
              <div key={g.id}>
                <div
                  className="mboard-group"
                  {...activateProps(() => toggleGroup(g.id))}
                  aria-expanded={!closedGroups[g.id]}
                >
                  <span className={`mboard-chev${closedGroups[g.id] ? '' : ' open'}`} aria-hidden="true">▸</span>
                  <span className="mboard-group-name" style={{ color: g.color }}>{g.name}</span>
                  <span className="mboard-group-count">{plural(g.rows.length, 'item', 'items')}</span>
                  <span className={`ragchip ragchip-${g.rag.toLowerCase()}`} title={RAG_MEANING[g.rag]}>{g.rag}</span>
                  <span className="mboard-group-pct">{g.pct}% complete</span>
                </div>
                {!closedGroups[g.id] && g.rows.map(({ task, ...r }, i) => (
                  <div
                    key={task.id}
                    className={`mboard-row${i % 2 ? ' alt' : ''}`}
                    {...activateProps(() => setEditingTask(task))}
                  >
                    <span className="mboard-rail" style={{ background: g.color }} aria-hidden="true" />
                    <span className="mboard-cell">
                      <span className={`mboard-check${r.done ? ' on' : ''}`} aria-hidden="true">{r.done ? '✓' : ''}</span>
                    </span>
                    <span className={`mboard-item${r.done ? ' done' : ''}`}>{task.title}</span>
                    <span className="mboard-cell">
                      <span className={`sbadge sbadge-${r.statusId}`}>{r.statusLabel}</span>
                    </span>
                    <span className="mboard-cell mboard-owner">
                      {r.ownerUid
                        ? <>
                            <span className="mboard-av" style={{ background: avatarColorFor(r.ownerUid) }}>{r.ownerInitials}</span>
                            <span className="mboard-owner-name">{r.ownerFirst}</span>
                          </>
                        : <span className="mboard-owner-none">Unassigned</span>}
                    </span>
                    <span className={`mboard-due${r.late ? ' late' : ''}`}>{r.due}</span>
                    <span className="mboard-cell mboard-prog">
                      <span className="mboard-track">
                        <span
                          className="mboard-fill"
                          style={{ width: `${r.pct}%`, background: r.pct === 100 ? 'var(--c-done)' : g.color }}
                        />
                      </span>
                      <span className="mboard-pct">{r.pct}%</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </section>

          {/* ══ Delivery pipeline + the right rail ═══════════════════════════ */}
          <div className="db-split">
            <section className="dcard">
              <div className="dcard-head">
                <h2 className="dcard-title">Delivery pipeline</h2>
                <span className={`pipe-chip${pipeline.healthy === pipeline.stages.length ? ' ok' : ''}`}>
                  {pipeline.healthy} of {pipeline.stages.length} stages healthy
                </span>
              </div>
              <p className="dcard-sub">Items flowing through {activeWorkspace.name} right now.</p>

              <div className="stage-flow">
                {pipeline.stages.map((st) => (
                  <div key={st.name} className={`stage stage-${st.tone}`}>
                    <div className="stage-name">{st.name}</div>
                    <div className="stage-count">{st.count}</div>
                    <div className="stage-state">{st.state}</div>
                  </div>
                ))}
              </div>

              <div className="dcard-label">Recent activity</div>
              {recentActivities.length === 0 ? (
                <p className="db-empty">Nothing logged yet.</p>
              ) : (
                <div className="runs">
                  {recentActivities.map((a) => {
                    const tone = RUN_TONE[a.completionStatus] || 'navy';
                    return (
                      <div
                        key={a.id}
                        className="run"
                        {...activateProps(() => openTaskOfActivity(a))}
                      >
                        <span className={`run-dot tone-${tone}`} aria-hidden="true" />
                        <span className="run-name">{a.taskTitle || '(task)'}</span>
                        <span className={`run-state tone-${tone}`}>{RUN_LABEL[a.completionStatus] || 'Logged'}</span>
                        <span className="run-dur">{a.hoursSpent ? `${a.hoursSpent}h` : '—'}</span>
                        <span className="run-when">{shortDate(a.date)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="db-rail">
              <section className="dcard">
                <div className="dcard-head">
                  <h2 className="dcard-title">Active alerts</h2>
                  <span className={`alert-count${alerts.length ? '' : ' quiet'}`}>{alerts.length}</span>
                </div>
                {alerts.length === 0 ? (
                  <p className="db-empty">Nothing is on fire.</p>
                ) : (
                  <div className="alerts">
                    {alerts.map((a) => (
                      <div key={a.id} className={`alert alert-${a.tone}`}>
                        <div className="alert-top">
                          <span className={`alert-sev tone-${a.tone}`}>{a.sev}</span>
                          <span className="alert-title">{a.title}</span>
                        </div>
                        <div className="alert-meta">{a.meta}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="dcard">
                <h2 className="dcard-title">Team utilization</h2>
                <p className="dcard-sub">Against {WEEKLY_CAPACITY_H}h weekly capacity</p>
                {teamLoad.length === 0 ? (
                  <p className="db-empty">No members yet.</p>
                ) : (
                  <div className="util">
                    {teamLoad.map((m) => (
                      <div key={m.uid} className="util-row" title={`${m.hours.toFixed(1)}h logged · ${plural(m.open, 'open task', 'open tasks')}`}>
                        <span className="util-av" style={{ background: avatarColorFor(m.uid) }}>{m.initials}</span>
                        <span className="util-name">{firstNameFor(memberProfiles[m.uid], m.uid)}</span>
                        <span className="util-track">
                          <span className={`util-fill tone-${m.tone}`} style={{ width: `${Math.min(m.pct, 100)}%` }} />
                        </span>
                        <span className={`util-pct tone-${m.tone}`}>{m.pct}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      {/* Clicking a task opens the EDITOR, not the read-only activity list.
          One click, one destination — the activity log is that editor's
          Activity tab now, so the list is not lost, it just stopped being
          a second modal in front of the thing you actually wanted. */}
      {editingTask && (
        <TaskEditor
          task={editingTask}
          projects={projects}
          onClose={() => setEditingTask(null)}
        />
      )}
    </>
  );
}

/**
 * One resource tile, exactly as the Explorer mockups draw it: a coloured top
 * edge, a tinted icon badge beside an uppercase label, the number with a delta
 * chip beside it, a 5px rail, and one line of context underneath.
 *
 * `bar` is a percentage; omit it and no rail is drawn, which is a different
 * thing from passing 0 (a rail at empty). `delta` is omitted rather than shown
 * as "—" when there is nothing to compare against — an em dash in a delta slot
 * reads as "no change", which is a claim.
 */
export function Tile({ tone, icon, label, value, delta, bar, sub }) {
  return (
    <div className={`tile tile-${tone}`}>
      <div className="tile-head">
        {icon ? <span className="tile-icon" aria-hidden="true">{icon}</span> : <span className="tile-dot" />}
        <span className="tile-label">{label}</span>
      </div>
      <div className="tile-value-row">
        <span className="tile-value">{value}</span>
        {delta != null && delta !== '' && <span className="tile-delta">{delta}</span>}
      </div>
      {bar != null && (
        <div className="tile-bar"><span style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} /></div>
      )}
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

// Zone divider — the label that tells you what the next two cards are for.
function ZoneLabel({ tone, title, note }) {
  return (
    <div className={`db-zone db-zone-${tone}`}>
      <span className="db-zone-title">{title}</span>
      {note && <span className="db-zone-note">{note}</span>}
      <span className="db-zone-line" />
    </div>
  );
}

