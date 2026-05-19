// src/components/GanttView.jsx — SVG-free Gantt using CSS grid + absolute bars.

import { useState, useMemo } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { todayLocal } from '../services/firebase';

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
  const { projects, byId: projectById } = useProjects();
  const [zoom, setZoom] = useState('day');
  const zoomConf = ZOOMS.find((z) => z.id === zoom);

  // Filter to tasks that have at least a plan window OR an actual window,
  // and match project filter.
  const rows = useMemo(() => {
    return tasks
      .filter((t) => projectFilter === 'all' || t.projectId === projectFilter)
      .filter((t) => t.plan?.startDate || t.plan?.endDate || t.actual?.startDate || t.actual?.endDate);
  }, [tasks, projectFilter]);

  // Compute timeline range: from earliest start to latest end, padded by 3 days.
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

  // Build day headers
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

      <div className="gantt" style={{ '--gantt-day-w': `${zoomConf.dayWidth}px` }}>
        {/* Header row */}
        <div
          className="gantt-row header"
          style={{ gridTemplateColumns: `${labelWidth}px ${totalWidth}px` }}
        >
          <div className="gantt-label">Task</div>
          <div className="gantt-track" style={{ display: 'grid', gridTemplateColumns: `repeat(${range.total}, ${zoomConf.dayWidth}px)` }}>
            {dayHeaders.map((h, i) => (
              <div
                key={i}
                className={`gantt-day-header ${h.isWeekend ? 'weekend' : ''} ${h.isToday ? 'today' : ''}`}
              >
                {h.label}
              </div>
            ))}
          </div>
        </div>

        {/* Body rows */}
        {rows.map((t) => {
          const project = projectById[t.projectId];
          const planStart  = parseDate(t.plan?.startDate);
          const planEnd    = parseDate(t.plan?.endDate);
          const actStart   = parseDate(t.actual?.startDate);
          const actEnd     = parseDate(t.actual?.endDate);

          const planLeft  = planStart  ? diffDays(range.min, planStart) * zoomConf.dayWidth  : null;
          const planWidth = planStart && planEnd  ? (diffDays(planStart, planEnd) + 1) * zoomConf.dayWidth : null;

          const actLeft   = actStart   ? diffDays(range.min, actStart)  * zoomConf.dayWidth  : null;
          // If task is still in progress (no actual end), draw to today
          const actEndOrToday = actEnd || (t.status !== 'done' ? today : null);
          const actWidth  = actStart && actEndOrToday ? (diffDays(actStart, actEndOrToday) + 1) * zoomConf.dayWidth : null;

          const isOverdue = t.status !== 'done' && planEnd && planEnd < today;
          const isInProgress = t.status === 'doing';

          return (
            <div
              key={t.id}
              className="gantt-row"
              style={{ gridTemplateColumns: `${labelWidth}px ${totalWidth}px` }}
            >
              <div className="gantt-label">
                {project && <span className="proj-dot" style={{ background: project.color }} />}
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                  {project && <span className="muted small" style={{ fontSize: 11 }}>{project.name}</span>}
                </div>
              </div>
              <div className="gantt-track" style={{ height: 40, position: 'relative' }}>
                {/* day grid background */}
                <div className="gantt-day-grid" />

                {/* Plan bar */}
                {planLeft != null && planWidth != null && (
                  <div
                    className="gantt-bar plan"
                    style={{ left: planLeft, width: planWidth, background: project?.color || 'var(--c-doing)' }}
                    title={`Plan: ${t.plan?.startDate || '?'} → ${t.plan?.endDate || '?'}`}
                  >
                    {planWidth > 60 ? t.title : ''}
                  </div>
                )}

                {/* Actual bar */}
                {actLeft != null && actWidth != null && (
                  <div
                    className={`gantt-bar actual ${isOverdue ? 'overdue' : isInProgress ? 'in-progress' : ''}`}
                    style={{ left: actLeft, width: actWidth }}
                    title={`Actual: ${t.actual?.startDate || '?'} → ${t.actual?.endDate || 'in progress'}`}
                  />
                )}

                {/* Today line */}
                {today >= range.min && today <= range.max && (
                  <div
                    className="gantt-today-line"
                    style={{ left: diffDays(range.min, today) * zoomConf.dayWidth + zoomConf.dayWidth / 2 - 1 }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <span className="small muted">Legend:</span>
        <span className="badge" style={{ background: 'var(--c-doing)', color: 'white', opacity: 0.4 }}>Plan</span>
        <span className="badge" style={{ background: 'var(--c-done)', color: 'white' }}>Actual (done)</span>
        <span className="badge" style={{ background: 'var(--c-doing)', color: 'white' }}>Actual (in progress)</span>
        <span className="badge" style={{ background: 'var(--c-danger)', color: 'white' }}>Overdue</span>
      </div>
    </>
  );
}

function PageHeader({ zoom, setZoom }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">Gantt timeline</h1>
        <p className="page-subtitle">Plan vs actual across all tasks with dates. Plan is the faded bar, actual is the solid bar beneath.</p>
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
