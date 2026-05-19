// src/components/TaskEditor.jsx — full edit modal for a task

import { useState } from 'react';
import { updateTask, softDeleteTask } from '../services/firebase';

export default function TaskEditor({ task, projects, onClose }) {
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
  const [saving, setSaving] = useState(false);

  const selectedProject = projects.find((p) => p.id === projectId);

  const save = async () => {
    setSaving(true);
    try {
      await updateTask(task.id, {
        title: title.trim(),
        description: description.trim(),
        projectId: projectId || null,
        phaseId: phaseId || null,
        priority,
        requestedBy: requestedBy.trim(),
        category: selectedProject?.name || task.category,  // keep legacy in sync
        'plan.startDate':   planStart   || null,
        'plan.endDate':     planEnd     || null,
        'actual.startDate': actualStart || null,
        'actual.endDate':   actualEnd   || null,
      });
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Edit task</h3>
        <p className="modal-sub">Update any field. Changes save when you click Save.</p>

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
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Phase</label>
            <select className="select" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} disabled={!selectedProject}>
              <option value="">— None —</option>
              {selectedProject?.phases?.map((ph) => (
                <option key={ph.id} value={ph.id}>{ph.name}</option>
              ))}
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

        <div className="modal-actions">
          <button className="btn btn-danger" onClick={remove} disabled={saving}>Delete</button>
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
