// src/components/TemplateGallery.jsx — "Start from a template".
//
// The first project on a blank account used to be an empty box and a cursor.
// This offers a handful of real processes — client project, product launch,
// audit, event, new joiner — each with its phases and a starting set of tasks,
// plus "start from scratch" for when none of them fits.

import { useState } from 'react';
import { useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import { addProject, addTask, uid } from '../services/firebase';
import { TEMPLATE_GALLERY, describeTemplate, templateToProject } from '../templates/gallery';
import { friendlyError } from '../services/access';

export default function TemplateGallery({ onClose, onCreated }) {
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [chosen, setChosen] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const pick = (template) => {
    setChosen(template);
    setName(template.name === 'Start from scratch' ? '' : template.name);
    setError(null);
  };

  const create = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      const { project, tasks } = templateToProject(chosen, { uid, name });
      const ref = await addProject(userId, { workspaceId, ...project });
      for (const task of tasks) {
        await addTask(userId, { workspaceId, projectId: ref.id, ...task });
      }
      onCreated?.(ref.id);
      onClose?.();
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, 'Could not create that project. Try again.'));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <h3 className="modal-title">Start from a template</h3>
        <p className="modal-sub">
          Pick the process closest to your work. You get its phases and a starting
          set of tasks — change anything you like afterwards.
        </p>

        <div className="tg-grid">
          {TEMPLATE_GALLERY.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tg-card ${chosen?.id === t.id ? 'is-on' : ''}`}
              onClick={() => pick(t)}
              disabled={busy}
              aria-pressed={chosen?.id === t.id}
            >
              <span className="tg-icon" aria-hidden="true">{t.icon}</span>
              <span className="tg-name">{t.name}</span>
              <span className="muted small tg-summary">{t.summary}</span>
              <span className="muted small tg-meta">{describeTemplate(t)} · {t.audience}</span>
            </button>
          ))}
        </div>

        {chosen && (
          <div className="field" style={{ marginTop: 14 }}>
            <label className="label">Project name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={chosen.name}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              disabled={busy}
            />
            {chosen.phases.length > 0 && (
              <p className="muted small" style={{ marginTop: 6 }}>
                Phases: {chosen.phases.join(' → ')}
              </p>
            )}
          </div>
        )}

        {error && <p className="auth-error-msg">{error}</p>}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={create} disabled={!chosen || busy}>
            {busy ? 'Creating…' : chosen ? `Create “${name.trim() || chosen.name}”` : 'Pick a template'}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
