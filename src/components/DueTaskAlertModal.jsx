// src/components/DueTaskAlertModal.jsx — the in-app "this task is due" alert.
//
// Mounted once in ApprovedApp (App.jsx) so it appears on every view. Shows
// exactly one task (see hooks/useDueAlertQueue.js) with Done / Skip / Snooze /
// Open task, plus a paste-ready GenAI prompt the user can edit, copy or run.
// The backdrop does not dismiss — this is a deliberate interruption; Esc
// snoozes for the default interval instead.

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDueAlertQueue } from '../hooks/useDueAlertQueue';
import { useProjects } from '../hooks/useTasks';
import { useWorkspaces, useActiveWorkspaceId } from '../hooks/useWorkspace';
import { useAiStatus } from '../hooks/useAiStatus';
import { generateClaudePromptFull } from '../services/anthropic';
import { askAI } from '../services/ai';
import { useKnowledgeStatus } from '../hooks/useKnowledgeStatus';
import { resolveNotebookFor, addSource } from '../services/knowledge';
import {
  buildFallbackPrompt, overdueDays, formatClock, snoozeUntil, SNOOZE_PRESETS_MIN,
} from '../services/dueAlerts';
import Markdown from './Markdown';

const PROMPT_KEY_PREFIX = 'task-monitor.dueAlerts.prompt.v1.';
// Per-device, like snooze/skip: one person grounding their prompts must not
// change what a teammate sees on the same shared task.
const GROUND_KEY = 'task-monitor.dueAlerts.ground.v1';
const RUN_SYSTEM = 'You are completing a task for the user. Produce the deliverable directly, ready to use — no preamble, no commentary about the prompt.';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ── prompt cache (per task + updatedAt) ───────────────────────────────── */

function taskVersion(task) {
  return task?.updatedAt?.toMillis?.() ?? task?.updatedAt?.seconds ?? 0;
}
function loadCachedPrompt(task) {
  try {
    const raw = localStorage.getItem(PROMPT_KEY_PREFIX + task.id);
    if (!raw) return null;
    const c = JSON.parse(raw);
    // A user-edited prompt survives task edits; a generated one is refreshed.
    if (c.edited || c.version === taskVersion(task)) return c;
    return null;
  } catch { return null; }
}
function saveCachedPrompt(task, entry) {
  try {
    localStorage.setItem(PROMPT_KEY_PREFIX + task.id, JSON.stringify({ ...entry, version: taskVersion(task) }));
  } catch { /* private mode */ }
}

function loadGroundPref() {
  try { return localStorage.getItem(GROUND_KEY) !== '0'; } catch { return true; }
}
function saveGroundPref(on) {
  try { localStorage.setItem(GROUND_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error(err);
    alert('Could not copy. Select the text manually and copy.');
    return false;
  }
}

/* ── component ─────────────────────────────────────────────────────────── */

export default function DueTaskAlertModal({ navigate }) {
  const { current, remaining, today, prefs, snooze, skip, markDone, muteAll } = useDueAlertQueue();
  const { byId } = useProjects();
  const { workspaces } = useWorkspaces();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { available: aiAvailable, provider } = useAiStatus();

  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  // Toast lives here (not in the dialog) so it survives the dialog closing.
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Announced by the aria-live region whenever the task on screen changes.
  const live = current ? `Next due task: ${current.title}` : '';

  const project = current ? byId[current.projectId] : null;
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;

  const onSnooze = useCallback((minutes) => {
    const r = snooze(minutes);
    if (r) showToast(`Snoozed “${r.task.title}” until ${formatClock(r.until)}`);
  }, [snooze, showToast]);

  const onSkip = useCallback(() => {
    const t = skip();
    if (t) showToast(`Skipped “${t.title}” for today`);
  }, [skip, showToast]);

  const onDone = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try { await markDone(); }
    catch (err) { showToast(`Could not mark done: ${err.message || err}`); }
    finally { setBusy(false); }
  }, [busy, markDone, showToast]);

  const onCloseAll = useCallback(() => {
    const n = remaining;
    muteAll();
    showToast(`Closed ${n} alert${n === 1 ? '' : 's'} for today — resume from the 🔔 in the top bar`);
  }, [remaining, muteAll, showToast]);

  const onOpen = useCallback(() => {
    if (!current) return;
    const task = current;
    // Snooze briefly so the alert does not sit on top of the editor it opens.
    snooze(5);
    navigate?.({ view: 'board', projectFilter: task.projectId || 'all' });
    // Board listens for this event (Board.jsx) and opens the TaskEditor; the
    // delay lets Board mount / receive the new projectFilter first.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('task-monitor:open-task', { detail: { taskId: task.id } }));
    }, 300);
  }, [current, navigate, snooze]);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{live}</div>
      {current && (
        <AlertDialog
          key={current.id}
          task={current}
          project={project}
          workspace={workspace}
          today={today}
          remaining={remaining}
          prefs={prefs}
          aiAvailable={aiAvailable}
          provider={provider}
          busy={busy}
          onDone={onDone}
          onSkip={onSkip}
          onSnooze={onSnooze}
          onOpen={onOpen}
          onCloseAll={onCloseAll}
        />
      )}
      {toast && <div className="due-alert-toast" role="status">{toast}</div>}
    </>
  );
}

