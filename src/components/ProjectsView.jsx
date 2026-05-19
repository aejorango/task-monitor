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
} from '../services/firebase';
import AiTaskGenerator from './AiTaskGenerator';

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
        await addProject(userId, { name: name.trim(), description: description.trim(), color, phases });
      } else {
        await updateProject(project.id, { name: name.trim(), description: description.trim(), color, phases });
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
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional context for this project" />
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
