// src/components/CsvImporter.jsx — modal that parses a CSV of activities, lets
// the user review/match projects+tasks, then bulk-imports them.

import { useState, useMemo } from 'react';
import { useAuth, useProjects, useTasks } from '../hooks/useTasks';
import { addTask, addActivity, todayLocal } from '../services/firebase';

// Minimal RFC-4180-ish CSV parser. Handles quoted cells, escaped quotes, and
// commas/newlines inside quotes. Returns array of rows (each row is an array).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  // Drop trailing all-empty row from a stray newline at EOF.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

// Find a header column index by any of the supplied candidate names (case-insensitive).
function findCol(headers, candidates) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// Map the column layout used by Export CSV (and any close variant).
function buildColumnMap(headers) {
  return {
    project:     findCol(headers, ['Project']),
    phase:       findCol(headers, ['Phase']),
    task:        findCol(headers, ['Task', 'Task title', 'Task name']),
    comment:     findCol(headers, ['Activity details', 'Comment', 'Details', 'Description']),
    date:        findCol(headers, ['Date']),
    completion:  findCol(headers, ['Completion', 'Completion status', 'Status']),
    output:      findCol(headers, ['Output link', 'Output', 'Attachments', 'Links']),
    bottleneck:  findCol(headers, ['Bottlenecks', 'Bottleneck', 'Remarks', 'Notes']),
    requestedBy: findCol(headers, ['Requested by', 'RequestedBy', 'Requester']),
    hours:       findCol(headers, ['Hours', 'Hours spent', 'HoursSpent', 'Duration']),
  };
}

// Normalize completion status string into the 4 canonical values.
function normalizeCompletion(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return 'in-progress';
  if (/(complete|done|finish)/.test(s)) return 'completed';
  if (/(block|stuck|hold)/.test(s))     return 'blocked';
  if (/(not.start|todo|to.?do|pending)/.test(s)) return 'not-started';
  return 'in-progress';
}

// Normalize "Output link" cell into attachments array. Accepts pipe-separated
// URLs (our export format) or whitespace-separated URLs.
function parseAttachments(raw) {
  if (!raw) return [];
  const urls = String(raw)
    .split(/[|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return urls.map((u) => ({
    name: u,
    url:  u,
    type: u.includes('drive.google') ? 'drive' : 'external',
  }));
}

// Normalize date to YYYY-MM-DD if possible. Accepts ISO date strings,
// short formats like "Mar 5", "2026-05-19", "5/19/2026", etc.
function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return todayLocal();
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try Date() — will accept "5/19/2026", "Mar 5", "2026/05/19", etc.
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return todayLocal();
}

export default function CsvImporter({ onClose }) {
  const { userId } = useAuth();
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
      const text = await file.text();
      const all = parseCsv(text);
      if (all.length === 0) throw new Error('CSV appears to be empty.');
      const headers = all[0];
      const body = all.slice(1);
      const map = buildColumnMap(headers);
      // Must at least have a task and a date column to make sense
      if (map.task === -1 || map.date === -1) {
        throw new Error(`Missing required columns. Need at least "Task" and "Date". Found: ${headers.join(', ')}`);
      }
      setColMap(map);
      setRows(body);
    } catch (err) {
      console.error(err);
      setParseError(err.message || String(err));
    }
  };

  // Resolve each row's project (by name) and task (by title). Tracks new tasks
  // that will need to be created. Returns the preview list.
  const preview = useMemo(() => {
    if (!rows || !colMap) return [];
    const projectByName = {};
    projects.forEach((p) => { projectByName[p.name.toLowerCase()] = p; });

    return rows.map((row, idx) => {
      const get = (col) => col === -1 ? '' : (row[col] || '').trim();

      const projectName = get(colMap.project);
      const phaseName   = get(colMap.phase);
      const taskTitle   = get(colMap.task);
      const comment     = get(colMap.comment);
      const date        = normalizeDate(get(colMap.date));
      const completion  = normalizeCompletion(get(colMap.completion));
      const attachments = parseAttachments(get(colMap.output));
      const bottleneck  = get(colMap.bottleneck);
      const requestedBy = get(colMap.requestedBy);
      const hours       = Number(get(colMap.hours)) || 0;

      const project = projectName ? projectByName[projectName.toLowerCase()] : null;
      const phase   = project && phaseName
        ? project.phases?.find((p) => p.name.toLowerCase() === phaseName.toLowerCase())
        : null;
      // Match task by title within the project (case-insensitive)
      const existingTask = tasks.find((t) =>
        t.title.toLowerCase() === taskTitle.toLowerCase() &&
        (project ? t.projectId === project.id : true)
      );

      return {
        idx,
        valid: !!taskTitle,
        projectName,
        project,
        phaseName,
        phase,
        taskTitle,
        existingTask,
        comment,
        date,
        completion,
        attachments,
        bottleneck,
        requestedBy,
        hours,
      };
    });
  }, [rows, colMap, projects, tasks]);

  const validRows  = preview.filter((r) => r.valid);
  const invalidRows = preview.filter((r) => !r.valid);
  const newTasksToCreate = new Set();
  validRows.forEach((r) => { if (!r.existingTask) newTasksToCreate.add(r.taskTitle.toLowerCase() + '|' + (r.project?.id || '')); });

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
            const key = row.taskTitle.toLowerCase() + '|' + (row.project?.id || '');
            if (createdTaskByKey[key]) {
              task = createdTaskByKey[key];
            } else {
              const ref = await addTask(userId, {
                title: row.taskTitle,
                category: row.project?.name || row.projectName || 'Personal',
                projectId: row.project?.id || null,
                phaseId: row.phase?.id || null,
                requestedBy: row.requestedBy,
              });
              task = {
                id: ref.id,
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
              <span className="badge badge-soft-info">{validRows.length} valid rows</span>
              {invalidRows.length > 0 && (
                <span className="badge badge-soft-warn">{invalidRows.length} skipped (missing task title)</span>
              )}
              {newTasksToCreate.size > 0 && (
                <span className="badge badge-soft-success">{newTasksToCreate.size} new tasks will be created</span>
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
