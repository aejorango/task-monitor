// src/components/CalendarView.jsx — month grid with tasks on plan-end dates.

import { useState, useMemo } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { useSettings } from '../hooks/useSettings';
import TaskEditor from './TaskEditor';

function parseISO(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarView({ projectFilter }) {
  const { tasks, loading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { settings } = useSettings();
  const weekStart = settings.weekStart ?? 1;

  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => {
    return tasks.filter((t) => projectFilter === 'all' || t.projectId === projectFilter);
  }, [tasks, projectFilter]);

  // Build calendar grid for current cursor month (6 rows × 7 cols)
  const grid = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const dayOfWeek = firstOfMonth.getDay();
    const offset = (dayOfWeek - weekStart + 7) % 7;
    const start = new Date(firstOfMonth);
    start.setDate(1 - offset);
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [cursor, weekStart]);

  // Group tasks by their plan.endDate (the typical "due date").
  // Tasks without a plan.endDate are not shown.
  const tasksByDate = useMemo(() => {
    const map = {};
    filtered.forEach((t) => {
      if (!t.plan?.endDate) return;
      (map[t.plan.endDate] = map[t.plan.endDate] || []).push(t);
    });
    return map;
  }, [filtered]);

  const today = iso(new Date());
  const cursorMonth = cursor.getMonth();

  const prev = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const next = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const goToday = () => { const d = new Date(); d.setDate(1); setCursor(d); };

  const monthLabel = cursor.toLocaleString('en', { month: 'long', year: 'numeric' });
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const orderedDayLabels = [...dayLabels.slice(weekStart), ...dayLabels.slice(0, weekStart)];

  if (loading) return <p className="muted">Loading calendar…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">Tasks are placed on their <strong>plan end date</strong>. Click a task to edit.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={prev}>‹</button>
          <button className="btn btn-sm" onClick={goToday}>Today</button>
          <button className="btn btn-sm" onClick={next}>›</button>
          <span className="muted" style={{ marginLeft: 8 }}>{monthLabel}</span>
        </div>
      </div>

      <div className="calendar">
        <div className="cal-header">
          {orderedDayLabels.map((d) => (
            <div key={d} className="cal-day-label">{d}</div>
          ))}
        </div>
        <div className="cal-grid">
          {grid.map((d, i) => {
            const dateStr = iso(d);
            const inMonth = d.getMonth() === cursorMonth;
            const isToday = dateStr === today;
            const dayTasks = tasksByDate[dateStr] || [];
            return (
              <div key={i} className={`cal-cell ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''}`}>
                <div className="cal-cell-head">
                  <span className="cal-cell-num">{d.getDate()}</span>
                  {dayTasks.length > 3 && (
                    <span className="muted small">{dayTasks.length} tasks</span>
                  )}
                </div>
                <div className="cal-cell-tasks">
                  {dayTasks.slice(0, 3).map((t) => {
                    const proj = projectById[t.projectId];
                    return (
                      <button
                        key={t.id}
                        className={`cal-task ${t.status === 'done' ? 'done' : ''}`}
                        style={{
                          background: proj?.color || 'var(--c-text-3)',
                          opacity: t.status === 'done' ? 0.55 : 1,
                        }}
                        onClick={() => setEditing(t)}
                        title={`${t.title}${proj ? ` (${proj.name})` : ''}`}
                      >
                        {t.title}
                      </button>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <button className="cal-more" onClick={() => setEditing(dayTasks[3])}>
                      +{dayTasks.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <TaskEditor
          task={editing}
          projects={projects}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
