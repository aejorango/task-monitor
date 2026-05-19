// src/components/ProjectsView.jsx — list, create, edit projects + phases.

import { useState } from 'react';
import { useProjects, useTasks, useAuth, useTemplates } from '../hooks/useTasks';
import {
  addProject,
  updateProject,
  archiveProject,
  softDeleteProject,
  uid,
  addTemplate,
  softDeleteTemplate,
  projectAsTemplatePayload,
  setProjectMember,
} from '../services/firebase';
import AiTaskGenerator from './AiTaskGenerator';
import { MarkdownEditor } from './Markdown';

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#3b82f6'];

export default function ProjectsView() {
  const { userId } = useAuth();
  const { projects, loading } = useProjects();
  const { tasks } = useTasks();
  const { templates } = useTemplates();
  const projectTemplates = templates.filter((t) => t.kind === 'project');
  const taskTemplates    = templates.filter((t) => t.kind === 'task');
  const [editing, setEditing] = useState(null);          // project or 'new'
  const [createFromTemplate, setCreateFromTemplate] = useState(null);
  const [aiFor, setAiFor] = useState(null);              // project to generate tasks for

  const stats = (projectId) => {
    const t = tasks.filter((x) => x.projectId === projectId);
    return {
      total: t.length,
      done:  t.filter((x) => x.status === 'done').length,
    };
  };

  if (loading) return <p className="muted">Loading projects…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">Manage projects and their phases. Each task belongs to one project + phase.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + New project
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◉</div>
          <p>No projects yet.</p>
          <p className="small">Click <strong>+ New project</strong> to create one.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const s = stats(p.id);
            return (
              <div key={p.id} className="project-card" onClick={() => setEditing(p)}>
                <div className="project-card-head">
                  <span className="proj-dot" style={{ background: p.color, width: 14, height: 14 }} />
                  <h3 className="project-name">{p.name}</h3>
                  <button
                    className="btn btn-sm btn-ghost"
                    title="Generate tasks from this project's description"
                    onClick={(e) => { e.stopPropagation(); setAiFor(p); }}
                    style={{ marginLeft: 'auto' }}
                  >✨ AI</button>
                </div>
                <p className="project-desc">{p.description || <span className="muted-2">No description</span>}</p>
                <div className="project-phases">
                  {p.phases?.length > 0 ? p.phases.map((ph) => (
                    <span key={ph.id} className="phase-tag">{ph.name}</span>
                  )) : <span className="muted small">No phases</span>}
                </div>
                <div className="project-stats">
                  <span>{s.total} task{s.total === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>{s.done} done</span>
                  {p.archived && (<><span>·</span><span className="badge badge-soft-muted">Archived</span></>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section className="review-section" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="review-h2" style={{ margin: 0 }}>Templates ({templates.length})</h2>
          <span className="muted small">
            Reusable starting points. Save tasks as templates from the task editor.
          </span>
        </div>
        {templates.length === 0 ? (
          <p className="muted small">No templates yet. In the task editor, click <strong>Save as template</strong> to add one.</p>
        ) : (
          <div className="template-grid">
            {projectTemplates.length > 0 && (
              <>
                <div className="template-section-label">Project templates</div>
                {projectTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    onUse={() => setCreateFromTemplate(tpl)}
                  />
                ))}
              </>
            )}
            {taskTemplates.length > 0 && (
              <>
                <div className="template-section-label">Task templates</div>
                {taskTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    note="Use from the Board → Quick-add → + From template"
                  />
                ))}
              </>
            )}
          </div>
        )}
      </section>

      {editing && (
        <ProjectEditor
          project={editing === 'new' ? null : editing}
          userId={userId}
          onClose={() => setEditing(null)}
        />
      )}

      {createFromTemplate && (
        <ProjectEditor
          project={null}
          userId={userId}
          fromTemplate={createFromTemplate}
          onClose={() => setCreateFromTemplate(null)}
        />
      )}

      {aiFor && (
        <AiTaskGenerator
          project={aiFor}
          onClose={() => setAiFor(null)}
        />
      )}
    </>
  );
}

