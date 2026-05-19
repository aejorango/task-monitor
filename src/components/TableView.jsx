// src/components/TableView.jsx — activity table with sorting, bulk actions, edit + CSV.

import { useState, useMemo, useEffect } from 'react';
import { useAllActivities, useProjects, useTasks } from '../hooks/useTasks';
import {
  deleteActivity,
  bulkDeleteActivities,
  bulkUpdateActivityCompletion,
} from '../services/firebase';
import ActivityEditor from './ActivityEditor';
import CsvImporter from './CsvImporter';

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

const COMPLETION_OPTIONS = [
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'completed',   label: 'Completed' },
];

export default function TableView({ projectFilter }) {
  const { activities, loading } = useAllActivities();
  const { byId: projectById } = useProjects();
  const { tasks } = useTasks();
  const taskById = useMemo(() => {
    const m = {}; tasks.forEach((t) => { m[t.id] = t; }); return m;
  }, [tasks]);

  const [sortBy, setSortBy]   = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing]   = useState(null);
  const [importerOpen, setImporterOpen] = useState(false);

  const filtered = useMemo(() => {
    return activities.filter((a) => projectFilter === 'all' || a.projectId === projectFilter);
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

  // Prune selections when underlying data changes (filtered rows can drop)
  useEffect(() => {
    const ids = new Set(sorted.map((r) => r.id));
    const next = new Set([...selected].filter((id) => ids.has(id)));
    if (next.size !== selected.size) setSelected(next);
  }, [sorted, selected]);

  const sortHandler = (key) => () => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  const allSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map((r) => r.id)));
  };
  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectedRows = sorted.filter((r) => selected.has(r.id));

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedRows.length} activity entr${selectedRows.length === 1 ? 'y' : 'ies'}?`)) return;
    await bulkDeleteActivities(selectedRows);
    setSelected(new Set());
  };

  const bulkComplete = async (status) => {
    await bulkUpdateActivityCompletion(selectedRows, status);
    setSelected(new Set());
  };

  const bulkExport = () => exportCsv(selectedRows);

  if (loading) return <p className="muted">Loading activity log…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Activity table</h1>
          <p className="page-subtitle">All logged activities across your tasks and projects. Click a column to sort. Select rows for bulk actions.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setImporterOpen(true)}>Import CSV</button>
          <button className="btn" onClick={() => exportCsv(sorted)}>Export all CSV</button>
        </div>
      </div>

      {importerOpen && <CsvImporter onClose={() => setImporterOpen(false)} />}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onDelete={bulkDelete}
          onComplete={bulkComplete}
          onExport={bulkExport}
        />
      )}

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
                <th style={{ width: 32 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                    style={{ accentColor: 'var(--c-accent)', cursor: 'pointer' }}
                  />
                </th>
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
                <th aria-label="actions" style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isSelected = selected.has(r.id);
                return (
                  <tr key={r.id} style={isSelected ? { background: 'var(--c-accent-soft)' } : {}}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(r.id)}
                        aria-label="Select row"
                        style={{ accentColor: 'var(--c-accent)', cursor: 'pointer' }}
                      />
                    </td>
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
                          📎 {(r._output.name || 'link').slice(0, 30)}
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
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Edit entry"
                        onClick={() => setEditing(r)}
                      >✎</button>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Delete entry"
                        onClick={() => { if (confirm('Delete this activity entry?')) deleteActivity(r); }}
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ActivityEditor
          activity={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function BulkBar({ count, onClear, onDelete, onComplete, onExport }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bulk-bar">
      <span className="bulk-bar-count">
        <strong>{count}</strong> selected
      </span>
      <button className="btn btn-sm btn-ghost" onClick={onClear}>Clear</button>
      <div style={{ flex: 1 }} />
      <div className="dropdown">
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>
          Set completion ▾
        </button>
        {open && (
          <div className="dropdown-menu">
            {COMPLETION_OPTIONS.map((o) => (
              <button
                key={o.value}
                className="dropdown-item"
                onClick={() => { onComplete(o.value); setOpen(false); }}
              >{o.label}</button>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-sm" onClick={onExport}>Export CSV</button>
      <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>
    </div>
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
