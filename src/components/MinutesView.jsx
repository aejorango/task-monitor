// src/components/MinutesView.jsx — meeting minutes. A list of meeting records,
// each with attendees, notes, decisions and trackable action items. Create /
// edit / delete via a modal.

import { useState, useMemo } from 'react';
import { useMinutes, useProjects, useAuth, useTasks } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { addMinute, updateMinute, softDeleteMinute, addTask, softDeleteTask, uid, todayLocal } from '../services/firebase';
import Icon from './Icon';
import TaskActivitiesModal from './TaskActivitiesModal';
import TaskEditor from './TaskEditor';

function PriorityIcon() {
  // Clean monochrome flag/pin — inherits currentColor.
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22V4" />
      <path d="M4 4h12l-2.5 4L16 12H4" />
    </svg>
  );
}

function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  if (!y) return s;
  return new Date(y, m - 1, d).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyMinute = () => ({
  title: '',
  date: todayLocal(),
  attendees: '',
  location: '',
  projectId: '',
  notes: '',
  decisions: '',
  actionItems: [{ id: uid(), text: '', owner: '', due: '', done: false }],
  bossName: '',
  bossMentions: [{ id: uid(), text: '' }],
  bossPushbacks: [{ id: uid(), text: '' }],
});

export default function MinutesView({ projectFilter = 'all' }) {
  const { minutes, loading } = useMinutes();
  const { projects, byId: projectById } = useProjects();
  const { tasks } = useTasks();
  const { userId } = useAuth();
  const { workspaces } = useWorkspaces();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);
  const [editing, setEditing] = useState(null); // minute object or 'new'

  const tasksById = useMemo(() => {
    const m = {};
    tasks.forEach((t) => { m[t.id] = t; });
    return m;
  }, [tasks]);

  // Left-panel selection — seeded from the topbar project filter, then driven
  // by the project list. '__all__' | '__none__' | <projectId>.
  const [selectedId, setSelectedId] = useState(projectFilter !== 'all' ? projectFilter : '__all__');

  const countByProject = useMemo(() => {
    const m = {};
    minutes.forEach((x) => { const k = x.projectId || '__none__'; m[k] = (m[k] || 0) + 1; });
    return m;
  }, [minutes]);
  const hasNoProject = (countByProject['__none__'] || 0) > 0;

  // Group projects by segment
  const projectsBySegment = useMemo(() => {
    const grouped = {};

    // First, add all workspace-defined segments (even if empty)
    const wsSegments = workspace?.segments || [];
    wsSegments.forEach((seg) => {
      grouped[seg.name] = [];
    });

    // Add Uncategorized if not present
    if (!grouped['Uncategorized']) {
      grouped['Uncategorized'] = [];
    }

    // Now add projects to their segments
    projects.forEach((p) => {
      const seg = p.segment || 'Uncategorized';
      if (!grouped[seg]) grouped[seg] = [];
      grouped[seg].push(p);
    });

    // Sort segments: Uncategorized last, others alphabetically
    const keys = Object.keys(grouped).sort((a, b) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
    const sorted = {};
    keys.forEach((k) => { sorted[k] = grouped[k]; });
    return sorted;
  }, [projects, workspace?.segments]);

  const visibleMinutes =
    selectedId === '__all__'  ? minutes
    : selectedId === '__none__' ? minutes.filter((m) => !m.projectId)
    : minutes.filter((m) => m.projectId === selectedId);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Minutes</h1>
          <p className="page-subtitle">Meeting minutes — attendees, notes, decisions and action items.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New minutes</button>
        </div>
      </div>

      <div className="minutes-layout">
        {/* Project panel */}
        <aside className="minutes-nav">
          <div className="minutes-nav-label">Projects</div>
          <button
            className={`minutes-nav-link ${selectedId === '__all__' ? 'active' : ''}`}
            onClick={() => setSelectedId('__all__')}
          >
            <span className="minutes-nav-name">All projects</span>
            <span className="minutes-nav-count">{minutes.length}</span>
          </button>
          {Object.entries(projectsBySegment).map(([segmentName, segmentProjects]) => (
            segmentProjects.length > 0 && (
              <div key={segmentName} className="minutes-nav-segment">
                <div className="minutes-nav-segment-title">{segmentName}</div>
                {segmentProjects.map((p) => (
                  <button
                    key={p.id}
                    className={`minutes-nav-link ${selectedId === p.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="proj-dot" style={{ background: p.color }} />
                    <span className="minutes-nav-name">{p.name}</span>
                    {countByProject[p.id] ? <span className="minutes-nav-count">{countByProject[p.id]}</span> : null}
                  </button>
                ))}
              </div>
            )
          ))}
          {hasNoProject && (
            <button
              className={`minutes-nav-link ${selectedId === '__none__' ? 'active' : ''}`}
              onClick={() => setSelectedId('__none__')}
            >
              <span className="minutes-nav-name muted">No project</span>
              <span className="minutes-nav-count">{countByProject['__none__']}</span>
            </button>
          )}
        </aside>

        {/* Minutes for the selected project */}
        <div className="minutes-content">
          {loading ? (
            <p className="muted">Loading minutes…</p>
          ) : visibleMinutes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              {minutes.length === 0 ? (
                <>
                  <p>No meeting minutes yet.</p>
                  <p className="small">Click <strong>+ New minutes</strong> to record your first meeting.</p>
                </>
              ) : (
                <>
                  <p>No minutes for this project.</p>
                  <p className="small">Pick <strong>All projects</strong> on the left, or add minutes for this project.</p>
                </>
              )}
            </div>
          ) : (
            <div className="minutes-list">
              {visibleMinutes.map((m) => (
                <MinuteCard
                  key={m.id}
                  minute={m}
                  project={projectById[m.projectId]}
                  tasksById={tasksById}
                  projects={projects}
                  userId={userId}
                  onEdit={() => setEditing(m)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <MinuteEditor
          minute={editing === 'new' ? null : editing}
          defaultProjectId={selectedId !== '__all__' && selectedId !== '__none__' ? selectedId : ''}
          projects={projects}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function MinuteCard({ minute, project, tasksById = {}, projects = [], userId, onEdit }) {
  const workspaceId = useActiveWorkspaceId();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null); // action-item id currently syncing to a task
  const [viewingTask, setViewingTask] = useState(null); // → TaskActivitiesModal
  const [editingTask, setEditingTask] = useState(null); // → TaskEditor
  const items = minute.actionItems || [];
  const doneCount = items.filter((i) => i.done).length;

  // Persist a patched action-items array back to the minute.
  const patchItems = (nextItems) => updateMinute(minute.id, { actionItems: nextItems });

  // Create a task from an action item and remember its id on the item so the
  // card can later show "linked" state and offer to delete it again.
  const createTaskFromItem = async (it) => {
    if (!it.text?.trim() || busyId) return;
    setBusyId(it.id);
    try {
      const ref = await addTask(userId, {
        workspaceId,
        title: it.text.trim(),
        projectId: minute.projectId || null,
        description: `From minutes: ${minute.title || 'Untitled meeting'}`,
        plan: { endDate: it.due || null },
        assignedToExternal: it.owner?.trim() ? [it.owner.trim()] : [],
      });
      await patchItems(items.map((x) => (x.id === it.id ? { ...x, taskId: ref.id } : x)));
    } catch (err) {
      console.error(err);
      alert('Could not create task. Check console.');
    } finally {
      setBusyId(null);
    }
  };

  // Soft-delete the linked task and clear the link on the action item.
  const deleteTaskForItem = async (it) => {
    if (!it.taskId || busyId) return;
    if (!confirm('Delete the task created from this action item?')) return;
    setBusyId(it.id);
    try {
      await softDeleteTask(it.taskId);
      await patchItems(items.map((x) => (x.id === it.id ? { ...x, taskId: null } : x)));
    } catch (err) {
      console.error(err);
      alert('Could not delete task. Check console.');
    } finally {
      setBusyId(null);
    }
  };
  const mentions = (minute.bossMentions || []).filter((x) => x.text?.trim());
  const pushbacks = (minute.bossPushbacks || []).filter((x) => x.text?.trim());
  const hasPriority = minute.bossName || mentions.length || pushbacks.length;
  const boss = minute.bossName?.trim();

  return (
    <div className="minute-card">
      <button className="minute-card-head" onClick={() => setOpen((o) => !o)}>
        <div className="minute-card-main">
          <span className="minute-card-title">{minute.title || 'Untitled meeting'}</span>
          <span className="minute-card-meta">
            {fmtDate(minute.date)}
            {minute.location && <> · {minute.location}</>}
            {project && <> · <span className="proj-tag"><span className="proj-dot" style={{ background: project.color }} />{project.name}</span></>}
          </span>
        </div>
        <div className="minute-card-side">
          {items.length > 0 && (
            <span className="badge badge-soft-muted">{doneCount}/{items.length} actions</span>
          )}
          <span className="minute-card-chevron">{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div className={`minute-card-body ${hasPriority ? 'has-priority' : ''}`}>
          <div className="minute-body-main">
            {minute.attendees && (
              <div className="minute-section">
                <div className="minute-section-label">Attendees</div>
                <div className="minute-section-text">{minute.attendees}</div>
              </div>
            )}
            {minute.notes && (
              <div className="minute-section">
                <div className="minute-section-label">Notes</div>
                <div className="minute-section-text pre">{minute.notes}</div>
              </div>
            )}
            {minute.decisions && (
              <div className="minute-section">
                <div className="minute-section-label">Decisions</div>
                <div className="minute-section-text pre">{minute.decisions}</div>
              </div>
            )}

            {items.length > 0 && (
              <div className="minute-section">
                <div className="minute-section-label">Action items</div>
                <ul className="minute-actions">
                  {items.map((it) => (
                    <li key={it.id} className={`minute-action ${it.done ? 'done' : ''}`}>
                      <span className="minute-action-check">{it.done ? '✓' : '○'}</span>
                      <span className="minute-action-text">{it.text || <span className="muted">—</span>}</span>
                      {it.owner && <span className="minute-action-owner">{it.owner}</span>}
                      {it.due && <span className="minute-action-due">{it.due}</span>}
                      {it.taskId ? (
                        <span className="minute-action-task">
                          <button
                            className="icon-btn minute-action-open"
                            title={tasksById[it.taskId] ? 'Open task — log activity / edit' : 'Linked task not found in this workspace'}
                            disabled={!tasksById[it.taskId]}
                            onClick={() => { const t = tasksById[it.taskId]; if (t) setViewingTask(t); }}
                          ><Icon name="board" size={15} /></button>
                          <button
                            className="icon-btn link-danger"
                            disabled={busyId === it.id}
                            onClick={() => deleteTaskForItem(it)}
                            title="Delete the linked task"
                          ><Icon name="trash" size={15} /></button>
                        </span>
                      ) : (
                        it.text?.trim() && (
                          <button
                            className="icon-btn minute-action-add"
                            disabled={busyId === it.id}
                            onClick={() => createTaskFromItem(it)}
                            title="Add as task"
                          ><Icon name="plus" size={15} /></button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="minute-card-actions">
              <button className="btn btn-sm" onClick={onEdit}>✎ Edit</button>
            </div>
          </div>

          {hasPriority && (
            <aside className="minute-body-side">
              <div className="minute-priority">
                <div className="minute-priority-head">
                  <PriorityIcon />
                  <span className="minute-priority-title">The Priority</span>
                  {boss && <span className="minute-priority-boss">{boss}</span>}
                </div>
                <div className="minute-priority-block">
                  <div className="minute-priority-label">
                    Things {boss || 'the boss'} keeps mentioning
                    <span className="minute-priority-hint">important to him</span>
                  </div>
                  {mentions.length > 0 ? (
                    <ol className="minute-priority-list">
                      {mentions.map((x) => <li key={x.id}>{x.text}</li>)}
                    </ol>
                  ) : <div className="minute-priority-empty">—</div>}
                </div>
                <div className="minute-priority-block">
                  <div className="minute-priority-label">
                    Things {boss || 'he'} pushed back
                    <span className="minute-priority-hint">ideas/items he shot down</span>
                  </div>
                  {pushbacks.length > 0 ? (
                    <ol className="minute-priority-list">
                      {pushbacks.map((x) => <li key={x.id}>{x.text}</li>)}
                    </ol>
                  ) : <div className="minute-priority-empty">—</div>}
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {viewingTask && !editingTask && (
        <TaskActivitiesModal
          task={viewingTask}
          userId={userId}
          onClose={() => setViewingTask(null)}
          onEditTask={(t) => setEditingTask(t)}
        />
      )}

      {editingTask && (
        <TaskEditor
          task={editingTask}
          projects={projects}
          onClose={() => { setEditingTask(null); setViewingTask(null); }}
        />
      )}
    </div>
  );
}

function MinuteEditor({ minute, projects = [], defaultProjectId = '', onClose }) {
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [form, setForm] = useState(() =>
    minute
      ? {
          title: minute.title || '',
          date: minute.date || todayLocal(),
          attendees: minute.attendees || '',
          location: minute.location || '',
          projectId: minute.projectId || '',
          notes: minute.notes || '',
          decisions: minute.decisions || '',
          actionItems: (minute.actionItems?.length ? minute.actionItems : [{ id: uid(), text: '', owner: '', due: '', done: false }])
            .map((it) => ({ id: it.id || uid(), text: it.text || '', owner: it.owner || '', due: it.due || '', done: !!it.done, taskId: it.taskId || null })),
          bossName: minute.bossName || '',
          bossMentions: (minute.bossMentions?.length ? minute.bossMentions : [{ id: uid(), text: '' }])
            .map((x) => ({ id: x.id || uid(), text: x.text || '' })),
          bossPushbacks: (minute.bossPushbacks?.length ? minute.bossPushbacks : [{ id: uid(), text: '' }])
            .map((x) => ({ id: x.id || uid(), text: x.text || '' })),
        }
      : { ...emptyMinute(), projectId: defaultProjectId || '' }
  );
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const addItem = () => set({ actionItems: [...form.actionItems, { id: uid(), text: '', owner: '', due: '', done: false }] });
  const setItem = (id, patch) => set({ actionItems: form.actionItems.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  const delItem = (id) => set({ actionItems: form.actionItems.filter((it) => it.id !== id) });

  // Priority list helpers (key = 'bossMentions' | 'bossPushbacks')
  const addPri = (key) => set({ [key]: [...form[key], { id: uid(), text: '' }] });
  const setPri = (key, id, text) => set({ [key]: form[key].map((x) => (x.id === id ? { ...x, text } : x)) });
  const delPri = (key, id) => set({ [key]: form[key].filter((x) => x.id !== id) });

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = {
      ...form,
      title: form.title.trim(),
      projectId: form.projectId || null,
      actionItems: form.actionItems.filter((it) => it.text.trim() || it.owner.trim() || it.due || it.taskId),
      bossName: form.bossName.trim(),
      bossMentions: form.bossMentions.filter((x) => x.text.trim()),
      bossPushbacks: form.bossPushbacks.filter((x) => x.text.trim()),
    };
    try {
      if (minute) await updateMinute(minute.id, payload);
      else await addMinute(userId, { ...payload, workspaceId });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save minutes. Check console.');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!minute) return;
    if (!confirm(`Delete minutes "${minute.title}"?`)) return;
    setSaving(true);
    try { await softDeleteMinute(minute.id); onClose(); }
    catch (err) { console.error(err); alert('Could not delete. Check console.'); setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: '95vw' }}>
        <h3 className="modal-title">{minute ? 'Edit minutes' : 'New minutes'}</h3>
        <p className="modal-sub">Record what happened and who does what next.</p>

        <div className="modal-scroll" style={{ maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
          <div className="field">
            <label className="label">Meeting title</label>
            <input className="input" value={form.title} autoFocus placeholder="e.g. Weekly sync — Data Governance"
              onChange={(e) => set({ title: e.target.value })} />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="label">Date</label>
              <input type="date" className="input" value={form.date} onChange={(e) => set({ date: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Location</label>
              <input className="input" value={form.location} placeholder="Room / link" onChange={(e) => set({ location: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label className="label">Project (optional)</label>
            <select className="select" value={form.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">— None —</option>
              {[...projects].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="label">Attendees</label>
            <input className="input" value={form.attendees} placeholder="Comma-separated names" onChange={(e) => set({ attendees: e.target.value })} />
          </div>

          <div className="field">
            <label className="label">Notes</label>
            <textarea className="input" rows={5} value={form.notes} placeholder="Discussion, updates, context…" onChange={(e) => set({ notes: e.target.value })} />
          </div>

          <div className="field">
            <label className="label">Decisions</label>
            <textarea className="input" rows={3} value={form.decisions} placeholder="What was decided" onChange={(e) => set({ decisions: e.target.value })} />
          </div>

          {/* THE PRIORITY — boss-focused */}
          <div className="field minute-priority-edit">
            <label className="label">The Priority</label>
            <input className="input" value={form.bossName} placeholder="Boss's name (e.g. Mr. Reyes)"
              onChange={(e) => set({ bossName: e.target.value })} />

            <div className="minute-pri-group">
              <div className="minute-pri-group-label">Things the boss keeps mentioning <span className="muted">(important for him)</span></div>
              {form.bossMentions.map((x, i) => (
                <div key={x.id} className="minute-edit-row">
                  <span className="minute-pri-num">{i + 1}</span>
                  <input className="input input-sm" value={x.text} placeholder="What he keeps bringing up"
                    onChange={(e) => setPri('bossMentions', x.id, e.target.value)} />
                  <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => delPri('bossMentions', x.id)}>✕</button>
                </div>
              ))}
              <button className="btn btn-sm" onClick={() => addPri('bossMentions')}>+ Add</button>
            </div>

            <div className="minute-pri-group">
              <div className="minute-pri-group-label">Things he pushed back <span className="muted">(ideas/items he shot down)</span></div>
              {form.bossPushbacks.map((x, i) => (
                <div key={x.id} className="minute-edit-row">
                  <span className="minute-pri-num">{i + 1}</span>
                  <input className="input input-sm" value={x.text} placeholder="What he rejected / resisted"
                    onChange={(e) => setPri('bossPushbacks', x.id, e.target.value)} />
                  <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => delPri('bossPushbacks', x.id)}>✕</button>
                </div>
              ))}
              <button className="btn btn-sm" onClick={() => addPri('bossPushbacks')}>+ Add</button>
            </div>
          </div>

          <div className="field">
            <label className="label">Action items</label>
            {form.actionItems.map((it, i) => (
              <div key={it.id} className="minute-edit-row">
                <button
                  type="button"
                  className={`minute-edit-check ${it.done ? 'done' : ''}`}
                  onClick={() => setItem(it.id, { done: !it.done })}
                  title={it.done ? 'Mark not done' : 'Mark done'}
                >{it.done ? '✓' : ''}</button>
                <div className="minute-edit-fields">
                  <input className="input input-sm" value={it.text} placeholder={`Action ${i + 1}`}
                    onChange={(e) => setItem(it.id, { text: e.target.value })} />
                  <div className="field-row" style={{ gap: 8, margin: 0 }}>
                    <input className="input input-sm" value={it.owner} placeholder="Owner" onChange={(e) => setItem(it.id, { owner: e.target.value })} />
                    <input type="date" className="input input-sm" value={it.due} onChange={(e) => setItem(it.id, { due: e.target.value })} />
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => delItem(it.id)}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={addItem}>+ Add action item</button>
          </div>
        </div>

        <div className="modal-actions">
          {minute && (
            <button className="btn btn-sm btn-ghost link-danger" onClick={remove} disabled={saving}>🗑 Delete</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : minute ? 'Save changes' : 'Create minutes'}
          </button>
        </div>
      </div>
    </div>
  );
}