function ProjectSharing({ project }) {
  const [uid, setUid]   = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const acl     = project.acl || {};
  const ownerId = project.userId;
  const members = Object.keys(acl);

  const invite = async () => {
    if (!uid.trim()) return;
    setBusy(true); setError(null);
    try {
      await setProjectMember(project.id, uid.trim(), role);
      setUid('');
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  const removeMember = async (memberUid) => {
    if (memberUid === ownerId) { alert('Cannot remove the project owner.'); return; }
    if (!confirm('Remove this member from the project?')) return;
    try { await setProjectMember(project.id, memberUid, null); }
    catch (err) { console.error(err); alert(err.message); }
  };

  const changeRole = async (memberUid, nextRole) => {
    if (memberUid === ownerId) return;
    try { await setProjectMember(project.id, memberUid, nextRole); }
    catch (err) { console.error(err); alert(err.message); }
  };

  return (
    <div className="field" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
      <label className="label">Sharing</label>
      <p className="muted small" style={{ marginTop: 0 }}>
        Add a member by their Firebase UID. (Email-based invites need a Cloud Function — see roadmap; for now you can find a teammate's UID in their Settings → Account → session ID.)
      </p>

      <ul className="dep-list" style={{ marginBottom: 8 }}>
        {members.map((memberUid) => (
          <li key={memberUid} className="dep-item">
            <span className={`badge badge-soft-${memberUid === ownerId ? 'info' : 'muted'}`}>
              {memberUid === ownerId ? 'owner' : acl[memberUid]}
            </span>
            <span className="dep-title mono small">{memberUid}</span>
            {memberUid !== ownerId && (
              <>
                <select
                  className="select select-sm"
                  value={acl[memberUid]}
                  onChange={(e) => changeRole(memberUid, e.target.value)}
                  style={{ width: 90 }}
                >
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="admin">admin</option>
                </select>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeMember(memberUid)}>✕</button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6 }}>
        <input
          className="input input-sm"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          placeholder="Firebase UID"
        />
        <select className="select select-sm" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="admin">admin</option>
        </select>
        <button type="button" className="btn btn-primary btn-sm" onClick={invite} disabled={busy || !uid.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && (
        <p className="auth-error-msg" style={{ marginTop: 6 }}>{error}</p>
      )}
    </div>
  );
}

function CustomFieldsEditor({ fields, onChange }) {
  const add = () => onChange([...fields, { id: uid(), name: 'New field', type: 'text', options: [] }]);
  const remove = (id) => onChange(fields.filter((f) => f.id !== id));
  const update = (id, patch) => onChange(fields.map((f) => f.id === id ? { ...f, ...patch } : f));

  return (
    <div className="field" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
      <label className="label">Custom fields</label>
      <p className="muted small" style={{ marginTop: 0 }}>
        Extra fields that appear on every task in this project. Text, number, date, or select (predefined options).
      </p>

      {fields.length === 0 ? (
        <p className="muted small">No custom fields.</p>
      ) : (
        <ul className="dep-list">
          {fields.map((f) => (
            <li key={f.id} className="dep-item" style={{ gridTemplateColumns: '1fr auto auto auto', gap: 6 }}>
              <input
                className="input input-sm"
                value={f.name}
                onChange={(e) => update(f.id, { name: e.target.value })}
                placeholder="Field name"
              />
              <select className="select select-sm" value={f.type} onChange={(e) => update(f.id, { type: e.target.value })}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Select</option>
              </select>
              {f.type === 'select' && (
                <input
                  className="input input-sm"
                  style={{ minWidth: 160 }}
                  value={(f.options || []).join(', ')}
                  onChange={(e) => update(f.id, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="comma, separated, values"
                />
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(f.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={add}>+ Add field</button>
    </div>
  );
}

function TemplateCard({ template, onUse, note }) {
  const handleDelete = (e) => {
    e.stopPropagation();
    if (!confirm(`Delete template "${template.name}"?`)) return;
    softDeleteTemplate(template.id);
  };
  return (
    <div className="template-card" onClick={onUse} style={{ cursor: onUse ? 'pointer' : 'default' }}>
      <div className="template-card-head">
        <span className="badge badge-soft-info">{template.kind}</span>
        <strong>{template.name}</strong>
        <button className="btn btn-sm btn-ghost link-danger" onClick={handleDelete} style={{ marginLeft: 'auto' }}>✕</button>
      </div>
      {template.kind === 'project' && (
        <p className="muted small">
          {template.payload?.phases?.length || 0} phases
        </p>
      )}
      {template.kind === 'task' && (
        <>
          <p className="template-task-title">{template.payload?.title}</p>
          {template.payload?.subtasks?.length > 0 && (
            <span className="muted small">{template.payload.subtasks.length} subtask{template.payload.subtasks.length === 1 ? '' : 's'}</span>
          )}
        </>
      )}
      {note && <p className="muted small" style={{ marginTop: 4 }}>{note}</p>}
    </div>
  );
}

function ProjectEditor({ project, userId, fromTemplate, onClose }) {
  const isNew = !project;
  const seed = fromTemplate?.payload;
  const [name, setName]         = useState(project?.name || seed?.name || '');
  const [description, setDescription] = useState(project?.description || seed?.description || '');
  const [color, setColor]       = useState(project?.color || seed?.color || COLORS[0]);
  const [phases, setPhases]     = useState(
    project?.phases?.length ? project.phases :
    seed?.phases?.length ? seed.phases.map((p) => ({ id: uid(), name: p.name, order: p.order })) :
    [
      { id: uid(), name: 'Planning',  order: 0 },
      { id: uid(), name: 'Execution', order: 1 },
      { id: uid(), name: 'Review',    order: 2 },
    ]
  );
  const [customFields, setCustomFields] = useState(project?.customFields || []);
  const [saving, setSaving] = useState(false);

  const addPhase = () => setPhases([...phases, { id: uid(), name: 'New phase', order: phases.length }]);
  const updatePhase = (id, name) => setPhases(phases.map((p) => p.id === id ? { ...p, name } : p));
  const removePhase = (id) => setPhases(phases.filter((p) => p.id !== id));
  const movePhase = (idx, dir) => {
    const next = [...phases];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setPhases(next.map((p, i) => ({ ...p, order: i })));
  };

  const save = async () => {
    if (!name.trim()) { alert('Project name is required.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await addProject(userId, { name: name.trim(), description: description.trim(), color, phases, customFields });
      } else {
        await updateProject(project.id, { name: name.trim(), description: description.trim(), color, phases, customFields });
      }
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save project. Check console.');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete project "${project.name}"? Tasks will remain but lose their project link.`)) return;
    await softDeleteProject(project.id);
    onClose();
  };

  const archive = async () => {
    await archiveProject(project.id);
    onClose();
  };

  const saveAsTemplate = async () => {
    const tplName = prompt('Template name:', name.trim() || 'New project template');
    if (!tplName) return;
    try {
      await addTemplate(userId, {
        name: tplName.trim(),
        kind: 'project',
        payload: projectAsTemplatePayload({ name: name.trim(), description: description.trim(), color, phases }),
      });
      alert(`Saved template "${tplName.trim()}".`);
    } catch (err) {
      console.error(err);
      alert('Could not save template. Check console.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{isNew ? 'New project' : 'Edit project'}</h3>

        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BRIDGED Compliance" />
        </div>

        <div className="field">
          <label className="label">Description</label>
          <MarkdownEditor value={description} onChange={setDescription} rows={3} placeholder="What is this project about? Markdown supported." />
        </div>

        <div className="field">
          <label className="label">Color</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: c, border: color === c ? '2px solid var(--c-text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Phases</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {phases.map((p, i) => (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 4 }}>
                <input className="input input-sm" value={p.name} onChange={(e) => updatePhase(p.id, e.target.value)} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => movePhase(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => movePhase(i, 1)} disabled={i === phases.length - 1}>↓</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removePhase(p.id)} disabled={phases.length === 1}>✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={addPhase} style={{ alignSelf: 'flex-start', marginTop: 4 }}>+ Add phase</button>
          </div>
        </div>

        <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />

        {!isNew && (
          <ProjectSharing project={project} />
        )}

        <div className="modal-actions">
          {!isNew && (
            <>
              <button className="btn btn-danger" onClick={remove} disabled={saving}>Delete</button>
              <button className="btn" onClick={archive} disabled={saving}>Archive</button>
            </>
          )}
          <button className="btn" onClick={saveAsTemplate} disabled={saving || !name.trim()}>Save as template</button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
