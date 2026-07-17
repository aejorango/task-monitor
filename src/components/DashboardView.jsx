// src/components/DashboardView.jsx — single-screen orientation page that
// answers four questions in order:
//   1. What's my day look like?      → greeting + KPI tiles
//   2. What should I tackle next?    → Today's focus + AI Suggest
//   3. What's coming?                → Upcoming this week (3-day lookahead)
//   4. What's happening / blocked?   → Recent activity + bottleneck panel

import { useState, useMemo } from 'react';
import { useTasks, useProjects, useAllActivities, useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { todayLocal, auth } from '../services/firebase';
import { suggestNextTask, getEffectiveApiKey as getApiKey } from '../services/anthropic';
import Markdown from './Markdown';
import TaskActivitiesModal from './TaskActivitiesModal';
import TaskEditor from './TaskEditor';
import TaskForm from './TaskForm';
import WorkspaceEditor from './WorkspaceEditor';
import { WorkspaceIcon } from './WorkspaceSwitcher';
import Icon from './Icon';

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
function friendlyDate(s) {
  const today = todayLocal();
  if (s === today)               return 'Today';
  if (s === addDaysIso(today, 1)) return 'Tomorrow';
  if (s === addDaysIso(today, -1)) return 'Yesterday';
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function DashboardView({ projectFilter, navigate }) {
  const { userId } = useAuth();
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities, loading: actsLoading } = useAllActivities();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { workspaces, loading: wsLoading } = useWorkspaces();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const [viewingTask, setViewingTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [aiOutput, setAiOutput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const today    = isoToday();
  const tomorrow = addDaysIso(today, 1);
  const weekEnd  = addDaysIso(today, 6);
  const weekStart7 = addDaysIso(today, -6);

  const filtered = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.projectId === projectFilter);

  // ───── KPIs ─────────────────────────────────────────────────────────────
  const hoursToday = useMemo(() =>
    activities
      .filter((a) => a.date === today && (projectFilter === 'all' || a.projectId === projectFilter))
      .reduce((s, a) => s + (a.hoursSpent || 0), 0)
  , [activities, today, projectFilter]);

  const tasksDueToday = filtered.filter((t) =>
    t.status !== 'done' && t.plan?.endDate === today
  );

  const overdue = filtered.filter((t) =>
    t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today
  );

  const doneThisWeek = filtered.filter((t) =>
    t.status === 'done' && t.actual?.endDate && t.actual.endDate >= weekStart7 && t.actual.endDate <= today
  );

  const inProgress = filtered.filter((t) => t.status === 'doing');

  // Tasks due in next 6 days (excluding today, capped at 6 days out)
  const upcoming = filtered.filter((t) =>
    t.status !== 'done' && t.plan?.endDate && t.plan.endDate > today && t.plan.endDate <= weekEnd
  ).sort((a, b) => a.plan.endDate.localeCompare(b.plan.endDate));

  // Group upcoming by date
  const upcomingByDate = upcoming.reduce((acc, t) => {
    (acc[t.plan.endDate] = acc[t.plan.endDate] || []).push(t);
    return acc;
  }, {});

  const recentActivities = activities
    .filter((a) => projectFilter === 'all' || a.projectId === projectFilter)
    .slice(0, 10);

  const recentBottlenecks = activities
    .filter((a) => a.bottleneckRemarks?.trim())
    .filter((a) => projectFilter === 'all' || a.projectId === projectFilter)
    .filter((a) => a.date >= weekStart7)
    .slice(0, 6);

  // Greeting based on local time
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
      const text = await suggestNextTask({ tasks: filtered, projects, today });
      setAiOutput(text);
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
    return <div className="dashboard-view" style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-3)' }}><div className="spinner" />&nbsp; Loading workspace…</div>;
  }
  if (!activeWorkspaceId || !activeWorkspace) {
    return (
      <div className="dashboard-view">
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
      </div>
    );
  }
  if (tasksLoading || actsLoading) {
    return <div className="dashboard-view" style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-3)' }}><div className="spinner" />&nbsp; Loading dashboard…</div>;
  }

  // Derived stats for the workspace + projects cards
  const wsMemberCount = activeWorkspace?.members?.length || 1;
  const wsRole = activeWorkspace?.acl?.[userId] || 'editor';

  const projectsForFilter = projectFilter === 'all'
    ? projects
    : projects.filter((p) => p.id === projectFilter);
  const projectStats = projectsForFilter.map((p) => {
    const pTasks = tasks.filter((t) => t.projectId === p.id);
    const total = pTasks.length;
    const done  = pTasks.filter((t) => t.status === 'done').length;
    const doing = pTasks.filter((t) => t.status === 'doing').length;
    const todo  = pTasks.filter((t) => t.status === 'todo').length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    return { project: p, total, done, doing, todo, pct };
  }).sort((a, b) => b.total - a.total);

  const hasAnyData = tasks.length > 0 || activities.length > 0;

  return (
    <div className="dashboard-view">
      {/* Greeting + quick add */}
      <div className="dash-greet">
        <div>
          <h1 className="dash-greet-title">{greeting}{userFirst ? `, ${userFirst}` : ''}</h1>
          <p className="dash-greet-sub muted small">
            {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {' · '}<strong>{activeWorkspace.name}</strong>
            {projectFilter !== 'all' && projectById[projectFilter] && (
              <> · Filtered to <strong>{projectById[projectFilter].name}</strong></>
            )}
          </p>
        </div>
      </div>

      {/* Empty-state hero — only when the workspace has literally no data yet */}
      {!hasAnyData && (
        <div className="dash-empty-hero">
          <div className="dash-empty-hero-icon" style={{ background: activeWorkspace.color }}>
            {activeWorkspace.icon || '◆'}
          </div>
          <h2 className="dash-empty-hero-title">
            "{activeWorkspace.name}" is ready for your first task
          </h2>
          <p className="dash-empty-hero-sub muted">
            Add a task below to get started. You can attach it to a project, set a deadline,
            break it into subtasks, and log activity as you make progress.
          </p>
          <div className="dash-empty-hero-actions">
            <button className="btn btn-primary" onClick={goToBoard}>Open Board view</button>
            <button className="btn" onClick={() => navigate?.({ view: 'projects' })}>
              Set up projects first
            </button>
          </div>
        </div>
      )}

      <TaskForm projects={projects} projectFilter={projectFilter} />

      {/* Workspace + projects overview — always visible, even with empty data */}
      <div className="dash-row dash-row-overview">
        <section className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WorkspaceIcon workspace={activeWorkspace} size="sm" />
              {activeWorkspace.name}
            </h2>
            <button className="btn btn-sm btn-ghost" onClick={() => navigate?.({ view: 'settings' })}>
              Manage →
            </button>
          </div>
          {activeWorkspace.description && (
            <p className="muted small" style={{ marginTop: 0 }}>{activeWorkspace.description}</p>
          )}
          <div className="dash-ws-stats">
            <Stat label="Members" value={wsMemberCount} />
            <Stat label="Projects" value={projects.length} />
            <Stat label="Total tasks" value={tasks.length} />
            <Stat label="Your role" value={wsRole} />
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Projects ({projectStats.length})</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => navigate?.({ view: 'projects' })}>
              All projects →
            </button>
          </div>
          {projectStats.length === 0 ? (
            <p className="muted small">No projects yet. <a className="table-link" href="#" onClick={(e) => { e.preventDefault(); navigate?.({ view: 'projects' }); }}>Create your first project →</a></p>
          ) : (
            <ul className="dash-projects">
              {projectStats.slice(0, 6).map((s) => (
                <li key={s.project.id} className="dash-project" onClick={() => navigate?.({ view: 'board', projectFilter: s.project.id })}>
                  <span className="proj-dot" style={{ background: s.project.color }} />
                  <div className="dash-project-text">
                    <div className="dash-project-name">{s.project.name}</div>
                    <div className="muted small">
                      {s.total === 0 ? 'No tasks yet' : `${s.done}/${s.total} done · ${s.doing} in progress`}
                    </div>
                  </div>
                  {s.total > 0 && (
                    <div className="dash-project-bar">
                      <div className="dash-project-bar-fill" style={{ width: `${s.pct}%`, background: s.project.color }} />
                      <span className="dash-project-pct">{s.pct}%</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* KPI tiles */}
      <div className="dash-kpi-grid">
        <KpiTile label="Hours today"    value={hoursToday.toFixed(1)} suffix="h" icon={<Icon name="clock" />} />
        <KpiTile label="Due today"      value={tasksDueToday.length} accent={tasksDueToday.length > 0 ? 'info' : 'muted'}   icon={<Icon name="calendar" />} />
        <KpiTile label="Overdue"        value={overdue.length}       accent={overdue.length > 0 ? 'danger' : 'muted'}        icon={<Icon name="alert" />} />
        <KpiTile label="Done this week" value={doneThisWeek.length}  accent="success"                                        icon={<Icon name="check" />} />
        <KpiTile label="In progress"    value={inProgress.length}    accent={inProgress.length > 0 ? 'info' : 'muted'}       icon={<Icon name="play" />} />
      </div>

      <div className="dash-row dash-row-main">
        {/* Today's focus + AI */}
        <section className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Today's focus</h2>
            {getApiKey() && (
              <button
                className="btn btn-sm btn-primary"
                onClick={runAiSuggest}
                disabled={aiBusy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon name="sparkles" size={14} />
                {aiBusy ? 'Thinking…' : 'Suggest with AI'}
              </button>
            )}
          </div>

          {aiOutput && (
            <div className="ai-output" style={{ marginBottom: 12 }}>
              <div className="markdown-preview" style={{ background: 'var(--c-surface-2)', borderRadius: 6, padding: 12 }}>
                <Markdown src={aiOutput} />
              </div>
            </div>
          )}
          {aiError && (
            <div className="auth-error" style={{ marginBottom: 12 }}>
              <p className="auth-error-msg">{aiError}</p>
            </div>
          )}

          <DashSubsection title={`Due today (${tasksDueToday.length})`}>
            {tasksDueToday.length === 0
              ? <p className="muted small">Nothing due today.</p>
              : <TaskList tasks={tasksDueToday} projectById={projectById} onSelect={setViewingTask} />}
          </DashSubsection>

          <DashSubsection title={`In progress (${inProgress.length})`}>
            {inProgress.length === 0
              ? <p className="muted small">No tasks currently in progress.</p>
              : <TaskList tasks={inProgress} projectById={projectById} onSelect={setViewingTask} />}
          </DashSubsection>

          {overdue.length > 0 && (
            <DashSubsection title={`Overdue (${overdue.length})`} accent="danger">
              <TaskList tasks={overdue.slice(0, 8)} projectById={projectById} onSelect={setViewingTask} />
              {overdue.length > 8 && (
                <p className="muted small" style={{ marginTop: 6 }}>+ {overdue.length - 8} more overdue.</p>
              )}
            </DashSubsection>
          )}
        </section>

        {/* Upcoming this week */}
        <section className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Upcoming this week</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => navigate?.({ view: 'gantt' })}>
              Open Gantt →
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="muted small">Nothing scheduled for the next 6 days.</p>
          ) : (
            <div className="dash-upcoming">
              {Object.keys(upcomingByDate).sort().map((d) => (
                <div key={d}>
                  <div className="dash-day-label">{friendlyDate(d)}</div>
                  <TaskList tasks={upcomingByDate[d]} projectById={projectById} onSelect={setViewingTask} compact />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="dash-row dash-row-secondary">
        {/* Recent activity */}
        <section className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Recent activity</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => navigate?.({ view: 'table' })}>
              View all →
            </button>
          </div>
          {recentActivities.length === 0 ? (
            <p className="muted small">No activity logged yet.</p>
          ) : (
            <ul className="dash-feed">
              {recentActivities.map((a) => {
                const proj = projectById[a.projectId];
                return (
                  <li key={a.id} className="dash-feed-item">
                    {proj && <span className="proj-dot" style={{ background: proj.color }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="dash-feed-head">
                        <strong>{a.taskTitle || '(task)'}</strong>
                        <span className="muted small mono">{a.date}</span>
                      </div>
                      {a.comment && <p className="dash-feed-body">{a.comment}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Bottlenecks */}
        <section className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Bottlenecks (last 7 days)</h2>
          </div>
          {recentBottlenecks.length === 0 ? (
            <p className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={14} style={{ color: 'var(--c-success)' }} />
              No blockers recorded.
            </p>
          ) : (
            <ul className="dash-feed dash-bottleneck-list">
              {recentBottlenecks.map((a) => {
                const proj = projectById[a.projectId];
                return (
                  <li key={a.id} className="dash-feed-item">
                    {proj && <span className="proj-dot" style={{ background: proj.color }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="dash-feed-head">
                        <strong>{a.taskTitle || '(task)'}</strong>
                        <span className="muted small mono">{a.date}</span>
                      </div>
                      <p className="dash-feed-body" style={{ color: 'var(--c-warn)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <Icon name="warning" size={14} style={{ marginTop: 2 }} />
                        <span>{a.bottleneckRemarks}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

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
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="dash-ws-stat">
      <div className="dash-ws-stat-value">{value}</div>
      <div className="dash-ws-stat-label">{label}</div>
    </div>
  );
}

function KpiTile({ label, value, suffix, accent, icon }) {
  return (
    <div className={`dash-kpi ${accent ? `kpi-tile-${accent}` : ''}`}>
      {icon && <div className="dash-kpi-icon">{icon}</div>}
      <div className="dash-kpi-label">{label}</div>
      <div className={`dash-kpi-value ${accent ? `kpi-${accent}` : ''}`}>
        {value}
        {suffix && <span className="dash-kpi-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

function DashSubsection({ title, children, accent }) {
  return (
    <div className="dash-subsection">
      <div className={`dash-subsection-title ${accent ? `accent-${accent}` : ''}`}>{title}</div>
      {children}
    </div>
  );
}

function TaskList({ tasks, projectById, onSelect, compact }) {
  return (
    <ul className={`dash-tasklist ${compact ? 'compact' : ''}`}>
      {tasks.map((t) => {
        const proj = projectById[t.projectId];
        return (
          <li key={t.id} className="dash-task" onClick={() => onSelect(t)}>
            <span className={`priority-pill ${t.priority || 'medium'}`}><span className="dot" /></span>
            <span className="dash-task-title">{t.title}</span>
            {proj && (
              <span className="proj-tag">
                <span className="proj-dot" style={{ background: proj.color }} />
                {proj.name}
              </span>
            )}
            {t.plan?.endDate && (
              <span className="muted small mono">{t.plan.endDate}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
