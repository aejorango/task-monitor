// src/components/GanttView.jsx — SVG-free Gantt with draggable plan bars.
// Three drag handles per plan bar:
//   - left edge  (resize start)
//   - right edge (resize end)
//   - middle     (move whole bar)

import { useState, useMemo, useRef, useEffect } from 'react';
import { useTasks, useProjects, useAuth } from '../hooks/useTasks';
import { todayLocal, updateTask, addTask } from '../services/firebase';
import TaskActivitiesModal from './TaskActivitiesModal';
import TaskEditor from './TaskEditor';

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

export default function GanttView({ projectFilter }) {
  const { tasks, loading, userId } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const [zoom, setZoom] = useState('day');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [viewingTask, setViewingTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const zoomConf = ZOOMS.find((z) => z.id === zoom);

  const rows = useMemo(() => {
    // Earliest date on a task (plan or actual start, then ends as fallback)
    const earliestOf = (t) => {
      const candidates = [t.plan?.startDate, t.actual?.startDate, t.plan?.endDate, t.actual?.endDate]
        .filter(Boolean)
        .sort();
      return candidates[0] || '9999-12-31';
    };

    return tasks
      .filter((t) => projectFilter === 'all' || t.projectId === projectFilter)
      .filter((t) => t.plan?.startDate || t.plan?.endDate || t.actual?.startDate || t.actual?.endDate)
      .sort((a, b) => {
        // 1. Group by project (alphabetical by project name; null project last)
        const aProj = projectById[a.projectId]?.name || '￿';
        const bProj = projectById[b.projectId]?.name || '￿';
        if (aProj !== bProj) return aProj.localeCompare(bProj);
        // 2. Within a project, earliest start first
        return earliestOf(a).localeCompare(earliestOf(b));
      });
  }, [tasks, projectFilter, projectById]);

  const range = useMemo(() => {
    // Default view starts one week before today so recent context is visible
    // even when the earliest scheduled task is in the future.
    const today = parseDate(todayLocal());
    let min = addDays(today, -7);
    let max = today;
    rows.forEach((t) => {
      const dates = [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]
        .map(parseDate).filter(Boolean);
      dates.forEach((d) => {
        if (d < min) min = d;
        if (d > max) max = d;
      });
    });
    // Pad the trailing edge so future tasks have a little headroom; the
    // leading edge already sits a week before today.
    max = addDays(max, 3);
    return { min, max, total: diffDays(min, max) + 1 };
  }, [rows]);

  const today = parseDate(todayLocal());

  if (loading) return <p className="muted">Loading Gantt…</p>;

  if (rows.length === 0) {
    return (
      <>
        <PageHeader zoom={zoom} setZoom={setZoom} onNewTask={() => setQuickAddOpen(true)} />
        <div className="empty-state">
          <div className="empty-state-icon">▭</div>
          <p>No tasks with plan or actual dates yet.</p>
          <p className="small">Click <strong>+ New task</strong> above, or add plan start/end dates to existing tasks.</p>
        </div>
        {quickAddOpen && (
          <GanttQuickAdd projects={projects} projectFilter={projectFilter} onClose={() => setQuickAddOpen(false)} />
        )}
      </>
    );
  }

  const totalWidth   = range.total * zoomConf.dayWidth;
  const phaseWidth   = 120;
  const taskWidth    = 240;
  const labelWidth   = phaseWidth + taskWidth;
  const rowHeight    = 40;       // CSS .gantt-row height
  const groupHeight  = 32;       // CSS .gantt-row.group-header height
  const headerHeight = 33;       // CSS .gantt-row.header height

  // Build a flat layout array: group headers + task rows, interleaved in
  // render order. Each entry has { kind, top, height, projectId?, task? }.
  // `top` is the Y offset from the start of the body (after the column header
  // row). The SVG overlay starts at the body's top — i.e. headerHeight below
  // the .gantt container — so arrow math just uses entry.top + height / 2.
  const layout = [];
  let cursorY = 0;
  let lastProjectKey = '__none__';
  rows.forEach((t) => {
    const projKey = t.projectId || '__none__';
    if (projKey !== lastProjectKey) {
      layout.push({
        kind: 'group',
        top: cursorY,
        height: groupHeight,
        projectId: t.projectId || null,
      });
      cursorY += groupHeight;
      lastProjectKey = projKey;
    }
    layout.push({
      kind: 'task',
      top: cursorY,
      height: rowHeight,
      task: t,
    });
    cursorY += rowHeight;
  });
  const bodyHeight = cursorY;

  // Index task rows for arrow Y computation.
  const taskRowByTaskId = new Map();
  layout.forEach((entry) => {
    if (entry.kind === 'task') taskRowByTaskId.set(entry.task.id, entry);
  });

  // Compute dependency arrows: from end of dep's plan bar to start of this
  // task's plan bar. Coordinates are relative to the SVG, which sits inside
  // the .gantt container at top: headerHeight, left: labelWidth.
  const arrows = [];
  rows.forEach((t) => {
    const depIds = t.dependsOn || [];
    const myPlanStart = parseDate(t.plan?.startDate);
    if (!myPlanStart) return;
    const myEntry = taskRowByTaskId.get(t.id);
    if (!myEntry) return;
    const toX = Math.round(diffDays(range.min, myPlanStart) * zoomConf.dayWidth);
    const toY = Math.round(myEntry.top + myEntry.height / 2);

    depIds.forEach((depId) => {
      const depEntry = taskRowByTaskId.get(depId);
      if (!depEntry) return;
      const depPlanEnd = parseDate(depEntry.task.plan?.endDate);
      if (!depPlanEnd) return;
      const fromX = Math.round((diffDays(range.min, depPlanEnd) + 1) * zoomConf.dayWidth);
      const fromY = Math.round(depEntry.top + depEntry.height / 2);
      arrows.push({ id: `${depId}->${t.id}`, fromX, fromY, toX, toY });
    });
  });

  const dayHeaders = [];
  const weekendCols = [];   // [{ left, width }] indices for shaded weekend strips
  for (let i = 0; i < range.total; i++) {
    const d = addDays(range.min, i);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = fmtDate(d) === fmtDate(today);
    dayHeaders.push({ d, isWeekend, isToday, label: fmtShort(d, zoom) });
    if (isWeekend) {
      weekendCols.push({ left: i * zoomConf.dayWidth, width: zoomConf.dayWidth });
    }
  }

  return (
    <>
      <PageHeader zoom={zoom} setZoom={setZoom} />

      <div className="gantt" style={{ '--gantt-day-w': `${zoomConf.dayWidth}px`, position: 'relative' }}>
        <div className="gantt-row header" style={{ gridTemplateColumns: `${phaseWidth}px ${taskWidth}px ${totalWidth}px` }}>
          <div className="gantt-label gantt-label-phase">Phase</div>
          <div className="gantt-label">Task</div>
          <div className="gantt-track" style={{ display: 'grid', gridTemplateColumns: `repeat(${range.total}, ${zoomConf.dayWidth}px)` }}>
            {dayHeaders.map((h, i) => (
              <div
                key={i}
                className={`gantt-day-header ${h.isWeekend ? 'weekend' : ''} ${h.isToday ? 'today' : ''}`}
              >{h.label}</div>
            ))}
          </div>
        </div>

        {/* Weekend column tint — paints Saturday and Sunday columns across
            the full body height so weekends are visually distinct beneath
            the task bars. Sits behind bars (z-index: 0) and is non-interactive. */}
        {weekendCols.length > 0 && (
          <div
            className="gantt-weekend-overlay"
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: headerHeight,
              left: labelWidth,
              width: totalWidth,
              height: bodyHeight,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          >
            {weekendCols.map((w, i) => (
              <div
                key={i}
                className="gantt-weekend-col"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: w.left,
                  width: w.width,
                }}
              />
            ))}
          </div>
        )}

        {/* Dependency arrows overlay. Origin sits at (left: labelWidth, top:
            headerHeight) inside the .gantt container, so arrow coordinates
            are in the body's local space. */}
        {arrows.length > 0 && (
          <svg
            className="gantt-arrows"
            width={totalWidth}
            height={bodyHeight}
            style={{
              position: 'absolute',
              top: headerHeight,
              left: labelWidth,
              pointerEvents: 'none',
            }}
          >
            <defs>
              <marker
                id="dep-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-text-3)" />
              </marker>
            </defs>
            {arrows.map((a) => {
              // Elbow: short horizontal from dep end, then vertical to target row,
              // then horizontal to the target bar start. Use a small gap before
              // the target X so the arrowhead doesn't overlap the bar.
              const gap = 4;
              const endX = a.toX - gap;
              const midX = (a.fromX + endX) / 2;
              const d = `M ${a.fromX} ${a.fromY}
                         L ${midX} ${a.fromY}
                         L ${midX} ${a.toY}
                         L ${endX} ${a.toY}`;
              return (
                <path
                  key={a.id}
                  d={d}
                  fill="none"
                  stroke="var(--c-text-3)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  markerEnd="url(#dep-arrow)"
                />
              );
            })}
          </svg>
        )}

        {layout.map((entry, i) => {
          if (entry.kind === 'group') {
            const proj = projectById[entry.projectId];
            return (
              <div
                key={`g-${i}`}
                className="gantt-row group-header"
                style={{ gridTemplateColumns: `${phaseWidth + taskWidth}px ${totalWidth}px` }}
              >
                <div className="gantt-label">
                  {proj ? (
                    <span className="proj-tag">
                      <span className="proj-dot" style={{ background: proj.color }} />
                      {proj.name}
                    </span>
                  ) : (
                    <span className="muted small">No project</span>
                  )}
                </div>
                {/* Empty track cell so the row spans the timeline area too */}
                <div />
              </div>
            );
          }
          const t = entry.task;
          const proj = projectById[t.projectId];
          const phase = proj?.phases?.find((p) => p.id === t.phaseId);
          return (
            <GanttRow
              key={t.id}
              task={t}
              project={proj}
              phaseName={phase?.name || ''}
              range={range}
              zoomConf={zoomConf}
              totalWidth={totalWidth}
              phaseWidth={phaseWidth}
              taskWidth={taskWidth}
              today={today}
              onClick={() => setViewingTask(t)}
            />
          );
        })}
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <span className="small muted">Legend:</span>
        <span className="badge" style={{ background: 'var(--c-doing)', color: 'white', opacity: 0.5 }}>Plan (draggable)</span>
        <span className="badge" style={{ background: 'var(--c-done)', color: 'white' }}>Actual (done)</span>
        <span className="badge" style={{ background: 'var(--c-doing)', color: 'white' }}>Actual (in progress)</span>
        <span className="badge" style={{ background: 'var(--c-danger)', color: 'white' }}>Overdue</span>
        <span className="small muted" style={{ marginLeft: 8 }}>Drag plan bar edges to resize, middle to move.</span>
      </div>

      {quickAddOpen && (
        <GanttQuickAdd projects={projects} projectFilter={projectFilter} onClose={() => setQuickAddOpen(false)} />
      )}

      {viewingTask && !editingTask && (
        <TaskActivitiesModal
          task={viewingTask}
          userId={userId}
          onClose={() => setViewingTask(null)}
          onEditTask={(t) => { setEditingTask(t); }}
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

// ─── Individual row with draggable plan bar ────────────────────────────────

function GanttRow({ task, project, phaseName, range, zoomConf, totalWidth, phaseWidth, taskWidth, today, onClick }) {
  const planStart = parseDate(task.plan?.startDate);
  const planEnd   = parseDate(task.plan?.endDate);
  const actStart  = parseDate(task.actual?.startDate);
  const actEnd    = parseDate(task.actual?.endDate);

  // Drag state. While dragging, we shadow the real plan dates with local ones.
  const [drag, setDrag] = useState(null);  // { mode, startX, origStartDay, origEndDay, curStartDay, curEndDay }

  const trackRef = useRef(null);

  // Resolve current bar position (drag-shadowed or real)
  const liveStart = drag ? addDays(range.min, drag.curStartDay) : planStart;
  const liveEnd   = drag ? addDays(range.min, drag.curEndDay)   : planEnd;

  const planLeft  = liveStart ? diffDays(range.min, liveStart) * zoomConf.dayWidth  : null;
  const planWidth = liveStart && liveEnd ? (diffDays(liveStart, liveEnd) + 1) * zoomConf.dayWidth : null;

  const actLeft   = actStart ? diffDays(range.min, actStart) * zoomConf.dayWidth : null;
  const actEndOrToday = actEnd || (task.status !== 'done' ? today : null);
  const actWidth  = actStart && actEndOrToday ? (diffDays(actStart, actEndOrToday) + 1) * zoomConf.dayWidth : null;

  const isOverdue = task.status !== 'done' && planEnd && planEnd < today;
  const isInProgress = task.status === 'doing';

  // ── Drag handlers ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const dx = e.clientX - drag.startX;
      const dDays = Math.round(dx / zoomConf.dayWidth);
      let curStart = drag.origStartDay;
      let curEnd   = drag.origEndDay;
      if (drag.mode === 'move') {
        curStart += dDays;
        curEnd   += dDays;
      } else if (drag.mode === 'resize-left') {
        curStart = Math.min(curEnd, drag.origStartDay + dDays);
      } else if (drag.mode === 'resize-right') {
        curEnd = Math.max(curStart, drag.origEndDay + dDays);
      }
      setDrag({ ...drag, curStartDay: curStart, curEndDay: curEnd });
    };
    const onUp = async () => {
      // Commit
      const newStart = addDays(range.min, drag.curStartDay);
      const newEnd   = addDays(range.min, drag.curEndDay);
      const newStartStr = fmtDate(newStart);
      const newEndStr   = fmtDate(newEnd);
      const changed = newStartStr !== task.plan?.startDate || newEndStr !== task.plan?.endDate;
      setDrag(null);
      if (changed) {
        try {
          await updateTask(task.id, {
            'plan.startDate': newStartStr,
            'plan.endDate':   newEndStr,
          });
        } catch (err) {
          console.error('Could not save plan dates:', err);
          alert('Could not save plan dates. Check console.');
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
  }, [drag, zoomConf.dayWidth, range.min, task.id, task.plan?.startDate, task.plan?.endDate]);

  const startDrag = (e, mode) => {
    if (!planStart || !planEnd) return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      mode,
      startX: e.clientX,
      origStartDay: diffDays(range.min, planStart),
      origEndDay:   diffDays(range.min, planEnd),
      curStartDay:  diffDays(range.min, planStart),
      curEndDay:    diffDays(range.min, planEnd),
    });
  };

  // Clicking the row's label area opens the activities modal. Bar drags are
  // not affected because drag handlers stopPropagation on the bar elements.
  const handleLabelClick = (e) => {
    // Only fire on direct label clicks, not on bubbling from interactive children.
    if (!onClick) return;
    onClick();
  };

  return (
    <div
      className="gantt-row task-row"
      style={{ gridTemplateColumns: `${phaseWidth}px ${taskWidth}px ${totalWidth}px` }}
    >
      <div className="gantt-label gantt-label-phase" onClick={handleLabelClick}>
        {phaseName ? (
          <span className="phase-tag" title={phaseName}>{phaseName}</span>
        ) : (
          <span className="muted small">—</span>
        )}
      </div>
      <div className="gantt-label" onClick={handleLabelClick}>
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
        </div>
      </div>
      <div ref={trackRef} className="gantt-track" style={{ height: 40, position: 'relative', userSelect: drag ? 'none' : 'auto' }}>
        <div className="gantt-day-grid" />

        {planLeft != null && planWidth != null && (
          <div
            className="gantt-bar plan"
            style={{
              left: planLeft,
              width: planWidth,
              background: project?.color || 'var(--c-doing)',
              cursor: drag?.mode === 'move' ? 'grabbing' : 'grab',
            }}
            onPointerDown={(e) => startDrag(e, 'move')}
            title={`Plan: ${fmtDate(liveStart)} → ${fmtDate(liveEnd)}`}
          >
            {/* Left resize handle */}
            <div
              className="gantt-handle gantt-handle-left"
              onPointerDown={(e) => startDrag(e, 'resize-left')}
            />
            <span style={{ pointerEvents: 'none', position: 'relative', zIndex: 1 }}>
              {planWidth > 60 ? task.title : ''}
            </span>
            {/* Right resize handle */}
            <div
              className="gantt-handle gantt-handle-right"
              onPointerDown={(e) => startDrag(e, 'resize-right')}
            />
          </div>
        )}

        {actLeft != null && actWidth != null && (
          <div
            className={`gantt-bar actual ${isOverdue ? 'overdue' : isInProgress ? 'in-progress' : ''}`}
            style={{ left: actLeft, width: actWidth }}
            title={`Actual: ${task.actual?.startDate || '?'} → ${task.actual?.endDate || 'in progress'}`}
          />
        )}

        {today >= range.min && today <= range.max && (
          <div
            className="gantt-today-line"
            style={{ left: diffDays(range.min, today) * zoomConf.dayWidth + zoomConf.dayWidth / 2 - 1 }}
          />
        )}
      </div>
    </div>
  );
}

function PageHeader({ zoom, setZoom, onNewTask }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">Gantt timeline</h1>
        <p className="page-subtitle">Plan vs actual across all tasks with dates. Drag plan bars to adjust dates.</p>
      </div>
      <div className="page-actions">
        {ZOOMS.map((z) => (
          <button
            key={z.id}
            className={`chip ${zoom === z.id ? 'active' : ''}`}
            onClick={() => setZoom(z.id)}
          >{z.label}</button>
        ))}
        {onNewTask && (
          <button className="btn btn-primary btn-sm" onClick={onNewTask}>
            + New task
          </button>
        )}
      </div>
    </div>
  );
}

// Lightweight quick-add modal optimized for adding a task to the Gantt: title +
// project + phase + plan dates (the fields you actually need on a timeline).
function GanttQuickAdd({ projects, projectFilter, onClose }) {
  const { userId } = useAuth();
  const [title, setTitle]     = useState('');
  const [projectId, setProjectId] = useState(
    projectFilter !== 'all' ? projectFilter : (projects[0]?.id || '')
  );
  const [phaseId, setPhaseId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [planStart, setPlanStart] = useState(todayLocal());
  const [planEnd, setPlanEnd]     = useState(todayLocal());
  const [saving, setSaving] = useState(false);

  const project = projects.find((p) => p.id === projectId);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await addTask(userId, {
        title: title.trim(),
        category: project?.name || 'Personal',
        projectId: projectId || null,
        phaseId:   phaseId   || null,
        priority,
        plan: { startDate: planStart || null, endDate: planEnd || null },
      });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save task. Check console.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3 className="modal-title">New task</h3>
        <p className="modal-sub">Add a task directly to the timeline.</p>

        <div className="field">
          <label className="label">Title</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) save(); }}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">Project</label>
            <select className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPhaseId(''); }}>
              <option value="">— None —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Phase</label>
            <select className="select" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} disabled={!project}>
              <option value="">— None —</option>
              {project?.phases?.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">Plan start</label>
            <input type="date" className="input" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Plan end</label>
            <input type="date" className="input" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label className="label">Priority</label>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add task'}
          </button>
        </div>
      </div>
    </div>
  );
}
