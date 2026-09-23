// src/components/WBSView.jsx — Board → WBS, rebuilt to `Board Explorer.dc.html`
// (T-0149).
//
// The mockup's Work breakdown is ONE card and three indent levels — project ›
// phase › item — and nothing else. That is the whole page now.
//
// What was here before was a Gantt in a table: a horizontally-scrolling day
// grid with a zoom preset, plan bars, a today line, and six data columns
// (days, start, end, resource, % complete) in front of it, under a
// progress-ring summary band. It duplicated the Gantt tab it sat next to
// while being harder to read than either, so it went in one pass. Where each
// of those facts lives now is written down in CLAUDE.md; nothing was deleted
// without a home.
//
// What survived, because it exists nowhere else:
//   · clicking any row opens that scope's activity log (project / phase /
//     task) — the modal at the foot of this file;
//   · the green tick on an item that had activity logged TODAY;
//   · subtasks, as a fourth indent following the same rule;
//   · collapse, per project and per phase.

import { useState, useMemo } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useWorkspaces, useActiveWorkspaceId } from '../hooks/useWorkspace';
import { todayLocal } from '../services/firebase';
import { scopeTasks, scopeOf, blockedTaskIds, displayStatus } from '../services/boardScope';
import ActivityEditor from './ActivityEditor';
import ActivityLogger from './ActivityLogger';
import TaskEditor from './TaskEditor';
import TaskQuickAdd from './TaskQuickAdd';
import ExportButton from './ExportButton';
import { buildActivityLogDocument } from '../services/activityExport';
import { useModalDialog } from '../hooks/useModalDialog';
import { PageActions, PageSubtitle } from './PageHeader';
import Avatar from './Avatar';

