// src/components/Board.jsx — Kanban with drag-and-drop between columns.

import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragOverlay,
} from '@dnd-kit/core';
import { useTasks, useProjects, useActivities } from '../hooks/useTasks';
import {
  setTaskStatus,
  softDeleteTask,
  addActivity,
  deleteActivity,
  todayLocal,
} from '../services/firebase';
import TaskForm from './TaskForm';
import TaskEditor from './TaskEditor';
import ActivityLogger from './ActivityLogger';

const COLUMNS = [
  { id: 'todo',  label: 'To Do' },
  { id: 'doing', label: 'In Progress' },
  { id: 'done',  label: 'Done' },
];

export default function Board({ projectFilter }) {
  const { tasks, loading, userId } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const [editingTask, setEditingTask] = useState(null);
  const [loggingTask, setLoggingTask]   = useState(null);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [activeDrag, setActiveDrag] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const filtered = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.projectId === projectFilter);

  if (loading) return <p className="muted">Loading tasks…</p>;
  if (!userId) return <p className="muted">Signing you in…</p>;

  const handleDragStart = (e) => {
    const task = filtered.find((t) => t.id === e.active.id);
    setActiveDrag(task);
  };

  const handleDragEnd = (e) => {
    setActiveDrag(null);
    const taskId = e.active.id;
    const overId = e.over?.id;
    if (!overId) return;
    const task = filtered.find((t) => t.id === taskId);
    if (!task) return;
    const targetStatus = COLUMNS.find((c) => c.id === overId)?.id;
    if (targetStatus && targetStatus !== task.status) {
      setTaskStatus(task, targetStatus);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Board</h1>
          <p className="page-subtitle">
            Drag cards across columns to update status.
            {projectFilter !== 'all' && projectById[projectFilter] && (
              <> Filtered to <strong>{projectById[projectFilter].name}</strong>.</>
            )}
          </p>
        </div>
      </div>

      <TaskForm projects={projects} projectFilter={projectFilter} />

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="board">
          {COLUMNS.map((col) => (
            <Column key={col.id} column={col}>
              {filtered
                .filter((t) => t.status === col.id)
                .map((task) => (
                  <DraggableCard
                    key={task.id}
                    task={task}
                    project={projectById[task.projectId]}
                    expanded={expandedTaskId === task.id}
                    onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                    onLog={() => setLoggingTask(task)}
                    onEdit={() => setEditingTask(task)}
                  />
                ))}
            </Column>
          ))}
        </div>

        <DragOverlay>
          {activeDrag ? <CardBody task={activeDrag} project={projectById[activeDrag.projectId]} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {loggingTask && (
        <ActivityLogger
          task={loggingTask}
          userId={userId}
          onClose={() => setLoggingTask(null)}
        />
      )}

      {editingTask && (
        <TaskEditor
          task={editingTask}
          projects={projects}
          onClose={() => setEditingTask(null)}
        />
      )}
    </>
  );
}

// ─── Column (droppable) ───────────────────────────────────────────────────

function Column({ column, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const count = Array.isArray(children) ? children.length : (children ? 1 : 0);
  return (
    <div ref={setNodeRef} className={`column ${isOver ? 'drag-over' : ''}`}>
      <div className="column-head">
        <span>{column.label}</span>
        <span className="count">{count}</span>
      </div>
      {children}
      {count === 0 && (
        <div style={{ padding: '20px 8px', fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'center' }}>
          Drop tasks here
        </div>
      )}
    </div>
  );
}

// ─── Draggable card ───────────────────────────────────────────────────────

function DraggableCard({ task, project, expanded, onToggleExpand, onLog, onEdit }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ touchAction: 'none' }}
    >
      <CardBody
        task={task}
        project={project}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onLog={onLog}
        onEdit={onEdit}
        dragging={isDragging}
      />
    </div>
  );
}

// ─── Card body (used by both real card + drag overlay) ────────────────────

