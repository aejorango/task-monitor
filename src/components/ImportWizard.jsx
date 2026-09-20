// src/components/ImportWizard.jsx — bring a spreadsheet in, whatever its
// column names are.
//
// Four steps, and nothing is written until the last one:
//   1. Pick what you are importing — tasks, projects or the activity log.
//   2. Choose the file.
//   3. Map each of our fields onto one of your columns (guessed first).
//   4. Read what will happen, then confirm.
//
// The parsing, guessing and validation are in services/csv.js; this is the
// screen around them.

import { useMemo, useState } from 'react';
import { useAuth, useProjects, useTasks } from '../hooks/useTasks';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import { addTask, addProject, addActivity, uid } from '../services/firebase';
import {
  IMPORT_KINDS, chunkForImport, guessMapping, missingRequired, parseCsv,
  parseImportRows, summarizeImportRows,
} from '../services/csv';
import { friendlyError } from '../services/access';

const KIND_KEYS = Object.keys(IMPORT_KINDS);

export default function ImportWizard({ onClose, initialKind = 'tasks' }) {
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const { projects } = useProjects();
  const { tasks } = useTasks();

  const [kind, setKind] = useState(initialKind);
  const [headers, setHeaders] = useState(null);
  const [body, setBody] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);

  const spec = IMPORT_KINDS[kind];
  const step = done ? 4 : headers ? 3 : 2;

  const rows = useMemo(
    () => (headers ? parseImportRows(body, mapping, kind) : []),
    [headers, body, mapping, kind],
  );
  const summary = useMemo(() => summarizeImportRows(rows), [rows]);
  const missing = useMemo(() => missingRequired(mapping, kind), [mapping, kind]);

  const pickFile = async (file) => {
    if (!file) return;
    setError(null); setDone(null);
    try {
      const all = parseCsv(await file.text());
      if (all.length === 0) { setError('That file is empty.'); return; }
      const head = all[0].map((h) => String(h).trim());
      const rest = all.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (rest.length === 0) { setError('That file has column headings but no rows underneath them.'); return; }
      setFileName(file.name);
      setHeaders(head);
      setBody(rest);
      setMapping(guessMapping(head, kind));
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, 'We could not read that file. Save it as a .csv and try again.'));
    }
  };

  const changeKind = (next) => {
    setKind(next);
    setDone(null);
    if (headers) setMapping(guessMapping(headers, next));
  };

  const projectByName = useMemo(() => {
    const m = new Map();
    projects.forEach((p) => m.set((p.name || '').toLowerCase(), p));
    return m;
  }, [projects]);

  const runImport = async () => {
    setImporting(true);
    setProgress(0);
    const valid = rows.filter((r) => r.valid);
    const failures = [];
    let imported = 0;
    const createdProjects = new Map();

    try {
      let seen = 0;
      for (const chunk of chunkForImport(valid)) {
        for (const row of chunk) {
          try {
            await writeOne(row.record, {
              kind, userId, workspaceId, projectByName, createdProjects, tasks,
            });
            imported += 1;
          } catch (err) {
            console.error('Row failed:', row, err);
            failures.push({
              line: row.line,
              label: row.record.title || row.record.name || row.record.task || '(row)',
              reason: friendlyError(err, 'Could not save this row.'),
            });
          }
          seen += 1;
          setProgress(Math.round((seen / valid.length) * 100));
        }
      }
    } finally {
      setImporting(false);
      setDone({ imported, failures, skipped: summary.willSkip });
    }
  };

  return (
    <div className="modal-backdrop" onClick={importing ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <h3 className="modal-title">Import from a spreadsheet</h3>
        <p className="modal-sub">
          Save your sheet as a <strong>.csv</strong>, then bring it in here. Nothing is
          added until you confirm on the last step.
        </p>

        <ol className="iw-steps">
          {['What to import', 'Choose the file', 'Match the columns', 'Confirm'].map((label, i) => (
            <li key={label} className={`iw-step ${step === i + 1 ? 'is-on' : ''} ${step > i + 1 ? 'is-done' : ''}`}>
              <span className="iw-step-n">{i + 1}</span> {label}
            </li>
          ))}
        </ol>

        {/* 1 — what */}
        <div className="field">
          <label className="label">What are you importing?</label>
          <div className="iw-kinds">
            {KIND_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className={`iw-kind ${kind === k ? 'is-on' : ''}`}
                onClick={() => changeKind(k)}
                disabled={importing}
              >
                <strong>{IMPORT_KINDS[k].label}</strong>
                <span className="muted small">{IMPORT_KINDS[k].describe}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2 — file */}
        {!done && (
          <div className="field">
            <label className="label">Your file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => pickFile(e.target.files?.[0])}
              disabled={importing}
            />
            {fileName && <p className="muted small" style={{ marginTop: 4 }}>{fileName} · {body.length} rows</p>}
            {error && <p className="auth-error-msg" style={{ marginTop: 6 }}>{error}</p>}
          </div>
        )}

        {/* 3 — mapping */}
        {headers && !done && (
          <>
            <div className="field">
              <label className="label">Match the columns</label>
              <p className="muted small" style={{ marginTop: 0 }}>
                We have guessed from your headings. Change anything we got wrong.
              </p>
              <div className="iw-map">
                {spec.fields.map((f) => (
                  <label key={f.key} className="iw-map-row">
                    <span className="iw-map-label">
                      {f.label}
                      {f.required && <span className="link-danger" title="Required"> *</span>}
                    </span>
                    <select
                      className="select select-sm"
                      value={mapping[f.key] ?? -1}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                      disabled={importing}
                    >
                      <option value={-1}>— not in my file —</option>
                      {headers.map((h, i) => (
                        <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            {missing.length > 0 ? (
              <p className="auth-error-msg">
                Still needed: <strong>{missing.join(', ')}</strong>. Pick the column that holds it.
              </p>
            ) : (
              <div className="csv-summary">
                <span className="badge badge-soft-info">
                  {summary.willImport} row{summary.willImport === 1 ? '' : 's'} will be imported
                </span>
                {summary.willSkip > 0 && (
                  <span className="badge badge-soft-warn">{summary.willSkip} skipped</span>
                )}
                {summary.reasons.map((r) => (
                  <span key={r} className="muted small">{r}</span>
                ))}
              </div>
            )}

            {rows.length > 0 && missing.length === 0 && (
              <div className="csv-preview-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      {spec.fields.filter((f) => (mapping[f.key] ?? -1) !== -1).map((f) => (
                        <th key={f.key}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 8).map((r) => (
                      <tr key={r.line} className={r.valid ? undefined : 'iw-invalid'}>
                        <td className="muted small">{r.line}</td>
                        {spec.fields.filter((f) => (mapping[f.key] ?? -1) !== -1).map((f) => (
                          <td key={f.key}>
                            {Array.isArray(r.record[f.key])
                              ? r.record[f.key].map((v) => (typeof v === 'string' ? v : v.name)).join(', ')
                              : String(r.record[f.key] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 8 && <p className="muted small">…and {rows.length - 8} more rows.</p>}
              </div>
            )}
          </>
        )}

        {importing && (
          <div className="csv-progress">
            <div className="csv-progress-bar"><div className="csv-progress-fill" style={{ width: `${progress}%` }} /></div>
            <span className="muted small mono">{progress}%</span>
          </div>
        )}

        {/* 4 — result */}
        {done && (
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <div className="empty-state-icon" style={{ background: 'var(--c-success-bg)', color: 'var(--c-success)' }}>✓</div>
            <p><strong>{done.imported}</strong> {spec.label.toLowerCase()} imported.</p>
            {done.skipped > 0 && (
              <p className="muted small">{done.skipped} row{done.skipped === 1 ? '' : 's'} were skipped before we started.</p>
            )}
            {done.failures.length > 0 && (
              <div style={{ textAlign: 'left', maxWidth: 560, margin: '12px auto 0' }}>
                <p className="muted small">
                  {done.failures.length} row{done.failures.length === 1 ? '' : 's'} could not be saved.
                  Fix them in your spreadsheet and import again — what came in above is already
                  saved and will not be duplicated.
                </p>
                <ul className="dep-list">
                  {done.failures.slice(0, 10).map((f) => (
                    <li key={f.line} className="dep-item">
                      <span className="badge badge-soft-warn">Line {f.line}</span>
                      <span className="dep-title">{f.label}</span>
                      <span className="muted small">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          {!done && headers && (
            <button
              className="btn btn-primary"
              onClick={runImport}
              disabled={importing || missing.length > 0 || summary.willImport === 0}
            >
              {importing ? 'Importing…' : `Import ${summary.willImport} ${spec.label.toLowerCase()}`}
            </button>
          )}
          <button className="btn" onClick={onClose} disabled={importing}>
            {done ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Write one parsed record. Shared shape so the loop above stays readable. */
async function writeOne(record, ctx) {
  const { kind, userId, workspaceId, projectByName, createdProjects, tasks } = ctx;

  if (kind === 'projects') {
    return addProject(userId, {
      workspaceId,
      name: record.name,
      description: record.description,
      segment: record.segment || '',
      phases: (record.phases || []).map((name) => ({ id: uid(), name })),
    });
  }

  // Tasks and activities both need a project; create one if the file names a
  // project we do not have, so an import is not silently half-applied.
  const resolveProject = async (name) => {
    if (!name) return null;
    const key = name.toLowerCase();
    if (projectByName.has(key)) return projectByName.get(key);
    if (createdProjects.has(key)) return createdProjects.get(key);
    const ref = await addProject(userId, { workspaceId, name });
    const created = { id: ref.id, name, workspaceId, phases: [] };
    createdProjects.set(key, created);
    return created;
  };

  if (kind === 'tasks') {
    const project = await resolveProject(record.project);
    const phase = project?.phases?.find((p) => p.name?.toLowerCase() === record.phase?.toLowerCase());
    return addTask(userId, {
      workspaceId,
      title: record.title,
      description: record.description,
      projectId: project?.id || null,
      phaseId: phase?.id || null,
      priority: record.priority,
      tags: record.tags,
      requestedBy: record.requestedBy,
      plan: { startDate: record.startDate || null, endDate: record.endDate || null },
    });
  }

  // activities
  const project = await resolveProject(record.project);
  let task = tasks.find((t) =>
    (t.title || '').toLowerCase() === record.task.toLowerCase()
    && (project ? t.projectId === project.id : true));

  if (!task) {
    const ref = await addTask(userId, {
      workspaceId,
      title: record.task,
      projectId: project?.id || null,
      requestedBy: record.requestedBy,
    });
    task = { id: ref.id, workspaceId, title: record.task, projectId: project?.id || null };
  }

  return addActivity(userId, task, {
    date: record.date,
    comment: record.comment,
    hoursSpent: record.hours,
    attachments: record.output,
    completionStatus: record.completion,
    bottleneckRemarks: record.bottleneck,
    requestedBy: record.requestedBy,
  });
}
