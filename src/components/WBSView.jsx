// src/components/WBSView.jsx — Work Breakdown Structure.
// Snapshot of overall status: rows are Project → Phase → Task → Subtask with
// schedule columns (duration / start / end / resource / % complete) and a
// Gantt-style timeline on the right. Clicking a project, phase, or task row
// opens that scope's activity log.

import { useState, useMemo } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useWorkspaces, useActiveWorkspaceId } from '../hooks/useWorkspace';
import { todayLocal } from '../services/firebase';
import ActivityEditor from './ActivityEditor';
import ActivityLogger from './ActivityLogger';
import TaskEditor from './TaskEditor';
import TaskQuickAdd from './TaskQuickAdd';

const ZOOMS = [
  { id: 'day',   label: 'Day',   dayWidth: 36 },
  { id: 'week',  label: 'Week',  dayWidth: 16 },
  { id: 'month', label: 'Month', dayWidth: 6 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function diffDays(a, b) {
  return Math.round((b - a) / DAY_MS);
}
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtShort(d, zoomId) {
  if (zoomId === 'month') return d.getDate() === 1 ? d.toLocaleString('en', { month: 'short' }) : '';
  if (zoomId === 'week')  return d.getDay() === 1 ? `${d.getDate()}` : '';
  return `${d.getDate()}`;
}

// Task schedule: plan dates first, actual as fallback.
function taskStart(t) { return t.plan?.startDate || t.actual?.startDate || null; }
function taskEnd(t)   { return t.plan?.endDate   || t.actual?.endDate   || null; }

// % complete for one task: done → 100, else subtask ratio, else manual
// progress, else a token 50% for "doing".
function taskPct(t) {
  if (t.status === 'done') return 100;
  const subs = t.subtasks || [];
  if (subs.length > 0) return Math.round((subs.filter((s) => s.done).length / subs.length) * 100);
  if (typeof t.progress === 'number' && t.progress > 0) return Math.min(100, Math.round(t.progress));
  return t.status === 'doing' ? 50 : 0;
}

function avgPct(tasks) {
  if (tasks.length === 0) return null;
  return Math.round(tasks.reduce((s, t) => s + taskPct(t), 0) / tasks.length);
}

// Min start / max end across a set of tasks → { start, end } | null
function spanOf(tasks) {
  let start = null;
  let end = null;
  tasks.forEach((t) => {
    const s = taskStart(t);
    const e = taskEnd(t);
    if (s && (!start || s < start)) start = s;
    if (e && (!end   || e > end))   end = e;
  });
  return start || end ? { start: start || end, end: end || start } : null;
}

function durationDays(span) {
  if (!span?.start || !span?.end) return null;
  return diffDays(parseDate(span.start), parseDate(span.end)) + 1;
}

// A task's full date extent [first, last] across plan + actual (YYYY-MM-DD) or
// null. Used by the date-period filter to test window overlap.
function fullSpan(t) {
  const all = [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]
    .filter(Boolean)
    .sort();
  if (all.length === 0) return null;
  return { first: all[0], last: all[all.length - 1] };
}

export default function WBSView({ projectFilter }) {
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, loading: projectsLoading } = useProjects();
  const { activities } = useAllActivities();
  const { workspaces } = useWorkspaces();
  const activeWs = useActiveWorkspaceId();

  // Tasks that have at least one activity logged TODAY — surfaced as a green
  // check so you can see at a glance which tasks are "moving" today.
  const activeTodayIds = useMemo(() => {
    const t = todayLocal();
    const s = new Set();
    activities.forEach((a) => { if (a.date === t && a.taskId) s.add(a.taskId); });
    return s;
  }, [activities]);

  const [zoom, setZoom] = useState('week');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [logScope, setLogScope] = useState(null); // { type, project, phase?, task? }
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'todo' | 'doing' | 'done'
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo]     = useState('');

  const zoomConf = ZOOMS.find((z) => z.id === zoom);
  const memberProfiles = workspaces.find((w) => w.id === activeWs)?.memberProfiles || {};

  const resourceOf = (t) =>
    t.requestedBy?.trim()
    || memberProfiles[t.userId]?.displayName
    || memberProfiles[t.userId]?.email
    || null;

  // Unique resource names across a set of tasks, rendered "A, B +2".
  const resourcesOf = (taskList) => {
    const names = [...new Set(taskList.map(resourceOf).filter(Boolean))];
    if (names.length === 0) return null;
    const shown = names.slice(0, 2).join(', ');
    return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
  };

  // ── Build the tree: project → phase groups → tasks ───────────────────────
  const statusActive = statusFilter !== 'all';
  const periodActive = !!(periodFrom || periodTo);
  const filterActive = statusActive || periodActive;
  const tree = useMemo(() => {
    const sortTasks = (arr) =>
      [...arr].sort((a, b) => (taskStart(a) || '9999').localeCompare(taskStart(b) || '9999'));

    // Does the task's date extent overlap the [periodFrom, periodTo] window?
    const inPeriod = (t) => {
      if (!periodActive) return true;
      const span = fullSpan(t);
      if (!span) return false;                              // no dates → out of any window
      if (periodFrom && span.last  < periodFrom) return false; // ends before window
      if (periodTo   && span.first > periodTo)   return false; // starts after window
      return true;
    };

    // Focus filters: status (chosen state) + date period. Empty phases/projects
    // are dropped while any filter is active so the table stays focused.
    let scopedTasks = tasks;
    if (statusActive) scopedTasks = scopedTasks.filter((t) => t.status === statusFilter);
    if (periodActive) scopedTasks = scopedTasks.filter(inPeriod);

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
      if (filterActive) groups = groups.filter((g) => g.tasks.length > 0);
      return { project: p, tasks: pTasks, groups };
    });
    if (filterActive) blocks = blocks.filter((b) => b.tasks.length > 0);

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
  }, [projects, tasks, projectFilter, statusFilter, statusActive, periodActive, periodFrom, periodTo]);

  // ── Timeline range (same approach as Gantt) ───────────────────────────────
  const today = parseDate(todayLocal());
  const range = useMemo(() => {
    // Extent of the visible tasks across plan + actual dates.
    let taskMin = null;
    let taskMax = null;
    tree.forEach(({ tasks: pTasks }) => {
      pTasks.forEach((t) => {
        [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]
          .map(parseDate).filter(Boolean)
          .forEach((d) => {
            if (!taskMin || d < taskMin) taskMin = d;
            if (!taskMax || d > taskMax) taskMax = d;
          });
      });
    });

    // When a period is set, the timeline window is pinned to it (each bound
    // independently). Otherwise auto-fit the visible tasks, starting a week
    // before today so recent context is visible.
    if (periodActive) {
      let min = periodFrom ? parseDate(periodFrom) : null;
      let max = periodTo   ? parseDate(periodTo)   : null;
      if (!min) min = taskMin || (max ? addDays(max, -30) : addDays(today, -7));
      if (!max) max = taskMax || (min ? addDays(min, 30)  : addDays(today, 30));
      if (max < min) max = min;
      return { min, max, total: diffDays(min, max) + 1 };
    }

    let min = addDays(today, -7);
    let max = today;
    if (taskMin && taskMin < min) min = taskMin;
    if (taskMax && taskMax > max) max = taskMax;
    max = addDays(max, 3);
    return { min, max, total: diffDays(min, max) + 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, periodActive, periodFrom, periodTo]);

  const totalWidth = range.total * zoomConf.dayWidth;
  // Left columns: name | duration | start | end | resource | % complete
  const gridCols = `560px 60px 92px 92px 120px 92px ${totalWidth}px`;
  const labelWidth = 560 + 60 + 92 + 92 + 120 + 92;

  const toggle = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dayHeaders = [];
  for (let i = 0; i < range.total; i++) {
    const d = addDays(range.min, i);
    dayHeaders.push({
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isToday: fmtDate(d) === fmtDate(today),
      label: fmtShort(d, zoom),
    });
  }

  const barGeom = (span) => {
    if (!span) return null;
    const s = parseDate(span.start);
    const e = parseDate(span.end);
    // Clamp to the visible window so a bar that starts before range.min (e.g. a
    // period filter narrowing the window) never gets a negative left and spills
    // over the left columns.
    const rawLeft = diffDays(range.min, s) * zoomConf.dayWidth;
    const rawRight = (diffDays(range.min, e) + 1) * zoomConf.dayWidth;
    const left = Math.max(0, rawLeft);
    const right = Math.min(totalWidth, rawRight);
    return { left, width: Math.max(2, right - left) };
  };

  const todayLeft = today >= range.min && today <= range.max
    ? diffDays(range.min, today) * zoomConf.dayWidth + zoomConf.dayWidth / 2 - 1
    : null;

  if (tasksLoading || projectsLoading) {
    return <p className="muted">Loading WBS…</p>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Breakdown Structure</h1>
          <p className="page-subtitle">
            Project → Phase → Task → Subtask with schedule and completion roll-ups.
            Click a row to open its activity log.
          </p>
        </div>
        <div className="page-actions">
          {ZOOMS.map((z) => (
            <button
              key={z.id}
              className={`chip ${zoom === z.id ? 'active' : ''}`}
              onClick={() => setZoom(z.id)}
            >{z.label}</button>
          ))}
          <button className="btn btn-primary btn-sm" onClick={() => setQuickAddOpen(true)}>
            + New task
          </button>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 12, flexWrap: 'wrap', rowGap: 8 }}>
        <span className="small muted" style={{ fontWeight: 600 }}>Show:</span>
        {[
          { id: 'all',   label: 'All' },
          { id: 'todo',  label: 'To do' },
          { id: 'doing', label: 'Ongoing' },
          { id: 'done',  label: 'Done' },
        ].map((s) => (
          <button
            key={s.id}
            className={`chip ${statusFilter === s.id ? 'active' : ''}`}
            onClick={() => setStatusFilter(s.id)}
          >{s.label}</button>
        ))}

        <span className="wbsx-toolbar-sep" aria-hidden="true" />

        <span className="small muted" style={{ fontWeight: 600 }}>Dates:</span>
        <span className="wbsx-date-inputs">
          <label className="small muted">From</label>
          <input
            type="date"
            className="input input-sm"
            value={periodFrom}
            max={periodTo || undefined}
            onChange={(e) => setPeriodFrom(e.target.value)}
          />
          <label className="small muted">To</label>
          <input
            type="date"
            className="input input-sm"
            value={periodTo}
            min={periodFrom || undefined}
            onChange={(e) => setPeriodTo(e.target.value)}
          />
        </span>
        {periodActive && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setPeriodFrom(''); setPeriodTo(''); }}>
            ✕ Clear dates
          </button>
        )}
      </div>

      {tree.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▦</div>
          {filterActive ? (
            <>
              <p>No tasks match the current filters.</p>
              <p className="small">
                Widen the date range or set status back to <strong>All</strong> to see the full WBS.
              </p>
            </>
          ) : (
            <p>No projects yet. Create one in the Projects view.</p>
          )}
        </div>
      ) : (
        <div className="wbsx" style={{ '--gantt-day-w': `${zoomConf.dayWidth}px` }}>
          {/* Column headers */}
          <div className="wbsx-row wbsx-header" style={{ gridTemplateColumns: gridCols }}>
            <div className="wbsx-cell wbsx-name-cell">Project / Phase / Task</div>
            <div className="wbsx-cell num">Days</div>
            <div className="wbsx-cell">Start</div>
            <div className="wbsx-cell">End</div>
            <div className="wbsx-cell">Resource</div>
            <div className="wbsx-cell">% Done</div>
            <div className="wbsx-track" style={{ display: 'grid', gridTemplateColumns: `repeat(${range.total}, ${zoomConf.dayWidth}px)` }}>
              {dayHeaders.map((h, i) => (
                <div key={i} className={`gantt-day-header ${h.isWeekend ? 'weekend' : ''} ${h.isToday ? 'today' : ''}`}>
                  {h.label}
                </div>
              ))}
            </div>
          </div>

          {tree.map(({ project, tasks: pTasks, groups, isOrphan }) => {
            const pKey = `p:${project.id}`;
            const pCollapsed = collapsed.has(pKey);
            const pSpan = spanOf(pTasks);
            const pPct = avgPct(pTasks);

            return (
              <ProjectBlock
                key={project.id}
                project={project}
                pTasks={pTasks}
                groups={groups}
                isOrphan={!!isOrphan}
                gridCols={gridCols}
                pCollapsed={pCollapsed}
                collapsed={collapsed}
                toggle={toggle}
                pKey={pKey}
                pSpan={pSpan}
                pPct={pPct}
                barGeom={barGeom}
                todayLeft={todayLeft}
                totalWidth={totalWidth}
                resourcesOf={resourcesOf}
                resourceOf={resourceOf}
                today={today}
                activeTodayIds={activeTodayIds}
                onOpenLog={setLogScope}
              />
            );
          })}
        </div>
      )}

      <div className="toolbar" style={{ marginTop: 16 }}>
        <span className="small muted">Legend:</span>
        <span className="badge" style={{ background: 'var(--c-text-2)', color: 'white' }}>Project span</span>
        <span className="badge" style={{ background: 'var(--c-accent)', color: 'white', opacity: 0.65 }}>Phase span</span>
        <span className="badge" style={{ background: 'var(--c-doing)', color: 'white' }}>Task</span>
        <span className="badge" style={{ background: 'var(--c-danger)', color: 'white' }}>Overdue</span>
        <span className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
          <span className="wbsx-today-check" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          activity logged today
        </span>
        <span className="small muted" style={{ marginLeft: 8 }}>
          % roll-up: task = subtasks / progress · phase &amp; project = average of their tasks.
        </span>
      </div>

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

