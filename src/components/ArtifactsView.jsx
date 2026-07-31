// src/components/ArtifactsView.jsx — table of all attached/linked documents
// across activity log entries, one row per attachment.

import { useState, useMemo } from 'react';
import { useAllActivities, useProjects, useTasks } from '../hooks/useTasks';

const COLUMNS = [
  { key: 'project', label: 'Project' },
  { key: 'phase',   label: 'Phase' },
  { key: 'task',    label: 'Task' },
  { key: 'name',    label: 'Document' },
  { key: 'date',    label: 'Date logged' },
];

export default function ArtifactsView({ projectFilter }) {
  const { activities, loading } = useAllActivities();
  const { byId: projectById } = useProjects();
  const { tasks } = useTasks();
  const taskById = useMemo(() => {
    const m = {}; tasks.forEach((t) => { m[t.id] = t; }); return m;
  }, [tasks]);

  const [sortBy, setSortBy]   = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const rows = useMemo(() => {
    const out = [];
    activities.forEach((a) => {
      if (projectFilter !== 'all' && a.projectId !== projectFilter) return;
      if (!a.attachments?.length) return;
      const task = taskById[a.taskId];
      const project = projectById[a.projectId];
      const phase = project?.phases?.find((p) => p.id === a.phaseId);
      a.attachments.forEach((att, i) => {
        out.push({
          id: `${a.id}-${i}`,
          _project: project?.name || a.taskCategory || '—',
          _phase:   phase?.name || '—',
          _task:    a.taskTitle || task?.title || '—',
          _color:   project?.color || '#a1a1aa',
          name:     att.name || 'Untitled',
          url:      att.url,
          type:     att.type,
          date:     a.date,
        });
      });
    });
    out.sort((x, y) => {
      const xv = x[`_${sortBy}`] ?? x[sortBy] ?? '';
      const yv = y[`_${sortBy}`] ?? y[sortBy] ?? '';
      const cmp = String(xv).localeCompare(String(yv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [activities, projectById, taskById, projectFilter, sortBy, sortDir]);

  const sortHandler = (key) => () => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  if (loading) return <p className="muted">Loading artifacts…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Artifacts</h1>
          <p className="page-subtitle">All documents attached or linked from activity log entries, across your tasks and projects.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📎</div>
          <p>No artifacts yet.</p>
          <p className="small">Attach a file or link when logging an activity and it will show up here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={sortBy === c.key ? 'sorted' : ''}
                    onClick={sortHandler(c.key)}
                  >
                    {c.label}
                    <span className="sort-icon">{sortBy === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="proj-tag">
                      <span className="proj-dot" style={{ background: r._color }} />
                      {r._project}
                    </span>
                  </td>
                  <td>{r._phase}</td>
                  <td className="table-cell-wrap"><strong>{r._task}</strong></td>
                  <td className="table-cell-wrap">
                    {r.url ? (
                      <a className="table-link" href={r.url} target="_blank" rel="noreferrer">
                        {r.type === 'image' ? '🖼️' : '📎'} {r.name}
                      </a>
                    ) : r.name}
                  </td>
                  <td className="mono small">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
