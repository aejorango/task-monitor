// dev/my-week.jsx — dev-only harness for My Week.
//
// The real bucketing and the real drop arithmetic, with tasks from three
// pretend workspaces and no Firebase: a drop is applied locally and logged, so
// the grid, the rails and the week navigation can be used for real.
//
// Open: http://localhost:5173/dev/my-week.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable,
  useSensor, useSensors,
} from '@dnd-kit/core';
import { buildMyWeek, clampOffset, weekTitle } from '../src/services/myWeek';
import { moveTaskToDay, DAY_UNSCHEDULED } from '../src/services/workload';
import { todayLocal, addDaysISO } from '../src/services/recurrence';
import '../src/App.css';

const ACE = 'u-ace';
const WORKSPACES = [
  { id: 'ws-1', name: 'BRIDGED', color: '#0051BA' },
  { id: 'ws-2', name: 'AIM', color: '#7B2D8F' },
  { id: 'ws-3', name: 'Personal', color: '#1DA449' },
];
const T = todayLocal();
const at = (n) => addDaysISO(T, n);

const SAMPLE = [
  { id: 't1', title: 'Reconcile the September ledger', priority: 'high', workspaceId: 'ws-1', plan: { startDate: at(-2), endDate: at(0) } },
  { id: 't2', title: 'Board pack', priority: 'medium', workspaceId: 'ws-1', plan: { endDate: at(1) } },
  { id: 't3', title: 'Policy review', priority: 'low', workspaceId: 'ws-2', plan: { endDate: at(2) } },
  { id: 't4', title: 'Partner onboarding', priority: 'high', workspaceId: 'ws-2', plan: { endDate: at(3) } },
  { id: 't5', title: 'Renew the domain', priority: 'low', workspaceId: 'ws-3', plan: { endDate: at(4) } },
  { id: 't6', title: 'Weekend site visit', priority: 'medium', workspaceId: 'ws-1', plan: { endDate: at(5) } },
  { id: 't7', title: 'Filed already', priority: 'low', status: 'done', workspaceId: 'ws-2', plan: { endDate: at(0) } },
  { id: 't8', title: 'Archive cleanup', priority: 'low', workspaceId: 'ws-3', plan: {} },
  { id: 't9', title: 'Someday: rewrite the deck', priority: 'medium', workspaceId: 'ws-1', plan: {} },
  { id: 't10', title: 'Overdue compliance memo', priority: 'high', workspaceId: 'ws-2', plan: { endDate: at(-9) } },
].map((t) => ({ status: 'todo', actual: {}, assignedTo: [ACE], ...t }));

const PRIORITY_DOT = { high: 'var(--c-danger)', medium: 'var(--c-amber)', low: 'var(--c-emerald)' };

function Card({ task, overlay }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: overlay });
  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      className={`myweek-card${isDragging || overlay ? ' is-dragging' : ''}${task.status === 'done' ? ' is-done' : ''}`}
      {...(overlay ? {} : attributes)} {...(overlay ? {} : listeners)}
    >
      <div className="myweek-card-top">
        <span className="myweek-card-dot" style={{ background: PRIORITY_DOT[task.priority] }} aria-hidden="true" />
        <span className="myweek-card-title">{task.title}</span>
      </div>
      <div className="myweek-card-meta">
        <span className="myweek-card-ws" style={{ '--ws-color': task.workspaceColor }}>{task.workspaceName}</span>
        {task.status === 'done' && <span className="badge badge-soft-success">Done</span>}
      </div>
    </article>
  );
}

function Day({ day }) {
  const { setNodeRef, isOver } = useDroppable({ id: day.date });
  return (
    <section ref={setNodeRef} className={[
      'myweek-day', day.isToday ? 'is-today' : '', day.isWeekend ? 'is-weekend' : '',
      isOver ? 'is-drop-target' : '',
    ].filter(Boolean).join(' ')}>
      <header className="myweek-day-head">
        <span className="myweek-day-name">{day.label.weekday}</span>
        <span className="myweek-day-date">{day.label.date}</span>
        {day.tasks.length > 0 && <span className="myweek-day-count">{day.tasks.length}</span>}
      </header>
      <div className="myweek-day-body">
        {day.tasks.length === 0
          ? <p className="myweek-day-empty">—</p>
          : day.tasks.map((t) => <Card key={t.id} task={t} />)}
      </div>
    </section>
  );
}

