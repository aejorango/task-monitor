// src/components/CsvImporter.jsx — modal that parses a CSV of activities, lets
// the user review/match projects+tasks, then bulk-imports them.

import { useState, useMemo } from 'react';
import { useAuth, useProjects, useTasks } from '../hooks/useTasks';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import { addTask, addActivity } from '../services/firebase';
// Parsing, column matching and row resolution live in services/csv.js so they
// can be unit-tested — an importer that quietly mis-matches rows duplicates a
// person's whole activity log. This file is the screen around them.
import {
  buildImportPreview, importTaskKey, readActivityCsv, summarizeImport,
} from '../services/csv';
import { friendlyError } from '../services/access';

export default function CsvImporter({ onClose }) {
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const { projects } = useProjects();
  const { tasks } = useTasks();

  const [parseError, setParseError] = useState(null);
  const [rows, setRows] = useState(null);          // parsed body rows, null until file picked
  const [colMap, setColMap] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);          // { imported, skipped } once done

  const handleFile = async (file) => {
    if (!file) return;
    setParseError(null);
    setRows(null);
    try {
      const read = readActivityCsv(await file.text());
      if (!read.ok) { setParseError(read.error); return; }
      setColMap(read.map);
      setRows(read.body);
    } catch (err) {
      console.error(err);
      setParseError(friendlyError(err, 'We could not read that file. Make sure it is a .csv saved from a spreadsheet.'));
    }
  };

  // Resolve each row against the real projects and tasks. See services/csv.js.
  const preview = useMemo(
    () => (rows && colMap ? buildImportPreview({ body: rows, map: colMap, projects, tasks }) : []),
    [rows, colMap, projects, tasks],
  );
  const summary = useMemo(() => summarizeImport(preview), [preview]);

  const validRows = preview.filter((r) => r.valid);

  const handleImport = async () => {
    setImporting(true);
    setProgress(0);
    let imported = 0;
    let skipped = 0;
    // Cache for tasks created during this import so multiple activities
    // for the same new task can share a single task doc.
    const createdTaskByKey = {};

    try {
      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        try {
          let task = row.existingTask;
          if (!task) {
            const key = importTaskKey(row);
            if (createdTaskByKey[key]) {
              task = createdTaskByKey[key];
            } else {
              // If the target project lives in a different workspace (shared
              // project), the task must inherit the project's workspaceId so
              // it lands in the project's home — not orphaned in the
              // importer's active workspace.
              const targetWorkspaceId = row.project?.workspaceId || workspaceId;
              const ref = await addTask(userId, {
                workspaceId: targetWorkspaceId,
                title: row.taskTitle,
                category: row.project?.name || row.projectName || 'Personal',
                projectId: row.project?.id || null,
                phaseId: row.phase?.id || null,
                requestedBy: row.requestedBy,
              });
              task = {
                id: ref.id,
                workspaceId: targetWorkspaceId,
                title: row.taskTitle,
                category: row.project?.name || row.projectName || 'Personal',
                projectId: row.project?.id || null,
                phaseId: row.phase?.id || null,
                status: 'todo',
              };
              createdTaskByKey[key] = task;
            }
          }
          await addActivity(userId, task, {
            date: row.date,
            comment: row.comment,
            hoursSpent: row.hours,
            attachments: row.attachments,
            completionStatus: row.completion,
            bottleneckRemarks: row.bottleneck,
            requestedBy: row.requestedBy,
          });
          imported++;
        } catch (err) {
          console.error('Row failed:', row, err);
          skipped++;
        }
        setProgress(Math.round(((i + 1) / validRows.length) * 100));
      }
    } finally {
      setImporting(false);
      setDone({ imported, skipped });
    }
  };

  return (
    <div className="modal-backdrop" onClick={importing ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <h3 className="modal-title">Import activities from CSV</h3>
        <p className="modal-sub">
          Expected columns: <span className="mono small">Project, Phase, Task, Activity details, Date, Completion, Output link, Bottlenecks, Requested by, Hours</span>.
          Round-trip with <strong>Export CSV</strong> works out of the box.
        </p>

        {!rows && !done && (
          <div className="csv-drop">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ display: 'block', marginBottom: 8 }}
            />
            <p className="muted small">
              The importer matches projects by name and tasks by title (case-insensitive). New tasks are created on the fly.
            </p>
            {parseError && (
              <div className="auth-error">
                <div className="auth-error-head">
                  <span className="badge badge-soft-danger">Parse error</span>
                </div>
                <p className="auth-error-msg">{parseError}</p>
              </div>
            )}
          </div>
        )}

        {rows && !done && (
          <>
            <div className="csv-summary">
              <span className="badge badge-soft-info">
                {summary.willImport} row{summary.willImport === 1 ? '' : 's'} will be imported
              </span>
              {summary.existingTasks > 0 && (
                <span className="badge badge-soft-muted">
                  {summary.existingTasks} added to {summary.existingTasks === 1 ? 'a task' : 'tasks'} you already have
                </span>
              )}
              {summary.newTasks > 0 && (
                <span className="badge badge-soft-success">
                  {summary.newTasks} new task{summary.newTasks === 1 ? '' : 's'} will be created
                </span>
              )}
              {summary.totalHours > 0 && (
                <span className="badge badge-soft-muted">{summary.totalHours}h of work logged</span>
              )}
              {summary.willSkip > 0 && (
                <span className="badge badge-soft-warn">
                  {summary.willSkip} row{summary.willSkip === 1 ? '' : 's'} skipped — no task name
                </span>
              )}
            </div>

            <div className="csv-preview-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Phase</th>
                    <th>Task</th>
                    <th>Date</th>
                    <th>Completion</th>
                    <th>Comment</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 200).map((r) => (
                    <tr key={r.idx} className={r.valid ? '' : 'csv-row-invalid'}>
                      <td>
                        {r.project
                          ? <span className="proj-tag"><span className="proj-dot" style={{ background: r.project.color }} />{r.project.name}</span>
                          : <span className="muted small">{r.projectName || '—'}</span>}
                      </td>
                      <td>
                        {r.phase
                          ? r.phase.name
                          : <span className="muted small">{r.phaseName || '—'}</span>}
                      </td>
                      <td>
                        <strong>{r.taskTitle || <span className="muted">(no title)</span>}</strong>
                        {r.taskTitle && !r.existingTask && (
                          <span className="badge badge-soft-success" style={{ marginLeft: 6 }}>new</span>
                        )}
                      </td>
                      <td className="mono small">{r.date}</td>
                      <td>
                        <span className={`badge badge-soft-${r.completion === 'completed' ? 'success' : r.completion === 'blocked' ? 'danger' : 'info'}`}>{r.completion}</span>
                      </td>
                      <td className="table-cell-wrap small">{r.comment || <span className="muted">—</span>}</td>
                      <td className="mono small">{r.hours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 200 && (
                <p className="muted small" style={{ padding: 8 }}>
                  Showing first 200 of {preview.length} rows. All valid rows will be imported.
                </p>
              )}
            </div>

            {importing && (
              <div className="csv-progress">
                <div className="csv-progress-bar"><div className="csv-progress-fill" style={{ width: `${progress}%` }} /></div>
                <span className="muted small mono">{progress}%</span>
              </div>
            )}
          </>
        )}

        {done && (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div className="empty-state-icon" style={{ background: 'var(--c-success-bg)', color: 'var(--c-success)' }}>✓</div>
            <p><strong>{done.imported}</strong> activities imported.</p>
            {done.skipped > 0 && <p className="muted small">{done.skipped} rows failed — see console for details.</p>}
          </div>
        )}

        <div className="modal-actions">
          {!done && rows && (
            <button
              className="btn"
              onClick={() => { setRows(null); setColMap(null); setParseError(null); }}
              disabled={importing}
            >Choose a different file</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={importing}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {rows && !done && (
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={importing || validRows.length === 0}
            >
              {importing ? `Importing… ${progress}%` : `Import ${validRows.length} activit${validRows.length === 1 ? 'y' : 'ies'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
