// src/components/Board.jsx — Kanban with drag-and-drop and optional phase swim-lanes.

import { useState, useEffect } from 'react';
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
import { useTimer } from '../hooks/useTimer';
import {
  setTaskStatus,
  updateTask,
  deleteActivity,
  todayLocal,
} from '../services/firebase';
import TaskForm from './TaskForm';
import TaskEditor from './TaskEditor';
import ActivityLogger from './ActivityLogger';
import ActivityEditor from './ActivityEditor';

const COLUMNS = [
  { id: 'todo',  label: 'To Do' },
  { id: 'doing', label: 'In Progress' },
  { id: 'done',  label: 'Done' },
];

const NO_PHASE_ID = '__nophase__';

export default function Board({ projectFilter, initialTagFilter, initialStatusFilter }) {
  const { tasks, loading, userId } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const [editingTask, setEditingTask]   = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [loggingTask, setLoggingTask]   = useState(null);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [activeDrag, setActiveDrag]     = useState(null);
  const [groupByPhase, setGroupByPhase] = useState(false);
  const [tagFilter, setTagFilter] = useState(initialTagFilter || null);

  // Sync local tag filter when URL-level filter changes (e.g. saved view loaded)
  useEffect(() => { setTagFilter(initialTagFilter || null); }, [initialTagFilter]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const projectFiltered = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.projectId === projectFilter);

  const tagFiltered = tagFilter
    ? projectFiltered.filter((t) => (t.tags || []).includes(tagFilter))
    : projectFiltered;
  const filtered = initialStatusFilter
    ? tagFiltered.filter((t) => t.status === initialStatusFilter)
    : tagFiltered;

  // All tags available across the (project-filtered) tasks, for the chip strip
  const availableTags = (() => {
    const set = new Set();
    projectFiltered.forEach((t) => (t.tags || []).forEach((tg) => set.add(tg)));
    return [...set].sort();
  })();

  if (loading) return <p className="muted">Loading tasks…</p>;
  if (!userId) return <p className="muted">Signing you in…</p>;

  const selectedProject = projectFilter !== 'all' ? projectById[projectFilter] : null;
  const phases = selectedProject?.phases || [];
  const canGroupByPhase = !!selectedProject && phases.length > 0;
  const showSwimLanes = groupByPhase && canGroupByPhase;

  const handleDragStart = (e) => {
    const task = filtered.find((t) => t.id === e.active.id);
    setActiveDrag(task);
  };

  const handleDragEnd = async (e) => {
    setActiveDrag(null);
    const taskId = e.active.id;
    const overId = e.over?.id;
    if (!overId) return;
    const task = filtered.find((t) => t.id === taskId);
    if (!task) return;

    // Drop target ids:
    //  - "todo" / "doing" / "done"               (no swim lanes)
    //  - "todo::<phaseId>" / etc.                (swim lanes; phaseId or NO_PHASE_ID)
    const [targetStatus, targetPhase] = String(overId).split('::');
    if (!COLUMNS.find((c) => c.id === targetStatus)) return;

    const statusChanged = targetStatus !== task.status;
    const phaseChanged  = targetPhase !== undefined &&
      ((targetPhase === NO_PHASE_ID && task.phaseId) ||
       (targetPhase !== NO_PHASE_ID && task.phaseId !== targetPhase));

    if (statusChanged) {
      await setTaskStatus(task, targetStatus);
    }
    if (phaseChanged) {
      await updateTask(task.id, { phaseId: targetPhase === NO_PHASE_ID ? null : targetPhase });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Board</h1>
          <p className="page-subtitle">
            Drag cards across columns to update status.
            {showSwimLanes && <> Drop into a phase row to also set the phase.</>}
            {projectFilter !== 'all' && projectById[projectFilter] && !showSwimLanes && (
              <> Filtered to <strong>{projectById[projectFilter].name}</strong>.</>
            )}
          </p>
        </div>
        <div className="page-actions">
          {canGroupByPhase && (
            <button
              className={`chip ${groupByPhase ? 'active' : ''}`}
              onClick={() => setGroupByPhase(!groupByPhase)}
              title="Show phase swim-lanes within each status column"
            >
              {groupByPhase ? '✓ ' : ''}Group by phase
            </button>
          )}
        </div>
      </div>

      {availableTags.length > 0 && (
        <div className="tag-filter-bar">
          <span className="small muted" style={{ marginRight: 4 }}>Tags:</span>
          <button
            className={`chip ${!tagFilter ? 'active' : ''}`}
            onClick={() => setTagFilter(null)}
          >All</button>
          {availableTags.map((tg) => (
            <button
              key={tg}
              className={`chip ${tagFilter === tg ? 'active' : ''}`}
              onClick={() => setTagFilter(tagFilter === tg ? null : tg)}
            >#{tg}</button>
          ))}
        </div>
      )}

      <TaskForm projects={projects} projectFilter={projectFilter} />

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board">
          {COLUMNS.map((col) => (
            <ColumnShell
              key={col.id}
              column={col}
              count={filtered.filter((t) => t.status === col.id).length}
            >
              {showSwimLanes ? (
                <SwimLanes
                  column={col}
                  phases={phases}
                  filtered={filtered}
                  projectById={projectById}
                  expandedTaskId={expandedTaskId}
                  setExpandedTaskId={setExpandedTaskId}
                  setLoggingTask={setLoggingTask}
                  setEditingTask={setEditingTask}
                  setEditingActivity={setEditingActivity}
                />
              ) : (
                <DroppableArea id={col.id}>
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
                        onEditActivity={(a) => setEditingActivity(a)}
                      />
                    ))}
                </DroppableArea>
              )}
            </ColumnShell>
          ))}
        </div>

        <DragOverlay>
          {activeDrag ? <CardBody task={activeDrag} project={projectById[activeDrag.projectId]} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {loggingTask && (
        <ActivityLogger task={loggingTask} userId={userId} onClose={() => setLoggingTask(null)} />
      )}
      {editingTask && (
        <TaskEditor task={editingTask} projects={projects} onClose={() => setEditingTask(null)} />
      )}
      {editingActivity && (
        <ActivityEditor activity={editingActivity} onClose={() => setEditingActivity(null)} />
      )}
    </>
  );
}

