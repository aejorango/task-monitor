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

import { useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { useMyTasksAcrossWorkspaces } from '../hooks/useTasks';
import { useMyWeek } from '../hooks/useMyWeek';
import { useSettings } from '../hooks/useSettings';
import { todayLocal } from '../services/firebase';
import { weekTitle, UNSCHEDULED } from '../services/myWeek';
import { DAY_UNSCHEDULED } from '../services/workload';
import { useToast } from './Toast';
import TaskEditor from './TaskEditor';
import Icon from './Icon';
import { PageActions, PageSubtitle } from './PageHeader';

const PRIORITY_DOT = { high: 'var(--c-danger)', medium: 'var(--c-amber)', low: 'var(--c-emerald)' };

export default function MyWeekView() {
  const { tasks, loading, userId, workspaces } = useMyTasksAcrossWorkspaces();
  const { settings } = useSettings();
  const toast = useToast();

  const [editing, setEditing] = useState(null);

  // The week, and what a drag inside it does. In the hook so a test can drive
  // it — this page needs a live workspace before it renders anything at all.
  const { week, offset, goToWeek, dragging, onDragStart, onDragEnd, onDragCancel } =
    useMyWeek({ tasks, userId, workspaces, weekStart: settings.weekStart, toast });

  const sensors = useSensors(
    // A card is also a button — a drag has to travel before it counts as one,
    // or opening a task becomes impossible.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  if (loading) return <p className="muted">Loading your week…</p>;

  const title = weekTitle(week.week, todayLocal());

  return (
    <div className="myweek">
      <PageSubtitle>Assigned to you, from every workspace you are in · drag a task to another day</PageSubtitle>
      <PageActions>
        <span className="myweek-nav">
          <button
            className="cmd"
            onClick={() => goToWeek((o) => o - 1)}
            aria-label="The week before this one"
          >←</button>
          <span className="myweek-title">{title}</span>
          <button
            className="cmd"
            onClick={() => goToWeek((o) => o + 1)}
            aria-label="The week after this one"
          >→</button>
        </span>
        {offset !== 0 && (
          <button className="cmd" onClick={() => goToWeek(0)}>Back to this week</button>
        )}
      </PageActions>

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
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
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