function Rail({ id, title, hint, tasks, tone }) {
  const d = useDroppable({ id: id || '__none__', disabled: !id });
  return (
    <section ref={id ? d.setNodeRef : undefined} className={[
      'myweek-rail', tone ? `is-${tone}` : '', id && d.isOver ? 'is-drop-target' : '',
    ].filter(Boolean).join(' ')}>
      <header className="myweek-rail-head">
        <span className="myweek-rail-title">{title}</span>
        <span className="myweek-rail-count">{tasks.length}</span>
      </header>
      <p className="myweek-rail-hint">{hint}</p>
      <div className="myweek-rail-body">
        {tasks.length === 0 ? <p className="myweek-day-empty">Nothing here.</p>
          : tasks.map((t) => <Card key={t.id} task={t} />)}
      </div>
    </section>
  );
}

function Harness() {
  const [tasks, setTasks] = useState(SAMPLE);
  const [offset, setOffset] = useState(0);
  const [weekStart, setWeekStart] = useState(1);
  const [dragging, setDragging] = useState(null);
  const [log, setLog] = useState([]);

  const week = useMemo(
    () => buildMyWeek({ tasks, userId: ACE, workspaces: WORKSPACES, today: T, weekStart, offset }),
    [tasks, weekStart, offset],
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  const onDragEnd = ({ active, over }) => {
    setDragging(null);
    if (!over) return;
    const task = byId[active.id];
    const patch = moveTaskToDay(task, over.id);
    if (!patch) return;
    setTasks((list) => list.map((t) => (t.id !== task.id ? t : {
      ...t,
      plan: {
        startDate: 'plan.startDate' in patch ? patch['plan.startDate'] : t.plan.startDate,
        endDate: patch['plan.endDate'],
      },
    })));
    setLog((l) => [{
      at: new Date().toLocaleTimeString(), title: task.title, patch: JSON.stringify(patch),
    }, ...l].slice(0, 8));
  };

  return (
    <div style={{ padding: 20 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Week</h1>
          <p className="page-subtitle">Today is {T}. Drag a card to another day, or onto “No date yet”.</p>
        </div>
        <div className="page-actions myweek-nav">
          <button className="btn btn-sm" onClick={() => setOffset((o) => clampOffset(o - 1))} aria-label="The week before this one">←</button>
          <span className="myweek-title">{weekTitle(week.week, T)}</span>
          <button className="btn btn-sm" onClick={() => setOffset((o) => clampOffset(o + 1))} aria-label="The week after this one">→</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setWeekStart((w) => (w === 1 ? 0 : 1))}>
            Week starts {weekStart === 1 ? 'Monday' : 'Sunday'}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setDragging(byId[active.id] || null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="myweek-rails">
          <Rail id={DAY_UNSCHEDULED} title="No date yet" hint="Drag one onto a day to schedule it" tasks={week.unscheduled} />
          {week.overdue.length > 0 && (
            <Rail id={null} title="Still open from before" hint="Overdue — drag one onto a day to give it a new date" tasks={week.overdue} tone="danger" />
          )}
        </div>
        <div className="myweek-grid">
          {week.days.map((d) => <Day key={d.date} day={d} />)}
        </div>
        <DragOverlay>{dragging && <Card task={dragging} overlay />}</DragOverlay>
      </DndContext>

      <h2 style={{ fontSize: 14, marginTop: 24 }}>What each drop wrote</h2>
      {log.length === 0 ? <p className="muted small">Nothing yet.</p> : (
        <table className="table">
          <thead><tr><th>At</th><th>Task</th><th>Patch</th></tr></thead>
          <tbody>{log.map((r, i) => (
            <tr key={i}><td>{r.at}</td><td>{r.title}</td><td><code>{r.patch}</code></td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
