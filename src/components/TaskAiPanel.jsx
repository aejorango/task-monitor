// src/components/TaskAiPanel.jsx — per-task AI actions: generate subtasks,
// generate a Claude-ready prompt that can be pasted to produce the actual
// deliverable for the task.

import { useState } from 'react';
import {
  generateSubtasks,
  generateClaudePrompt,
  getEffectiveApiKey as getApiKey,
} from '../services/anthropic';
import Markdown from './Markdown';

export default function TaskAiPanel({ task, project, subtasks, onAddSubtasks }) {
  const apiKey = getApiKey();
  const [busy, setBusy]               = useState(null); // 'subtasks' | 'prompt' | null
  const [subtaskDrafts, setSubtaskDrafts] = useState(null);
  const [accepted, setAccepted]       = useState({});
  const [prompt, setPrompt]           = useState('');
  const [copyOk, setCopyOk]           = useState(false);
  const [error, setError]             = useState(null);

  if (!apiKey) {
    return (
      <div className="auth-error">
        <div className="auth-error-head">
          <span className="badge badge-soft-warn">API key required</span>
        </div>
        <p className="auth-error-msg">
          Set your Anthropic API key in <strong>Settings → AI (Anthropic API)</strong> to use AI on this task.
          Get one at <a className="table-link" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>.
        </p>
      </div>
    );
  }

  const runSubtasks = async () => {
    setBusy('subtasks');
    setError(null);
    setSubtaskDrafts(null);
    setAccepted({});
    try {
      const drafts = await generateSubtasks({
        task,
        projectName: project?.name,
        count: 6,
      });
      setSubtaskDrafts(drafts);
      setAccepted(Object.fromEntries(drafts.map((d) => [d.id, true])));
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  const runPrompt = async () => {
    setBusy('prompt');
    setError(null);
    setPrompt('');
    try {
      const text = await generateClaudePrompt({
        task,
        projectName: project?.name,
        projectDescription: project?.description,
        subtasks,
      });
      setPrompt(text);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch (err) {
      console.error(err);
      alert('Could not copy. Select the text manually and copy.');
    }
  };

  const acceptedCount = Object.values(accepted).filter(Boolean).length;
  const applyAccepted = () => {
    const toAdd = subtaskDrafts
      .filter((d) => accepted[d.id])
      .map((d) => ({ id: d.id, text: d.text, done: false }));
    if (toAdd.length === 0) return;
    onAddSubtasks(toAdd);
    setSubtaskDrafts(null);
    setAccepted({});
  };

  return (
    <div className="task-ai-panel">
      <p className="muted small" style={{ marginTop: 0 }}>
        Use GenAI to break this task down or produce a ready-to-paste prompt for the actual work.
      </p>

      {/* SECTION 1: Subtasks */}
      <div className="ai-action-block">
        <div className="ai-action-head">
          <strong>✨ Generate subtasks</strong>
          <button
            className="btn btn-primary btn-sm"
            onClick={runSubtasks}
            disabled={busy === 'subtasks'}
          >
            {busy === 'subtasks' ? 'Thinking…' : (subtaskDrafts ? 'Regenerate' : 'Generate')}
          </button>
        </div>
        <p className="muted small">Break this task into 4–10 concrete checklist items.</p>

        {subtaskDrafts && (
          <>
            <ul className="ai-subtask-list">
              {subtaskDrafts.map((d) => (
                <li key={d.id} className={`ai-subtask-item ${accepted[d.id] ? 'on' : 'off'}`}>
                  <input
                    type="checkbox"
                    checked={!!accepted[d.id]}
                    onChange={() => setAccepted({ ...accepted, [d.id]: !accepted[d.id] })}
                    style={{ accentColor: 'var(--c-accent)', cursor: 'pointer' }}
                  />
                  <input
                    className="input input-sm"
                    value={d.text}
                    onChange={(e) => setSubtaskDrafts(subtaskDrafts.map((x) => x.id === d.id ? { ...x, text: e.target.value } : x))}
                  />
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => setSubtaskDrafts(null)}>Discard</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={applyAccepted}
                disabled={acceptedCount === 0}
              >
                Add {acceptedCount} subtask{acceptedCount === 1 ? '' : 's'} to checklist
              </button>
            </div>
          </>
        )}
      </div>

      {/* SECTION 2: GenAI prompt */}
      <div className="ai-action-block">
        <div className="ai-action-head">
          <strong>📋 Generate GenAI prompt</strong>
          <button
            className="btn btn-primary btn-sm"
            onClick={runPrompt}
            disabled={busy === 'prompt'}
          >
            {busy === 'prompt' ? 'Thinking…' : (prompt ? 'Regenerate' : 'Generate')}
          </button>
        </div>
        <p className="muted small">
          Get a ready-to-paste prompt for GenAI that, when pasted into a fresh chat, will produce the deliverable for this task.
        </p>

        {prompt && (
          <>
            <textarea
              className="textarea"
              rows={12}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
              <button className="btn btn-sm" onClick={copyPrompt}>
                {copyOk ? '✓ Copied' : '⎘ Copy prompt'}
              </button>
              <a
                className="btn btn-sm btn-primary"
                href="https://claude.ai/new"
                target="_blank"
                rel="noreferrer"
              >Open GenAI →</a>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary className="muted small" style={{ cursor: 'pointer' }}>Preview rendered</summary>
              <div className="markdown-preview" style={{ marginTop: 6 }}>
                <Markdown src={prompt} />
              </div>
            </details>
          </>
        )}
      </div>

      {error && (
        <div className="auth-error">
          <div className="auth-error-head"><span className="badge badge-soft-danger">AI error</span></div>
          <p className="auth-error-msg">{error}</p>
        </div>
      )}
    </div>
  );
}
