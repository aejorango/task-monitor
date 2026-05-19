// src/components/TaskEditor.jsx — edit modal with subtasks, tags, dependencies.

import { useState, useMemo } from 'react';
import { updateTask, softDeleteTask, uid, addTemplate, taskAsTemplatePayload } from '../services/firebase';
import { useTasks, useAuth } from '../hooks/useTasks';

export default function TaskEditor({ task, projects, onClose }) {
  const { tasks: allTasks } = useTasks();
  const { userId } = useAuth();

  const [title, setTitle]             = useState(task.title || '');
  const [description, setDescription] = useState(task.description || '');
  const [projectId, setProjectId]     = useState(task.projectId || '');
  const [phaseId, setPhaseId]         = useState(task.phaseId || '');
  const [priority, setPriority]       = useState(task.priority || 'medium');
  const [planStart, setPlanStart]     = useState(task.plan?.startDate || '');
  const [planEnd, setPlanEnd]         = useState(task.plan?.endDate || '');
  const [actualStart, setActualStart] = useState(task.actual?.startDate || '');
  const [actualEnd, setActualEnd]     = useState(task.actual?.endDate || '');
  const [requestedBy, setRequestedBy] = useState(task.requestedBy || '');
  const [tags, setTags]               = useState(task.tags || []);
  const [subtasks, setSubtasks]       = useState(task.subtasks || []);
  const [dependsOn, setDependsOn]     = useState(task.dependsOn || []);

  const [recurrence, setRecurrence]   = useState(task.recurrence || null);

  const [tagInput, setTagInput]       = useState('');
  const [subtaskInput, setSubtaskInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details'); // 'details' | 'subtasks' | 'deps'

  const selectedProject = projects.find((p) => p.id === projectId);

  // All existing tags from other tasks (for autocomplete)
  const knownTags = useMemo(() => {
    const set = new Set();
    allTasks.forEach((t) => (t.tags || []).forEach((tg) => set.add(tg)));
    return [...set].sort();
  }, [allTasks]);

  const tagSuggestions = tagInput
    ? knownTags.filter((t) => !tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase()))
    : [];

  // Candidates for dependencies = all tasks except this one + already-selected
  const dependsOnCandidates = allTasks
    .filter((t) => t.id !== task.id && !dependsOn.includes(t.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const dependsOnTasks = dependsOn
    .map((id) => allTasks.find((t) => t.id === id))
    .filter(Boolean);

  const completionPct = subtasks.length === 0 ? null :
    Math.round(subtasks.filter((s) => s.done).length / subtasks.length * 100);

  const addTag = (t) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) return;
    setTags([...tags, trimmed]);
    setTagInput('');
  };
  const removeTag = (t) => setTags(tags.filter((x) => x !== t));

  const addSubtask = () => {
    const text = subtaskInput.trim();
    if (!text) return;
    setSubtasks([...subtasks, { id: uid(), text, done: false }]);
    setSubtaskInput('');
  };
  const toggleSubtask = (id) => setSubtasks(subtasks.map((s) => s.id === id ? { ...s, done: !s.done } : s));
  const removeSubtask = (id) => setSubtasks(subtasks.filter((s) => s.id !== id));
  const moveSubtask = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= subtasks.length) return;
    const next = [...subtasks];
    [next[idx], next[target]] = [next[target], next[idx]];
    setSubtasks(next);
  };

  const addDep = (depId) => setDependsOn([...dependsOn, depId]);
  const removeDep = (depId) => setDependsOn(dependsOn.filter((id) => id !== depId));

  const save = async () => {
    setSaving(true);
    try {
      const updates = {
        title: title.trim(),
        description: description.trim(),
        projectId: projectId || null,
        phaseId: phaseId || null,
        priority,
        requestedBy: requestedBy.trim(),
        category: selectedProject?.name || task.category,
        tags,
        subtasks,
        dependsOn,
        recurrence,
        'plan.startDate':   planStart   || null,
        'plan.endDate':     planEnd     || null,
        'actual.startDate': actualStart || null,
        'actual.endDate':   actualEnd   || null,
      };
      if (completionPct !== null) updates.progress = completionPct;
      await updateTask(task.id, updates);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save task. Check console.');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this task? This is a soft delete and can be restored.')) return;
    await softDeleteTask(task.id);
    onClose();
  };

  const saveAsTemplate = async () => {
    const name = prompt('Template name:', title.trim() || 'New template');
    if (!name) return;
    try {
      const payload = taskAsTemplatePayload({
        title: title.trim(),
        description: description.trim(),
        priority,
        requestedBy: requestedBy.trim(),
        projectId: projectId || null,
        phaseId: phaseId || null,
        tags,
        subtasks,
        recurrence,
      });
      await addTemplate(userId, { name: name.trim(), kind: 'task', payload });
      alert(`Saved template "${name.trim()}".`);
    } catch (err) {
      console.error(err);
      alert('Could not save template. Check console.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Edit task</h3>

        <div className="tabbar">
          <button className={`tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>Details</button>
          <button className={`tab ${tab === 'subtasks' ? 'active' : ''}`} onClick={() => setTab('subtasks')}>
            Subtasks {subtasks.length > 0 && <span className="tab-count">{subtasks.filter((s) => s.done).length}/{subtasks.length}</span>}
          </button>
          <button className={`tab ${tab === 'deps' ? 'active' : ''}`} onClick={() => setTab('deps')}>
            Dependencies {dependsOn.length > 0 && <span className="tab-count">{dependsOn.length}</span>}
          </button>
        </div>

        {tab === 'details' && (
          <>
            <div className="field">
              <label className="label">Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Description</label>
              <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field-row">
              <div className="field">
                <label className="label">Project</label>
                <select className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPhaseId(''); }}>
                  <option value="">— None —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label">Phase</label>
                <select className="select" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} disabled={!selectedProject}>
                  <option value="">— None —</option>
                  {selectedProject?.phases?.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label className="label">Priority</label>
                <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="field">
                <label className="label">Requested by</label>
                <input className="input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label className="label">Plan start</label>
                <input type="date" className="input" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Plan end</label>
                <input type="date" className="input" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label className="label">Actual start</label>
                <input type="date" className="input" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Actual end</label>
                <input type="date" className="input" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label className="label">Tags</label>
              <div className="tag-input-wrap">
                {tags.map((t) => (
                  <span key={t} className="tag-pill">
                    #{t} <button type="button" onClick={() => removeTag(t)}>×</button>
                  </span>
                ))}
                <input
                  className="tag-input"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                    if (e.key === 'Backspace' && !tagInput && tags.length) {
                      e.preventDefault(); removeTag(tags[tags.length - 1]);
                    }
                  }}
                  placeholder={tags.length === 0 ? 'Type a tag and press Enter…' : ''}
                />
              </div>
              {tagSuggestions.length > 0 && (
                <div className="tag-suggestions">
                  {tagSuggestions.slice(0, 6).map((s) => (
                    <button key={s} type="button" className="tag-suggest-item" onClick={() => addTag(s)}>
                      #{s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
          </>
        )}

        {tab === 'subtasks' && (
          <div className="field">
            <label className="label">
              Checklist
              {completionPct !== null && (
                <span className="muted small" style={{ marginLeft: 8 }}>
                  {subtasks.filter((s) => s.done).length}/{subtasks.length} complete ({completionPct}%)
                </span>
              )}
            </label>
            {subtasks.length > 0 && (
              <ul className="subtask-list">
                {subtasks.map((s, i) => (
                  <li key={s.id} className={`subtask-item ${s.done ? 'done' : ''}`}>
                    <input
                      type="checkbox"
                      checked={s.done}
                      onChange={() => toggleSubtask(s.id)}
                      style={{ accentColor: 'var(--c-accent)', cursor: 'pointer' }}
                    />
                    <span className="subtask-text">{s.text}</span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveSubtask(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveSubtask(i, 1)} disabled={i === subtasks.length - 1}>↓</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeSubtask(s.id)}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                className="input input-sm"
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                placeholder="Add a subtask…"
              />
              <button type="button" className="btn btn-sm" onClick={addSubtask}>Add</button>
            </div>
          </div>
        )}

        {tab === 'deps' && (
          <div className="field">
            <label className="label">This task depends on…</label>
            {dependsOnTasks.length === 0 ? (
              <p className="muted small">No dependencies. This task can start anytime.</p>
            ) : (
              <ul className="dep-list">
                {dependsOnTasks.map((d) => {
                  const isComplete = d.status === 'done';
                  return (
                    <li key={d.id} className="dep-item">
                      <span className={`badge badge-soft-${isComplete ? 'success' : 'warn'}`}>
                        {isComplete ? '✓ done' : d.status}
                      </span>
                      <span className="dep-title">{d.title}</span>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeDep(d.id)}>✕</button>
                    </li>
                  );
                })}
              </ul>
            )}
            <DepPicker candidates={dependsOnCandidates} onAdd={addDep} />
            {dependsOnTasks.some((d) => d.status !== 'done') && (
              <p className="dep-warn">
                ⚠ This task is blocked by {dependsOnTasks.filter((d) => d.status !== 'done').length} incomplete dependenc{dependsOnTasks.filter((d) => d.status !== 'done').length === 1 ? 'y' : 'ies'}.
              </p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-danger" onClick={remove} disabled={saving}>Delete</button>
          <button className="btn" onClick={saveAsTemplate} disabled={saving || !title.trim()}>Save as template</button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecurrenceEditor({ value, onChange }) {
  const enabled = !!value;
  const rule    = value?.rule || 'weekly';
  const interval = value?.interval || 1;
  const dayOfWeek = value?.dayOfWeek ?? 0;
  const dayOfMonth = value?.dayOfMonth ?? 1;
  const until = value?.until || '';

  const toggle = (on) => {
    if (!on) { onChange(null); return; }
    onChange({ rule: 'weekly', interval: 1, dayOfWeek: new Date().getDay(), until: '' });
  };
  const patch = (delta) => onChange({ rule, interval, dayOfWeek, dayOfMonth, until, ...delta });

  return (
    <div className="field" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
      <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} style={{ accentColor: 'var(--c-accent)' }} />
        <span>Recurring task</span>
      </label>
      {enabled && (
        <div className="recurrence-grid">
          <select className="select select-sm" value={rule} onChange={(e) => patch({ rule: e.target.value })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <span className="muted small">every</span>
          <input
            type="number" min="1" max="99"
            className="input input-sm"
            value={interval}
            onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })}
            style={{ width: 60 }}
          />
          <span className="muted small">
            {rule === 'daily' ? 'day(s)' : rule === 'weekly' ? 'week(s)' : 'month(s)'}
          </span>
          {rule === 'weekly' && (
            <>
              <span className="muted small" style={{ marginLeft: 8 }}>on</span>
              <select className="select select-sm" value={dayOfWeek} onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}>
                <option value={0}>Sun</option>
                <option value={1}>Mon</option>
                <option value={2}>Tue</option>
                <option value={3}>Wed</option>
                <option value={4}>Thu</option>
                <option value={5}>Fri</option>
                <option value={6}>Sat</option>
              </select>
            </>
          )}
          {rule === 'monthly' && (
            <>
              <span className="muted small" style={{ marginLeft: 8 }}>on day</span>
              <input
                type="number" min="1" max="31"
                className="input input-sm"
                value={dayOfMonth}
                onChange={(e) => patch({ dayOfMonth: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })}
                style={{ width: 60 }}
              />
            </>
          )}
          <span className="muted small" style={{ marginLeft: 8 }}>until</span>
          <input
            type="date"
            className="input input-sm"
            value={until}
            onChange={(e) => patch({ until: e.target.value || null })}
            style={{ width: 140 }}
          />
        </div>
      )}
      {enabled && (
        <p className="muted small" style={{ marginTop: 6 }}>
          The next instance is auto-created when this task is marked done.
        </p>
      )}
    </div>
  );
}

function DepPicker({ candidates, onAdd }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = q
    ? candidates.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()))
    : candidates;
  return (
    <div style={{ marginTop: 8 }}>
      {!open ? (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>+ Add dependency</button>
      ) : (
        <div className="dep-picker">
          <input
            className="input input-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a task…"
            autoFocus
          />
          <ul className="dep-picker-list">
            {filtered.length === 0 && <li className="muted small" style={{ padding: 8 }}>No matching tasks.</li>}
            {filtered.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" className="dep-picker-item" onClick={() => { onAdd(t.id); setQ(''); setOpen(false); }}>
                  <span className={`badge badge-soft-${t.status === 'done' ? 'success' : 'muted'}`}>{t.status}</span>
                  <span>{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