function CardBody({ task, project, expanded, onToggleExpand, onLog, onEdit, dragging }) {
  const today = todayLocal();
  const isOverdue =
    task.status !== 'done' && task.plan?.endDate && task.plan.endDate < today;
  const finishedEarly =
    task.status === 'done' &&
    task.actual?.endDate && task.plan?.endDate &&
    task.actual.endDate < task.plan.endDate;
  const finishedLate =
    task.status === 'done' &&
    task.actual?.endDate && task.plan?.endDate &&
    task.actual.endDate > task.plan.endDate;

  return (
    <div className={`task-card ${dragging ? 'dragging' : ''} ${isOverdue ? 'overdue' : ''}`}>
      <div className="task-card-top">
        <p className="task-title">{task.title}</p>
        <span className={`priority-pill ${task.priority || 'medium'}`}>
          <span className="dot" />
        </span>
      </div>

      <div className="task-card-meta">
        {project && (
          <span className="proj-tag">
            <span className="proj-dot" style={{ background: project.color }} />
            {project.name}
          </span>
        )}
        {!project && task.category && (
          <span className="proj-tag">
            <span className="proj-dot" style={{ background: '#a1a1aa' }} />
            {task.category}
          </span>
        )}
        {isOverdue && <span className="badge badge-soft-danger">Overdue</span>}
        {finishedEarly && <span className="badge badge-soft-success">Done early</span>}
        {finishedLate && <span className="badge badge-soft-warn">Done late</span>}
      </div>

      {(task.plan?.startDate || task.plan?.endDate || task.actual?.startDate || task.actual?.endDate) && (
        <div className="task-card-dates">
          {(task.plan?.startDate || task.plan?.endDate) && (
            <div className="date-line">
              <strong>Plan</strong> <span>{task.plan?.startDate || '—'} → {task.plan?.endDate || '—'}</span>
            </div>
          )}
          {(task.actual?.startDate || task.actual?.endDate) && (
            <div className="date-line">
              <strong>Actual</strong> <span>{task.actual?.startDate || '—'} → {task.actual?.endDate || '—'}</span>
            </div>
          )}
        </div>
      )}

      <div className="task-card-footer">
        <div className="counters">
          <span>{task.activityCount || 0} log{task.activityCount === 1 ? '' : 's'}</span>
          <span>·</span>
          <span>{(task.totalHoursLogged || 0).toFixed(1)}h</span>
          {task.attachmentCount > 0 && (<><span>·</span><span>📎 {task.attachmentCount}</span></>)}
        </div>
        <div className="task-card-actions">
          <button className="btn btn-sm btn-ghost" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onLog && onLog(); }}>+ Log</button>
          <button className="btn btn-sm btn-ghost" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(); }}>{expanded ? 'Hide' : 'Log'}</button>
          <button className="btn btn-sm btn-ghost" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onEdit && onEdit(); }}>Edit</button>
        </div>
      </div>

      {expanded && <ActivityListInline taskId={task.id} />}
    </div>
  );
}

function ActivityListInline({ taskId }) {
  const { activities, loading } = useActivities(taskId);
  if (loading) return <p className="muted small">Loading log…</p>;
  if (activities.length === 0)
    return <p className="muted small" style={{ marginTop: 8 }}>No activity logged yet.</p>;
  return (
    <ul className="activity-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
      {activities.map((a) => (
        <li key={a.id} className="activity-item">
          <div className="activity-item-head">
            <strong className="mono small">{a.date}</strong>
            <span className="muted small">{a.hoursSpent || 0}h</span>
            {a.completionStatus && (
              <span className={`badge badge-soft-${
                a.completionStatus === 'completed' ? 'success' :
                a.completionStatus === 'blocked'   ? 'danger'  :
                a.completionStatus === 'in-progress' ? 'info'  : 'muted'
              }`}>{a.completionStatus}</span>
            )}
            <button
              className="link-danger"
              onClick={() => { if (confirm('Delete this log entry?')) deleteActivity(a); }}
            >✕</button>
          </div>
          {a.comment && <p className="activity-comment">{a.comment}</p>}
          {a.bottleneckRemarks && (
            <p className="activity-comment" style={{ color: 'var(--c-warn)', marginTop: 4 }}>
              ⚠ {a.bottleneckRemarks}
            </p>
          )}
          {a.requestedBy && (
            <p className="muted small" style={{ marginTop: 4 }}>
              Requested by: {a.requestedBy}
            </p>
          )}
          {a.attachments?.length > 0 && (
            <ul className="attachments">
              {a.attachments.map((att, i) => (
                <li key={i}>
                  <a href={att.url} target="_blank" rel="noreferrer">📎 {att.name || att.url}</a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
