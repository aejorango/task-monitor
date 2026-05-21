// src/components/WorkspaceEditor.jsx — create / edit a workspace.

import { useState } from 'react';
import { useAuth } from '../hooks/useTasks';
import {
  addWorkspace,
  updateWorkspace,
  softDeleteWorkspace,
} from '../services/firebase';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const ICONS  = ['◆', '◉', '◈', '▲', '★', '☀', '✦', '✿', '⌘', '⚡', '☂', '✈'];

export default function WorkspaceEditor({ workspace, onClose }) {
  const { userId } = useAuth();
  const isNew = !workspace;
  const [name, setName]           = useState(workspace?.name || '');
  const [description, setDescr]   = useState(workspace?.description || '');
  const [color, setColor]         = useState(workspace?.color || COLORS[0]);
  const [icon,  setIcon]          = useState(workspace?.icon  || ICONS[0]);
  const [saving, setSaving]       = useState(false);

  const save = async () => {
    if (!name.trim()) { alert('Workspace name is required.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        const result = await addWorkspace(userId, { name: name.trim(), description: description.trim(), color, icon });
        onClose(result.id);
      } else {
        await updateWorkspace(workspace.id, { name: name.trim(), description: description.trim(), color, icon });
        onClose();
      }
    } catch (err) {
      console.error(err);
      alert('Could not save workspace. ' + (err?.message || ''));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete workspace "${workspace.name}"? Projects and tasks inside it become inaccessible. This is a soft delete; an admin can recover via Firestore.`)) return;
    setSaving(true);
    try { await softDeleteWorkspace(workspace.id); onClose(); }
    catch (err) { console.error(err); alert('Could not delete workspace.'); setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3 className="modal-title">{isNew ? 'Create workspace' : 'Edit workspace'}</h3>
        <p className="modal-sub">A workspace contains projects, tasks, activities, and templates. Members of the workspace can see and edit everything inside it.</p>

        <div className="field-row">
          <div className="field" style={{ flex: '0 0 64px' }}>
            <label className="label">Icon & color</label>
            <div className="ws-icon-preview" style={{ background: color }}>{icon}</div>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Name</label>
            <input
              autoFocus
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Personal, Bridged, Client Work"
            />
          </div>
        </div>

        <div className="field">
          <label className="label">Description (optional)</label>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescr(e.target.value)} placeholder="What's this workspace for?" />
        </div>

        <div className="field">
          <label className="label">Color</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: c, border: color === c ? '2px solid var(--c-text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Icon</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICONS.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIcon(i)}
                title={i}
                className={`icon-pick ${icon === i ? 'selected' : ''}`}
              >{i}</button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          {!isNew && <button className="btn btn-danger" onClick={remove} disabled={saving}>Delete</button>}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => onClose()} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
