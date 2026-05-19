// src/components/TaskForm.jsx — quick-add card with expandable details.

import { useState, useEffect } from 'react';
import { addTask } from '../services/firebase';
import { useAuth, useTemplates } from '../hooks/useTasks';

export default function TaskForm({ projects = [], projectFilter = 'all' }) {
  const { userId, ready } = useAuth();
  const { templates } = useTemplates();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [planStart, setPlanStart] = useState('');
  const [planEnd, setPlanEnd] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [tags, setTags] = useState([]);
  const [subtasks, setSubtasks] = useState([]);
  const [recurrence, setRecurrence] = useState(null);

  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const taskTemplates = templates.filter((t) => t.kind === 'task');

  const applyTemplate = (tpl) => {
    const p = tpl.payload || {};
    setTitle(p.title || '');
    setDescription(p.description || '');
    setPriority(p.priority || 'medium');
    setRequestedBy(p.requestedBy || '');
    if (p.projectId) setProjectId(p.projectId);
    if (p.phaseId) setPhaseId(p.phaseId);
    setTags(p.tags || []);
    setSubtasks(p.subtasks || []);
    setRecurrence(p.recurrence || null);
    setExpanded(true);
    setTplOpen(false);
  };

  // When projectFilter narrows to a specific project, prefill projectId
  useEffect(() => {
    if (projectFilter !== 'all' && !projectId) setProjectId(projectFilter);
  }, [projectFilter, projectId]);

  // Default to first project if available and none selected
  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const selectedProject = projects.find((p) => p.id === projectId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !userId) return;

    setSubmitting(true);
    try {
      await addTask(userId, {
        title: title.trim(),
        description: description.trim(),
        category: selectedProject?.name || 'Personal',
        projectId: projectId || null,
        phaseId: phaseId || null,
        priority,
        requestedBy: requestedBy.trim(),
        tags,
        subtasks,
        recurrence,
        plan: {
          startDate: planStart || null,
          endDate:   planEnd   || null,
        },
      });
      setTitle('');
      setDescription('');
      setPlanStart('');
      setPlanEnd('');
      setRequestedBy('');
      setTags([]);
      setSubtasks([]);
      setRecurrence(null);
    } catch (err) {
      console.error('Failed to add task:', err);
      alert('Could not save task. Check console.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="quick-add">
      <div className="quick-add-row">
        <input
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          required
          disabled={!ready}
        />
        <select className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPhaseId(''); }} style={{ width: 180 }}>
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={submitting || !ready || !title.trim()}>
          {submitting ? 'Saving…' : 'Add task'}
        </button>
      </div>

      {expanded && (
        <>
          <textarea
            className="textarea"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description / context (optional)"
          />
          <div className="quick-add-detail">
            <div>
              <label className="label">Phase</label>
              <select className="select" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} disabled={!selectedProject}>
                <option value="">— None —</option>
                {selectedProject?.phases?.map((ph) => (
                  <option key={ph.id} value={ph.id}>{ph.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="label">Requested by</label>
              <input className="input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="e.g. Mark" />
            </div>
            <div>
              <label className="label">Plan start</label>
              <input type="date" className="input" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
            </div>
            <div>
              <label className="label">Plan end</label>
              <input type="date" className="input" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? '− Hide details' : '+ More details'}
          </button>
          {taskTemplates.length > 0 && (
            <div className="dropdown">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTplOpen(!tplOpen)}>
                + From template ▾
              </button>
              {tplOpen && (
                <div className="dropdown-menu" style={{ left: 0, right: 'auto' }}>
                  {taskTemplates.map((tpl) => (
                    <button key={tpl.id} type="button" className="dropdown-item" onClick={() => applyTemplate(tpl)}>
                      <span className="mono small">{tpl.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {(tags.length > 0 || subtasks.length > 0 || recurrence) && (
          <span className="muted small">
            {tags.length > 0 && `${tags.length} tag${tags.length === 1 ? '' : 's'}`}
            {subtasks.length > 0 && ` · ${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}`}
            {recurrence && ` · 🔁 ${recurrence.rule}`}
          </span>
        )}
      </div>
    </form>
  );
}
