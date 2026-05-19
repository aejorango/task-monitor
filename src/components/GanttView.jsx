// src/components/GanttView.jsx — SVG-free Gantt with draggable plan bars.
// Three drag handles per plan bar:
//   - left edge  (resize start)
//   - right edge (resize end)
//   - middle     (move whole bar)

import { useState, useMemo, useRef, useEffect } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { todayLocal, updateTask } from '../services/firebase';

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
  const { tasks, loading } = useTasks();
  const { byId: projectById } = useProjects();
  const [zoom, setZoom] = useState('day');
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
    let min = parseDate(todayLocal());
    let max = parseDate(todayLocal());
    rows.forEach((t) => {
      const dates = [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]
        .map(parseDate).filter(Boolean);
      dates.forEach((d) => {
        if (d < min) min = d;
        if (d > max) max = d;
      });
    });
    min = addDays(min, -3);
    max = addDays(max, 3);
    return { min, max, total: diffDays(min, max) + 1 };
  }, [rows]);

  const today = parseDate(todayLocal());

  if (loading) return <p className="muted">Loading Gantt…</p>;

  if (rows.length === 0) {
    return (
      <>
        <PageHeader zoom={zoom} setZoom={setZoom} />
        <div className="empty-state">
          <div className="empty-state-icon">▭</div>
          <p>No tasks with plan or actual dates yet.</p>
          <p className="small">Add plan start/end dates to your tasks to see them on the Gantt.</p>
        </div>
      </>
    );
  }

  const totalWidth = range.total * zoomConf.dayWidth;
  const labelWidth = 240;
  const rowHeight  = 40;
  const headerHeight = 33;

  // Index rows for arrow computation
  const rowIndex = new Map();
  rows.forEach((t, i) => rowIndex.set(t.id, i));

  // Compute dependency arrows: from end of dep's plan bar to start of this task's plan bar.
  // Coordinates are relative to the SVG which sits over the track area only (so x is in the
  // task time-range coordinate space; y indexes rows including the header row).
  const arrows = [];
  rows.forEach((t) => {
    const depIds = t.dependsOn || [];
    const myPlanStart = parseDate(t.plan?.startDate);
    if (!myPlanStart) return;
    const myIdx = rowIndex.get(t.id);
    const toX = diffDays(range.min, myPlanStart) * zoomConf.dayWidth;
    const toY = headerHeight + myIdx * rowHeight + rowHeight / 2;

    depIds.forEach((depId) => {
      const dep = rows.find((r) => r.id === depId);
      if (!dep) return;  // dep not in current filter/view
      const depPlanEnd = parseDate(dep.plan?.endDate);
      if (!depPlanEnd) return;
      const depIdx = rowIndex.get(depId);
      const fromX = (diffDays(range.min, depPlanEnd) + 1) * zoomConf.dayWidth;
      const fromY = headerHeight + depIdx * rowHeight + rowHeight / 2;
      arrows.push({ id: `${depId}->${t.id}`, fromX, fromY, toX, toY });
    });
  });

  const dayHeaders = [];
  for (let i = 0; i < range.total; i++) {
    const d = addDays(range.min, i);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = fmtDate(d) === fmtDate(today);
    dayHeaders.push({ d, isWeekend, isToday, label: fmtShort(d, zoom) });
  }

  return (
    <>
      <PageHeader zoom={zoom} setZoom={setZoom} />

      <div className="gantt" style={{ '--gantt-day-w': `${zoomConf.dayWidth}px`, position: 'relative' }}>
        <div className="gantt-row header" style={{ gridTemplateColumns: `${labelWidth}px ${totalWidth}px` }}>
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

        {/* Dependency arrows overlay (positioned over the track area only) */}
        {arrows.length > 0 && (
          <svg
            className="gantt-arrows"
            width={totalWidth}
            height={headerHeight + rows.length * rowHeight}
            style={{
              position: 'absolute',
              top: 0,
              left: labelWidth,
              pointerEvents: 'none',
            }}
          >
            <defs>
              <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-text-3)" />
              </marker>
            </defs>
            {arrows.map((a) => {
              // Elbow path: from end of dep bar, jog down/up halfway, jog right to start of this bar.
              const midX = (a.fromX + a.toX) / 2;
              return (
                <path
                  key={a.id}
                  d={`M ${a.fromX} ${a.fromY} L ${midX} ${a.fromY} L ${midX} ${a.toY} L ${a.toX - 4} ${a.toY}`}
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

        {rows.map((t) => (
          <GanttRow
            key={t.id}
            task={t}
            project={projectById[t.projectId]}
            range={range}
            zoomConf={zoomConf}
            totalWidth={totalWidth}
            labelWidth={labelWidth}
            today={today}
          />
        ))}
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <span className="small muted">Legend:</span>
        <span className="badge" style={{ background: 'var(--c-doing)', color: 'white', opacity: 0.5 }}>Plan (draggable)</span>
        <span className="badge" style={{ background: 'var(--c-done)', color: 'white' }}>Actual (done)</span>
        <span className="badge" style={{ background: 'var(--c-doing)', color: 'white' }}>Actual (in progress)</span>
        <span className="badge" style={{ background: 'var(--c-danger)', color: 'white' }}>Overdue</span>
        <span className="small muted" style={{ marginLeft: 8 }}>Drag plan bar edges to resize, middle to move.</span>
      </div>
    </>
  );
}

// ─── Individual row with draggable plan bar ────────────────────────────────

function GanttRow({ task, project, range, zoomConf, totalWidth, labelWidth, today }) {
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

  return (
    <div className="gantt-row" style={{ gridTemplateColumns: `${labelWidth}px ${totalWidth}px` }}>
      <div className="gantt-label">
        {project && <span className="proj-dot" style={{ background: project.color }} />}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
          {project && <span className="muted small" style={{ fontSize: 11 }}>{project.name}</span>}
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

function PageHeader({ zoom, setZoom }) {
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
      </div>
    </div>
  );
}
