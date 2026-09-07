// src/components/KnowledgeSection.jsx — Settings → "Knowledge base (NotebookLM)".
//
// The whole integration lives on the operator's own machine, so this section
// has to be honest about four different worlds and give each one the ONE
// command that moves it forward:
//
//   bridge down        → start the bridge
//   CLI missing        → pipx install …
//   CLI, not signed in → notebooklm login
//   signed in, empty   → create a notebook at notebooklm.google.com
//   ready              → the notebook table, with sources and usage
//
// Re-check re-probes without a restart, which is the point: an operator runs
// `notebooklm login` in a terminal and comes straight back here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useKnowledgeStatus } from '../hooks/useKnowledgeStatus';
import { useWorkspaces } from '../hooks/useWorkspace';
import { useAllWorkspaceProjects } from '../hooks/useTasks';
import {
  fetchSources, addSource, fetchNotebookUsage, BRIDGE_DOWN_HINT, bridgeUrl,
  bridgeOff, enableBridgeHere, localNetworkNote,
} from '../services/knowledge';

const INSTALL_CMDS = [
  'brew install pipx && pipx ensurepath',
  'pipx install "notebooklm-py[browser]"',
  'notebooklm login',
];

function CopyCmd({ cmd }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setOk(true);
      setTimeout(() => setOk(false), 1400);
    } catch (err) { console.error(err); }
  };
  return (
    <div className="kb-cmd">
      <code className="mono">{cmd}</code>
      <button type="button" className="btn btn-sm" onClick={copy}>{ok ? '✓ Copied' : '⎘ Copy'}</button>
    </div>
  );
}

