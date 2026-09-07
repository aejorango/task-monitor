// src/components/NotebookPicker.jsx — pick the NotebookLM notebook that backs
// a workspace or a project.
//
// The one rule that shapes this component: opening a dropdown must never be
// able to start a subprocess. It reads the shared cache
// (useKnowledgeStatus / cachedNotebooks) and nothing else, so it renders
// instantly, works with the bridge down, and keeps a saved id even when the
// notebook is not in the cache — offline is not proof that it is gone.

import { useMemo } from 'react';
import { useKnowledgeStatus } from '../hooks/useKnowledgeStatus';
import { validateNotebookChoice } from '../services/knowledge';

export default function NotebookPicker({
  value,                 // notebookId | null
  title,                 // last-known title, so an offline picker still reads well
  onChange,              // (notebookId | null, notebookTitle | null) => void
  label = 'Knowledge base (NotebookLM)',
  hint,                  // extra help text under the control
  inheritLabel,          // e.g. "Inherit from workspace (Ops notes)"
  required = false,
  disabled = false,
}) {
  const { available, notebooks, hint: statusHint, probed } = useKnowledgeStatus();

  const list = notebooks;   // null = never fetched, [] = fetched and empty
  const known = useMemo(
    () => (list || []).find((n) => n.id === value) || null,
    [list, value],
  );
  const warning = validateNotebookChoice(value, { required });
  // A saved notebook that is not in the cache still shows its stored title —
  // losing the name because the bridge is down would look like data loss.
  const savedTitle = known?.title || title || (value ? value : '');

  const pick = (id) => {
    if (!id) return onChange(null, null);
    const found = (list || []).find((n) => n.id === id);
    onChange(id, found?.title || savedTitle || null);
  };

  return (
    <div className="field notebook-picker">
      <label className="label" htmlFor="notebook-picker-select">{label}</label>

      {list && list.length > 0 ? (
        <select
          id="notebook-picker-select"
          className="input"
          value={value || ''}
          disabled={disabled}
          onChange={(e) => pick(e.target.value)}
        >
          <option value="">{inheritLabel || 'None — answer from general knowledge'}</option>
          {list.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}{typeof n.sourceCount === 'number' ? ` · ${n.sourceCount} source${n.sourceCount === 1 ? '' : 's'}` : ''}
            </option>
          ))}
          {/* A saved notebook the cache has never seen still needs a row to
              select, or saving the form would silently clear it. */}
          {value && !known && <option value={value}>{savedTitle} (not in your account right now)</option>}
        </select>
      ) : (
        <>
          <input
            id="notebook-picker-select"
            className="input"
            value={savedTitle}
            readOnly
            placeholder={value ? '' : 'No notebook selected'}
          />
          <p className="muted small" style={{ marginTop: 6 }}>
            {!probed ? 'Checking the knowledge base…'
              : available ? 'No notebooks in this account yet — create one at notebooklm.google.com.'
              : statusHint || 'The knowledge base is not connected on this device.'}
            {' '}
            <a href="#/settings" className="link">Open Settings → Knowledge base</a> to re-check.
          </p>
        </>
      )}

      {value && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          style={{ marginTop: 6, alignSelf: 'flex-start' }}
          onClick={() => onChange(null, null)}
          disabled={disabled}
        >Clear</button>
      )}

      {warning && (
        <span className={`field-note is-${warning.level}`} role={warning.level === 'error' ? 'alert' : undefined}>
          ⚠ {warning.message}
        </span>
      )}
      {hint && !warning && <p className="muted small" style={{ marginTop: 6 }}>{hint}</p>}
    </div>
  );
}
