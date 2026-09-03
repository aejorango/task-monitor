// src/components/AskAiView.jsx — "Ask AI": ask questions about your workspaces,
// projects and tasks in plain language, then keep the thread going.
//
// Every number, list row and metric is computed locally from live Firestore
// data by services/askAi.js — Claude only writes the prose summary, the
// "what I'd do next" list and the follow-up questions. That means the page
// still answers (with a locally written summary) when a company has no AI key.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTasks, useProjects, useAllActivities, useAllWorkspaceProjects, useAllWorkspaceTasks } from '../hooks/useTasks';
import { useWorkspaces, useActiveWorkspaceId } from '../hooks/useWorkspace';
import { auth } from '../services/firebase';
import {
  SCOPES, THINKING, buildDigest, buildSuggestions, routeIntent, buildAnswer,
  narrate, isAiAvailable, answerToText,
  looksLikeAction, parseAction, applyAction,
} from '../services/askAi';

const SCOPE_DEFAULT_INTENT = {
  Workspaces: { key: 'workspaces' },
  Projects:   { key: 'risk' },
  Tasks:      { key: 'people' },
};

export default function AskAiView() {
  const { tasks, loading: tasksLoading, userId, workspaceId } = useTasks();
  const { projects } = useProjects();
  const { activities } = useAllActivities();
  const { workspaces } = useWorkspaces();
  const { projects: allWorkspaceProjects } = useAllWorkspaceProjects();
  const { tasks: allWorkspaceTasks } = useAllWorkspaceTasks();
  const activeWorkspaceId = useActiveWorkspaceId();

  const [draft, setDraft]   = useState('');
  const [turns, setTurns]   = useState([]);
  const [scope, setScope]   = useState('Everything');
  const seqRef  = useRef(0);
  const tailRef = useRef(null);

  const memberProfiles = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId)?.memberProfiles || {},
    [workspaces, activeWorkspaceId],
  );

  const digest = useMemo(() => buildDigest({
    tasks, projects, activities, workspaces,
    allWorkspaceProjects, allWorkspaceTasks,
    memberProfiles, activeWorkspaceId,
  }), [tasks, projects, activities, workspaces, allWorkspaceProjects, allWorkspaceTasks, memberProfiles, activeWorkspaceId]);

  // Keep a ref so `ask` always reads the freshest facts without re-binding.
  const digestRef = useRef(digest);
  useEffect(() => { digestRef.current = digest; }, [digest]);

  const suggestions = useMemo(() => buildSuggestions(digest), [digest]);
  const aiOn = isAiAvailable();

  // Scroll the newest turn into view as it lands.
  useEffect(() => {
    if (turns.length) tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [turns.length]);

  const ask = async (question, intentOverride) => {
    const q = (question || '').trim();
    if (!q) return;
    const id = ++seqRef.current;
    const askedScope = scope;
    setTurns((prev) => [...prev, {
      id, q, scope: askedScope, thinking: true,
      thinkingLabel: THINKING[id % THINKING.length],
    }]);
    setDraft('');

    const started = Date.now();
    try {
      const d = digestRef.current;

      // A typed request to change something takes the write path: it comes
      // back as a proposal to confirm, never as a write. Suggestion cards and
      // follow-up chips always carry an intent, so they stay read-only.
      if (!intentOverride && looksLikeAction(q, d)) {
        const [out] = await Promise.all([
          parseAction({ question: q, digest: d, workspaceId, userId }),
          new Promise((r) => setTimeout(r, 400)),
        ]);
        setTurns((prev) => prev.map((t) => (t.id === id
          ? { ...t, thinking: false, proposal: out.proposal || null, clarify: out.clarify || null }
          : t)));
        return;
      }

      const intent = intentOverride || routeIntent(q, d) || SCOPE_DEFAULT_INTENT[askedScope] || null;
      const base = buildAnswer(intent, d, q);
      const [answer] = await Promise.all([
        narrate({ question: q, answer: base, digest: d, scope: askedScope }),
        // Floor the "thinking" state so it never flashes when AI is off.
        new Promise((r) => setTimeout(r, 500)),
      ]);
      const ms = Date.now() - started;
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, thinking: false, answer, ms, intent } : t)));
    } catch (err) {
      console.error('[ask-ai]', err);
      setTurns((prev) => prev.map((t) => (t.id === id
        ? { ...t, thinking: false, error: err?.message || 'Something went wrong building that answer.' }
        : t)));
    }
  };

  const patchTurn = (id, patch) => setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Only reached from the Confirm button on a proposal card.
  const confirmAction = async (turn) => {
    patchTurn(turn.id, { applying: true, error: null });
    try {
      const receipt = await applyAction(turn.proposal, { userId, digest: digestRef.current });
      patchTurn(turn.id, { applying: false, applied: receipt });
    } catch (err) {
      console.error('[ask-ai] write failed', err);
      patchTurn(turn.id, { applying: false, error: err?.message || 'The write failed. Nothing was changed.' });
    }
  };
  const cancelAction = (turn) => patchTurn(turn.id, { cancelled: true });

  const submit = () => ask(draft);
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } };
  const hasThread = turns.length > 0;

  const user = auth.currentUser;
  const initial = (user?.displayName || user?.email || '?')[0].toUpperCase();

  return (
    <div className="askai">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Ask AI <span className="askai-beta">BETA</span>
          </h1>
          <p className="page-subtitle">
            {hasThread
              ? `${turns.length} ${turns.length === 1 ? 'question' : 'questions'} in this thread · scope: ${scope.toLowerCase()}`
              : 'Ask in plain language about your workspaces, projects and tasks.'}
          </p>
        </div>
        {hasThread && (
          <div className="page-actions">
            <button className="btn btn-sm" onClick={() => { setTurns([]); setDraft(''); seqRef.current = 0; }}>
              ⟲ New thread
            </button>
          </div>
        )}
      </div>

      {/* ── Empty state: hero prompt + suggestions ─────────── */}
      {!hasThread && (
        <>
          <div className="askai-hero">
            <div className="askai-hero-glow" aria-hidden="true" />
            <div className="askai-hero-inner">
              <span className="askai-hero-eyebrow"><SparkIcon size={13} /> Ask anything</span>
              <h2 className="askai-hero-title">What do you want to know about your work?</h2>
              <p className="askai-hero-sub">
                Ask in plain language about your workspaces, projects and tasks — then keep the
                conversation going with follow-up messages.
              </p>

              <div className="askai-scope-row">
                <span className="askai-scope-label">Scope</span>
                {SCOPES.map((s) => (
                  <button
                    key={s}
                    className={`askai-chip dark ${s === scope ? 'active' : ''}`}
                    onClick={() => setScope(s)}
                  >{s}</button>
                ))}
              </div>

              <div className="askai-prompt">
                <SearchIcon />
                <input
                  className="askai-prompt-input"
                  type="text"
                  placeholder="e.g. Which projects are at risk and why?"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                  aria-label="Ask a question about your work"
                />
                <button className="askai-ask-btn" onClick={submit} disabled={!draft.trim()}>
                  Ask <ArrowIcon />
                </button>
              </div>

              <div className="askai-hero-foot">
                <span>↵ to ask</span>
                <span>
                  {aiOn ? 'Reads live data across ' : 'Computed from live data across '}
                  {digest.counts.workspaces} {digest.counts.workspaces === 1 ? 'workspace' : 'workspaces'} ·{' '}
                  {digest.counts.projects} {digest.counts.projects === 1 ? 'project' : 'projects'} ·{' '}
                  {digest.counts.tasks} {digest.counts.tasks === 1 ? 'task' : 'tasks'}
                  {tasksLoading ? ' · loading…' : ''}
                </span>
              </div>
            </div>
          </div>

          {!aiOn && (
            <p className="askai-note">
              AI narration is off for your account, so answers are written from your data locally.
              An admin can connect one in Settings.
            </p>
          )}

          <div className="askai-section-head">
            <span>Try one of these</span>
            <div className="askai-rule" />
          </div>
          <div className="askai-suggestions">
            {suggestions.map((s, i) => (
              <button key={s.q} className="askai-sugg" onClick={() => ask(s.q, s.intent)}>
                <span className={`askai-sugg-icon ${i % 2 ? 'accent' : ''}`}>{s.icon}</span>
                <span className="askai-sugg-body">
                  <span className="askai-sugg-q">{s.q}</span>
                  <span className="askai-sugg-tag">{s.tag}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Conversation transcript ─────────────────────────── */}
      {hasThread && (
        <div className="askai-thread">
          {turns.map((t, i) => (
            <Turn
              key={t.id}
              turn={t}
              initial={initial}
              isLast={i === turns.length - 1}
              // The detail table is shown once per thread — on the opening
              // question — so follow-ups read as a conversation, not as the
              // same table over and over.
              showItems={i === 0}
              aiOn={aiOn}
              onAsk={ask}
              onConfirm={confirmAction}
              onCancel={cancelAction}
              tailRef={i === turns.length - 1 ? tailRef : null}
            />
          ))}
        </div>
      )}

      {/* ── Sticky composer (thread mode) ───────────────────── */}
      {hasThread && (
        <div className="askai-composer">
          <div className="askai-composer-top">
            <span className="askai-scope-label light">Scope</span>
            {SCOPES.map((s) => (
              <button
                key={s}
                className={`askai-chip light ${s === scope ? 'active' : ''}`}
                onClick={() => setScope(s)}
              >{s}</button>
            ))}
            <span className="askai-composer-hint">Follow-ups keep the thread's context</span>
          </div>
          <div className="askai-composer-bar">
            <ChatIcon />
            <input
              className="askai-composer-input"
              type="text"
              placeholder="Ask a follow-up…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              aria-label="Ask a follow-up"
            />
            <button className="askai-send" onClick={submit} disabled={!draft.trim()} aria-label="Send">
              <SendIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── one question + its answer ───────────────────────────── */

function Turn({ turn, initial, isLast, showItems, aiOn, onAsk, onConfirm, onCancel, tailRef }) {
  const a = turn.answer;
  const [helpful, setHelpful] = useState(false);
  const [copied, setCopied]   = useState(false);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(answerToText(turn.q, a));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) { console.error('copy failed', err); }
  };

  return (
    <div className="askai-turn" ref={tailRef}>
      <div className="askai-q-row">
        <div className="askai-q">{turn.q}</div>
        <div className="askai-avatar user">{initial}</div>
      </div>

      <div className="askai-a-row">
        <div className="askai-avatar ai"><SparkIcon size={18} /></div>
        <div className="askai-a-body">
          {turn.thinking && (
            <div className="askai-card askai-thinking">
              <span>{turn.thinkingLabel}</span>
              <span className="askai-dots"><i /><i /><i /></span>
            </div>
          )}

          {turn.error && (
            <div className="askai-card askai-error">
              <strong>Could not answer that.</strong>
              <span>{turn.error}</span>
            </div>
          )}

          {turn.clarify && (
            <div className="askai-card askai-answer">
              <div className="askai-answer-head">
                <span className="askai-badge" data-tone="amber">Need one more thing</span>
              </div>
              <p className="askai-answer-text">{turn.clarify}</p>
            </div>
          )}

          {turn.proposal && !turn.applied && !turn.cancelled && (
            <ProposalCard
              proposal={turn.proposal}
              applying={turn.applying}
              onConfirm={() => onConfirm(turn)}
              onCancel={() => onCancel(turn)}
            />
          )}

          {turn.cancelled && !turn.applied && (
            <div className="askai-card askai-answer askai-cancelled">
              <p className="askai-answer-text">Cancelled — nothing was written.</p>
            </div>
          )}

          {turn.applied && <ReceiptCard proposal={turn.proposal} receipt={turn.applied} />}

          {a && (
            <>
              <div className="askai-card askai-answer">
                <div className="askai-answer-head">
                  <span className="askai-badge" data-tone={a.tone}>{a.badge}</span>
                  <span className="askai-answer-meta">
                    {a.aiUsed ? `answered in ${(turn.ms / 1000).toFixed(1)}s` : 'computed from your data'} · scope: {(turn.scope || 'everything').toLowerCase()}
                  </span>
                </div>
                <p className="askai-answer-text">{a.summary}</p>
              </div>

              {a.metrics?.length > 0 && (
                <div className="askai-metrics">
                  {a.metrics.map((m) => (
                    <div key={m.label} className="askai-metric" data-tone={m.tone}>
                      <div className="askai-metric-label">{m.label}</div>
                      <div className="askai-metric-value">{m.value}</div>
                      <div className="askai-metric-delta" data-tone={m.tone}>{m.delta}</div>
                    </div>
                  ))}
                </div>
              )}

              {showItems && a.items?.length > 0 && (
                <div className="askai-card askai-items">
                  <div className="askai-items-head">
                    <span className="askai-items-title">{a.itemsTitle}</span>
                    <span className="askai-items-count">{a.items.length}</span>
                  </div>
                  {a.items.map((it, i) => (
                    <div key={`${it.title}-${i}`} className="askai-item">
                      <span className="askai-item-dot" style={{ background: it.dot }} />
                      <div className="askai-item-body">
                        <div className="askai-item-title">{it.title}</div>
                        <div className="askai-item-meta">{it.meta}</div>
                      </div>
                      {typeof it.bar === 'number' && (
                        <div className="askai-item-bar">
                          <div className="askai-item-bar-fill" data-tone={it.tone} style={{ width: `${it.bar}%` }} />
                        </div>
                      )}
                      <span className="askai-item-tag" data-tone={it.tone}>{it.tag}</span>
                    </div>
                  ))}
                </div>
              )}

              {a.actions?.length > 0 && (
                <div className="askai-detail">
                  <div className="askai-actions">
                    <div className="askai-detail-title"><span className="askai-star">✦</span>What I'd do next</div>
                    <ul>{a.actions.map((ac, i) => <li key={i}>{ac}</li>)}</ul>
                  </div>
                  <div className="askai-card askai-sources">
                    <div className="askai-detail-title">Based on</div>
                    <div className="askai-source-chips">
                      {a.sources.map((s) => <span key={s} className="askai-source">{s}</span>)}
                    </div>
                    <div className="askai-feedback">
                      <button className={`askai-fb ${helpful ? 'on' : ''}`} onClick={() => setHelpful((v) => !v)}>
                        {helpful ? '✓ Thanks' : '👍 Helpful'}
                      </button>
                      <button className="askai-fb" onClick={share}>{copied ? '✓ Copied' : '↗ Share'}</button>
                      <button className="askai-fb" onClick={() => onAsk(turn.q, turn.intent)}>⟲ Retry</button>
                    </div>
                  </div>
                </div>
              )}

              {isLast && a.followUps?.length > 0 && (
                <div className="askai-followups">
                  <div className="askai-followups-label">Ask a follow-up</div>
                  <div className="askai-followups-row">
                    {a.followUps.map((f) => (
                      <button
                        key={f.label}
                        className="askai-chip light"
                        onClick={() => onAsk(f.q || f.label, f.key ? { key: f.key } : null)}
                      >{f.label} →</button>
                    ))}
                  </div>
                </div>
              )}

              {!aiOn && (
                <p className="askai-note small">Written from your data — AI narration is off for your account.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── write actions: confirm, then receipt ────────────────── */

const OP_TONE = { create: 'green', update: 'amber', delete: 'red' };

function ProposalCard({ proposal, applying, onConfirm, onCancel }) {
  return (
    <div className="askai-card askai-proposal" data-op={proposal.op}>
      <div className="askai-proposal-head">
        <span className="askai-badge" data-tone={OP_TONE[proposal.op] || 'amber'}>{proposal.title}</span>
        <span className="askai-answer-meta">Review it — nothing is written until you confirm.</span>
      </div>

      <dl className="askai-proposal-fields">
        {proposal.fields.map((f) => (
          <div key={f.label} className="askai-proposal-field">
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>

      {proposal.warnings?.map((w) => (
        <p key={w} className="askai-proposal-warn">⚠ {w}</p>
      ))}

      <div className="askai-proposal-actions">
        <button className="askai-confirm" onClick={onConfirm} disabled={applying}>
          {applying ? 'Writing…' : '✓ Confirm'}
        </button>
        <button className="askai-cancel" onClick={onCancel} disabled={applying}>Cancel</button>
      </div>
    </div>
  );
}

const OP_DONE = { create: 'Created', update: 'Updated', delete: 'Deleted' };

function ReceiptCard({ proposal, receipt }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(receipt.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) { console.error('copy failed', err); }
  };
  // In-app navigation: set the hash, then ask the Board to open the task —
  // the same handshake global search uses.
  const open = (e) => {
    e.preventDefault();
    window.location.hash = receipt.hash;
    if (receipt.taskId && receipt.hash.startsWith('#/board')) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('task-monitor:open-task', { detail: { taskId: receipt.taskId } }));
      }, 60);
    }
  };
  return (
    <div className="askai-card askai-receipt">
      <div className="askai-receipt-head">
        <span className="askai-badge" data-tone={proposal.op === 'delete' ? 'red' : 'green'}>
          {OP_DONE[proposal.op]} {proposal.entity}
        </span>
        <strong className="askai-receipt-label">{receipt.label}</strong>
      </div>
      <div className="askai-receipt-link">
        <a href={receipt.url} onClick={open}>{receipt.url}</a>
        <button className="askai-fb" onClick={copy}>{copied ? '✓ Copied' : '⧉ Copy link'}</button>
      </div>
    </div>
  );
}

/* ── icons ───────────────────────────────────────────────── */

function SparkIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 13.6 8.4 19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />
      <path d="M18 16.5 18.7 18.8 21 19.5l-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h13" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}
