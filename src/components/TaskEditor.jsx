// src/components/TaskEditor.jsx — edit modal with subtasks, tags, dependencies.

import { useState, useMemo } from 'react';
import { addTask, updateTask, softDeleteTask, uid, addTemplate, taskAsTemplatePayload, todayLocal } from '../services/firebase';
import { useTasks, useAuth, useTaskComments } from '../hooks/useTasks';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import { MarkdownEditor } from './Markdown';
import Markdown from './Markdown';
import {
  addTaskComment,
  updateTaskComment,
  softDeleteTaskComment,
} from '../services/firebase';
import TaskAiPanel from './TaskAiPanel';
import { usePresence } from '../hooks/usePresence';

export default function TaskEditor({ task, projects, onClose }) {
  const { tasks: allTasks } = useTasks();
  const { userId } = useAuth();

  const [title, setTitle]             = useState(task.title || '');
  const [description, setDescription] = useState(task.description || '');
  const [projectId, setProjectId]     = useState(task.projectId || '');
  const [phaseId, setPhaseId]         = useState(task.phaseId || '');
  const [priority, setPriority]       = useState(task.priority || 'medium');
  const [status, setStatus]           = useState(task.status || 'todo');
  const [planStart, setPlanStart]     = useState(task.plan?.startDate || '');
  const [planEnd, setPlanEnd]         = useState(task.plan?.endDate || '');
  const [actualStart, setActualStart] = useState(task.actual?.startDate || '');
  const [actualEnd, setActualEnd]     = useState(task.actual?.endDate || '');
  const [requestedBy, setRequestedBy] = useState(task.requestedBy || '');
  const [tags, setTags]               = useState(task.tags || []);
  const [customValues, setCustomValues] = useState(task.customValues || {});
  const [assignedTo, setAssignedTo] = useState(task.assignedTo || []);
  const [subtasks, setSubtasks]       = useState(task.subtasks || []);
  const [dependsOn, setDependsOn]     = useState(task.dependsOn || []);
  const [links, setLinks]             = useState(task.links || []);

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
  const promoteSubtask = async (s) => {
    if (!confirm(`Promote "${s.text}" to a full task?\n\nIt will inherit this task's project and phase. The subtask will be removed from this list.`)) return;
    try {
      await addTask(userId, {
        workspaceId: task.workspaceId,
        title: s.text,
        description: `Promoted from subtask of "${task.title}".`,
        category: selectedProject?.name || task.category,
        projectId: projectId || null,
        phaseId:   phaseId   || null,
        priority,
        requestedBy: requestedBy.trim(),
        tags: [...new Set([...(tags || []), 'promoted'])],
        links: [{ targetId: task.id, type: 'related-to' }],
      });
      setSubtasks(subtasks.filter((x) => x.id !== s.id));
    } catch (err) {
      console.error(err);
      alert('Could not promote subtask. Check console.');
    }
  };
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
      // Mirror the auto-stamping logic from setTaskStatus, but only when the
      // user didn't manually fill the corresponding actual date field. This
      // preserves explicit edits while still being helpful for the common
      // "move task to In progress" flow.
      const today = todayLocal();
      let nextActualStart = actualStart;
      let nextActualEnd   = actualEnd;
      let nextProgress    = task.progress;
      if (status !== task.status) {
        if (status === 'doing' && !nextActualStart) nextActualStart = today;
        if (status === 'done') {
          if (!nextActualStart) nextActualStart = today;
          if (!nextActualEnd)   nextActualEnd   = today;
          nextProgress = 100;
        }
        if (status === 'todo') {
          // Revert: clear stamps unless the user has explicitly set them in
          // the same edit (rare; we trust the form values either way).
          if (nextActualStart === task.actual?.startDate) nextActualStart = null;
          if (nextActualEnd   === task.actual?.endDate)   nextActualEnd   = null;
          if (nextProgress === 100) nextProgress = 0;
        }
      }

      const updates = {
        title: title.trim(),
        description: description.trim(),
        projectId: projectId || null,
        phaseId: phaseId || null,
        priority,
        status,
        progress: nextProgress,
        requestedBy: requestedBy.trim(),
        category: selectedProject?.name || task.category,
        tags,
        subtasks,
        dependsOn,
        links,
        recurrence,
        customValues,
        assignedTo,
        'plan.startDate':   planStart        || null,
        'plan.endDate':     planEnd          || null,
        'actual.startDate': nextActualStart  || null,
        'actual.endDate':   nextActualEnd    || null,
      };
      // Only override progress from subtask completion if the user didn't
      // just transition status (which has its own progress logic).
      if (completionPct !== null && status === task.status) updates.progress = completionPct;
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
      await addTemplate(userId, { workspaceId: task.workspaceId, name: name.trim(), kind: 'task', payload });
      alert(`Saved template "${name.trim()}".`);
    } catch (err) {
      console.error(err);
      alert('Could not save template. Check console.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h3 className="modal-title">Edit task</h3>
          <PresenceStack taskId={task.id} />
        </div>

        <div className="tabbar">
          <button className={`tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>Details</button>
          <button className={`tab ${tab === 'subtasks' ? 'active' : ''}`} onClick={() => setTab('subtasks')}>
            Subtasks {subtasks.length > 0 && <span className="tab-count">{subtasks.filter((s) => s.done).length}/{subtasks.length}</span>}
          </button>
          <button className={`tab ${tab === 'deps' ? 'active' : ''}`} onClick={() => setTab('deps')}>
            Dependencies {dependsOn.length > 0 && <span className="tab-count">{dependsOn.length}</span>}
          </button>
          <button className={`tab ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>
            Comments
          </button>
          <button className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>
            ✨ AI
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
              <MarkdownEditor value={description} onChange={setDescription} rows={4} placeholder="What is this task about?" />
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
                <label className="label">Status</label>
                <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="todo">To do</option>
                  <option value="doing">In progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
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

            <AssigneePicker
              members={selectedProject?.acl || {}}
              membersDetails={selectedProject?.memberDetails || {}}
              assignedTo={assignedTo}
              onChange={setAssignedTo}
            />

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

            <CustomFieldsForm
              fields={selectedProject?.customFields || []}
              values={customValues}
              onChange={setCustomValues}
            />
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
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      title="Promote to its own task"
                      onClick={() => promoteSubtask(s)}
                    >↗</button>
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

            <LinksEditor
              links={links}
              onChange={setLinks}
              candidates={allTasks.filter((t) => t.id !== task.id)}
            />
          </div>
        )}

        {tab === 'comments' && (
          <CommentsThread task={task} userId={userId} />
        )}

        {tab === 'ai' && (
          <TaskAiPanel
            task={{ ...task, title, description, priority, tags, requestedBy }}
            project={selectedProject}
            subtasks={subtasks}
            onAddSubtasks={(newSubs) => {
              setSubtasks([...subtasks, ...newSubs]);
              setTab('subtasks');
            }}
          />
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

function AssigneePicker({ members, assignedTo, onChange }) {
  const uids = Object.keys(members || {});
  const toggle = (uid) => {
    if (assignedTo.includes(uid)) onChange(assignedTo.filter((x) => x !== uid));
    else onChange([...assignedTo, uid]);
  };
  if (uids.length === 0) {
    return null;
  }
  return (
    <div className="field">
      <label className="label">Assigned to ({assignedTo.length})</label>
      <p className="muted small" style={{ marginTop: -4 }}>
        Pick from project members. Use Sharing on the project page to invite teammates.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {uids.map((uid) => {
          const role = members[uid];
          const selected = assignedTo.includes(uid);
          return (
            <button
              key={uid}
              type="button"
              className={`chip ${selected ? 'active' : ''}`}
              title={`${uid} · ${role}`}
              onClick={() => toggle(uid)}
            >
              <span className="mono small">{uid.slice(0, 6)}</span>
              <span className="muted small" style={{ marginLeft: 4 }}>{role}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CustomFieldsForm({ fields, values, onChange }) {
  if (!fields?.length) return null;
  const setValue = (id, v) => onChange({ ...values, [id]: v });
  return (
    <div className="field" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
      <label className="label">Project custom fields</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {fields.map((f) => (
          <div key={f.id}>
            <label className="label">{f.name}</label>
            {f.type === 'text' && (
              <input className="input" value={values[f.id] || ''} onChange={(e) => setValue(f.id, e.target.value)} />
            )}
            {f.type === 'number' && (
              <input type="number" className="input" value={values[f.id] ?? ''} onChange={(e) => setValue(f.id, e.target.value === '' ? '' : Number(e.target.value))} />
            )}
            {f.type === 'date' && (
              <input type="date" className="input" value={values[f.id] || ''} onChange={(e) => setValue(f.id, e.target.value)} />
            )}
            {f.type === 'select' && (
              <select className="select" value={values[f.id] || ''} onChange={(e) => setValue(f.id, e.target.value)}>
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PresenceStack({ taskId }) {
  const others = usePresence(taskId);
  if (!others.length) return null;
  return (
    <div className="presence-stack" title={`Also viewing: ${others.map((p) => p.displayName || p.userId).join(', ')}`}>
      {others.slice(0, 4).map((p, i) => (
        p.photoURL
          ? <img key={p.id} src={p.photoURL} alt="" className="presence-avatar" style={{ zIndex: 10 - i }} />
          : <div key={p.id} className="presence-avatar fallback" style={{ zIndex: 10 - i }}>
              {(p.displayName || p.userId)[0]?.toUpperCase() || '?'}
            </div>
      ))}
      {others.length > 4 && (
        <div className="presence-avatar fallback presence-more">+{others.length - 4}</div>
      )}
    </div>
  );
}

const LINK_TYPES = [
  { value: 'blocks',       label: 'blocks',       badge: 'danger',  icon: '⛔' },
  { value: 'related-to',   label: 'related to',   badge: 'info',    icon: '↔' },
  { value: 'duplicate-of', label: 'duplicate of', badge: 'muted',   icon: '⎘' },
];

function LinksEditor({ links, onChange, candidates }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('related-to');
  const [q, setQ]       = useState('');

  const candidateById = {};
  candidates.forEach((c) => { candidateById[c.id] = c; });

  const filtered = q
    ? candidates.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())
                            && !links.some((l) => l.targetId === t.id))
    : candidates.filter((l) => !links.some((x) => x.targetId === l.id));

  const remove = (idx) => onChange(links.filter((_, i) => i !== idx));
  const add = (targetId) => {
    onChange([...links, { targetId, type }]);
    setQ('');
    setOpen(false);
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
      <label className="label">Related tasks</label>
      {links.length === 0 ? (
        <p className="muted small">No relations. Use these for "blocks", "related to", or "duplicate of" — distinct from a hard dependency.</p>
      ) : (
        <ul className="dep-list">
          {links.map((l, i) => {
            const target = candidateById[l.targetId];
            const def    = LINK_TYPES.find((t) => t.value === l.type) || LINK_TYPES[1];
            return (
              <li key={i} className="dep-item">
                <span className={`badge badge-soft-${def.badge}`}>{def.icon} {def.label}</span>
                <span className="dep-title">{target?.title || '(deleted task)'}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(i)}>✕</button>
              </li>
            );
          })}
        </ul>
      )}

      {!open ? (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} style={{ marginTop: 6 }}>
          + Add relation
        </button>
      ) : (
        <div className="dep-picker" style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <span className="muted small">Type:</span>
            <select className="select select-sm" value={type} onChange={(e) => setType(e.target.value)}>
              {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <input
            className="input input-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a task to link to…"
            autoFocus
          />
          <ul className="dep-picker-list">
            {filtered.length === 0 && <li className="muted small" style={{ padding: 8 }}>No matching tasks.</li>}
            {filtered.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" className="dep-picker-item" onClick={() => add(t.id)}>
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

function CommentsThread({ task, userId }) {
  const taskId = task.id;
  const { comments, loading } = useTaskComments(taskId);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState('');

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    try {
      await addTaskComment(userId, task, text);
      setBody('');
    } catch (err) {
      console.error(err);
      alert('Could not post comment. Check console.');
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (commentId) => {
    const text = editingBody.trim();
    if (!text) { setEditingId(null); return; }
    try { await updateTaskComment(commentId, text); }
    catch (err) { console.error(err); alert('Could not save edit.'); }
    setEditingId(null);
  };

  return (
    <div className="comments-thread">
      {loading ? (
        <p className="muted small">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="muted small">No comments yet. Add the first one below — leave breadcrumbs for your future self.</p>
      ) : (
        <ul className="comments-list">
          {comments.map((c) => {
            const isEditing = editingId === c.id;
            return (
              <li key={c.id} className="comment-item">
                <div className="comment-head">
                  <span className="mono small muted">
                    {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleString() : 'pending'}
                  </span>
                  {c.editedAt && <span className="muted small">(edited)</span>}
                  <div style={{ flex: 1 }} />
                  {!isEditing && (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setEditingId(c.id); setEditingBody(c.body); }}>✎</button>
                      <button className="btn btn-sm btn-ghost link-danger"
                        onClick={() => { if (confirm('Delete this comment?')) softDeleteTaskComment(c.id); }}>✕</button>
                    </>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <MarkdownEditor value={editingBody} onChange={setEditingBody} rows={2} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={() => saveEdit(c.id)}>Save</button>
                    </div>
                  </>
                ) : (
                  <Markdown src={c.body} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="comment-composer">
        <MarkdownEditor value={body} onChange={setBody} rows={3} placeholder="Leave a note… Markdown supported." />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn btn-primary" onClick={post} disabled={posting || !body.trim()}>
            {posting ? 'Posting…' : 'Comment'}
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
