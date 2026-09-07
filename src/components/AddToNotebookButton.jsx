// src/components/AddToNotebookButton.jsx — "＋ Notebook": push a URL that is
// already on a task or artifact into that project's NotebookLM notebook, so a
// later grounded answer can cite it.
//
// Two rules shape this button:
//   1. It only exists when the knowledge base is reachable AND a notebook
//      actually resolves for this project — otherwise it is dead UI.
//   2. One add at a time. Google processes each source in the background and
//      firing a loop of them is the fastest way to get the session throttled.

import { useState } from 'react';
import { useKnowledgeStatus } from '../hooks/useKnowledgeStatus';
import { addSource, resolveNotebookFor } from '../services/knowledge';

export default function AddToNotebookButton({
  url,
  project,
  workspace,
  label = '＋ Notebook',
  className = 'btn btn-sm btn-ghost',
}) {
  const { available } = useKnowledgeStatus();
  const notebookId = resolveNotebookFor({ project, workspace });
  const [state, setState] = useState(null);   // null | 'adding' | 'added' | error string

  if (!available || !notebookId || !url) return null;

  const add = async (e) => {
    e.preventDefault();
    e.stopPropagation();          // these usually sit inside a link or a card
    if (state === 'adding') return;
    if (!/^https?:\/\//i.test(String(url))) {
      setState('Only http(s) links can be added as a notebook source.');
      return;
    }
    setState('adding');
    try {
      await addSource(notebookId, { kind: 'url', url });
      setState('added');
    } catch (err) {
      console.error(err);
      setState(err.message || String(err));   // the CLI's own words
    }
  };

  const failed = state && state !== 'adding' && state !== 'added';

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={add}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={state === 'adding' || state === 'added'}
        title={state === 'added'
          ? 'Already added to this project’s notebook'
          : 'Add this link to the project’s NotebookLM notebook'}
      >
        {state === 'adding' ? 'Adding…' : state === 'added' ? '✓ Added' : label}
      </button>
      {state === 'adding' && (
        <span className="muted small"> Google is processing it…</span>
      )}
      {failed && <span className="field-note is-error">{state}</span>}
    </>
  );
}