export default function KnowledgeSection() {
  const { available, cliFound, authenticated, bridgeOk, hint, notebooks, loading, probed, recheck } =
    useKnowledgeStatus();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);   // notebookId whose detail is open

  const { workspaces } = useWorkspaces();
  const { projects } = useAllWorkspaceProjects();

  const doRecheck = useCallback(async () => {
    setBusy(true);
    try { await recheck(); } finally { setBusy(false); }
  }, [recheck]);

  // Which workspaces / projects point at which notebook. Pure client-side
  // scan — the notebook itself has no idea anything depends on it.
  const dependentsByNotebook = useMemo(() => {
    const map = new Map();
    const add = (id, entry) => {
      if (!id) return;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(entry);
    };
    workspaces.forEach((w) => add(w.knowledge?.notebookId, {
      kind: 'workspace', id: w.id, name: w.name, title: w.knowledge?.notebookTitle,
    }));
    projects.forEach((p) => add(p.knowledge?.notebookId, {
      kind: 'project', id: p.id, name: p.name, title: p.knowledge?.notebookTitle,
    }));
    return map;
  }, [workspaces, projects]);

  // A notebook that something still references but the account no longer
  // lists: deleted or renamed in Google. Never silently drop the reference.
  const orphans = useMemo(() => {
    if (!Array.isArray(notebooks)) return [];
    const known = new Set(notebooks.map((n) => n.id));
    return [...dependentsByNotebook.entries()]
      .filter(([id]) => !known.has(id))
      .map(([id, deps]) => ({ id, deps, title: deps.find((d) => d.title)?.title || id }));
  }, [notebooks, dependentsByNotebook]);

  const state = !bridgeOk ? 'bridge-down'
    : !cliFound ? 'no-cli'
    : !authenticated ? 'signed-out'
    : (Array.isArray(notebooks) && notebooks.length === 0) ? 'empty'
    : 'ready';

  return (
    <section id="settings-knowledge" className="review-section htu-section">
      <h2 className="review-h2-accent">Knowledge base (NotebookLM)</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Point the app at your own Google NotebookLM notebooks so AI answers cite <em>your</em>{' '}
        documents instead of general knowledge. Entirely optional — everything else works without it.
      </p>

      <div className="kb-statusbar">
        <span className={`badge badge-soft-${available ? 'success' : state === 'empty' ? 'warn' : 'muted'}`}>
          {!probed ? 'Checking…'
            : available ? `Connected · ${notebooks?.length ?? 0} notebook${notebooks?.length === 1 ? '' : 's'}`
            : state === 'bridge-down' ? 'Bridge not running'
            : state === 'no-cli' ? 'Not installed'
            : state === 'signed-out' ? 'Not signed in'
            : 'No notebooks yet'}
        </span>
        <button type="button" className="btn btn-sm" onClick={doRecheck} disabled={busy || loading}>
          {busy || loading ? 'Checking…' : '↻ Re-check'}
        </button>
        <span className="muted small">Bridge <span className="mono">{bridgeUrl()}</span></span>
      </div>

      {state === 'bridge-down' && (
        <div className="kb-panel">
          <strong>Start the AI bridge</strong>
          <p className="muted small">{hint || BRIDGE_DOWN_HINT}</p>
          {bridgeOff() && (
            <p style={{ margin: '6px 0 10px' }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={async () => { setBusy(true); try { await enableBridgeHere(); } finally { setBusy(false); } }}
              >
                Enable the bridge on this device
              </button>
              <span className="muted small" style={{ marginLeft: 8 }}>
                Sets Settings → AI brain → Bridge to “Always probe” for this browser and re-checks.
              </span>
            </p>
          )}
          <CopyCmd cmd="npm run bridge" />
          {localNetworkNote() && <p className="muted small" style={{ marginTop: 8 }}>{localNetworkNote()}</p>}
        </div>
      )}

      {state === 'no-cli' && (
        <div className="kb-panel">
          <strong>One-time setup</strong>
          <p className="muted small">
            Run these on the machine that runs the bridge, and sign in with a{' '}
            <strong>dedicated Google account</strong> — the CLI drives a real browser session.
          </p>
          {INSTALL_CMDS.map((c) => <CopyCmd key={c} cmd={c} />)}
          <p className="muted small">Then press Re-check. No restart needed.</p>
        </div>
      )}

      {state === 'signed-out' && (
        <div className="kb-panel">
          <strong>Almost there</strong>
          <p className="muted small">{hint}</p>
          <CopyCmd cmd="notebooklm login" />
        </div>
      )}

      {state === 'empty' && (
        <div className="kb-panel">
          <strong>Signed in — no notebooks yet</strong>
          <p className="muted small">
            Create one at <a className="link" href="https://notebooklm.google.com" target="_blank" rel="noreferrer noopener">notebooklm.google.com</a>,
            add a few sources, then press Re-check.
          </p>
        </div>
      )}

      {state === 'ready' && (
        <div className="kb-table">
          <div className="kb-row kb-head">
            <span>Notebook</span>
            <span>Sources</span>
            <span>Used by</span>
            <span />
          </div>
          {notebooks.map((n) => {
            const deps = dependentsByNotebook.get(n.id) || [];
            const open = expanded === n.id;
            return (
              <div key={n.id} className={`kb-item${open ? ' is-open' : ''}`}>
                <div className="kb-row">
                  <span className="kb-title">{n.title}</span>
                  <span className="muted small">{n.sourceCount ?? '—'}</span>
                  <span className="muted small">
                    {deps.length ? `${deps.length} ${deps.length === 1 ? 'place' : 'places'}` : 'not used'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : n.id)}
                  >{open ? 'Hide' : 'Details'}</button>
                </div>
                {open && <NotebookDetail notebook={n} dependents={deps} />}
              </div>
            );
          })}
        </div>
      )}

      {orphans.length > 0 && (
        <div className="kb-panel is-warning" style={{ marginTop: 14 }}>
          <strong>Referenced but not found</strong>
          <p className="muted small">
            These notebooks are still selected somewhere but were not returned by your NotebookLM
            account — they may have been deleted or renamed. The setting is kept as-is.
          </p>
          <ul className="kb-deps">
            {orphans.map((o) => (
              <li key={o.id}>
                <span className="kb-title">{o.title}</span>{' '}
                <span className="muted small">
                  — {o.deps.map((d) => `${d.kind} “${d.name}”`).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ── one notebook: sources, add-source, usage ──────────────────────────── */

function NotebookDetail({ notebook, dependents }) {
  const [sources, setSources] = useState(null);
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState('url');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  // One add at a time: Google processes each source, and firing several in a
  // loop is the fastest way to get the CLI session rate-limited.
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    // Every state update lands after the await, so mounting this panel does
    // not set state synchronously inside the effect below.
    try {
      const rows = await fetchSources(notebook.id);
      setSources(rows);
      setError(null);
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [notebook.id]);

  // Sources and usage in one pass. Usage failing (no bridge) must not hide the
  // sources, and vice versa — hence allSettled rather than all.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [srcRes, useRes] = await Promise.allSettled([
        fetchSources(notebook.id),
        fetchNotebookUsage(notebook.id),
      ]);
      if (!alive) return;
      if (srcRes.status === 'fulfilled') { setSources(srcRes.value); setError(null); }
      else setError(srcRes.reason?.message || String(srcRes.reason));
      setUsage(useRes.status === 'fulfilled' ? useRes.value : null);
    })();
    return () => { alive = false; };
  }, [notebook.id]);

  const submit = async (e) => {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setError(null);
    setNote('Adding… Google processes a new source in the background, so it may take a minute.');
    try {
      if (kind === 'url') await addSource(notebook.id, { kind: 'url', url: url.trim() });
      else await addSource(notebook.id, { kind: 'text', title: title.trim() || 'Task Monitor note', text });
      setUrl(''); setTitle(''); setText('');
      setNote('Added.');
      await load();
    } catch (err) {
      setNote(null);
      setError(err.message || String(err));   // the CLI's own words, verbatim
    } finally {
      setAdding(false);
    }
  };

  const canAdd = kind === 'url' ? /^https?:\/\/\S+$/i.test(url.trim()) : !!text.trim();

  return (
    <div className="kb-detail">
      <div className="kb-detail-col">
        <h4 className="kb-h4">Sources</h4>
        {sources === null && !error && <p className="muted small">Loading…</p>}
        {sources?.length === 0 && <p className="muted small">No sources yet.</p>}
        {sources?.length > 0 && (
          <ul className="kb-sources">
            {sources.map((s) => (
              <li key={s.id}>
                <span className="kb-src-kind">{s.kind}</span>
                <span>{s.title}</span>
              </li>
            ))}
          </ul>
        )}

        <form className="kb-add" onSubmit={submit}>
          <div className="kb-add-kinds">
            <label><input type="radio" checked={kind === 'url'} onChange={() => setKind('url')} /> URL</label>
            <label><input type="radio" checked={kind === 'text'} onChange={() => setKind('text')} /> Pasted text</label>
          </div>
          {kind === 'url' ? (
            <input
              className="input" type="url" placeholder="https://…"
              value={url} onChange={(e) => setUrl(e.target.value)} disabled={adding}
            />
          ) : (
            <>
              <input
                className="input" placeholder="Title"
                value={title} onChange={(e) => setTitle(e.target.value)} disabled={adding}
              />
              <textarea
                className="textarea" rows={4} placeholder="Paste the text to add as a source…"
                value={text} onChange={(e) => setText(e.target.value)} disabled={adding}
              />
            </>
          )}
          <button className="btn btn-sm btn-primary" type="submit" disabled={adding || !canAdd}>
            {adding ? 'Adding…' : '＋ Add source'}
          </button>
        </form>

        {note && <p className="muted small">{note}</p>}
        {error && <p className="field-note is-error" role="alert">{error}</p>}
      </div>

      <div className="kb-detail-col">
        <h4 className="kb-h4">Usage</h4>
        <p className="muted small">
          Dependents — delete this notebook and these stop being grounded:
        </p>
        {dependents.length === 0 ? (
          <p className="muted small">Nothing references it yet.</p>
        ) : (
          <ul className="kb-deps">
            {dependents.map((d) => (
              <li key={`${d.kind}-${d.id}`}>
                <span className="badge badge-soft-muted">{d.kind}</span>{' '}
                <a className="link" href={d.kind === 'project' ? `#/projects/${d.id}` : '#/settings'}>{d.name}</a>
              </li>
            ))}
          </ul>
        )}

        {usage && (
          <>
            <p className="muted small" style={{ marginTop: 10 }}>
              <strong>{usage.stats.total}</strong> ask{usage.stats.total === 1 ? '' : 's'} ·{' '}
              <strong>{usage.stats.last7d}</strong> in the last 7 days ·{' '}
              {usage.stats.lastAt ? `last ${new Date(usage.stats.lastAt).toLocaleString()}` : 'never asked'}
              {(usage.stats.helpful || usage.stats.unhelpful)
                ? ` · 👍 ${usage.stats.helpful} / 👎 ${usage.stats.unhelpful}`
                : ''}
            </p>
            {usage.recent?.length > 0 && (
              <ul className="kb-asks">
                {usage.recent.map((r) => (
                  <li key={r.id}>
                    <span className="badge badge-soft-muted">{r.source}</span>{' '}
                    <span className="kb-ask-q">{r.question}</span>
                    <span className="muted small"> · {new Date(r.at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">
              Asks are logged on this machine only, next to the bridge config. Nothing is sent to Google
              beyond the question itself.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
