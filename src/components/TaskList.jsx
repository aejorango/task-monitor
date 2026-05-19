// src/components/TaskList.jsx
// Kanban-style board with plan vs actual dates, activity counters,
// inline activity logger, and per-task activity log expansion.

import { useState } from 'react';
import { useTasks, useActivities } from '../hooks/useTasks';
import {
  moveTaskStatus,
  softDeleteTask,
  archiveTask,
  addActivity,
  deleteActivity,
  todayLocal,
} from '../services/firebase';

const CATEGORIES = ['All', 'BRIDGED', 'AIM', 'Personal'];

export default function TaskList() {
  const { tasks, loading, byCategory, userId } = useTasks();
  const [filter, setFilter] = useState('All');
  const [loggingTask, setLoggingTask] = useState(null);
  const [expandedTaskId, setExpandedTaskId] = useState(null);

  if (loading) return <p className="muted">Loading tasks…</p>;
  if (!userId) return <p className="muted">Signing you in…</p>;

  const filtered = byCategory(filter);
  const columns = [
    { key: 'todo',  label: 'To Do' },
    { key: 'doing', label: 'In Progress' },
    { key: 'done',  label: 'Done' },
  ];

  return (
    <div className="task-list">
      <div className="filters">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={filter === c ? 'chip active' : 'chip'}
            onClick={() => setFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="board">
        {columns.map((col) => (
          <div key={col.key} className="column">
            <h3>
              {col.label}{' '}
              <span className="count">
                {filtered.filter((t) => t.status === col.key).length}
              </span>
            </h3>
            {filtered
              .filter((t) => t.status === col.key)
              .map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  expanded={expandedTaskId === task.id}
                  onToggleExpand={() =>
                    setExpandedTaskId(expandedTaskId === task.id ? null : task.id)
                  }
                  onLog={() => setLoggingTask(task)}
                />
              ))}
          </div>
        ))}
      </div>

      {loggingTask && (
        <ActivityLogger
          task={loggingTask}
          userId={userId}
          onClose={() => setLoggingTask(null)}
        />
      )}
    </div>
  );
}

// ─── Task card ──────────────────────────────────────────────────────────────

function TaskCard({ task, expanded, onToggleExpand, onLog }) {
  const priorityColors = {
    high:   '#e63946',
    medium: '#f4a261',
    low:    '#2a9d8f',
  };

  const today = todayLocal();
  const isOverdue =
    task.status !== 'done' && task.plan?.endDate && task.plan.endDate < today;
  const finishedEarly =
    task.status === 'done' &&
    task.actual?.endDate &&
    task.plan?.endDate &&
    task.actual.endDate < task.plan.endDate;
  const finishedLate =
    task.status === 'done' &&
    task.actual?.endDate &&
    task.plan?.endDate &&
    task.actual.endDate > task.plan.endDate;

  return (
    <div className={`task-card ${isOverdue ? 'overdue' : ''}`}>
      <div
        className="priority-bar"
        style={{ background: priorityColors[task.priority] }}
      />
      <div className="task-content">
        <p className="task-title">{task.title}</p>

        <div className="task-meta">
          <span className="tag">{task.category}</span>
          {isOverdue && <span className="badge overdue">Overdue</span>}
          {finishedEarly && <span className="badge good">Done early</span>}
          {finishedLate && <span className="badge warn">Done late</span>}
        </div>

        <div className="dates">
          <div>
            <span className="date-label">Plan:</span>{' '}
            {task.plan?.startDate || '—'} → {task.plan?.endDate || '—'}
          </div>
          <div>
            <span className="date-label">Actual:</span>{' '}
            {task.actual?.startDate || '—'} → {task.actual?.endDate || '—'}
          </div>
        </div>

        <div className="counters">
          <span>{task.activityCount || 0} log{task.activityCount === 1 ? '' : 's'}</span>
          <span>·</span>
          <span>{(task.totalHoursLogged || 0).toFixed(1)}h</span>
          {task.attachmentCount > 0 && (
            <>
              <span>·</span>
              <span>📎 {task.attachmentCount}</span>
            </>
          )}
        </div>

        <div className="task-actions">
          <button onClick={onLog}>＋ Log</button>
          <button onClick={onToggleExpand}>
            {expanded ? 'Hide' : 'History'}
          </button>
          <button onClick={() => moveTaskStatus(task)}>→ Move</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm('Delete this task?')) softDeleteTask(task.id);
            }}
          >
            Delete
          </button>
        </div>

        {expanded && <ActivityLog taskId={task.id} />}
      </div>
    </div>
  );
}

