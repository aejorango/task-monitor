// src/components/AiTaskGenerator.jsx — generate draft tasks from a project
// description, let the user edit/accept/reject each, then bulk-create.

import { useState } from 'react';
import { generateTaskDrafts, getApiKey } from '../services/anthropic';
import { useAuth } from '../hooks/useTasks';
import { addTask, todayLocal } from '../services/firebase';

const DAY = 24 * 60 * 60 * 1000;

function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AiTaskGenerator({ project, onClose }) {
  const { userId } = useAuth();
  const apiKey = getApiKey();
  const [count, setCount] = useState(8);
  const [drafts, setDrafts] = useState(null);     // array | null
  const [accepted, setAccepted] = useState({});   // { [draftId]: true|false }  — true=accept, false=reject, undefined=undecided
  const [editingId, setEditingId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(null);         // { created } once done

  const phaseNames = (project.phases || []).map((p) => p.name);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setDrafts(null);
    setAccepted({});
    try {
      const list = await generateTaskDrafts({
        projectName: project.name,
        projectDescription: project.description || '',
        phaseNames,
        count,
      });
      setDrafts(list);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setGenerating(false);
    }
  };

  const updateDraft = (id, patch) => {
    setDrafts((cur) => cur.map((d) => d.id === id ? { ...d, ...patch } : d));
  };

  const accept = (id, value) => setAccepted((cur) => ({ ...cur, [id]: value }));

  const acceptAll = () => {
    setAccepted(Object.fromEntries(drafts.map((d) => [d.id, true])));
  };

  const createAccepted = async () => {
    const toCreate = drafts.filter((d) => accepted[d.id] === true);
    if (toCreate.length === 0) {
      alert('Mark at least one draft as Accept first.');
      return;
    }
    setCreating(true);
    let created = 0;
    let cursorDay = new Date();
    try {
      for (const d of toCreate) {
        const phase = d.phase
          ? (project.phases || []).find((p) => p.name.toLowerCase() === d.phase.toLowerCase())
          : null;
        const planStart = isoFromDate(cursorDay);
        const planEnd   = isoFromDate(new Date(cursorDay.getTime() + (Math.max(0, d.estimatedDays - 1)) * DAY));
        await addTask(userId, {
          title: d.title,
          description: d.description,
          category: project.name,
          projectId: project.id,
          phaseId: phase?.id || null,
          priority: d.priority,
          plan: { startDate: planStart, endDate: planEnd },
          tags: ['ai-generated'],
        });
        // Move cursor for the next task: estimatedDays after this one finishes.
        cursorDay = new Date(cursorDay.getTime() + d.estimatedDays * DAY);
        created++;
      }
      setDone({ created });
    } catch (err) {
      console.error(err);
      alert(`Failed after creating ${created} task(s): ${err.message || err}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={creating ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <h3 className="modal-title">✨ Generate tasks from description</h3>
        <p className="modal-sub">
          Project: <strong>{project.name}</strong>
          {project.description && <> · {project.description.slice(0, 80)}{project.description.length > 80 ? '…' : ''}</>}
        </p>

        {!apiKey && (
          <div className="auth-error">
            <div className="auth-error-head">
              <span className="badge badge-soft-warn">API key required</span>
            </div>
            <p className="auth-error-msg">
              Set your Anthropic API key in Settings → AI before generating tasks.
              Get one at <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>.
            </p>
          </div>
        )}

        {!drafts && !done && (
          <>
            <div className="field-row">
              <div className="field">
                <label className="label">How many tasks to draft?</label>
                <input type="number" min="3" max="20" className="input" value={count} onChange={(e) => setCount(Math.max(3, Math.min(20, Number(e.target.value) || 8)))} />
              </div>
              <div className="field">
                <label className="label">Phases available</label>
                <p className="muted small" style={{ marginTop: 8 }}>
                  {phaseNames.length > 0 ? phaseNames.join(', ') : '— none —'}
                </p>
              </div>
            </div>
            {error && (
              <div className="auth-error">
                <div className="auth-error-head"><span className="badge badge-soft-danger">Error</span></div>
                <p className="auth-error-msg">{error}</p>
              </div>
            )}
            <div className="modal-actions">
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={generate} disabled={generating || !apiKey}>
                {generating ? 'Generating…' : '✨ Generate drafts'}
              </button>
            </div>
          </>
        )}

        {drafts && !done && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
              <div className="csv-summary">
                <span className="badge badge-soft-success">
                  {Object.values(accepted).filter((v) => v === true).length} accepted
                </span>
                <span className="badge badge-soft-danger">
                  {Object.values(accepted).filter((v) => v === false).length} rejected
                </span>
                <span className="badge badge-soft-muted">
                  {drafts.length - Object.keys(accepted).length} undecided
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={acceptAll}>Accept all</button>
                <button className="btn btn-sm" onClick={generate} disabled={generating}>
                  {generating ? 'Regenerating…' : '↻ Regenerate'}
                </button>
              </div>
            </div>

            <div className="ai-drafts">
              {drafts.map((d) => {
                const state = accepted[d.id];
                const isEditing = editingId === d.id;
                return (
                  <div key={d.id} className={`ai-draft ${state === true ? 'accepted' : ''} ${state === false ? 'rejected' : ''}`}>
                    {isEditing ? (
                      <>
                        <input
                          className="input input-sm"
                          value={d.title}
                          onChange={(e) => updateDraft(d.id, { title: e.target.value })}
                        />
                        <textarea
                          className="textarea"
                          rows={2}
                          value={d.description}
                          onChange={(e) => updateDraft(d.id, { description: e.target.value })}
                        />
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label className="small muted">Priority</label>
                          <select className="select select-sm" value={d.priority} onChange={(e) => updateDraft(d.id, { priority: e.target.value })}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                          <label className="small muted">Phase</label>
                          <select className="select select-sm" value={d.phase} onChange={(e) => updateDraft(d.id, { phase: e.target.value })}>
                            <option value="">—</option>
                            {phaseNames.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <label className="small muted">~Days</label>
                          <input type="number" min="1" max="30" className="input input-sm" style={{ width: 60 }}
                            value={d.estimatedDays}
                            onChange={(e) => updateDraft(d.id, { estimatedDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                          />
                          <div style={{ flex: 1 }} />
                          <button className="btn btn-sm" onClick={() => setEditingId(null)}>Done</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="ai-draft-head">
                          <strong className="ai-draft-title">{d.title}</strong>
                          <span className={`priority-pill ${d.priority}`}><span className="dot" /> {d.priority}</span>
                          {d.phase && <span className="phase-tag">{d.phase}</span>}
                          <span className="muted small">~{d.estimatedDays}d</span>
                        </div>
                        {d.description && <p className="ai-draft-desc">{d.description}</p>}
                      </>
                    )}
                    <div className="ai-draft-actions">
                      {!isEditing && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditingId(d.id)}>✎ Edit</button>
                      )}
                      <button
                        className={`btn btn-sm ${state === true ? 'btn-primary' : ''}`}
                        onClick={() => accept(d.id, state === true ? undefined : true)}
                      >✓ Accept</button>
                      <button
                        className={`btn btn-sm ${state === false ? 'btn-danger' : ''}`}
                        onClick={() => accept(d.id, state === false ? undefined : false)}
                      >✕ Reject</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="modal-actions">
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={onClose} disabled={creating}>Cancel</button>
              <button className="btn btn-primary" onClick={createAccepted} disabled={creating || Object.values(accepted).filter((v) => v === true).length === 0}>
                {creating ? 'Creating…' : `Create ${Object.values(accepted).filter((v) => v === true).length} task(s)`}
              </button>
            </div>
          </>
        )}

        {done && (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div className="empty-state-icon" style={{ background: 'var(--c-success-bg)', color: 'var(--c-success)' }}>✓</div>
            <p><strong>{done.created}</strong> tasks created on <strong>{project.name}</strong>.</p>
            <p className="muted small">They're tagged <span className="mono">#ai-generated</span> and visible on the Board.</p>
            <div className="modal-actions">
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
