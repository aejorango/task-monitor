// src/components/TableView.jsx — flat table of all activities with full PM-suite columns.

import { useState, useMemo } from 'react';
import { useAllActivities, useProjects, useTasks } from '../hooks/useTasks';
import { deleteActivity } from '../services/firebase';

const COLUMNS = [
  { key: 'project',     label: 'Project' },
  { key: 'phase',       label: 'Phase' },
  { key: 'task',        label: 'Task' },
  { key: 'comment',     label: 'Activity details' },
  { key: 'date',        label: 'Date' },
  { key: 'completion',  label: 'Completion' },
  { key: 'output',      label: 'Output link' },
  { key: 'bottleneck',  label: 'Bottlenecks / remarks' },
  { key: 'requestedBy', label: 'Requested by' },
  { key: 'hours',       label: 'Hours' },
];

export default function TableView({ projectFilter }) {
  const { activities, loading } = useAllActivities();
  const { projects, byId: projectById } = useProjects();
  const { tasks } = useTasks();
  const taskById = useMemo(() => {
    const m = {}; tasks.forEach((t) => { m[t.id] = t; }); return m;
  }, [tasks]);

  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (projectFilter === 'all') return true;
      return a.projectId === projectFilter;
    });
  }, [activities, projectFilter]);

  const sorted = useMemo(() => {
    const rows = filtered.map((a) => {
      const task = taskById[a.taskId];
      const project = projectById[a.projectId];
      const phase = project?.phases?.find((p) => p.id === a.phaseId);
      return {
        ...a,
        _project:    project?.name || a.taskCategory || '—',
        _phase:      phase?.name || '—',
        _task:       a.taskTitle || task?.title || '—',
        _color:      project?.color || '#a1a1aa',
        _output:     a.attachments?.[0],
        _output_count: a.attachments?.length || 0,
      };
    });

    rows.sort((a, b) => {
      const av = a[`_${sortBy}`] ?? a[sortBy] ?? '';
      const bv = b[`_${sortBy}`] ?? b[sortBy] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [filtered, projectById, taskById, sortBy, sortDir]);

  const sortHandler = (key) => () => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  if (loading) return <p className="muted">Loading activity log…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Activity table</h1>
          <p className="page-subtitle">All logged activities across your tasks and projects. Click a column to sort.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => exportCsv(sorted)}>Export CSV</button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">☰</div>
          <p>No activities logged yet.</p>
          <p className="small">Add a task on the Board, then click <strong>+ Log</strong> to record an activity.</p>
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
                    <span className="sort-icon">
                      {sortBy === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </th>
                ))}
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="proj-tag">
                      <span className="proj-dot" style={{ background: r._color }} />
                      {r._project}
                    </span>
                  </td>
                  <td>{r._phase}</td>
                  <td className="table-cell-wrap"><strong>{r._task}</strong></td>
                  <td className="table-cell-wrap">{r.comment || <span className="muted">—</span>}</td>
                  <td className="mono small">{r.date}</td>
                  <td>
                    {r.completionStatus ? (
                      <span className={`badge badge-soft-${
                        r.completionStatus === 'completed' ? 'success' :
                        r.completionStatus === 'blocked'   ? 'danger'  :
                        r.completionStatus === 'in-progress' ? 'info'  : 'muted'
                      }`}>{r.completionStatus}</span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    {r._output ? (
                      <a className="table-link" href={r._output.url} target="_blank" rel="noreferrer">
                        📎 {r._output.name?.slice(0, 30) || 'link'}
                        {r._output_count > 1 && <span className="muted"> +{r._output_count - 1}</span>}
                      </a>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="table-cell-wrap">
                    {r.bottleneckRemarks
                      ? <span style={{ color: 'var(--c-warn)' }}>⚠ {r.bottleneckRemarks}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td>{r.requestedBy || <span className="muted">—</span>}</td>
                  <td className="mono small">{(r.hoursSpent || 0).toFixed(1)}h</td>
                  <td>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Delete entry"
                      onClick={() => {
                        if (confirm('Delete this activity entry?')) deleteActivity(r);
                      }}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function exportCsv(rows) {
  const headers = ['Project', 'Phase', 'Task', 'Activity details', 'Date', 'Completion', 'Output link', 'Bottlenecks', 'Requested by', 'Hours'];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  rows.forEach((r) => {
    lines.push([
      r._project,
      r._phase,
      r._task,
      r.comment,
      r.date,
      r.completionStatus,
      r.attachments?.map((a) => a.url).join(' | '),
      r.bottleneckRemarks,
      r.requestedBy,
      r.hoursSpent || 0,
    ].map(escape).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-monitor-activities-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
