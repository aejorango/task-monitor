// src/components/CalendarView.jsx — month grid with drag-to-reschedule.

import { useState, useMemo } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
} from '@dnd-kit/core';
import { useTasks, useProjects, useAuth } from '../hooks/useTasks';
import { useSettings } from '../hooks/useSettings';
import { updateTask } from '../services/firebase';
import TaskEditor from './TaskEditor';
import TaskActivitiesModal from './TaskActivitiesModal';
import TaskQuickAdd from './TaskQuickAdd';

function parseISO(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DAY = 24 * 60 * 60 * 1000;

export default function CalendarView({ projectFilter }) {
  const { tasks, loading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { settings } = useSettings();
  const weekStart = settings.weekStart ?? 1;

  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const { userId } = useAuth();
  const [activeDrag, setActiveDrag] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'todo' | 'doing' | 'done'
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const filtered = useMemo(() => {
    return tasks
      .filter((t) => projectFilter === 'all' || t.projectId === projectFilter)
      .filter((t) => statusFilter === 'all' || t.status === statusFilter);
  }, [tasks, projectFilter, statusFilter]);

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
  // dayIndex: 0=Sun..6=Sat. Build labels in week-start order, each tagged
  // with whether it falls on a weekend.
  const orderedDayInfo = Array.from({ length: 7 }, (_, i) => {
    const idx = (weekStart + i) % 7;
    return { label: dayLabels[idx], idx, isWeekend: idx === 0 || idx === 6 };
  });

  const onDragStart = (e) => {
    const t = filtered.find((x) => x.id === e.active.id);
    setActiveDrag(t);
  };

  const onDragEnd = async (e) => {
    setActiveDrag(null);
    const taskId  = e.active.id;
    const newDate = e.over?.id;
    if (!newDate) return;
    const task = filtered.find((t) => t.id === taskId);
    if (!task) return;
    const oldEnd = task.plan?.endDate;
    if (!oldEnd || oldEnd === newDate) return;

    // Compute date delta in days. If a startDate exists, shift it by the same amount
    // to preserve the duration.
    const updates = { 'plan.endDate': newDate };
    if (task.plan?.startDate) {
      const delta = Math.round((parseISO(newDate) - parseISO(oldEnd)) / DAY);
      const newStart = new Date(parseISO(task.plan.startDate));
      newStart.setDate(newStart.getDate() + delta);
      updates['plan.startDate'] = iso(newStart);
    }
    try { await updateTask(task.id, updates); }
    catch (err) {
      console.error('Could not reschedule task:', err);
      alert('Could not reschedule task. Check console.');
    }
  };

  if (loading) return <p className="muted">Loading calendar…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">Tasks placed on their <strong>plan end date</strong>. Click to edit; drag to reschedule.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={prev}>‹</button>
          <button className="btn btn-sm" onClick={goToday}>Today</button>
          <button className="btn btn-sm" onClick={next}>›</button>
          <span className="muted" style={{ marginLeft: 8 }}>{monthLabel}</span>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={() => setQuickAddOpen(true)}>
            + New task
          </button>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
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
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="calendar">
          <div className="cal-header">
            {orderedDayInfo.map((d) => (
              <div key={d.label} className={`cal-day-label ${d.isWeekend ? 'weekend' : ''}`}>{d.label}</div>
            ))}
          </div>
          <div className="cal-grid">
            {grid.map((d, i) => {
              const dateStr = iso(d);
              const inMonth = d.getMonth() === cursorMonth;
              const isToday = dateStr === today;
              const dayOfWeek = d.getDay();
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
              const dayTasks = tasksByDate[dateStr] || [];
              return (
                <CalCell
                  key={i}
                  dateStr={dateStr}
                  inMonth={inMonth}
                  isToday={isToday}
                  isWeekend={isWeekend}
                  dayNum={d.getDate()}
                  dayTasks={dayTasks}
                  projectById={projectById}
                  onTaskClick={setViewing}
                />
              );
            })}
          </div>
        </div>

        <DragOverlay>
          {activeDrag ? (
            <button
              className="cal-task"
              style={{
                background: projectById[activeDrag.projectId]?.color || 'var(--c-text-3)',
                opacity: 0.85,
              }}
            >{activeDrag.title}</button>
          ) : null}
        </DragOverlay>
      </DndContext>

      {viewing && !editing && (
        <TaskActivitiesModal
          task={viewing}
          userId={userId}
          onClose={() => setViewing(null)}
          onEditTask={(t) => setEditing(t)}
        />
      )}

      {editing && (
        <TaskEditor
          task={editing}
          projects={projects}
          onClose={() => { setEditing(null); setViewing(null); }}
        />
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

function CalCell({ dateStr, inMonth, isToday, isWeekend, dayNum, dayTasks, projectById, onTaskClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });
  return (
    <div
      ref={setNodeRef}
      className={`cal-cell ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''} ${isOver ? 'drag-over' : ''}`}
    >
      <div className="cal-cell-head">
        <span className="cal-cell-num">{dayNum}</span>
        {dayTasks.length > 3 && <span className="muted small">{dayTasks.length} tasks</span>}
      </div>
      <div className="cal-cell-tasks">
        {dayTasks.slice(0, 3).map((t) => (
          <DraggableCalTask key={t.id} task={t} project={projectById[t.projectId]} onClick={() => onTaskClick(t)} />
        ))}
        {dayTasks.length > 3 && (
          <button className="cal-more" onClick={() => onTaskClick(dayTasks[3])}>
            +{dayTasks.length - 3} more
          </button>
        )}
      </div>
    </div>
  );
}

function DraggableCalTask({ task, project, onClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cal-task ${task.status === 'done' ? 'done' : ''}`}
      style={{
        background: project?.color || 'var(--c-text-3)',
        opacity: isDragging ? 0.3 : (task.status === 'done' ? 0.55 : 1),
        touchAction: 'none',
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${task.title}${project ? ` (${project.name})` : ''}`}
    >
      {task.title}
    </button>
  );
}
