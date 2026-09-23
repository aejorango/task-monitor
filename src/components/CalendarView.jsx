// src/components/CalendarView.jsx — month grid with drag-to-reschedule.

import { useState, useMemo, useEffect } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
} from '@dnd-kit/core';
import { useTasks, useProjects, useAuth, useAllActivities } from '../hooks/useTasks';
import { tagFilterState } from '../services/tagFilter';
import { useSettings } from '../hooks/useSettings';
import { updateTask, todayLocal } from '../services/firebase';
import { scopeTasks, scopeOf, blockedTaskIds } from '../services/boardScope';
import { moveTaskToDay } from '../services/workload';
import TaskEditor from './TaskEditor';
import TaskQuickAdd from './TaskQuickAdd';
import { friendlyError } from '../services/access';
import { useToast } from './Toast';
import { PageActions, PageSubtitle } from './PageHeader';

// The date arithmetic a drop needs now lives in services/workload.js, so all
// this file still needs is a formatter for the grid it draws.
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarView({ projectFilter, initialTagFilter, route = {} }) {
  const toast = useToast();
  const { tasks, loading } = useTasks();
  const { activities: allActivities } = useAllActivities();
  const { projects, byId: projectById } = useProjects();
  const { settings } = useSettings();
  const weekStart = settings.weekStart ?? 1;

  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [editing, setEditing] = useState(null);
  const { userId } = useAuth();
  const [activeDrag, setActiveDrag] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' or one of TASK_STATUSES
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // A saved view stores the tag it was filtered by; the router hands it over
  // here. The audit believed this page already honoured it — it did not
  // (BUG-018), which is why the guard over App.jsx's props exists.
  const [tagFilter, setTagFilter] = useState(initialTagFilter || null);
  useEffect(() => { setTagFilter(initialTagFilter || null); }, [initialTagFilter]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const blockedIds = useMemo(() => blockedTaskIds(allActivities), [allActivities]);
  const inProject = useMemo(
    () => scopeTasks(
      tasks
        .filter((t) => projectFilter === 'all' || t.projectId === projectFilter)
        .filter((t) => statusFilter === 'all' || t.status === statusFilter),
      { scope: scopeOf(route), who: route.who, q: route.q, userId, blockedIds, today: todayLocal() },
    ),
    [tasks, projectFilter, statusFilter, route.onlyMine, route.stuckOnly, route.who, route.q, userId, blockedIds],
  );
  const tagState = useMemo(() => tagFilterState(inProject, tagFilter), [inProject, tagFilter]);
  const filtered = tagState.filtered;

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
    const newDate = e.over?.id;
    if (!newDate) return;
    const task = filtered.find((t) => t.id === e.active.id);
    // `moveTaskToDay` is the one place that decides what a drop on a day means
    // (T-0131). This used to be a second copy, and it returned early on a task
    // with no end date — so the tasks most in need of a day were exactly the
    // ones the calendar refused to give one.
    const updates = moveTaskToDay(task, newDate);
    if (!updates) return;
    try { await updateTask(task.id, updates); }
    catch (err) {
      console.error('Could not reschedule task:', err);
      toast.error(friendlyError(err, 'Could not reschedule task. Please try again.'));
    }
  };

  const monthName = cursor.toLocaleString('en', { month: 'long' });
  const monthYear = cursor.getFullYear();

  if (loading) return <p className="muted">Loading calendar…</p>;

  return (
    <>
      {/* The tag chip strip is gone from every page (T-0148). The filter is
          NOT — a saved view still applies it, so the page says so here and
          offers a way out. Dropping the strip and the filter both would make
          one saved view mean two different things (BUG-018). */}
      <PageSubtitle>
        {tagState?.active && (
          <>
            Filtered to <strong>#{tagState.active}</strong> ·{' '}
            <button className="table-link" onClick={() => setTagFilter(null)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
            >show all</button> ·{' '}
          </>
        )}
        Tasks on their <strong>plan end date</strong> · drag one to reschedule it
      </PageSubtitle>
      <PageActions>
        <button className="cmd cmd-primary" onClick={() => setQuickAddOpen(true)}>
          <span className="cmd-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </span>
          New task
        </button>
      </PageActions>


      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="bcard calendar">
        {/* The Board Explorer keeps the month, the arrows and Today inside the
            card, with what the grid is plotting spelled out on the right —
            "by due date", because a month grid that does not say which date it
            used is a month grid you have to guess at. */}
        <div className="cal-toolbar">
          <h2 className="cal-month-label">{monthName} <span className="accent">{monthYear}</span></h2>
          <button className="cal-nav-btn" onClick={prev} aria-label="Previous month">‹</button>
          <button className="cal-nav-btn" onClick={next} aria-label="Next month">›</button>
          <button className="cal-nav-today" onClick={goToday}>Today</button>
          <div className="cal-filter-group">
          {[
            { id: 'all',   label: 'All' },
            { id: 'todo',  label: 'To do' },
            { id: 'doing', label: 'Ongoing' },
            { id: 'review', label: 'In review' },
            { id: 'done',  label: 'Done' },
          ].map((s) => (
            <button
              key={s.id}
              className={`cal-filter-btn ${statusFilter === s.id ? 'active' : ''}`}
              onClick={() => setStatusFilter(s.id)}
            >{s.label}</button>
          ))}
          </div>
          <span className="cal-basis">by due date</span>
        </div>
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
                  onTaskClick={setEditing}
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

      {/* Clicking a task opens the EDITOR, not the read-only activity list.
          One click, one destination — the activity log is that editor's
          Activity tab now, so the list is not lost, it just stopped being
          a second modal in front of the thing you actually wanted. */}
      {editing && (
        <TaskEditor
          task={editing}
          projects={projects}
          onClose={() => setEditing(null)}
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
  const [expanded, setExpanded] = useState(false);
  const visibleTasks = expanded ? dayTasks : dayTasks.slice(0, 3);
  const hiddenCount = dayTasks.length - 3;
  return (
    <div
      ref={setNodeRef}
      className={`cal-cell ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''} ${isOver ? 'drag-over' : ''}`}
    >
      <div className="cal-cell-head">
        {isToday ? (
          <span className="cal-today-badge">
            <span className="cal-today-num">{dayNum}</span>
            <span className="cal-today-label">Today</span>
          </span>
        ) : (
          <span className="cal-cell-num">{dayNum}</span>
        )}
        {dayTasks.length > 3 && <span className="muted small">{dayTasks.length} tasks</span>}
      </div>
      <div className="cal-cell-tasks">
        {visibleTasks.map((t) => (
          <DraggableCalTask key={t.id} task={t} project={projectById[t.projectId]} onClick={() => onTaskClick(t)} />
        ))}
        {hiddenCount > 0 && (
          <button className="cal-more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `+${hiddenCount} more`}
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
      className={`cal-task cal-task-${task.status || 'todo'} ${task.status === 'done' ? 'done' : ''}`}
      style={{
        '--task-color': project?.color || 'var(--c-text-3)',
        opacity: isDragging ? 0.3 : 1,
        touchAction: 'none',
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${task.title}${project ? ` (${project.name})` : ''}`}
    >
      {task.title}
    </button>
  );
}
