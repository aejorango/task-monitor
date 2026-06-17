// src/components/AiHelper.jsx — topbar "AI" button (yellow bulb) that opens a
// "stuck?" helper: suggests the top 3 things to do next, and per item can
// generate a ready-to-paste Claude prompt to actually get it done.

import { useState } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { suggestTopTasks, generateClaudePrompt, getEffectiveApiKey } from '../services/anthropic';
import { todayLocal } from '../services/firebase';

export default function AiHelper() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="topbar-ai-btn"
        onClick={() => setOpen(true)}
        title="Stuck? Let AI suggest what to do next"
      >
        <BulbIcon />
        <span className="topbar-ai-label">AI</span>
      </button>
      {open && <AiHelperModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AiHelperModal({ onClose }) {
  const { tasks } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const apiKey = getEffectiveApiKey();

  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [suggestions, setSuggestions] = useState(null); // null until first run
  const [prompts, setPrompts]       = useState({});      // suggestionId -> { loading, text, error }

  const suggest = async () => {
    setLoading(true);
    setError('');
    setPrompts({});
    try {
      const list = await suggestTopTasks({ tasks, projects, today: todayLocal(), count: 3 });
      setSuggestions(list);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Could not get suggestions.');
    } finally {
      setLoading(false);
    }
  };

  const genPrompt = async (s) => {
    setPrompts((p) => ({ ...p, [s.id]: { loading: true, text: '', error: '' } }));
    try {
      const task = s.taskId ? tasks.find((t) => t.id === s.taskId) : null;
      const project = task ? projectById[task.projectId] : null;
      const text = await generateClaudePrompt({
        task: task || { title: s.title, description: s.reason },
        projectName: project?.name,
        projectDescription: project?.description,
        subtasks: task?.subtasks || [],
      });
      setPrompts((p) => ({ ...p, [s.id]: { loading: false, text, error: '' } }));
    } catch (err) {
      console.error(err);
      setPrompts((p) => ({ ...p, [s.id]: { loading: false, text: '', error: err?.message || 'Failed to generate prompt.' } }));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="ai-helper-head">
          <div className="ai-helper-bulb"><BulbIcon size={22} /></div>
          <div>
            <h3 className="modal-title" style={{ margin: 0 }}>Stuck? Don't know what to do next?</h3>
            <p className="modal-sub" style={{ margin: '2px 0 0' }}>
              Let AI scan your open tasks and tell you the highest-impact things to tackle now.
            </p>
          </div>
        </div>

        {!apiKey ? (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <p className="muted">AI isn't enabled for your account yet.</p>
            <p className="small muted">An admin needs to assign your account to a company that has an AI key (Settings → User Management).</p>
          </div>
        ) : (
          <>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} onClick={suggest} disabled={loading}>
              {loading ? 'Thinking…' : suggestions ? '↻ Suggest again' : '✨ Suggest my top 3'}
            </button>

            {error && <p className="small" style={{ color: 'var(--c-danger)', marginTop: 10 }}>{error}</p>}

            {suggestions && suggestions.length > 0 && (
              <div className="ai-sug-list">
                {suggestions.map((s, i) => {
                  const pr = prompts[s.id];
                  return (
                    <div key={s.id} className="ai-sug">
                      <div className="ai-sug-row">
                        <span className="ai-sug-rank">{i + 1}</span>
                        <div className="ai-sug-body">
                          <div className="ai-sug-title">{s.title}</div>
                          {s.reason && <div className="ai-sug-reason">{s.reason}</div>}
                          {!s.taskId && <span className="badge badge-soft-muted" style={{ marginTop: 4 }}>new action</span>}
                        </div>
                        <button
                          className="btn btn-sm"
                          onClick={() => genPrompt(s)}
                          disabled={pr?.loading}
                          title="Generate a ready-to-paste Claude prompt to complete this"
                        >
                          {pr?.loading ? 'Generating…' : 'Generate prompt'}
                        </button>
                      </div>

                      {pr?.error && <p className="small" style={{ color: 'var(--c-danger)', margin: '6px 0 0 34px' }}>{pr.error}</p>}
                      {pr?.text && (
                        <div className="ai-sug-prompt">
                          <div className="ai-sug-prompt-head">
                            <span className="small muted">Prompt to paste into Claude</span>
                            <CopyBtn value={pr.text} />
                          </div>
                          <pre className="ai-sug-prompt-text">{pr.text}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {suggestions && suggestions.length === 0 && (
              <p className="muted small" style={{ marginTop: 12 }}>No open tasks to suggest from — add a few tasks and try again.</p>
            )}
          </>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CopyBtn({ value }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); }
    catch (err) { console.error('copy failed', err); }
  };
  return <button type="button" className="btn btn-sm btn-ghost" onClick={copy}>{ok ? '✓ Copied' : '⎘ Copy'}</button>;
}

function BulbIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.5.4.8.9.9 1.5l.1.7h5.2l.1-.7c.1-.6.4-1.1.9-1.5A6 6 0 0 0 12 3z"
        fill="#facc15" stroke="#eab308" strokeWidth="1.2" strokeLinejoin="round"
      />
      <path d="M9 18h6M10 21h4" stroke="#a16207" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