function parseDate(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function fmtDate(d) {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
}

function taskStart(t) { return t.plan?.startDate || t.actual?.startDate || null; }

/** "Jul 18" — the mockup's date form, month first to match `fmtDay`. */
function shortDate(iso) {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : null;
}

const PRIO_LABEL = { high: 'High', medium: 'Med', low: 'Low' };
const PRIO_CLASS = { high: 'p-high', medium: 'p-med', low: 'p-low' };

/**
 * The project's colour as TEXT.
 *
 * The mockup carries a lookup for this — brand orange `#e2892e` prints as
 * `#8a5410` and green `#137a36` as `#0f5f2a` — because a 13.5px name in the
 * raw brand colour is a smudge on a cream band. `color-mix` toward the theme's
 * own text colour does the same job for ANY project colour a user picks, and
 * it flips correctly in dark mode, which a hard-coded pair cannot.
 */
function inkOf(color) {
  return color ? `color-mix(in srgb, ${color} 62%, var(--c-text))` : 'var(--c-text)';
}

const STATUS_FILTERS = [
  { id: 'all',   label: 'All' },
  { id: 'todo',  label: 'To do' },
  { id: 'doing', label: 'Ongoing' },
  { id: 'done',  label: 'Done' },
];

export default function WBSView({ projectFilter, route = {} }) {
  const { tasks, loading: tasksLoading, userId } = useTasks();
  const { projects, loading: projectsLoading } = useProjects();
  const { activities } = useAllActivities();
  const blockedIds = useMemo(() => blockedTaskIds(activities), [activities]);
  const { workspaces } = useWorkspaces();
  const activeWs = useActiveWorkspaceId();

  // Tasks with an activity logged TODAY. A green tick beside one is the only
  // "this is moving" signal in the app, so it survived the rebuild.
  const activeTodayIds = useMemo(() => {
    const t = todayLocal();
    const s = new Set();
    activities.forEach((a) => { if (a.date === t && a.taskId) s.add(a.taskId); });
    return s;
  }, [activities]);

  const [collapsed, setCollapsed] = useState(() => new Set());
  const [logScope, setLogScope] = useState(null); // { type, project, phase?, task? }
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const memberProfiles = workspaces.find((w) => w.id === activeWs)?.memberProfiles || {};

  const resourceOf = (t) =>
    t.requestedBy?.trim()
    || memberProfiles[t.userId]?.displayName
    || memberProfiles[t.userId]?.email
    || null;

  // ── Build the tree: project → phase groups → tasks ───────────────────────
  const statusActive = statusFilter !== 'all';
  const tree = useMemo(() => {
    const sortTasks = (arr) =>
      [...arr].sort((a, b) => (taskStart(a) || '9999').localeCompare(taskStart(b) || '9999'));

    // The Board hub's toolbar first — All · Mine · Stuck, the roster and the
    // find box — then this page's own status filter on top of it.
    let scopedTasks = scopeTasks(tasks, {
      scope: scopeOf(route), who: route.who, q: route.q, userId, today: todayLocal(),
    });
    if (statusActive) scopedTasks = scopedTasks.filter((t) => t.status === statusFilter);

    const visible = projects.filter((p) => projectFilter === 'all' || p.id === projectFilter);
    let blocks = visible.map((p) => {
      const pTasks = scopedTasks.filter((t) => t.projectId === p.id);
      const phases = [...(p.phases || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const byPhase = {};
      pTasks.forEach((t) => {
        const key = t.phaseId && phases.some((ph) => ph.id === t.phaseId) ? t.phaseId : '__unphased__';
        (byPhase[key] = byPhase[key] || []).push(t);
      });
      let groups = [
        ...phases.map((ph) => ({ id: ph.id, name: ph.name, phase: ph, tasks: sortTasks(byPhase[ph.id] || []) })),
        ...((byPhase['__unphased__'] || []).length > 0
          ? [{ id: '__unphased__', name: 'Unphased', phase: null, tasks: sortTasks(byPhase['__unphased__']) }]
          : []),
      ];
      if (statusActive) groups = groups.filter((g) => g.tasks.length > 0);
      return { project: p, tasks: pTasks, groups };
    });
    if (statusActive) blocks = blocks.filter((b) => b.tasks.length > 0);

    // Orphan bucket: tasks with no project, or whose project is archived,
    // deleted, or otherwise not in the visible list. Without this they would
    // silently disappear from the WBS.
    if (projectFilter === 'all') {
      const knownIds = new Set(projects.map((p) => p.id));
      const orphans = scopedTasks.filter((t) => !t.projectId || !knownIds.has(t.projectId));
      if (orphans.length > 0) {
        blocks.push({
          project: { id: '__none__', name: 'Unassigned / no project', color: '#94a3b8', phases: [] },
          tasks: orphans,
          groups: [{ id: '__unphased__', name: 'Unphased', phase: null, tasks: sortTasks(orphans) }],
          isOrphan: true,
        });
      }
    }
    return blocks;
  }, [projects, tasks, projectFilter, statusFilter, statusActive,
      route.onlyMine, route.stuckOnly, route.who, route.q, userId]);

  const allTreeTasks = useMemo(() => tree.flatMap((b) => b.tasks), [tree]);
  const totalPhases = useMemo(
    () => tree.reduce((s, b) => s + b.groups.filter((g) => g.phase).length, 0),
    [tree]
  );
  const today = parseDate(todayLocal());

  const toggle = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (tasksLoading || projectsLoading) {
    return <p className="muted">Loading WBS…</p>;
  }

  return (
    <>
      <PageSubtitle>
        {allTreeTasks.length} item{allTreeTasks.length === 1 ? '' : 's'} ·{' '}
        {totalPhases} phase{totalPhases === 1 ? '' : 's'} ·{' '}
        {tree.length} project{tree.length === 1 ? '' : 's'} · click a row for its activity log
      </PageSubtitle>
      <PageActions>
        <button className="cmd cmd-primary" onClick={() => setQuickAddOpen(true)}>
          <span className="cmd-icon">+</span>New task
        </button>
      </PageActions>

      {tree.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▦</div>
          {statusActive ? (
            <>
              <p>No tasks are {STATUS_FILTERS.find((s) => s.id === statusFilter)?.label.toLowerCase()}.</p>
              <p className="small">Set the status filter back to <strong>All</strong> to see the full breakdown.</p>
            </>
          ) : (
            <p>No projects yet. Create one in the Projects view.</p>
          )}
        </div>
      ) : (
        <div className="wbs">
          {/* The mockup titles the card and names the hierarchy, because
              "project › phase › item" is easy to miss once the outline is
              full. */}
          <div className="wbs-head">
            <span className="bx-h">Work breakdown</span>
            <span className="bx-note">project › phase › item</span>
            {/* The status filter sits at the right-hand end of the card head
                (asked for directly): it filters THIS card, so it belongs on
                it rather than up in the page commands. */}
            <span className="seg wbs-head-seg" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`seg-btn${statusFilter === f.id ? ' is-on' : ''}`}
                  aria-pressed={statusFilter === f.id}
                  onClick={() => setStatusFilter(f.id)}
                >{f.label}</button>
              ))}
            </span>
          </div>

          {tree.map(({ project, tasks: pTasks, groups, isOrphan }) => {
            const pKey = `p:${project.id}`;
            const pOpen = !collapsed.has(pKey);
            return (
              <div key={project.id}>
                <button
                  type="button"
                  className="wbs-proj"
                  aria-expanded={pOpen}
                  onClick={() => toggle(pKey)}
                >
                  <span className="wbs-chev" aria-hidden="true">{pOpen ? '▾' : '▸'}</span>
                  <span className="wbs-badge" style={{ background: project.color }}>WBS</span>
                  <span className="wbs-proj-name" style={{ color: inkOf(project.color) }}>
                    {project.name}
                  </span>
                  <span className="wbs-count">
                    {pTasks.length} item{pTasks.length === 1 ? '' : 's'}
                  </span>
                </button>

                {pOpen && groups.length === 0 && (
                  <div className="wbs-empty">Nothing in this project yet.</div>
                )}

                {pOpen && groups.map((g, gi) => {
                  const gKey = `ph:${project.id}:${g.id}`;
                  const gOpen = !collapsed.has(gKey);
                  return (
                    <div key={gKey}>
                      <button
                        type="button"
                        className="wbs-phase"
                        aria-expanded={gOpen}
                        onClick={() => toggle(gKey)}
                      >
                        <span className="wbs-chev" aria-hidden="true">{gOpen ? '▾' : '▸'}</span>
                        <span
                          className="wbs-pcode"
                          style={{
                            color: inkOf(project.color),
                            background: `color-mix(in srgb, ${project.color || 'var(--c-text-3)'} 16%, transparent)`,
                          }}
                        >{gi + 1}</span>
                        <span className="wbs-pname">{g.name}</span>
                        <span className="wbs-pcount">
                          {g.tasks.length} item{g.tasks.length === 1 ? '' : 's'}
                        </span>
                      </button>

                      {gOpen && g.tasks.map((t, ti) => (
                        <WbsItem
                          key={t.id}
                          code={`${gi + 1}.${ti + 1}`}
                          task={t}
                          project={isOrphan ? null : project}
                          blockedIds={blockedIds}
                          today={today}
                          resourceOf={resourceOf}
                          activeToday={activeTodayIds.has(t.id)}
                          onOpenLog={() => setLogScope({ type: 'task', project, task: t })}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {logScope && (
        <ScopedActivityLogModal scope={logScope} onClose={() => setLogScope(null)} />
      )}

      {quickAddOpen && (
        <TaskQuickAdd
          projects={projects}
          projectFilter={projectFilter}
          onClose={() => setQuickAddOpen(false)}
        />
      )}
    </>
  );
}

// ─── One item, and its checklist ──────────────────────────────────────────
//
// The mockup's row is four things: the `1.2` code, the title, the status chip
// and the owner's face. Two app facts join them, both of which would be lost
// otherwise: the today-tick and the subtask count.

function WbsItem({ code, task: t, project, blockedIds, today, resourceOf, activeToday, onOpenLog }) {
  const subs = t.subtasks || [];
  const done = t.status === 'done';
  // Past its plan date it reads Stuck, whatever status it carries — the same
  // rule the board and the table use (services/boardScope.js).
  const shownStatus = displayStatus(t, blockedIds, fmtDate(today));
  const owner = resourceOf(t);
  const prio = t.priority || 'medium';
  const start = shortDate(t.plan?.startDate);
  const end = shortDate(t.plan?.endDate);
  // The end date goes red once it has passed, the same rule the board card
  // and the table use — a plan window that has run out says so here too.
  const late = !done && t.plan?.endDate && t.plan.endDate < fmtDate(today);
  const planTitle = t.plan?.startDate || t.plan?.endDate
    ? `Planned ${t.plan?.startDate || 'no start'} → ${t.plan?.endDate || 'no end'}`
    : 'No planned dates on this item';

  return (
    <>
      <button
        type="button"
        className="wbs-item"
        onClick={onOpenLog}
        title={`${t.title} — open this task's activity log`}
      >
        <span className="wbs-icode">{code}</span>
        <span className={`wbs-ititle${done ? ' is-done' : ''}`}>{t.title}</span>
        {activeToday && (
          <span className="wbs-today" title="Activity logged today — this task is moving" aria-label="Active today">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        )}
        {subs.length > 0 && (
          <span className="wbs-subcount">{subs.filter((s) => s.done).length}/{subs.length}</span>
        )}

        {/* The planned window, and the priority. Both sit in FIXED-width
            slots: the title is the only thing that flexes, so every chip
            below it lines up into a column. A chip that moves row to row is
            a column you cannot scan — the same mistake the Workload's cap
            notch made (T-0150). */}
        <span className="wbs-dates" title={planTitle}>
          {start || end ? (
            <>
              <span>{start || '—'}</span>
              <span className="wbs-arrow" aria-hidden="true">→</span>
              <span className={late ? 'late' : undefined}>{end || '—'}</span>
            </>
          ) : (
            <span className="wbs-nodate">no dates</span>
          )}
        </span>
        <span className="wbs-status-slot">
          <span className={`bx-st st-${shownStatus.id}`}>{shownStatus.label}</span>
        </span>
        {/* A face alone is a guess unless you already know the team; the
            name is the thing being asked for. The circle stays as the
            recognisable part, with the name beside it. */}
        <span className="wbs-owner">
          {owner
            ? <>
                <Avatar name={owner} id={t.assignedTo?.[0] || t.userId} size={20} />
                <span className="wbs-owner-name">{owner}</span>
              </>
            : <span className="wbs-owner-name is-none">Unassigned</span>}
        </span>
      </button>

      {subs.map((s, si) => (
        <div key={s.id} className="wbs-sub">
          <span className="wbs-icode">{code}.{si + 1}</span>
          <span className={`wbs-box${s.done ? ' on' : ''}`} aria-hidden="true">{s.done ? '✓' : ''}</span>
          <span className={`wbs-stitle${s.done ? ' is-done' : ''}`}>{s.text}</span>
        </div>
      ))}
    </>
  );
}

// ─── Scoped activity log modal ──────────────────────────────────────────────
// scope: { type: 'project'|'phase'|'task', project, phase?, task? }
// Phase scope resolves each activity's phase from the task's CURRENT phaseId
// (fallback: the activity's denormalized snapshot), consistent with the
// project Activity Log view.

function ScopedActivityLogModal({ scope, onClose }) {
  const modal = useModalDialog({ onClose });
  const { activities, loading } = useAllActivities();
  const { tasks, userId } = useTasks();
  const { projects } = useProjects();
  const [editing, setEditing] = useState(null);          // activity being edited
  const [loggingTask, setLoggingTask] = useState(null);  // task to add a log to
  const [editingTask, setEditingTask] = useState(null);  // task being edited
  const [selectedTaskId, setSelectedTaskId] = useState('');

  const taskById = {};
  tasks.forEach((t) => { taskById[t.id] = t; });

  const { project } = scope;

  // Tasks inside this scope — the candidates for "+ Log activity" / "Edit task".
  // For task scope it's just the (live) task itself; project/phase scopes get a
  // picker over their tasks.
  const orphanScopeIds = scope.taskIds ? new Set(scope.taskIds) : null;
  const scopeTasks =
    scope.type === 'task'
      ? [taskById[scope.task.id] || scope.task]
      : tasks.filter((t) => {
          if (orphanScopeIds) return orphanScopeIds.has(t.id);
          if (t.projectId !== project.id) return false;
          return scope.type === 'phase' ? t.phaseId === scope.phase.id : true;
        });

  const actionTask =
    scope.type === 'task'
      ? scopeTasks[0]
      : taskById[selectedTaskId] || null;

  const livePhaseId = (a) => {
    const liveTask = taskById[a.taskId];
    return liveTask ? (liveTask.phaseId || null) : (a.phaseId || null);
  };

  const rows = activities
    .filter((a) => {
      if (scope.type === 'task') return a.taskId === scope.task.id;
      if (orphanScopeIds) return orphanScopeIds.has(a.taskId); // unassigned bucket
      if (a.projectId !== project.id) return false;
      if (scope.type === 'phase') return livePhaseId(a) === scope.phase.id;
      return true; // project scope
    })
    .map((a) => {
      const phase = project.phases?.find((p) => p.id === livePhaseId(a));
      return {
        ...a,
        _phase: phase?.name || '—',
        _task: a.taskTitle || taskById[a.taskId]?.title || '—',
        _outputs: a.attachments || [],
      };
    })
    .sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
      || (b.loggedAt?.seconds || 0) - (a.loggedAt?.seconds || 0));

  const totalHours = rows.reduce((s, r) => s + (r.hoursSpent || 0), 0);

  const scopeTitle =
    scope.type === 'project' ? project.name
    : scope.type === 'phase' ? `${project.name} · ${scope.phase.name}`
    : `${project.name} · ${scope.task.title}`;

  const scopeLabel =
    scope.type === 'project' ? 'project'
    : scope.type === 'phase' ? 'phase'
    : 'task';

  // Export ▾ instead of a lone CSV button: this modal is one of the pages
  // somebody sends to a manager (BUG-031). `build` runs only when a format is
  // picked, so opening the modal costs nothing.
  const exportProps = {
    build: () => buildActivityLogDocument(rows, {
      projectById: { [project.id]: project },
      taskById,
      projectName: project.name,
      title: `${scopeTitle} — activity log`,
    }),
    baseName: `${scopeTitle}-activities`,
    kind: 'table',
    title: 'Save these entries as a spreadsheet, a PDF or a CSV',
  };

  return (
    <>
      <div className="modal-backdrop" {...modal.backdropProps}>
        <div className="modal" style={{ maxWidth: 1100, width: '95vw' }} {...modal.dialogProps}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <span className="proj-dot" style={{ background: project.color, width: 14, height: 14 }} />
            <h3 className="modal-title" style={{ margin: 0 }} id={modal.titleId}>{scopeTitle} — Activity log</h3>
          </div>
          <p className="modal-sub" style={{ marginBottom: 12 }}>
            All activities under this {scopeLabel} · {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {totalHours.toFixed(1)}h total
          </p>

          {loading ? (
            <p className="muted">Loading activity log…</p>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">☰</div>
              <p>No activities logged for this {scopeLabel} yet.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Task</th>
                    <th>Activity details</th>
                    <th>Date</th>
                    <th>Completion</th>
                    <th>Output</th>
                    <th>Bottlenecks / remarks</th>
                    <th>Requested by</th>
                    <th>Hours</th>
                    <th aria-label="actions" style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r._phase}</td>
                      <td className="table-cell-wrap"><strong>{r._task}</strong></td>
                      <td className="table-cell-wrap">{r.comment || <span className="muted">—</span>}</td>
                      <td className="mono small">{r.date}</td>
                      <td>
                        {r.completionStatus ? (
                          <span className={`badge badge-soft-${
                            r.completionStatus === 'completed'   ? 'success' :
                            r.completionStatus === 'blocked'     ? 'danger'  :
                            r.completionStatus === 'in-progress' ? 'info'    : 'muted'
                          }`}>{r.completionStatus}</span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>
                        {r._outputs[0] ? (
                          <a className="table-link" href={r._outputs[0].url} target="_blank" rel="noreferrer">
                            📎 {(r._outputs[0].name || 'link').slice(0, 30)}
                            {r._outputs.length > 1 && <span className="muted"> +{r._outputs.length - 1}</span>}
                          </a>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="table-cell-wrap">
                        {r.bottleneckRemarks
                          ? <span style={{ color: 'var(--c-warn)' }}>⚠ {r.bottleneckRemarks}</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td>{r.requestedBy || <span className="muted">—</span>}</td>
                      <td className="mono small">{(r.hoursSpent || 0).toFixed(1)}h</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          title="Edit this activity entry"
                          onClick={() => setEditing(r)} aria-label="Edit this activity entry">✎</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="modal-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
            {rows.length > 0 && (
              <ExportButton {...exportProps} className="btn btn-sm" />
            )}
            <div style={{ flex: 1 }} />
            {scope.type !== 'task' && scopeTasks.length > 0 && (
              <select
                className="select select-sm"
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                style={{ maxWidth: 240 }}
                title="Pick a task to log against or edit"
              >
                <option value="">— Pick a task —</option>
                {scopeTasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            )}
            <button
              className="btn btn-sm btn-primary"
              disabled={!actionTask}
              title={actionTask ? `Log activity on "${actionTask.title}"` : 'Pick a task first'}
              onClick={() => setLoggingTask(actionTask)}
            >+ Log activity</button>
            <button
              className="btn btn-sm"
              disabled={!actionTask}
              title={actionTask ? `Edit "${actionTask.title}"` : 'Pick a task first'}
              onClick={() => setEditingTask(actionTask)}
            >✎ Edit task</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {editing && (
        <ActivityEditor activity={editing} onClose={() => setEditing(null)} />
      )}

      {loggingTask && (
        <ActivityLogger
          task={loggingTask}
          userId={userId}
          onClose={() => setLoggingTask(null)}
        />
      )}

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
