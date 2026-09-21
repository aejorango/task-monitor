// src/components/LogActivityPicker.jsx — "which task did you work on?"
//
// Lifted out of WorkPerformedView when the Dashboard needed the same question
// (T-0122 / POL-012). Two copies of a picker is how the two pages come to
// disagree about what counts as a candidate, so there is one.
//
// It only asks the question; the caller decides what to do with the answer —
// in both current call sites that is opening ActivityLogger on the task.

import { useMemo, useState } from 'react';
import { useModalDialog } from '../hooks/useModalDialog';

export default function LogActivityPicker({
  tasks = [],
  projectById = {},
  projectFilter = 'all',
  title = 'Log activity',
  subtitle = 'Pick the task you worked on, then record what you did.',
  onPick,
  onClose,
}) {
  const modal = useModalDialog({ onClose });
  const [query, setQuery] = useState('');
  const [taskId, setTaskId] = useState('');

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => projectFilter === 'all' || t.projectId === projectFilter)
      .filter((t) => !q || (t.title || '').toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = projectById[a.projectId]?.name || '￿';
        const bp = projectById[b.projectId]?.name || '￿';
        return ap.localeCompare(bp) || (a.title || '').localeCompare(b.title || '');
      });
  }, [tasks, projectById, projectFilter, query]);

  const chosen = candidates.find((t) => t.id === taskId) || null;

  return (
    <div className="modal-backdrop" {...modal.backdropProps}>
      <div className="modal" style={{ maxWidth: 460 }} {...modal.dialogProps}>
        <h3 className="modal-title" id={modal.titleId}>{title}</h3>
        <p className="modal-sub">{subtitle}</p>

        <div className="field">
          <label className="label" htmlFor="log-activity-search">Search tasks</label>
          <input
            id="log-activity-search"
            className="input"
            value={query}
            autoFocus
            placeholder="Filter by title…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="log-activity-task">Task</label>
          <select
            id="log-activity-task"
            className="select"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">— Select a task —</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {projectById[t.projectId]?.name ? `${projectById[t.projectId].name} · ` : ''}{t.title}
              </option>
            ))}
          </select>
          {candidates.length === 0 && (
            <p className="muted small" style={{ marginTop: 6 }}>
              No tasks match — clear the search or add a task first.
            </p>
          )}
        </div>

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