/* ── the dialog itself (remounts per task via key) ─────────────────────── */

export function AlertDialog({
  task, project, workspace, today, remaining, prefs, aiAvailable, provider, busy,
  onDone, onSkip, onSnooze, onOpen, onCloseAll,
}) {
  const dialogRef = useRef(null);
  const snoozeBtnRef = useRef(null);
  const titleId = `due-alert-title-${task.id}`;
  const descId  = `due-alert-desc-${task.id}`;

  const late = overdueDays(task, today);
  const dueLabel = late > 0
    ? `Overdue by ${late} day${late === 1 ? '' : 's'}`
    : late === 0 ? 'Due today' : `Due in ${-late} day${late === -1 ? '' : 's'}`;
  const dueTone = late > 0 ? 'danger' : late === 0 ? 'warn' : 'info';
  const subtasks = (task.subtasks || []).filter(Boolean);
  const openTodo = subtasks.filter((st) => !st.done);
  const doneCount = subtasks.length - openTodo.length;

  /* focus trap + shortcuts. Handlers are read through a ref so the effect
     runs once per task and never steals focus back to Snooze mid-edit. */
  const handlers = useRef({});
  useEffect(() => {
    handlers.current = { onDone, onSkip, onSnooze, defaultMin: prefs.defaultSnoozeMin };
  });
  useEffect(() => {
    const prev = document.activeElement;
    snoozeBtnRef.current?.focus();
    const onKey = (e) => {
      const h = handlers.current;
      const inField = /^(TEXTAREA|INPUT|SELECT)$/.test(e.target?.tagName);
      if (e.key === 'Escape') { e.preventDefault(); h.onSnooze(h.defaultMin); return; }
      if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'd' || e.key === 'D') { e.preventDefault(); h.onDone(); return; }
        if (e.key === 's' || e.key === 'S') { e.preventDefault(); h.onSkip(); return; }
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
        if (nodes.length === 0) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop due-alert-backdrop">
      <div
        ref={dialogRef}
        className="modal due-alert modal-2col"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className="due-alert-head">
          <span className={`badge badge-soft-${dueTone} due-alert-badge`}>{dueLabel}</span>
          <span className="due-alert-head-right">
            {remaining > 1 && <span className="muted small">{remaining - 1} more due after this</span>}
            <button
              type="button"
              className="due-alert-close"
              onClick={onCloseAll}
              aria-label={`Close all ${remaining} due-task alerts for today`}
              title={`Close all alerts for today (${remaining}). Resume any time from the 🔔 in the top bar.`}
            >×</button>
          </span>
        </div>

        {/* DOM order IS tab order: the task and its buttons come before the
            prompt column, so Tab from Snooze walks the actions first and only
            then enters the prompt — and the mobile stack needs no reordering. */}
        <div className="due-alert-grid">
          <div className="due-alert-main">
            <h3 id={titleId} className="modal-title due-alert-title">{task.title}</h3>
            <p id={descId} className="modal-sub due-alert-meta">
              {project && (
                <span className="due-alert-project">
                  <span className="due-alert-dot" style={{ background: project.color || 'var(--c-accent)' }} />
                  {project.name}
                </span>
              )}
              {task.priority && <span className={`badge badge-soft-${task.priority === 'high' || task.priority === 'urgent' ? 'danger' : task.priority === 'low' ? 'muted' : 'info'}`}>{task.priority}</span>}
              {task.plan?.endDate && <span>Due {task.plan.endDate}</span>}
              {task.requestedBy && <span>For {task.requestedBy}</span>}
            </p>

            {task.description && (
              <div className="due-alert-desc markdown-preview">
                <Markdown src={task.description} />
              </div>
            )}

            {openTodo.length > 0 && (
              <div className="due-alert-subtasks">
                <div className="due-alert-subtasks-head">
                  {openTodo.length} open subtask{openTodo.length === 1 ? '' : 's'}
                  {doneCount > 0 && <span className="muted small"> · {doneCount} done</span>}
                </div>
                <ul>
                  {openTodo.slice(0, 8).map((st) => <li key={st.id || st.text}>{st.text}</li>)}
                  {openTodo.length > 8 && <li className="muted">+{openTodo.length - 8} more</li>}
                </ul>
              </div>
            )}

            <div className="modal-actions due-alert-actions">
              <button className="btn btn-primary" onClick={onDone} disabled={busy} title="Shortcut: D">
                {busy ? 'Saving…' : '✓ Done'}
              </button>
              <SnoozeButton ref={snoozeBtnRef} defaultMin={prefs.defaultSnoozeMin} onSnooze={onSnooze} />
              <button className="btn" onClick={onSkip} title="Hide for the rest of today. Shortcut: S">Skip today</button>
              <button className="btn btn-ghost" onClick={onOpen}>Open task →</button>
            </div>
          </div>

          <div className="due-alert-aside">
            <PromptBlock task={task} project={project} workspace={workspace} aiAvailable={aiAvailable} provider={provider} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── snooze split button ───────────────────────────────────────────────── */

const SnoozeButton = forwardRef(function SnoozeButton({ defaultMin, onSnooze }, ref) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (m) => { setOpen(false); onSnooze(m); };
  const customMin = Number(custom);
  const customOk = customMin >= 1 && customMin <= 1440;

  return (
    <div className="due-alert-snooze" ref={wrapRef}>
      <button ref={ref} className="btn" onClick={() => onSnooze(defaultMin)} title="Shortcut: Esc">
        ⏰ Snooze {defaultMin} min
      </button>
      <button
        className="btn due-alert-snooze-caret"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose snooze interval"
        onClick={() => setOpen((o) => !o)}
      >▾</button>
      {open && (
        <div className="due-alert-snooze-menu" role="menu">
          {SNOOZE_PRESETS_MIN.map((m) => (
            <button key={m} role="menuitem" className="due-alert-snooze-item" onClick={() => pick(m)}>
              <span>{m >= 60 ? `${m / 60} h` : `${m} min`}</span>
              <span className="muted small">until {formatClock(snoozeUntil(m))}</span>
            </button>
          ))}
          <div className="due-alert-snooze-custom">
            <input
              className="input input-sm"
              type="number" min={1} max={1440} inputMode="numeric"
              placeholder="Custom minutes"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && customOk) pick(customMin); }}
            />
            <button className="btn btn-sm btn-primary" disabled={!customOk} onClick={() => pick(customMin)}>
              Snooze{customOk ? ` · ${formatClock(snoozeUntil(customMin))}` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

/* ── GenAI prompt: generate (cached) → edit → copy → run ───────────────── */

function PromptBlock({ task, project, workspace, aiAvailable, provider }) {
  const knowledge = useKnowledgeStatus();
  const notebookId = resolveNotebookFor({ project, workspace });
  const canGround = knowledge.available && !!notebookId;
  const [groundOn, setGroundOn] = useState(loadGroundPref);
  const grounded = canGround && groundOn;
  const [entry, setEntry] = useState(() => loadCachedPrompt(task));
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copyOk, setCopyOk] = useState(false);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState(null);     // { text, degraded, reason }
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [savingSource, setSavingSource] = useState(null);   // null | 'saving' | 'saved'

  const fallback = useMemo(() => buildFallbackPrompt(task, project), [task, project]);
  const promptText = entry?.text || fallback;
  const isTemplate = !entry?.text;

  const generate = useCallback(async ({ force = false } = {}) => {
    if (!aiAvailable) return;
    if (!force && entry?.text) return;
    setGenerating(true);
    setError(null);
    try {
      const out = await generateClaudePromptFull({
        task,
        projectName: project?.name,
        projectDescription: project?.description,
        subtasks: task.subtasks || [],
        ground: grounded ? { notebookId, projectId: task.projectId, taskId: task.id } : null,
      });
      const next = {
        text: out.text,
        edited: false,
        grounding: out.grounding || null,
        groundDegraded: out.degraded ? (out.reason || null) : null,
      };
      setEntry(next);
      saveCachedPrompt(task, next);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setGenerating(false);
    }
  }, [aiAvailable, entry?.text, task, project, grounded, notebookId]);

  // First display of a task: generate once, then serve from cache. Deferred a
  // tick so the dialog paints (with the template) before the AI call starts.
  useEffect(() => {
    const id = setTimeout(generate, 0);
    return () => clearTimeout(id);
  }, [generate]);

  const startEdit = () => { setDraft(promptText); setEditing(true); };
  const saveEdit = () => {
    const next = { text: draft.trim() || promptText, edited: true };
    setEntry(next);
    saveCachedPrompt(task, next);
    setEditing(false);
  };

  const copy = async () => {
    if (await copyText(promptText)) { setCopyOk(true); setTimeout(() => setCopyOk(false), 1500); }
  };

  // Push the finished deliverable back into the notebook, so the next task in
  // this project can be grounded in it. One at a time — Google processes each.
  const saveAnswerToNotebook = async () => {
    if (!answer?.text || savingSource === 'saving') return;
    setSavingSource('saving');
    try {
      await addSource(notebookId, {
        kind: 'text',
        title: `${task.title.slice(0, 80)} — ${new Date().toISOString().slice(0, 10)}`,
        text: answer.text,
      });
      setSavingSource('saved');
    } catch (err) {
      console.error(err);
      setSavingSource(null);
      setError(err.message || String(err));
    }
  };

  const run = async () => {
    if (!aiAvailable || running) return;
    setRunning(true);
    setError(null);
    setAnswer(null);
    setSavingSource(null);   // a new answer has not been saved anywhere yet
    try {
      const res = await askAI(RUN_SYSTEM, promptText, {
        meta: { kind: 'due-alert-run', taskId: task.id },
        ground: grounded ? { notebookId, projectId: task.projectId, taskId: task.id } : null,
      });
      setAnswer({
        text: res.text, degraded: !!res.degraded, reason: res.reason,
        provider: res.provider, grounding: res.grounding || null,
      });
    } catch (err) {
      console.error(err);
      const msg = err.message || String(err);
      setError(err.code === 'bridge-unreachable' || /bridge/i.test(msg)
        ? `${msg} Then press Run again.`
        : msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="due-alert-prompt">
      <div className="due-alert-prompt-head">
        <button className="due-alert-prompt-toggle" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
          <strong>✨ Prompt to fulfil this task</strong>
          <span className="muted small">{collapsed ? 'show' : 'hide'}</span>
        </button>
        <span className="due-alert-prompt-badges">
          {entry?.grounding && (
            <span className="badge badge-soft-accent" title="Written with material from your NotebookLM notebook">
              ◇ grounded · {entry.grounding.citations?.length || 0} source{(entry.grounding.citations?.length || 0) === 1 ? '' : 's'}
            </span>
          )}
          {entry?.groundDegraded && (
            <span className="badge badge-soft-warn" title={entry.groundDegraded}>◇ not grounded</span>
          )}
          <span className={`badge badge-soft-${isTemplate ? 'warn' : entry?.edited ? 'info' : 'success'}`}>
            {generating ? 'generating…' : isTemplate ? (aiAvailable ? 'template' : 'Template (AI offline)') : entry?.edited ? 'edited' : 'AI generated'}
          </span>
        </span>
      </div>

      {!collapsed && (
        <>
          {editing ? (
            <textarea
              className="textarea due-alert-textarea"
              rows={Math.min(24, Math.max(8, draft.split('\n').length + 1))}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          ) : (
            <pre className="due-alert-pre">{generating && !entry?.text ? 'Writing a prompt for this task…' : promptText}</pre>
          )}

          {canGround && (
            <label className="due-alert-ground" title={`Retrieve from “${project?.knowledge?.notebookTitle || workspace?.knowledge?.notebookTitle || notebookId}” before writing`}>
              <input
                type="checkbox"
                checked={groundOn}
                onChange={(e) => { setGroundOn(e.target.checked); saveGroundPref(e.target.checked); }}
              />
              <span>Ground in this project's notebook</span>
            </label>
          )}

          {entry?.groundDegraded && <p className="field-note is-warning">{entry.groundDegraded}</p>}

          <div className="due-alert-prompt-actions">
            {editing ? (
              <>
                <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={startEdit} disabled={generating}>✎ Edit</button>
                <button className="btn btn-sm" onClick={copy} disabled={generating}>{copyOk ? '✓ Copied' : '⎘ Copy prompt'}</button>
                {aiAvailable && (
                  <button className="btn btn-sm btn-ghost" onClick={() => generate({ force: true })} disabled={generating || running}>
                    {generating ? 'Generating…' : '↻ Regenerate'}
                  </button>
                )}
                <button
                  className="btn btn-sm btn-primary"
                  onClick={run}
                  disabled={!aiAvailable || running || generating}
                  title={aiAvailable ? `Run with ${provider || 'AI'}` : 'AI is not available — copy the prompt into any GenAI tool instead'}
                >
                  {running ? 'Working…' : answer ? '▶ Run again' : '▶ Run'}
                </button>
              </>
            )}
          </div>

          {!aiAvailable && (
            <p className="muted small due-alert-note">
              No AI brain is connected on this device, so Run is disabled. Copy the prompt into any GenAI tool.
            </p>
          )}

          {error && <div className="due-alert-error" role="alert">{error}</div>}

          {answer && (
            <div className="due-alert-answer">
              <div className="due-alert-prompt-head">
                <strong>Result</strong>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {answer.grounding && (
                    <span className="badge badge-soft-accent">
                      ◇ grounded · {answer.grounding.citations?.length || 0} source{(answer.grounding.citations?.length || 0) === 1 ? '' : 's'}
                    </span>
                  )}
                  {answer.degraded && (
                    <span className="badge badge-soft-warn" title={answer.reason}>degraded</span>
                  )}
                  <button className="btn btn-sm" onClick={() => copyText(answer.text)}>⎘ Copy answer</button>
                  {canGround && (
                    <button
                      className="btn btn-sm"
                      disabled={savingSource === 'saving'}
                      onClick={saveAnswerToNotebook}
                    >
                      {savingSource === 'saving' ? 'Adding…' : savingSource === 'saved' ? '✓ In notebook' : '＋ Notebook'}
                    </button>
                  )}
                </div>
              </div>
              {answer.degraded && answer.reason && <p className="muted small due-alert-note">{answer.reason}</p>}
              <div className="markdown-preview due-alert-answer-body">
                <Markdown src={answer.text} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
