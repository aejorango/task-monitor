// src/components/WorkloadView.jsx — Board → Workload.
//
// People down the side, the next six weeks across the top, every cell showing
// what that person is carrying that week and how full it makes them. Drag a
// task to another week to move its deadline, or to another person to hand it
// over — which is the whole point: see the pile-up and fix it before the
// deadline slips.
//
// The arithmetic and the meaning of a drop are in the pure services/workload.js.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { useProjects, useTasks, useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { useSettings } from '../hooks/useSettings';
import { applyTaskMove } from '../services/firebase';
import { friendlyError } from '../services/access';
import { memberLabel } from '../services/invites';
import { shiftWeek } from '../services/timesheet';
import { todayLocal } from '../services/recurrence';
import {
  LOAD_LABEL, WEEKS_AHEAD,
  buildWorkload, cellId, describeCell, describeMove, moveTaskPlan, parseCellId, planningWeeks,
} from '../services/workload';
import { useToast } from './Toast';
import TaskEditor from './TaskEditor';

export default function WorkloadView({ projectFilter = 'all' }) {
  const { tasks, loading } = useTasks();
  const { byId: projectById } = useProjects();
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const { settings } = useSettings();
  const toast = useToast();

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const members = useMemo(() => workspace?.members || [], [workspace]);
  const memberProfiles = useMemo(() => workspace?.memberProfiles || {}, [workspace]);

  const [from, setFrom] = useState(todayLocal());
  const [dragging, setDragging] = useState(null);
  const [editing, setEditing] = useState(null);

  const weekStart = settings?.weekStart ?? 1;
  const weeks = useMemo(
    () => planningWeeks({ from, count: WEEKS_AHEAD, weekStart }),
    [from, weekStart],
  );

  const visible = useMemo(
    () => (projectFilter === 'all' ? tasks : tasks.filter((t) => t.projectId === projectFilter)),
    [tasks, projectFilter],
  );

  const { rows, unscheduled, byWeekTotals } = useMemo(
    () => buildWorkload(visible, { weeks, members, memberProfiles }),
    [visible, weeks, members, memberProfiles],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const move = async (task, target) => {
    const patch = moveTaskPlan(task, target);
    if (!patch) return;   // dropped where it already was
    try {
      await applyTaskMove(task, patch, {
        byUserId: userId,
        byName: memberLabel(userId, memberProfiles),
      });
      toast.success(describeMove(patch, memberProfiles));
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not move that task.'));
    }
  };

  const onDragEnd = async ({ active, over }) => {
    setDragging(null);
    const where = parseCellId(over?.id);
    if (!where) return;
    const task = visible.find((t) => t.id === active.id);
    if (!task) return;
    await move(task, {
      toUserId: where.userId,
      toWeek: weeks.find((w) => w.key === where.weekKey) || null,
    });
  };

  if (loading) return <p className="muted">Loading the plan…</p>;

  return (
    <div className="workload-view">
      <div className="page-head">
        <div>
          <h1 className="page-title">Workload</h1>
          <p className="muted small" style={{ margin: 0 }}>
            What everybody is carrying, week by week. Drag a task to another week to
            move its deadline, or to another person to hand it over.
          </p>
        </div>
        <div className="workload-nav">
          <button className="btn btn-sm" onClick={() => setFrom(shiftWeek(from, -1, weekStart))}>
            ← Earlier
          </button>
          <button className="btn btn-sm" onClick={() => setFrom(todayLocal())}>This week</button>
          <button className="btn btn-sm" onClick={() => setFrom(shiftWeek(from, 1, weekStart))}>
            Later →
          </button>
        </div>
      </div>

      <p className="muted small workload-key">
        {['free', 'ok', 'full', 'over'].map((level) => (
          <span key={level} className="workload-key-item">
            <span className={`workload-swatch is-${level}`} aria-hidden="true" />
            {LOAD_LABEL[level]}
          </span>
        ))}
      </p>

      {rows.length === 0 ? (
        <p className="muted">
          Nobody to plan for yet. Invite people to this workspace in Settings → Workspaces,
          and give tasks a due date so they show up here.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={({ active }) => setDragging(visible.find((t) => t.id === active.id) || null)}
          onDragCancel={() => setDragging(null)}
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
                      <WorkloadCell
                        key={week.key}
                        row={row}
                        week={week}
                        cell={row.cells[week.key]}
                        projectById={projectById}
                        onOpen={setEditing}
                      />
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
      )}

      {unscheduled.length > 0 && (
        <section className="workload-unscheduled">
          <h2 className="review-h2">No due date yet ({unscheduled.length})</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            These cannot be planned until somebody says when they are due. Open one to set a date.
          </p>
          <ul className="workload-unscheduled-list">
            {unscheduled.map((task) => (
              <li key={task.id}>
                <button type="button" className="workload-chip" onClick={() => setEditing(task)}>
                  {task.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WorkloadCell({ row, week, cell, projectById, onOpen }) {
  const id = cellId(row.userId, week.key);
  const { setNodeRef, isOver } = useDroppable({ id });
  const description = describeCell(row, week, cell);

  return (
    <td
      ref={setNodeRef}
      className={`workload-cell is-${cell.level} ${isOver ? 'is-drop-target' : ''}`}
      title={description}
      aria-label={description}
    >
      {cell.tasks.length === 0 ? (
        <span className="workload-empty" aria-hidden="true">—</span>
      ) : (
        <>
          <span className="workload-hours">{cell.hours}h</span>
          <ul className="workload-cell-list">
            {cell.tasks.map((task) => (
              <li key={task.id}>
                <WorkloadChip task={task} projectById={projectById} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </>
      )}
    </td>
  );
}

function WorkloadChip({ task, projectById, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const project = projectById[task.projectId];

  // The whole chip is the drag handle AND the way into the task — it is too
  // small to hold both a handle and a button. A click that never moved opens
  // the task; a click that arrives at the end of a drag does not.
  const dragged = useRef(false);
  useEffect(() => { if (isDragging) dragged.current = true; }, [isDragging]);

  const open = () => {
    if (dragged.current) { dragged.current = false; return; }
    onOpen(task);
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`workload-chip ${isDragging ? 'is-dragging' : ''}`}
      style={project?.color ? { borderLeftColor: project.color } : undefined}
      onClick={open}
      title={`${task.title} — drag to move it, click to open it`}
      {...listeners}
      {...attributes}
    >
      {task.title}
    </button>
  );
}

