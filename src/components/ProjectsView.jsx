// src/components/ProjectsView.jsx — list, create, edit projects + phases.

import { useState } from 'react';
import { useProjects, useTasks, useAuth } from '../hooks/useTasks';
import {
  addProject,
  updateProject,
  archiveProject,
  softDeleteProject,
  uid,
} from '../services/firebase';

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#3b82f6'];

export default function ProjectsView() {
  const { userId } = useAuth();
  const { projects, loading } = useProjects();
  const { tasks } = useTasks();
  const [editing, setEditing] = useState(null);          // project or 'new'

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

      {editing && (
        <ProjectEditor
          project={editing === 'new' ? null : editing}
          userId={userId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ProjectEditor({ project, userId, onClose }) {
  const isNew = !project;
  const [name, setName]         = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [color, setColor]       = useState(project?.color || COLORS[0]);
  const [phases, setPhases]     = useState(
    project?.phases?.length ? project.phases : [
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
