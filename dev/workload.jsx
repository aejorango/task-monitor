// dev/workload.jsx — dev-only harness for the workload planner.
//
// The real grid, the real drag-and-drop, sample people and tasks, and no
// Firebase: dropping a task shows you the patch it would have written.
//
// Open: http://localhost:5173/dev/workload.html
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
import {
  LOAD_LABEL, buildWorkload, cellId, describeCell, describeMove, moveTaskPlan,
  parseCellId, planningWeeks,
} from '../src/services/workload';
import '../src/App.css';

const ACE = 'u-ace';
const MIA = 'u-mia';
const memberProfiles = {
  [ACE]: { displayName: 'Ace Jorango' },
  [MIA]: { displayName: 'Mia Santos' },
};
const weeks = planningWeeks({ from: '2026-09-16', count: 4, weekStart: 1 });

const SAMPLE = [
  { id: 'a', title: 'Disbursement report', assignedTo: [ACE], estimateHours: 30, plan: { endDate: '2026-09-18' } },
  { id: 'b', title: 'Board pack', assignedTo: [ACE], estimateHours: 20, plan: { startDate: '2026-09-15', endDate: '2026-09-17' } },
  { id: 'c', title: 'Policy review', assignedTo: [MIA], estimateHours: 8, plan: { endDate: '2026-09-23' } },
  { id: 'd', title: 'Vendor contract', assignedTo: [], estimateHours: 5, plan: { endDate: '2026-09-24' } },
  { id: 'e', title: 'Someday: archive cleanup', assignedTo: [ACE], plan: { endDate: null } },
];

function Harness() {
  const [tasks, setTasks] = useState(SAMPLE);
  const [dragging, setDragging] = useState(null);
  const [log, setLog] = useState([]);

  const { rows, unscheduled, byWeekTotals } = useMemo(
    () => buildWorkload(tasks, { weeks, members: [ACE, MIA], memberProfiles }),
    [tasks],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = ({ active, over }) => {
    setDragging(null);
    const where = parseCellId(over?.id);
    const task = tasks.find((t) => t.id === active.id);
    if (!where || !task) return;
    const target = { toUserId: where.userId, toWeek: weeks.find((w) => w.key === where.weekKey) };
    const patch = moveTaskPlan(task, target);
    if (!patch) { setLog((l) => [`“${task.title}” was already there — nothing written.`, ...l]); return; }
    setLog((l) => [`${describeMove(patch, memberProfiles)} (${JSON.stringify(patch)})`, ...l]);
    // Apply it locally, the way updateTask would.
    setTasks((cur) => cur.map((t) => (t.id !== task.id ? t : {
      ...t,
      assignedTo: patch.assignedTo ?? t.assignedTo,
      plan: {
        startDate: patch['plan.startDate'] ?? t.plan?.startDate ?? null,
        endDate: patch['plan.endDate'] ?? t.plan?.endDate ?? null,
      },
    })));
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h2>Workload harness</h2>
      <p className="muted small">
        The real grid and the real drag-and-drop. Nothing is written — each drop
        prints the patch it would have handed to updateTask.
      </p>

      <p className="muted small workload-key">
        {['free', 'ok', 'full', 'over'].map((level) => (
          <span key={level} className="workload-key-item">
            <span className={`workload-swatch is-${level}`} aria-hidden="true" />
            {LOAD_LABEL[level]}
          </span>
        ))}
      </p>

      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setDragging(tasks.find((t) => t.id === active.id) || null)}
        onDragEnd={onDragEnd}
      >
        <div className="workload-scroll">
          <table className="workload-grid">
            <thead>
              <tr>
                <th scope="col" className="workload-person-head">Person</th>
                {weeks.map((w) => (
                  <th scope="col" key={w.key}>
                    <span className="workload-week">{w.label}</span>
                    <span className="muted small workload-week-total">
                      {byWeekTotals[w.key] ? `${byWeekTotals[w.key]}h planned` : 'nothing planned'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <th scope="row" className="workload-person">
                    <span>{row.name}</span>
                    <span className="muted small">{row.total ? `${row.total}h in view` : 'nothing in view'}</span>
                  </th>
                  {weeks.map((week) => (
                    <Cell key={week.key} row={row} week={week} cell={row.cells[week.key]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DragOverlay>
          {dragging ? <span className="workload-chip is-dragging">{dragging.title}</span> : null}
        </DragOverlay>
      </DndContext>

      {unscheduled.length > 0 && (
        <section className="workload-unscheduled">
          <h2 className="review-h2">No due date yet ({unscheduled.length})</h2>
          <ul className="workload-unscheduled-list">
            {unscheduled.map((t) => (
              <li key={t.id}><span className="workload-chip">{t.title}</span></li>
            ))}
          </ul>
        </section>
      )}

      <section className="review-section" style={{ marginTop: 20 }}>
        <h2 className="review-h2-accent">What each drop would write</h2>
        {log.length === 0
          ? <p className="muted small">Drag a task onto another cell.</p>
          : <ul className="dep-list">{log.map((line, i) => (
            <li key={i} className="dep-item" style={{ gridTemplateColumns: '1fr' }}>
              <span className="mono small">{line}</span>
            </li>
          ))}</ul>}
      </section>
    </div>
  );
}

function Cell({ row, week, cell }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId(row.userId, week.key) });
  const description = describeCell(row, week, cell);
  return (
    <td
      ref={setNodeRef}
      className={`workload-cell is-${cell.level} ${isOver ? 'is-drop-target' : ''}`}
      title={description}
      aria-label={description}
    >
      {cell.tasks.length === 0 ? <span className="workload-empty">—</span> : (
        <>
          <span className="workload-hours">{cell.hours}h</span>
          <ul className="workload-cell-list">
            {cell.tasks.map((task) => <li key={task.id}><Chip task={task} /></li>)}
          </ul>
        </>
      )}
    </td>
  );
}

function Chip({ task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`workload-chip ${isDragging ? 'is-dragging' : ''}`}
      {...listeners}
      {...attributes}
    >
      {task.title}
    </button>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
