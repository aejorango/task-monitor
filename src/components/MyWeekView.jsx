// src/components/MyWeekView.jsx — what I am doing this week, across everything.
//
// The one screen somebody who runs several workspaces can leave open all day
// (T-0131 / NEW-020). Seven day columns, an unscheduled rail to drag from and
// an overdue rail that will not let last week's work disappear. Every card says
// which workspace it came from, because the point is that they are mixed.
//
// The bucketing is `services/myWeek.js` and what a drop writes is
// `moveTaskToDay` in `services/workload.js` — the same module the Workload
// grid uses, so a drop means one thing in this app.

import { useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { useMyTasksAcrossWorkspaces } from '../hooks/useTasks';
import { useSettings } from '../hooks/useSettings';
import { updateTask, todayLocal } from '../services/firebase';
import { buildMyWeek, weekTitle, clampOffset, UNSCHEDULED } from '../services/myWeek';
import { moveTaskToDay, DAY_UNSCHEDULED } from '../services/workload';
import { friendlyError } from '../services/access';
import { useToast } from './Toast';
import TaskEditor from './TaskEditor';
import Icon from './Icon';

const PRIORITY_DOT = { high: 'var(--c-danger)', medium: 'var(--c-amber)', low: 'var(--c-emerald)' };

export default function MyWeekView() {
  const { tasks, loading, userId, workspaces } = useMyTasksAcrossWorkspaces();
  const { settings } = useSettings();
  const toast = useToast();

  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(null);
  const [dragging, setDragging] = useState(null);

  const today = todayLocal();
  const week = useMemo(
    () => buildMyWeek({
      tasks, userId, workspaces, today,
      weekStart: settings.weekStart, offset,
    }),
    [tasks, userId, workspaces, today, settings.weekStart, offset],
  );

  const sensors = useSensors(
    // A card is also a button — a drag has to travel before it counts as one,
    // or opening a task becomes impossible.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  const onDragEnd = async ({ active, over }) => {
    setDragging(null);
    if (!over) return;
    const task = byId[active.id];
    const patch = moveTaskToDay(task, over.id);
    if (!patch) return;
    try {
      await updateTask(task.id, patch);
    } catch (err) {
      console.error('[my-week] reschedule failed:', err);
      toast.error(friendlyError(err, 'Could not move that task. Please try again.'));
    }
  };

  if (loading) return <p className="muted">Loading your week…</p>;

  const title = weekTitle(week.week, today);

  return (
    <div className="myweek">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Week</h1>
          <p className="page-subtitle">
            Everything assigned to you, from every workspace you are in. Drag a task
            to another day to move it.
          </p>
        </div>
        <div className="page-actions myweek-nav">
          <button
            className="btn btn-sm"
            onClick={() => setOffset((o) => clampOffset(o - 1))}
            aria-label="The week before this one"
          >←</button>
          <span className="myweek-title">{title}</span>
          <button
            className="btn btn-sm"
            onClick={() => setOffset((o) => clampOffset(o + 1))}
            aria-label="The week after this one"
          >→</button>
          {offset !== 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setOffset(0)}>Back to this week</button>
          )}
        </div>
      </div>

      {week.counts.total === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">☀</div>
          <p>Nothing is assigned to you {offset === 0 ? 'this week' : 'in that week'}.</p>
          <p className="small">
            Tasks show up here the moment somebody puts your name on one — in any
            workspace you belong to.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={({ active }) => setDragging(byId[active.id] || null)}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="myweek-rails">
            <Rail
              id={DAY_UNSCHEDULED}
              title="No date yet"
              hint="Drag one onto a day to schedule it"
              tasks={week.unscheduled}
              onOpen={setEditing}
            />
            {week.overdue.length > 0 && (
              <Rail
                id={null}
                title={`Still open from before ${week.counts.overdue > 0 ? `(${week.counts.overdue})` : ''}`}
                hint="Overdue — drag one onto a day to give it a new date"
                tasks={week.overdue}
                tone="danger"
                onOpen={setEditing}
              />
            )}
          </div>

          <div className="myweek-grid">
            {week.days.map((day) => (
              <DayColumn key={day.date} day={day} onOpen={setEditing} />
            ))}
          </div>

          <DragOverlay>
            {dragging && <TaskCard task={dragging} overlay />}
          </DragOverlay>
        </DndContext>
      )}

      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ── A day ─────────────────────────────────────────────────────────────── */

function DayColumn({ day, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: day.date });
  const { weekday, date } = day.label;
  return (
    <section
      ref={setNodeRef}
      className={[
        'myweek-day',
        day.isToday ? 'is-today' : '',
        day.isWeekend ? 'is-weekend' : '',
        isOver ? 'is-drop-target' : '',
      ].filter(Boolean).join(' ')}
      aria-label={`${weekday} ${date}${day.isToday ? ', today' : ''}, ${day.tasks.length} ${day.tasks.length === 1 ? 'task' : 'tasks'}`}
    >
      <header className="myweek-day-head">
        <span className="myweek-day-name">{weekday}</span>
        <span className="myweek-day-date">{date}</span>
        {day.tasks.length > 0 && (
          <span className="myweek-day-count">
            {day.done > 0 ? `${day.done}/${day.tasks.length}` : day.tasks.length}
          </span>
        )}
      </header>
      <div className="myweek-day-body">
        {day.tasks.length === 0
          ? <p className="myweek-day-empty" aria-hidden="true">—</p>
          : day.tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

/* ── A rail beside the week ────────────────────────────────────────────── */

function Rail({ id, title, hint, tasks, tone, onOpen }) {
  // The overdue rail has no id: you can drag OUT of it onto a day, but there is
  // nothing sensible about dropping a task back into "overdue".
  const droppable = useDroppable({ id: id || UNSCHEDULED, disabled: !id });
  return (
    <section
      ref={id ? droppable.setNodeRef : undefined}
      className={[
        'myweek-rail',
        tone ? `is-${tone}` : '',
        id && droppable.isOver ? 'is-drop-target' : '',
      ].filter(Boolean).join(' ')}
    >
      <header className="myweek-rail-head">
        <span className="myweek-rail-title">{title}</span>
        <span className="myweek-rail-count">{tasks.length}</span>
      </header>
      <p className="myweek-rail-hint">{hint}</p>
      <div className="myweek-rail-body">
        {tasks.length === 0
          ? <p className="myweek-day-empty">Nothing here.</p>
          : tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

/* ── A card ────────────────────────────────────────────────────────────── */

function TaskCard({ task, onOpen, overlay = false }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id, disabled: overlay,
  });
  const dragged = isDragging || overlay;

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      className={`myweek-card${dragged ? ' is-dragging' : ''}${task.status === 'done' ? ' is-done' : ''}`}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      // The card IS the drag handle and the button: an inner button small
      // enough to sit on a card this size makes it undraggable.
      onClick={() => { if (!overlay && !isDragging) onOpen?.(task); }}
    >
      <div className="myweek-card-top">
        <span
          className="myweek-card-dot"
          style={{ background: PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium }}
          aria-hidden="true"
        />
        <span className="myweek-card-title">{task.title}</span>
      </div>
      <div className="myweek-card-meta">
        <span
          className="myweek-card-ws"
          style={task.workspaceColor ? { '--ws-color': task.workspaceColor } : undefined}
        >
          <Icon name="projects" size={11} /> {task.workspaceName}
        </span>
        {task.status === 'done' && <span className="badge badge-soft-success">Done</span>}
      </div>
    </article>
  );
}