// ─── Activity log (per task) ────────────────────────────────────────────────

function ActivityLog({ taskId }) {
  const { activities, loading } = useActivities(taskId);

  if (loading) return <p className="muted small">Loading log…</p>;
  if (activities.length === 0)
    return <p className="muted small">No activity logged yet.</p>;

  return (
    <ul className="activity-log">
      {activities.map((a) => (
        <li key={a.id} className="activity-item">
          <div className="activity-head">
            <strong>{a.date}</strong>
            <span className="muted small">{a.hoursSpent}h</span>
            <button
              className="link-danger"
              onClick={() => {
                if (confirm('Delete this log entry?')) deleteActivity(a);
              }}
            >
              ✕
            </button>
          </div>
          {a.comment && <p className="activity-comment">{a.comment}</p>}
          {a.attachments?.length > 0 && (
            <ul className="attachments">
              {a.attachments.map((att, i) => (
                <li key={i}>
                  <a href={att.url} target="_blank" rel="noreferrer">
                    📎 {att.name || att.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─── Activity logger (modal) ────────────────────────────────────────────────

function ActivityLogger({ task, userId, onClose }) {
  const [date, setDate] = useState(todayLocal());
  const [comment, setComment] = useState('');
  const [hours, setHours] = useState('');
  const [attachName, setAttachName] = useState('');
  const [attachUrl, setAttachUrl] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [saving, setSaving] = useState(false);

  const addAttachment = () => {
    if (!attachUrl.trim()) return;
    setAttachments([
      ...attachments,
      {
        name: attachName.trim() || attachUrl,
        url:  attachUrl.trim(),
        type: attachUrl.includes('drive.google') ? 'drive' : 'external',
      },
    ]);
    setAttachName('');
    setAttachUrl('');
  };

  const handleSave = async () => {
    if (!comment.trim() && !hours && attachments.length === 0) {
      alert('Add a comment, hours, or attachment first.');
      return;
    }
    setSaving(true);
    try {
      await addActivity(userId, task, {
        date,
        comment: comment.trim(),
        hoursSpent: Number(hours) || 0,
        attachments,
      });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save activity. Check console.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Log activity</h3>
        <p className="muted small">{task.title}</p>

        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <label>
          What did you do?
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Drafted sections 12-15, sent to Mark for review…"
          />
        </label>

        <label>
          Hours spent
          <input
            type="number"
            step="0.25"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 2.5"
          />
        </label>

        <div className="attach-block">
          <label className="small muted">Attachments (paste any link)</label>
          <div className="attach-row">
            <input
              type="text"
              value={attachName}
              onChange={(e) => setAttachName(e.target.value)}
              placeholder="Label (optional)"
            />
            <input
              type="url"
              value={attachUrl}
              onChange={(e) => setAttachUrl(e.target.value)}
              placeholder="https://…"
            />
            <button type="button" onClick={addAttachment}>
              Add
            </button>
          </div>
          {attachments.length > 0 && (
            <ul className="attachments">
              {attachments.map((a, i) => (
                <li key={i}>
                  📎 {a.name}{' '}
                  <button
                    className="link-danger"
                    onClick={() =>
                      setAttachments(attachments.filter((_, idx) => idx !== i))
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save log'}
          </button>
        </div>
      </div>
    </div>
  );
}