// ─── One project's block of rows ────────────────────────────────────────────

function ProjectBlock({
  project, pTasks, groups, isOrphan, gridCols, pCollapsed, collapsed, toggle, pKey,
  pSpan, pPct, barGeom, todayLeft, totalWidth, resourcesOf, resourceOf, today, activeTodayIds, onOpenLog,
}) {
  const pBar = barGeom(pSpan);
  // Orphan tasks have no shared projectId, so their log is scoped by task ids.
  const openProjectLog = () => onOpenLog({
    type: 'project',
    project,
    ...(isOrphan ? { taskIds: pTasks.map((t) => t.id) } : {}),
  });

  return (
    <>
      {/* Project row */}
      <div
        className="wbsx-row wbsx-project-row"
        style={{ gridTemplateColumns: gridCols }}
        onClick={openProjectLog}
        title="Click to view this project's activity log"
      >
        <div className="wbsx-cell wbsx-name-cell">
          <button
            className="wbsx-chevron"
            onClick={(e) => { e.stopPropagation(); toggle(pKey); }}
            aria-label={pCollapsed ? 'Expand project' : 'Collapse project'}
          >{pCollapsed ? '▸' : '▾'}</button>
          <span className="proj-dot" style={{ background: project.color }} />
          <span className="wbsx-project-name">{project.name}</span>
          <span className="muted small" style={{ marginLeft: 6 }}>
            {pTasks.length} task{pTasks.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="wbsx-cell num">{durationDays(pSpan) ?? '—'}</div>
        <div className="wbsx-cell mono small">{pSpan?.start || '—'}</div>
        <div className="wbsx-cell mono small">{pSpan?.end || '—'}</div>
        <div className="wbsx-cell small">{resourcesOf(pTasks) || '—'}</div>
        <PctCell pct={pPct} color={project.color} />
        <div className="wbsx-track">
          <div className="gantt-day-grid" />
          {pBar && (
            <div
              className="wbsx-bar wbsx-bar-project"
              style={{ left: pBar.left, width: pBar.width }}
              title={`${pSpan.start} → ${pSpan.end}`}
            />
          )}
          {todayLeft != null && <div className="gantt-today-line" style={{ left: todayLeft }} />}
        </div>
      </div>

      {/* Phase groups */}
      {!pCollapsed && groups.map((g) => {
        const gKey = `ph:${project.id}:${g.id}`;
        const gCollapsed = collapsed.has(gKey);
        const gSpan = spanOf(g.tasks);
        const gBar = barGeom(gSpan);
        const gPct = avgPct(g.tasks);
        const isRealPhase = !!g.phase;

        return (
          <PhaseGroup
            key={gKey}
            project={project}
            group={g}
            gKey={gKey}
            gridCols={gridCols}
            gCollapsed={gCollapsed}
            collapsed={collapsed}
            toggle={toggle}
            gSpan={gSpan}
            gBar={gBar}
            gPct={gPct}
            isRealPhase={isRealPhase}
            todayLeft={todayLeft}
            resourcesOf={resourcesOf}
            resourceOf={resourceOf}
            today={today}
            barGeom={barGeom}
            activeTodayIds={activeTodayIds}
            onOpenLog={onOpenLog}
          />
        );
      })}
    </>
  );
}

function PhaseGroup({
  project, group: g, gKey, gridCols, gCollapsed, collapsed, toggle,
  gSpan, gBar, gPct, isRealPhase, todayLeft, resourcesOf, resourceOf, today, barGeom, activeTodayIds, onOpenLog,
}) {
  return (
    <>
      <div
        className={`wbsx-row wbsx-phase-row ${isRealPhase ? '' : 'unphased'}`}
        style={{ gridTemplateColumns: gridCols }}
        onClick={isRealPhase ? () => onOpenLog({ type: 'phase', project, phase: g.phase }) : undefined}
        title={isRealPhase ? "Click to view this phase's activity log" : undefined}
      >
        <div className="wbsx-cell wbsx-name-cell" style={{ paddingLeft: 26 }}>
          <button
            className="wbsx-chevron"
            onClick={(e) => { e.stopPropagation(); toggle(gKey); }}
            aria-label={gCollapsed ? 'Expand phase' : 'Collapse phase'}
          >{gCollapsed ? '▸' : '▾'}</button>
          <span className="phase-tag">{g.name}</span>
          <span className="muted small" style={{ marginLeft: 6 }}>{g.tasks.length}</span>
        </div>
        <div className="wbsx-cell num">{durationDays(gSpan) ?? '—'}</div>
        <div className="wbsx-cell mono small">{gSpan?.start || '—'}</div>
        <div className="wbsx-cell mono small">{gSpan?.end || '—'}</div>
        <div className="wbsx-cell small">{resourcesOf(g.tasks) || '—'}</div>
        <PctCell pct={gPct} color="var(--c-accent)" />
        <div className="wbsx-track">
          <div className="gantt-day-grid" />
          {gBar && (
            <div
              className="wbsx-bar wbsx-bar-phase"
              style={{ left: gBar.left, width: gBar.width, background: project.color }}
              title={`${gSpan.start} → ${gSpan.end}`}
            />
          )}
          {todayLeft != null && <div className="gantt-today-line" style={{ left: todayLeft }} />}
        </div>
      </div>

      {!gCollapsed && g.tasks.map((t) => (
        <TaskRows
          key={t.id}
          project={project}
          task={t}
          gridCols={gridCols}
          collapsed={collapsed}
          toggle={toggle}
          todayLeft={todayLeft}
          resourceOf={resourceOf}
          today={today}
          barGeom={barGeom}
          activeToday={activeTodayIds?.has(t.id)}
          onOpenLog={onOpenLog}
        />
      ))}
    </>
  );
}

function TaskRows({ project, task: t, gridCols, collapsed, toggle, todayLeft, resourceOf, today, barGeom, activeToday, onOpenLog }) {
  const tKey = `t:${t.id}`;
  const tCollapsed = collapsed.has(tKey);
  const subs = t.subtasks || [];
  const span = taskStart(t) || taskEnd(t)
    ? { start: taskStart(t) || taskEnd(t), end: taskEnd(t) || taskStart(t) }
    : null;
  const bar = barGeom(span);
  const pct = taskPct(t);
  const isOverdue = t.status !== 'done' && t.plan?.endDate && parseDate(t.plan.endDate) < today;

  return (
    <>
      <div
        className="wbsx-row wbsx-task-row"
        style={{ gridTemplateColumns: gridCols }}
        onClick={() => onOpenLog({ type: 'task', project, task: t })}
        title="Click to view this task's activity log"
      >
        <div className="wbsx-cell wbsx-name-cell" style={{ paddingLeft: 52 }}>
          {subs.length > 0 ? (
            <button
              className="wbsx-chevron"
              onClick={(e) => { e.stopPropagation(); toggle(tKey); }}
              aria-label={tCollapsed ? 'Expand subtasks' : 'Collapse subtasks'}
            >{tCollapsed ? '▸' : '▾'}</button>
          ) : (
            <span className="wbsx-chevron-spacer" />
          )}
          {activeToday && (
            <span className="wbsx-today-check" title="Activity logged today — this task is moving" aria-label="Active today">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          )}
          <span className={`wbsx-task-name ${t.status === 'done' ? 'done' : ''}`}>{t.title}</span>
          {subs.length > 0 && (
            <span className="muted small" style={{ marginLeft: 6 }}>
              {subs.filter((s) => s.done).length}/{subs.length}
            </span>
          )}
        </div>
        <div className="wbsx-cell num">{durationDays(span) ?? '—'}</div>
        <div className="wbsx-cell mono small">{span?.start || '—'}</div>
        <div className="wbsx-cell mono small">{span?.end || '—'}</div>
        <div className="wbsx-cell small">{resourceOf(t) || '—'}</div>
        <PctCell pct={pct} color={isOverdue ? 'var(--c-danger)' : 'var(--c-doing)'} />
        <div className="wbsx-track">
          <div className="gantt-day-grid" />
          {bar && (
            <div
              className={`wbsx-bar wbsx-bar-task ${isOverdue ? 'overdue' : ''}`}
              style={{ left: bar.left, width: bar.width, background: isOverdue ? undefined : project.color }}
              title={`${span.start} → ${span.end} · ${pct}%`}
            >
              <div className="wbsx-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
          {todayLeft != null && <div className="gantt-today-line" style={{ left: todayLeft }} />}
        </div>
      </div>

      {!tCollapsed && subs.map((s) => (
        <div
          key={s.id}
          className="wbsx-row wbsx-subtask-row"
          style={{ gridTemplateColumns: gridCols }}
          onClick={() => onOpenLog({ type: 'task', project, task: t })}
        >
          <div className="wbsx-cell wbsx-name-cell" style={{ paddingLeft: 78 }}>
            <span className={`wbsx-sub-check ${s.done ? 'done' : ''}`}>{s.done ? '✓' : '○'}</span>
            <span className={`wbsx-sub-name ${s.done ? 'done' : ''}`}>{s.text}</span>
          </div>
          <div className="wbsx-cell num">—</div>
          <div className="wbsx-cell mono small">—</div>
          <div className="wbsx-cell mono small">—</div>
          <div className="wbsx-cell small">—</div>
          <PctCell pct={s.done ? 100 : 0} color="var(--c-emerald)" />
          <div className="wbsx-track">
            <div className="gantt-day-grid" />
            {todayLeft != null && <div className="gantt-today-line" style={{ left: todayLeft }} />}
          </div>
        </div>
      ))}
    </>
  );
}

function PctCell({ pct, color }) {
  if (pct == null) return <div className="wbsx-cell small muted">—</div>;
  return (
    <div className="wbsx-cell wbsx-pct">
      <div className="wbsx-pct-track">
        <div className="wbsx-pct-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="wbsx-pct-num">{pct}%</span>
    </div>
  );
}

// ─── Scoped activity log modal ──────────────────────────────────────────────
// scope: { type: 'project'|'phase'|'task', project, phase?, task? }
// Phase scope resolves each activity's phase from the task's CURRENT phaseId
// (fallback: the activity's denormalized snapshot), consistent with the
// project Activity Log view.

function ScopedActivityLogModal({ scope, onClose }) {
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

  const exportCsv = () => {
    const headers = ['Project', 'Phase', 'Task', 'Activity details', 'Date', 'Completion', 'Output link', 'Bottlenecks', 'Requested by', 'Hours'];
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach((r) => {
      lines.push([
        project.name, r._phase, r._task, r.comment, r.date, r.completionStatus,
        r._outputs.map((a) => a.url).join(' | '), r.bottleneckRemarks, r.requestedBy, r.hoursSpent || 0,
      ].map(escape).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = scopeTitle.replace(/[^\w.\-]+/g, '_');
    a.download = `${safeName}-activities-${todayLocal()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, width: '95vw' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <span className="proj-dot" style={{ background: project.color, width: 14, height: 14 }} />
            <h3 className="modal-title" style={{ margin: 0 }}>{scopeTitle} — Activity log</h3>
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
                          onClick={() => setEditing(r)}
                        >✎</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="modal-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
            {rows.length > 0 && (
              <button className="btn btn-sm" onClick={exportCsv}>⬇ Export CSV</button>
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