// ─── Column shell (header only) ───────────────────────────────────────────

function ColumnShell({ column, count, children }) {
  return (
    <div className="column">
      <div className="column-head">
        <span>{column.label}</span>
        <span className="count">{count}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Droppable area (no phase grouping) ───────────────────────────────────

function DroppableArea({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const count = Array.isArray(children) ? children.filter(Boolean).length : (children ? 1 : 0);
  return (
    <div ref={setNodeRef} className={`droppable ${isOver ? 'drag-over' : ''}`} style={{ minHeight: 80 }}>
      {children}
      {count === 0 && (
        <div style={{ padding: '20px 8px', fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'center' }}>
          Drop tasks here
        </div>
      )}
    </div>
  );
}

// ─── Swim-lanes: a status column subdivided by phase ──────────────────────

function SwimLanes({ column, phases, filtered, projectById, expandedTaskId, setExpandedTaskId, setLoggingTask, setEditingTask, setEditingActivity }) {
  const lanes = [
    ...phases.map((p) => ({ id: p.id, name: p.name })),
    { id: NO_PHASE_ID, name: 'No phase' },
  ];

  return (
    <div className="swim-lanes">
      {lanes.map((lane) => {
        const laneTasks = filtered.filter((t) =>
          t.status === column.id &&
          (lane.id === NO_PHASE_ID ? !t.phaseId : t.phaseId === lane.id)
        );
        return (
          <SwimLane key={lane.id} columnId={column.id} lane={lane}>
            {laneTasks.map((task) => (
              <DraggableCard
                key={task.id}
                task={task}
                project={projectById[task.projectId]}
                expanded={expandedTaskId === task.id}
                onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                onLog={() => setLoggingTask(task)}
                onEdit={() => setEditingTask(task)}
                onEditActivity={(a) => setEditingActivity(a)}
              />
            ))}
          </SwimLane>
        );
      })}
    </div>
  );
}

function SwimLane({ columnId, lane, children }) {
  const dropId = `${columnId}::${lane.id}`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const count = Array.isArray(children) ? children.filter(Boolean).length : (children ? 1 : 0);
  return (
    <div ref={setNodeRef} className={`swim-lane ${isOver ? 'drag-over' : ''}`}>
      <div className="swim-lane-head">
        <span>{lane.name}</span>
        <span className="count">{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 40 }}>
        {children}
        {count === 0 && (
          <div style={{ padding: '8px', fontSize: 11, color: 'var(--c-text-muted)', textAlign: 'center' }}>
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Draggable card ────────────────────────────────────────────────────────

function DraggableCard({ task, project, expanded, onToggleExpand, onLog, onEdit, onEditActivity }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ touchAction: 'none' }}>
      <CardBody
        task={task}
        project={project}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onLog={onLog}
        onEdit={onEdit}
        onEditActivity={onEditActivity}
        dragging={isDragging}
      />
    </div>
  );
}

// ─── Card body ────────────────────────────────────────────────────────────

function CardBody({ task, project, expanded, onToggleExpand, onLog, onEdit, onEditActivity, dragging }) {
  const today = todayLocal();
  const { running, state: timerState, start: startTimer } = useTimer();
  const isOverdue =
    task.status !== 'done' && task.plan?.endDate && task.plan.endDate < today;
  const finishedEarly =
    task.status === 'done' && task.actual?.endDate && task.plan?.endDate &&
    task.actual.endDate < task.plan.endDate;
  const finishedLate =
    task.status === 'done' && task.actual?.endDate && task.plan?.endDate &&
    task.actual.endDate > task.plan.endDate;
  const subtaskCount = task.subtasks?.length || 0;
  const subtasksDone = task.subtasks?.filter((s) => s.done).length || 0;
  const tags = task.tags || [];
  const depsCount = task.dependsOn?.length || 0;
  const isRecurring = !!task.recurrence;
  const isTrackingThis = running && timerState?.taskId === task.id;

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
        {depsCount > 0 && (
          <span className="badge badge-soft-muted" title={`${depsCount} dependenc${depsCount === 1 ? 'y' : 'ies'}`}>
            🔗 {depsCount}
          </span>
        )}
        {task.links?.length > 0 && (
          <span className="badge badge-soft-info" title={`${task.links.length} related task${task.links.length === 1 ? '' : 's'}`}>
            ↔ {task.links.length}
          </span>
        )}
        {isRecurring && (
          <span className="badge badge-soft-info" title={`Recurring: ${task.recurrence.rule}`}>
            🔁 {task.recurrence.rule}
          </span>
        )}
        {isTrackingThis && (
          <span className="badge badge-soft-success" title="Timer running">
            ⏱ tracking
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="task-card-tags">
          {tags.slice(0, 4).map((tg) => (
            <span key={tg} className="tag-pill small">#{tg}</span>
          ))}
          {tags.length > 4 && <span className="muted small">+{tags.length - 4}</span>}
        </div>
      )}

      {subtaskCount > 0 && (
        <div className="subtask-progress">
          <div className="subtask-progress-bar">
            <div
              className="subtask-progress-fill"
              style={{ width: `${(subtasksDone / subtaskCount) * 100}%` }}
            />
          </div>
          <span className="subtask-progress-label">{subtasksDone}/{subtaskCount}</span>
        </div>
      )}

      {/* Plan/actual dates are intentionally hidden from the card to keep it
          compact. Full dates are visible in the editor + Gantt + Calendar. */}

      <div className="task-card-footer">
        <div className="counters">
          <span>{task.activityCount || 0} log{task.activityCount === 1 ? '' : 's'}</span>
          <span>·</span>
          <span>{(task.totalHoursLogged || 0).toFixed(1)}h</span>
          {task.attachmentCount > 0 && (<><span>·</span><span>📎 {task.attachmentCount}</span></>)}
        </div>
        <div className="task-card-actions">
          {!isTrackingThis && (
            <button
              className="btn btn-sm btn-ghost"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); startTimer(task); }}
              title="Start time tracking on this task"
            >▶</button>
          )}
          <button className="btn btn-sm btn-ghost" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onLog && onLog(); }}>+ Log</button>
          <button className="btn btn-sm btn-ghost" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(); }}>{expanded ? 'Hide' : 'Log'}</button>
          <button className="btn btn-sm btn-ghost" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onEdit && onEdit(); }}>Edit</button>
        </div>
      </div>

      {expanded && <ActivityListInline taskId={task.id} onEditActivity={onEditActivity} />}
    </div>
  );
}

function ActivityListInline({ taskId, onEditActivity }) {
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
              title="Edit entry"
              style={{ color: 'var(--c-text-3)', marginLeft: 'auto' }}
              onClick={() => onEditActivity && onEditActivity(a)}
            >✎</button>
            <button
              className="link-danger"
              title="Delete entry"
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
