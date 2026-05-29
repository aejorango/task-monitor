// src/components/AiTaskGenerator.jsx — generate draft tasks from a project
// description, let the user edit/accept/reject each, then bulk-create.

import { useState } from 'react';
import { generateTaskDrafts, getApiKey } from '../services/anthropic';
import { useAuth } from '../hooks/useTasks';
import { addTask } from '../services/firebase';

const DAY = 24 * 60 * 60 * 1000;

function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Parse a YYYY-MM-DD string as a local-time Date (no timezone shift).
function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const x = new Date(date);
  x.setDate(x.getDate() + n);
  return x;
}

// Compute plan.startDate / plan.endDate for each task in `tasks`, honoring an
// optional [planStart, planEnd] window.
//
//   • No dates              → start today, lay tasks end-to-end by estimatedDays.
//   • Start only            → start on that date, lay tasks end-to-end.
//   • Start + End (or End   → distribute tasks proportionally to their
//     only → start today)      estimatedDays so they exactly fill the window;
//                              the last task ends on the end date.
//
// Returns an array parallel to `tasks` of { startDate, endDate } ISO strings.
function scheduleDrafts(tasks, planStart, planEnd) {
  const start = planStart ? parseLocalDate(planStart) : new Date();

  // Windowed mode: an explicit end date means we fit everything inside.
  if (planEnd) {
    const end = parseLocalDate(planEnd);
    const spanDays = Math.max(1, Math.round((end - start) / DAY) + 1); // inclusive
    const totalEstimated = tasks.reduce((s, t) => s + Math.max(1, t.estimatedDays || 1), 0);
    let cursorOffset = 0; // days elapsed from start (fractional)
    return tasks.map((t, i) => {
      const share = Math.max(1, t.estimatedDays || 1) / totalEstimated;
      const startOffset = Math.round(cursorOffset);
      cursorOffset += share * spanDays;
      let endOffset = Math.round(cursorOffset) - 1; // inclusive; -1 leaves no overlap
      if (endOffset < startOffset) endOffset = startOffset;
      if (i === tasks.length - 1) endOffset = spanDays - 1; // last task lands on end date
      return {
        startDate: isoFromDate(addDays(start, startOffset)),
        endDate:   isoFromDate(addDays(start, endOffset)),
      };
    });
  }

  // Sequential mode: lay tasks end-to-end by their estimatedDays.
  let cursor = new Date(start);
  return tasks.map((t) => {
    const days = Math.max(1, t.estimatedDays || 1);
    const startDate = isoFromDate(cursor);
    const endDate   = isoFromDate(new Date(cursor.getTime() + (days - 1) * DAY));
    cursor = new Date(cursor.getTime() + days * DAY);
    return { startDate, endDate };
  });
}

export default function AiTaskGenerator({ project, onClose }) {
  const { userId } = useAuth();
  const apiKey = getApiKey();
  const [count, setCount] = useState(8);
  const [planStart, setPlanStart] = useState('');  // '' → start on creation day
  const [planEnd, setPlanEnd]     = useState('');  // '' → sequential (no fixed window)
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

  const dateRangeInvalid = planStart && planEnd && planEnd < planStart;

  const createAccepted = async () => {
    const toCreate = drafts.filter((d) => accepted[d.id] === true);
    if (toCreate.length === 0) {
      alert('Mark at least one draft as Accept first.');
      return;
    }
    if (dateRangeInvalid) {
      alert('End date must be on or after the start date.');
      return;
    }
    setCreating(true);
    let created = 0;
    // Compute the schedule for the accepted tasks up-front, honoring the
    // optional start/end window. The schedule array is parallel to toCreate.
    const schedule = scheduleDrafts(toCreate, planStart, planEnd);
    try {
      for (let i = 0; i < toCreate.length; i++) {
        const d = toCreate[i];
        const { startDate, endDate } = schedule[i];
        const phase = d.phase
          ? (project.phases || []).find((p) => p.name.toLowerCase() === d.phase.toLowerCase())
          : null;
        await addTask(userId, {
          workspaceId: project.workspaceId,
          title: d.title,
          description: d.description,
          category: project.name,
          projectId: project.id,
          phaseId: phase?.id || null,
          priority: d.priority,
          plan: { startDate, endDate },
          tags: ['ai-generated'],
        });
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

            <div className="field-row">
              <div className="field">
                <label className="label">Start date <span className="muted small">(optional)</span></label>
                <input type="date" className="input" value={planStart} max={planEnd || undefined} onChange={(e) => setPlanStart(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">End date <span className="muted small">(optional)</span></label>
                <input type="date" className="input" value={planEnd} min={planStart || undefined} onChange={(e) => setPlanEnd(e.target.value)} />
              </div>
            </div>
            <p className="muted small" style={{ marginTop: -4 }}>
              <ScheduleHint planStart={planStart} planEnd={planEnd} invalid={dateRangeInvalid} />
            </p>

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

            <div className="ai-schedule-bar">
              <span className="small muted" style={{ fontWeight: 600 }}>Schedule:</span>
              <label className="small muted">Start</label>
              <input type="date" className="input input-sm" value={planStart} max={planEnd || undefined} onChange={(e) => setPlanStart(e.target.value)} />
              <label className="small muted">End</label>
              <input type="date" className="input input-sm" value={planEnd} min={planStart || undefined} onChange={(e) => setPlanEnd(e.target.value)} />
              <span className="small muted" style={{ flex: 1 }}>
                <ScheduleHint planStart={planStart} planEnd={planEnd} invalid={dateRangeInvalid} />
              </span>
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
              <button className="btn btn-primary" onClick={createAccepted} disabled={creating || dateRangeInvalid || Object.values(accepted).filter((v) => v === true).length === 0}>
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

// Inline hint describing how the chosen (or unchosen) dates will schedule
// the generated tasks. Keeps the user oriented about what will happen.
function ScheduleHint({ planStart, planEnd, invalid }) {
  if (invalid) {
    return <span style={{ color: 'var(--c-danger)' }}>End date must be on or after the start date.</span>;
  }
  if (planStart && planEnd) {
    return <>Tasks will be spread across <strong>{planStart}</strong> → <strong>{planEnd}</strong>, sized by their estimates; the last one ends on the end date.</>;
  }
  if (planStart && !planEnd) {
    return <>Tasks start on <strong>{planStart}</strong> and run back-to-back by their estimated durations.</>;
  }
  if (!planStart && planEnd) {
    return <>Tasks will be spread from <strong>today</strong> → <strong>{planEnd}</strong>, sized by their estimates.</>;
  }
  return <>No dates set — tasks start <strong>today</strong> and run back-to-back by their estimated durations.</>;
}
