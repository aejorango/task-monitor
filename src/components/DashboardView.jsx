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
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { todayLocal, auth } from '../services/firebase';
import { suggestNextTask } from '../services/anthropic';
import { topThemes } from '../services/askAi';
import { useAiStatus } from '../hooks/useAiStatus';
import Markdown from './Markdown';
import TaskActivitiesModal from './TaskActivitiesModal';
import TaskEditor from './TaskEditor';
import TaskForm from './TaskForm';
import WorkspaceEditor from './WorkspaceEditor';
import Icon from './Icon';

// Targets behind the capacity dial and the team-load bars. They are yardsticks,
// not data — labelled as such wherever they are shown.
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
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities, loading: actsLoading } = useAllActivities();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { workspaces, loading: wsLoading } = useWorkspaces();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const { available: aiAvailable } = useAiStatus();

  const [viewingTask, setViewingTask] = useState(null);
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
  const projectHealth = useMemo(() => projectsForFilter.map((p) => {
    const own     = tasks.filter((t) => t.projectId === p.id);
    const done    = own.filter((t) => t.status === 'done').length;
    const late    = own.filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today).length;
    const starts  = own.map((t) => t.plan?.startDate).filter(Boolean).sort();
    const ends    = own.map((t) => t.plan?.endDate).filter(Boolean).sort();
    const start   = starts[0] || null;
    const end     = ends[ends.length - 1] || null;
    const span    = start && end ? daysBetween(start, end) : null;
    const gone    = start ? daysBetween(start, today) : null;
    const elapsed = span && span > 0 && gone != null
      ? Math.max(0, Math.min(100, Math.round((gone / span) * 100)))
      : end && end < today ? 100 : null;
    const pct     = own.length ? Math.round((done / own.length) * 100) : 0;
    const gap     = elapsed == null ? null : elapsed - pct;

    let rag = 'GREEN';
    if (!own.length)                                       rag = 'IDLE';
    else if (late >= 3 || (gap != null && gap >= 20))      rag = 'RED';
    else if (late >= 1 || (gap != null && gap >= 10))      rag = 'AMBER';

    return { project: p, total: own.length, done, late, pct, elapsed, gap, rag };
  }).sort((a, b) => {
    const rank = { RED: 0, AMBER: 1, GREEN: 2, IDLE: 3 };
    return rank[a.rag] - rank[b.rag] || (b.gap ?? -99) - (a.gap ?? -99);
  }), [projectsForFilter, tasks, today]);

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
      console.error(err);
      setAiError(err.message || String(err));
    } finally {
      setAiBusy(false);
    }
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
      {/* ══ ZONE 1 · Daily brief ══════════════════════════════════════════ */}
      <section className="db-hero">
        <span className="db-hero-glow" aria-hidden="true" />
        <div className="db-hero-inner">
          <div className="db-hero-lead">
            <div className="db-hero-meta">
              <span className="db-date">
                {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              <span className="db-hero-sub">
                {activeWorkspace.name} · {plural(memberUids.length || 1, 'member', 'members')} · {plural(projects.length, 'project', 'projects')}
              </span>
            </div>
            <h1 className="db-greeting">{greeting}{userFirst ? `, ${userFirst}` : ''}.</h1>
            <p className="db-brief">{brief}</p>
            <div className="db-hero-actions">
              <button className="db-btn db-btn-primary" onClick={() => setAddingTask((v) => !v)}>
                <Icon name="plus" size={15} />{addingTask ? 'Close quick add' : 'Add task'}
              </button>
              {aiAvailable && (
                <button className="db-btn db-btn-ghost" onClick={runAiSuggest} disabled={aiBusy}>
                  <Icon name="sparkles" size={15} />{aiBusy ? 'Thinking…' : 'Plan my day with AI'}
                </button>
              )}
              <button
                className="db-btn db-btn-ghost"
                onClick={() => setViewingTask(actionQueue[0]?.task || inProgress[0] || filtered[0])}
                disabled={!filtered.length}
                title={actionQueue[0] ? `Log time on "${actionQueue[0].task.title}"` : 'Log time on a task'}
              >Log time</button>
            </div>
          </div>

          <div className="db-hero-pulse">
            <div className="db-dial" role="img" aria-label={`${hoursToday.toFixed(1)} of ${DAILY_TARGET_H} hours logged today`}>
              <svg viewBox="0 0 120 120" width="112" height="112">
                <circle cx="60" cy="60" r="50" className="db-dial-track" />
                <circle
                  cx="60" cy="60" r="50"
                  className="db-dial-fill"
                  strokeDasharray="314"
                  strokeDashoffset={314 - 314 * (dialPct / 100)}
                />
              </svg>
              <div className="db-dial-center">
                <div className="db-dial-value">{hoursToday.toFixed(1)}<span>h</span></div>
                <div className="db-dial-label">of {DAILY_TARGET_H}h today</div>
              </div>
            </div>
            <ul className="db-pulse">
              <PulseRow color="var(--c-danger)"  value={overdue.length}      label="overdue" />
              <PulseRow color="var(--c-accent)"  value={tasksDueToday.length} label="due today" />
              <PulseRow color="var(--c-teal)"      value={inProgress.length}    label="in progress" />
              <PulseRow color="var(--c-emerald)" value={doneThisWeek.length}  label="done this week" />
            </ul>
          </div>
        </div>
      </section>

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
          {/* ══ ZONE 2 · Needs you now ═══════════════════════════════════ */}
          <ZoneLabel tone="red" title="Needs you now"
            note={needsCount ? `${plural(needsCount, 'item', 'items')} · overdue first` : 'nothing on fire'} />
          <div className="db-grid">
            <section className="dash-card db-flush">
              <div className="db-head">
                <h2 className="dash-card-title">Action queue</h2>
                {overdue.length > 0 && <span className="db-chip db-chip-red">{overdue.length} overdue</span>}
                {tasksDueToday.length > 0 && <span className="db-chip db-chip-amber">{tasksDueToday.length} due today</span>}
                <button className="db-link" onClick={goToBoard}>Open board →</button>
              </div>
              {actionQueue.length === 0 ? (
                <p className="db-empty">Nothing overdue and nothing due today. Enjoy it.</p>
              ) : actionQueue.map(({ task, isLate, due, flag, project }) => (
                <div
                  key={task.id}
                  className={`db-queue-row${isLate ? ' is-late' : ''}`}
                  onClick={() => setViewingTask(task)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') setViewingTask(task); }}
                >
                  <span className="db-queue-rail" aria-hidden="true" />
                  <span className="db-prio" style={{ background: PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium }} />
                  <div className="db-queue-body">
                    <div className="db-queue-title">{task.title}</div>
                    <div className="db-queue-meta">
                      {project && (
                        <span className="db-queue-proj">
                          <span className="proj-dot" style={{ background: project.color }} />{project.name}
                        </span>
                      )}
                      {flag && <span className={`db-flag db-flag-${flag.tone}`}>{flag.text}</span>}
                    </div>
                  </div>
                  <span className={`db-due${isLate ? ' is-late' : ''}`}>{due}</span>
                  <span className="db-log">+ Log</span>
                </div>
              ))}
            </section>

            <section className="dash-card">
              <div className="db-head">
                <span className="db-head-icon db-head-icon-red"><Icon name="alert" size={15} /></span>
                <h2 className="dash-card-title">What's blocking us</h2>
              </div>
              {blockers.length === 0 ? (
                <p className="db-empty">No blockers logged in the last 30 days.</p>
              ) : (
                <div className="db-blockers">
                  {blockers.map((b) => (
                    <button key={b.act.id} type="button" className="db-blocker" onClick={() => {
                      const t = tasks.find((x) => x.id === b.act.taskId);
                      if (t) setViewingTask(t);
                    }}>
                      <div className="db-blocker-head">
                        <span className="proj-dot" style={{ background: b.color }} />
                        <strong className="db-blocker-title">{b.title}</strong>
                        <span className="db-blocker-age">{plural(b.days, 'day', 'days')}</span>
                      </div>
                      <p className="db-blocker-why">{b.reason}</p>
                    </button>
                  ))}
                </div>
              )}
              {topTheme && (
                <div className="db-theme">
                  <span className="db-theme-label">Top theme this month</span>
                  <span className="db-theme-tag">{topTheme.word.toUpperCase()} · {topTheme.n}</span>
                </div>
              )}
            </section>
          </div>

          {/* ══ ZONE 3 · Momentum ════════════════════════════════════════ */}
          <ZoneLabel tone="accent" title="Momentum" note="pace vs. schedule · sorted by risk" />
          <div className="db-grid">
            <section className="dash-card">
              <div className="db-head">
                <h2 className="dash-card-title">Project health</h2>
                <span className="db-chip">{plural(projectHealth.length, 'active', 'active')}</span>
                <button className="db-link" onClick={() => navigate?.({ view: 'projects' })}>All projects →</button>
              </div>
              <p className="db-note">
                The notch marks how much of the schedule is gone — bar behind the notch means falling behind.
              </p>
              {projectHealth.length === 0 ? (
                <p className="db-empty">
                  No projects yet.{' '}
                  <a className="table-link" href="#" onClick={(e) => { e.preventDefault(); navigate?.({ view: 'projects' }); }}>
                    Create your first project →
                  </a>
                </p>
              ) : (
                <div className="db-health">
                  {projectHealth.slice(0, 6).map((h) => (
                    <div
                      key={h.project.id}
                      className="db-health-row"
                      onClick={() => navigate?.({ view: 'board', projectFilter: h.project.id })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate?.({ view: 'board', projectFilter: h.project.id }); }}
                    >
                      <span className="proj-dot" style={{ background: h.project.color }} />
                      <div className="db-health-id">
                        <div className="db-health-name">{h.project.name}</div>
                        <div className="db-health-meta">
                          {h.total === 0 ? 'No tasks yet' : `${h.done}/${h.total} done · ${plural(h.late, 'overdue', 'overdue')}`}
                        </div>
                      </div>
                      <div className="db-track">
                        <span className="db-track-fill" style={{ width: `${h.pct}%`, background: h.project.color }} />
                        {h.elapsed != null && <span className="db-notch" style={{ left: `${h.elapsed}%` }} />}
                      </div>
                      <span className="db-health-pct">{h.pct}%</span>
                      <span className={`db-rag db-rag-${h.rag.toLowerCase()}`}>{h.rag}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="dash-card">
              <div className="db-head">
                <h2 className="dash-card-title">Next 5 days</h2>
                <button className="db-link" onClick={() => navigate?.({ view: 'gantt' })}>Gantt →</button>
              </div>
              {upcoming.length === 0 ? (
                <p className="db-empty">Nothing scheduled for the next five days.</p>
              ) : (
                <div className="db-upcoming">
                  {Object.keys(upcomingByDate).sort().map((d) => (
                    <div key={d}>
                      <div className="db-day">
                        {friendlyDate(d)}
                        <span className="db-day-count">{plural(upcomingByDate[d].length, 'task', 'tasks')}</span>
                      </div>
                      {upcomingByDate[d].map((t) => {
                        const proj = projectById[t.projectId];
                        const who  = (t.assignedTo || [])[0]
                          ? firstNameFor(memberProfiles[t.assignedTo[0]], t.assignedTo[0])
                          : (t.assignedToExternal || [])[0] || null;
                        return (
                          <div key={t.id} className="db-up-row" onClick={() => setViewingTask(t)} role="button" tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') setViewingTask(t); }}>
                            <span className="proj-dot" style={{ background: proj?.color || 'var(--c-border-strong)' }} />
                            <span className="db-up-title">{t.title}</span>
                            {who && <span className="db-who">{who}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ══ ZONE 4 · Context ═════════════════════════════════════════ */}
          <ZoneLabel tone="muted" title="Context" />
          <div className="db-grid">
            <section className="dash-card">
              <div className="db-head">
                <h2 className="dash-card-title">Recent activity</h2>
                <span className="db-chip">{hours7.toFixed(1)}h · 7 days</span>
                <button className="db-link" onClick={() => navigate?.({ view: 'table' })}>View log →</button>
              </div>
              {recentActivities.length === 0 ? (
                <p className="db-empty">No activity logged yet.</p>
              ) : (
                <div className="db-feed">
                  {recentActivities.map((a, i) => {
                    const tone = a.bottleneckRemarks?.trim() || a.completionStatus === 'blocked' ? 'red'
                      : a.completionStatus === 'completed' ? 'green'
                      : a.completionStatus === 'in-progress' ? 'amber' : 'navy';
                    const icon = tone === 'red' ? '!' : tone === 'green' ? '✓' : tone === 'amber' ? '◐' : '•';
                    return (
                      <div key={a.id} className="db-feed-item">
                        <div className="db-feed-rail">
                          <span className={`db-feed-dot db-tone-${tone}`}>{icon}</span>
                          {i < recentActivities.length - 1 && <span className="db-feed-line" />}
                        </div>
                        <div className="db-feed-body">
                          <div className="db-feed-head">
                            <strong>{a.taskTitle || '(task)'}</strong>
                            {(a.hoursSpent || 0) > 0 && (
                              <span className={`db-feed-hours db-tone-${tone}`}>{Number(a.hoursSpent).toFixed(1)}h</span>
                            )}
                            <span className="db-feed-date">{shortDate(a.date)}</span>
                          </div>
                          {a.comment && <p className="db-feed-text">{a.comment}</p>}
                          {a.bottleneckRemarks?.trim() && (
                            <p className="db-feed-block">⚠ {a.bottleneckRemarks.trim()}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="db-stack">
              <section className="dash-card">
                <div className="db-head">
                  <h2 className="dash-card-title">Team load</h2>
                  <button className="db-link" onClick={() => navigate?.({ view: 'settings' })}>Manage →</button>
                </div>
                {teamLoad.length === 0 ? (
                  <p className="db-empty">No members yet.</p>
                ) : (
                  <div className="db-team">
                    {teamLoad.map((m) => (
                      <div key={m.uid} className="db-member" title={`${m.hours.toFixed(1)}h logged · ${plural(m.open, 'open task', 'open tasks')}`}>
                        <span className="db-avatar" style={{ background: avatarColorFor(m.uid) }}>{m.initials}</span>
                        <div className="db-member-body">
                          <div className="db-member-name">{m.name}</div>
                          <div className="db-member-track">
                            <span className={`db-member-fill db-tone-${m.tone}`} style={{ width: `${Math.min(m.pct, 100)}%` }} />
                          </div>
                        </div>
                        <span className={`db-member-pct db-tone-${m.tone}`}>{m.pct}%</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="db-cap">
                  Capacity {WEEKLY_CAPACITY_H}h/week ·{' '}
                  {overCapacity > 0
                    ? <strong className="db-cap-over">{plural(overCapacity, 'person', 'people')} over</strong>
                    : <span>nobody over</span>}
                </div>
              </section>

              <section className="dash-card db-ws">
                <div className="db-ws-icon" style={{ background: activeWorkspace.color || 'var(--c-blue-deep)' }}>
                  {activeWorkspace.icon || activeWorkspace.name?.[0]?.toUpperCase() || '◆'}
                </div>
                <div className="db-ws-body">
                  <div className="db-ws-name">{activeWorkspace.name}</div>
                  <div className="db-ws-meta">{wsRole} · private · {plural(tasks.length, 'task', 'tasks')}</div>
                </div>
                <button className="db-link" onClick={() => navigate?.({ view: 'settings' })}>Settings →</button>
              </section>
            </div>
          </div>
        </>
      )}

      {viewingTask && !editingTask && (
        <TaskActivitiesModal
          task={viewingTask}
          userId={userId}
          onClose={() => setViewingTask(null)}
          onEditTask={(t) => setEditingTask(t)}
        />
      )}
      {editingTask && (
        <TaskEditor
          task={editingTask}
          projects={projects}
          onClose={() => { setEditingTask(null); setViewingTask(null); }}
        />
      )}
    </>
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

function PulseRow({ color, value, label }) {
  return (
    <li className="db-pulse-row">
      <span className="db-pulse-dot" style={{ background: color }} />
      <span className="db-pulse-value">{value}</span>
      <span className="db-pulse-label">{label}</span>
    </li>
  );
}
