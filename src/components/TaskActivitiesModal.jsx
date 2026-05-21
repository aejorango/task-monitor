// src/components/TaskActivitiesModal.jsx — popup that lists a task's activity
// log in a table. Used from Gantt and Calendar (clicking a task).
//
// Columns: Phase, Date, Activity Details, Link, Bottleneck.
//
// Includes an "Edit task" button to escalate to the full TaskEditor when the
// caller passes onEditTask.

import { useState } from 'react';
import { useActivities, useProjects } from '../hooks/useTasks';
import { todayLocal, setTaskStatus } from '../services/firebase';
import ActivityEditor from './ActivityEditor';
import ActivityLogger from './ActivityLogger';

export default function TaskActivitiesModal({ task, onClose, onEditTask, userId }) {
  const { activities, loading } = useActivities(task.id);
  const { byId: projectById } = useProjects();
  const [editingActivity, setEditingActivity] = useState(null);
  const [loggingNew, setLoggingNew] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const project = projectById[task.projectId];
  const phaseById = {};
  (project?.phases || []).forEach((p) => { phaseById[p.id] = p.name; });

  // Today's overdue indicator for the task header
  const isOverdue = task.status !== 'done' && task.plan?.endDate && task.plan.endDate < todayLocal();

  // Inline status change — calls setTaskStatus which also handles actual-date
  // stamping (start-on-doing, end-on-done) and recurrence spawning.
  const handleStatusChange = async (e) => {
    const next = e.target.value;
    if (next === task.status) return;
    setStatusBusy(true);
    try { await setTaskStatus(task, next); }
    catch (err) { console.error(err); alert('Could not change status.'); }
    finally { setStatusBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 880 }}
      >
        <div className="task-activities-head">
          <div>
            <h3 className="modal-title" style={{ marginBottom: 4 }}>{task.title}</h3>
            <p className="modal-sub">
              {project && (
                <span className="proj-tag" style={{ marginRight: 6 }}>
                  <span className="proj-dot" style={{ background: project.color }} />
                  {project.name}
                </span>
              )}
              <span className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span>Status:</span>
                <select
                  className="select select-sm"
                  value={task.status}
                  onChange={handleStatusChange}
                  disabled={statusBusy}
                  style={{ width: 'auto', padding: '2px 6px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="todo">To do</option>
                  <option value="doing">In progress</option>
                  <option value="done">Done</option>
                </select>
                {task.plan?.endDate && <> · Due {task.plan.endDate}</>}
                {isOverdue && <span className="badge badge-soft-danger" style={{ marginLeft: 6 }}>Overdue</span>}
              </span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setLoggingNew(true)}>+ Log activity</button>
            {onEditTask && (
              <button className="btn btn-sm" onClick={() => onEditTask(task)}>Edit task</button>
            )}
          </div>
        </div>

        {task.description && (
          <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
            {task.description.length > 220 ? task.description.slice(0, 220) + '…' : task.description}
          </p>
        )}

        {loading ? (
          <p className="muted">Loading activity log…</p>
        ) : activities.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <div className="empty-state-icon">☰</div>
            <p>No activities logged yet for this task.</p>
            <p className="small">Click <strong>+ Log activity</strong> above to record the first one.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Phase</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Activity Details</th>
                  <th style={{ width: 160 }}>Link</th>
                  <th style={{ width: 200 }}>Bottleneck</th>
                  <th style={{ width: 56 }} aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id}>
                    <td>{phaseById[a.phaseId] || <span className="muted">—</span>}</td>
                    <td className="mono small">{a.date}</td>
                    <td className="table-cell-wrap">
                      {a.comment || <span className="muted">—</span>}
                      {a.hoursSpent > 0 && (
                        <span className="muted small mono" style={{ marginLeft: 6 }}>{a.hoursSpent}h</span>
                      )}
                      {a.completionStatus && (
                        <span className={`badge badge-soft-${
                          a.completionStatus === 'completed' ? 'success' :
                          a.completionStatus === 'blocked'   ? 'danger'  :
                          a.completionStatus === 'in-progress' ? 'info'  : 'muted'
                        }`} style={{ marginLeft: 6 }}>{a.completionStatus}</span>
                      )}
                    </td>
                    <td>
                      {a.attachments?.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {a.attachments.map((att, i) => (
                            <a
                              key={i}
                              href={att.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="table-link"
                              title={att.name}
                            >📎 {(att.name || att.url).slice(0, 28)}{(att.name || att.url).length > 28 ? '…' : ''}</a>
                          ))}
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="table-cell-wrap">
                      {a.bottleneckRemarks
                        ? <span style={{ color: 'var(--c-warn)' }}>⚠ {a.bottleneckRemarks}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Edit this entry"
                        onClick={() => setEditingActivity(a)}
                      >✎</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        {editingActivity && (
          <ActivityEditor
            activity={editingActivity}
            onClose={() => setEditingActivity(null)}
          />
        )}

        {loggingNew && (
          <ActivityLogger
            task={task}
            userId={userId}
            onClose={() => setLoggingNew(false)}
          />
        )}
      </div>
    </div>
  );
}
