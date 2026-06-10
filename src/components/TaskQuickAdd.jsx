// src/components/TaskQuickAdd.jsx — lightweight task-creation modal: title +
// project + phase + plan dates + priority. Shared by the Gantt and WBS views,
// which both want a fast way to drop a task onto the timeline.

import { useState } from 'react';
import { useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import { addTask, todayLocal } from '../services/firebase';

export default function TaskQuickAdd({ projects, projectFilter, onClose }) {
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [title, setTitle]     = useState('');
  const [projectId, setProjectId] = useState(
    projectFilter !== 'all' ? projectFilter : (projects[0]?.id || '')
  );
  const [phaseId, setPhaseId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [planStart, setPlanStart] = useState(todayLocal());
  const [planEnd, setPlanEnd]     = useState(todayLocal());
  const [saving, setSaving] = useState(false);

  const project = projects.find((p) => p.id === projectId);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await addTask(userId, {
        workspaceId,
        title: title.trim(),
        category: project?.name || 'Personal',
        projectId: projectId || null,
        phaseId:   phaseId   || null,
        priority,
        plan: { startDate: planStart || null, endDate: planEnd || null },
      });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save task. Check console.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3 className="modal-title">New task</h3>
        <p className="modal-sub">Add a task directly to the timeline.</p>

        <div className="field">
          <label className="label">Title</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) save(); }}
          />
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
            <select className="select" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} disabled={!project}>
              <option value="">— None —</option>
              {project?.phases?.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
            </select>
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

        <div className="field">
          <label className="label">Priority</label>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add task'}
          </button>
        </div>
      </div>
    </div>
  );
}
