// src/components/AnalyticsView.jsx — burndown, velocity, cumulative flow,
// and workload. All charts are SVG, no library.
//
// Cumulative flow: stacked area of task counts by status across time.
// Burndown:        remaining open tasks per day within a window.
// Velocity:        tasks completed per ISO-week.
// Workload:        planned hours per project per week (stacked bars).

import { useState, useMemo } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { todayLocal } from '../services/firebase';

const RANGES = [
  { id: '14', label: '14 days', days: 14 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
];

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isoWeekKey(d) {
  // YYYY-Wnn (ISO week). Good enough for grouping.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date - firstThursday) / 86400000;
  const wk = 1 + Math.floor(diff / 7);
  return `${date.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export default function AnalyticsView({ projectFilter }) {
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const [rangeId, setRangeId] = useState('30');
  const range = RANGES.find((r) => r.id === rangeId);

  // Build the date series for the window.
  const todayStr = todayLocal();
  const today    = parseISO(todayStr);
  const dates    = useMemo(() => {
    const arr = [];
    for (let i = range.days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      arr.push(isoOf(d));
    }
    return arr;
  }, [range.days, todayStr]);

  const filtered = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.projectId === projectFilter);

  // Helper: status of a task as of a given date (best approximation from
  // createdAt + actual.startDate + actual.endDate).
  const statusOn = (task, dateStr) => {
    const created = task.createdAt?.toDate?.() ? isoOf(task.createdAt.toDate()) : null;
    if (created && dateStr < created) return null;  // task didn't exist yet
    if (task.actual?.endDate && dateStr >= task.actual.endDate) return 'done';
    if (task.actual?.startDate && dateStr >= task.actual.startDate) return 'doing';
    return 'todo';
  };

  // Cumulative-flow + burndown data.
  const cflow = useMemo(() => {
    return dates.map((d) => {
      let todoCount = 0, doingCount = 0, doneCount = 0;
      filtered.forEach((t) => {
        const s = statusOn(t, d);
        if (s === 'todo')  todoCount++;
        else if (s === 'doing') doingCount++;
        else if (s === 'done')  doneCount++;
      });
      return { date: d, todo: todoCount, doing: doingCount, done: doneCount };
    });
  }, [dates, filtered]);

  const maxStack = Math.max(1, ...cflow.map((c) => c.todo + c.doing + c.done));

  // Velocity: tasks completed per ISO-week within the window.
  const velocityByWeek = useMemo(() => {
    const m = {};
    filtered.forEach((t) => {
      if (!t.actual?.endDate) return;
      const d = parseISO(t.actual.endDate);
      if (!d) return;
      if (isoOf(d) < dates[0] || isoOf(d) > dates[dates.length - 1]) return;
      const key = isoWeekKey(d);
      m[key] = (m[key] || 0) + 1;
    });
    // Build ordered list of weeks present in the window
    const seen = new Set();
    const order = [];
    dates.forEach((ds) => {
      const k = isoWeekKey(parseISO(ds));
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    });
    return order.map((k) => ({ week: k, count: m[k] || 0 }));
  }, [filtered, dates]);
  const maxVelocity = Math.max(1, ...velocityByWeek.map((v) => v.count));

  // Workload: planned hours per project per week (stacked bars).
  // We approximate task duration as (planEnd - planStart + 1) days × 1h
  // unless task already has a totalHoursLogged > 0 (use that instead).
  // Allocation: spread the hours evenly across days the task spans, then
  // bucket by ISO-week.
  const workload = useMemo(() => {
    const byWeek = {};   // { weekKey: { projectId: hours } }
    const projHits = {}; // project name set for legend

    filtered.forEach((t) => {
      const planStart = parseISO(t.plan?.startDate);
      const planEnd   = parseISO(t.plan?.endDate);
      if (!planStart || !planEnd) return;
      const totalDays = Math.max(1, Math.round((planEnd - planStart) / 86400000) + 1);
      const totalHours = Math.max(1, t.totalHoursLogged || 1);  // floor at 1h
      const perDay = totalHours / totalDays;
      const proj = projectById[t.projectId];
      const name = proj?.name || t.category || 'Other';
      const color = proj?.color || '#a1a1aa';
      projHits[name] = color;

      for (let i = 0; i < totalDays; i++) {
        const d = new Date(planStart);
        d.setDate(d.getDate() + i);
        const ds = isoOf(d);
        if (ds < dates[0] || ds > dates[dates.length - 1]) continue;
        const wk = isoWeekKey(d);
        byWeek[wk] = byWeek[wk] || {};
        byWeek[wk][name] = (byWeek[wk][name] || 0) + perDay;
      }
    });

    // Build weeks in order
    const seen = new Set();
    const order = [];
    dates.forEach((ds) => {
      const k = isoWeekKey(parseISO(ds));
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    });

    const projectNames = Object.keys(projHits);
    const rows = order.map((wk) => ({
      week: wk,
      total: projectNames.reduce((s, n) => s + (byWeek[wk]?.[n] || 0), 0),
      byProject: projectNames.map((n) => ({
        name: n, color: projHits[n], hours: byWeek[wk]?.[n] || 0,
      })),
    }));
    const maxHours = Math.max(1, ...rows.map((r) => r.total));
    return { rows, projectNames, projColor: projHits, maxHours };
  }, [filtered, dates, projectById]);

  if (tasksLoading) return <p className="muted">Loading analytics…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">
            Burndown, velocity, cumulative flow, and workload.
            {projectFilter !== 'all' && projectById[projectFilter] && (
              <> Filtered to <strong>{projectById[projectFilter].name}</strong>.</>
            )}
          </p>
        </div>
        <div className="page-actions">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={`chip ${rangeId === r.id ? 'active' : ''}`}
              onClick={() => setRangeId(r.id)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {/* Burndown */}
      <section className="review-section">
        <h2 className="review-h2">Burndown — open tasks remaining</h2>
        <BurndownChart cflow={cflow} />
      </section>

      {/* Cumulative flow */}
      <section className="review-section">
        <h2 className="review-h2">Cumulative flow</h2>
        <CumulativeFlow cflow={cflow} maxStack={maxStack} />
        <div className="chart-legend">
          <span><span className="legend-swatch" style={{ background: 'var(--c-todo)' }} /> To do</span>
          <span><span className="legend-swatch" style={{ background: 'var(--c-doing)' }} /> Doing</span>
          <span><span className="legend-swatch" style={{ background: 'var(--c-done)' }} /> Done</span>
        </div>
      </section>

      {/* Velocity */}
      <section className="review-section">
        <h2 className="review-h2">Velocity — tasks done per week</h2>
        <VelocityChart velocity={velocityByWeek} maxVelocity={maxVelocity} />
      </section>

      {/* Workload */}
      <section className="review-section">
        <h2 className="review-h2">Workload — planned hours per week</h2>
        <WorkloadChart workload={workload} />
        {workload.projectNames.length > 0 && (
          <div className="chart-legend">
            {workload.projectNames.map((n) => (
              <span key={n}>
                <span className="legend-swatch" style={{ background: workload.projColor[n] }} /> {n}
              </span>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ─── Charts ──────────────────────────────────────────────────────────────

function CumulativeFlow({ cflow, maxStack }) {
  const w = 720, h = 200, pad = 24;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  const stepX = innerW / Math.max(1, cflow.length - 1);
  // We build three area paths: done (bottom), doing (mid), todo (top).
  const ys = cflow.map((c) => ({
    done:  c.done,
    doing: c.done + c.doing,
    todo:  c.done + c.doing + c.todo,
  }));
  const yScale = (v) => innerH - (v / maxStack) * innerH;
  const pathFromTop = (key) => {
    const top  = cflow.map((_, i) => `${pad + i * stepX},${pad + yScale(ys[i][key])}`);
    return `M${top.join(' L')} L${pad + innerW},${pad + innerH} L${pad},${pad + innerH} Z`;
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="200" preserveAspectRatio="none" style={{ display: 'block' }}>
      <path d={pathFromTop('todo')}  fill="var(--c-todo)"  opacity="0.55" />
      <path d={pathFromTop('doing')} fill="var(--c-doing)" opacity="0.85" />
      <path d={pathFromTop('done')}  fill="var(--c-done)" />
      <rect x={pad} y={pad} width={innerW} height={innerH} fill="none" stroke="var(--c-border)" />
    </svg>
  );
}

function BurndownChart({ cflow }) {
  const w = 720, h = 180, pad = 24;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  const open = cflow.map((c) => c.todo + c.doing);
  const max = Math.max(1, ...open);
  const stepX = innerW / Math.max(1, cflow.length - 1);
  const points = open.map((o, i) => `${pad + i * stepX},${pad + innerH - (o / max) * innerH}`).join(' ');
  // Ideal burndown reference line from start → end
  const startV = open[0] || 0;
  const idealStart = `${pad},${pad + innerH - (startV / max) * innerH}`;
  const idealEnd   = `${pad + innerW},${pad + innerH}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="180" preserveAspectRatio="none" style={{ display: 'block' }}>
      <rect x={pad} y={pad} width={innerW} height={innerH} fill="none" stroke="var(--c-border)" />
      <polyline points={`${idealStart} ${idealEnd}`} fill="none" stroke="var(--c-text-3)" strokeDasharray="3 3" />
      <polyline points={points} fill="none" stroke="var(--c-accent)" strokeWidth="2" />
    </svg>
  );
}

function VelocityChart({ velocity, maxVelocity }) {
  if (velocity.length === 0) {
    return <p className="muted small">No completed tasks in this window.</p>;
  }
  const barW = 100 / velocity.length;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: 160, gap: 2, padding: '4px 0' }}>
      {velocity.map((v) => (
        <div key={v.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="muted small mono" style={{ marginBottom: 4 }}>{v.count}</div>
          <div
            style={{
              width: '70%',
              height: `${(v.count / maxVelocity) * 100}%`,
              background: 'var(--c-done)',
              borderRadius: 3,
              minHeight: v.count > 0 ? 2 : 0,
            }}
            title={`${v.week}: ${v.count} done`}
          />
          <div className="muted small mono" style={{ marginTop: 4, fontSize: 10 }}>
            {v.week.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkloadChart({ workload }) {
  const { rows, maxHours } = workload;
  if (rows.length === 0) {
    return <p className="muted small">No tasks with plan dates in this window.</p>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: 180, gap: 2 }}>
      {rows.map((r) => {
        const totalH = (r.total / maxHours) * 100;
        return (
          <div key={r.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="muted small mono" style={{ marginBottom: 4 }}>{r.total.toFixed(0)}h</div>
            <div
              style={{
                width: '70%',
                height: `${totalH}%`,
                display: 'flex',
                flexDirection: 'column-reverse',
                borderRadius: 3,
                overflow: 'hidden',
                minHeight: r.total > 0 ? 4 : 0,
              }}
              title={r.byProject.map((p) => `${p.name}: ${p.hours.toFixed(1)}h`).join('\n')}
            >
              {r.byProject.map((p) => (
                p.hours > 0 ? (
                  <div key={p.name} style={{
                    background: p.color,
                    height: `${(p.hours / r.total) * 100}%`,
                  }} />
                ) : null
              ))}
            </div>
            <div className="muted small mono" style={{ marginTop: 4, fontSize: 10 }}>
              {r.week.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
