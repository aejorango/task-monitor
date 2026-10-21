// src/components/NodeView.jsx — Board → Node: every task as a node, joined to
// the tasks it waits on, leads to, is part of or relates to.
//
// Read left to right, the way work flows: a task sits one column after the
// furthest thing it waits on. The connections are only what the tasks say —
// `dependsOn` and the editor's Dependencies & relations — never a guess. The
// geometry, the wrapping and the cycle-guarding are the pure
// services/nodeGraph.js; this file draws them.
//
// EVERY task is on it (the toolbar's filters aside): the ones joined to
// another form the graph, and the rest are filed by project in a grid below
// it, because a plan has to see the work nobody has connected yet too.
// "Hide unconnected" narrows it to the chains alone, remembered per device.
//
// It is a Board page, so the toolbar above it narrows it like every other tab
// (Project · Status · person · Find, through `scopeTasks`). A task the filter
// left out but that a shown task connects to is drawn FADED rather than
// dropped: hiding the other end of a dependency hides the reason a task waits.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useMemberProfiles } from '../hooks/useWorkspace';
import { todayLocal } from '../services/firebase';
import { scopeTasks, scopeOf, blockedTaskIds, displayStatus } from '../services/boardScope';
import {
  buildGraph, layoutGraph, neighbourhood, EDGE_KINDS, LINE_H, NODE_W, GAP_X, PAD,
} from '../services/nodeGraph';
import { activateProps } from '../hooks/useActivate';
import { avatarColor, avatarInitial } from './Avatar';
import TaskEditor from './TaskEditor';
import { PageActions, PageSubtitle } from './PageHeader';

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2, 1.4];
const HIDE_KEY = 'task-monitor.node.hideUnconnected.v1';
const readHide = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };

function shortDue(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : null;
}
const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function NodeView({ projectFilter = 'all', route = {} }) {
  const { tasks, loading, userId } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities } = useAllActivities();
  const profiles = useMemberProfiles();
  const blockedIds = useMemo(() => blockedTaskIds(activities), [activities]);
  const today = todayLocal();

  // Every task by default; hiding the unconnected is a choice, kept per device.
  const [showLoose, setShowLooseState] = useState(() => !readHide());
  const setShowLoose = useCallback((next) => {
    setShowLooseState((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      try { v ? localStorage.removeItem(HIDE_KEY) : localStorage.setItem(HIDE_KEY, '1'); } catch { /* private window */ }
      return v;
    });
  }, []);
  // How wide the card is, so the grid of unconnected tasks fills it.
  const [canvasW, setCanvasW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(null);     // the node hovered or focused
  const [editing, setEditing] = useState(null);
  const scroller = useRef(null);
  // A callback ref: the canvas only exists once there is something to draw.
  const observer = useRef(null);
  const measure = useCallback((el) => {
    scroller.current = el;
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(([entry]) => setCanvasW(Math.round(entry.contentRect.width)));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  // The toolbar's filters, exactly as every Board tab applies them.
  const inView = useMemo(
    () => scopeTasks(
      tasks.filter((t) => !t.deleted && !t.archived && (projectFilter === 'all' || t.projectId === projectFilter)),
      { scope: scopeOf(route), who: route.who, q: route.q, status: route.statusFilter, userId, blockedIds, today },
    ),
    [tasks, projectFilter, route.statusFilter, route.onlyMine, route.stuckOnly, route.who, route.q, userId, blockedIds, today],
  );
  const all = useMemo(() => tasks.filter((t) => !t.deleted && !t.archived), [tasks]);

  const graph = useMemo(() => buildGraph(inView, all, { includeUnlinked: showLoose }), [inView, all, showLoose]);
  const across = Math.max(3, Math.floor((canvasW - PAD) / (NODE_W + GAP_X / 2)) || 0);
  const layout = useMemo(() => layoutGraph(graph, {
    across,
    groupOf: (t) => {
      const p = projectById[t?.projectId];
      return p ? { key: p.id, label: p.name, color: p.color } : { key: '', label: 'No project', color: null };
    },
  }), [graph, across, projectById]);
  const lit = useMemo(() => (focus ? neighbourhood(focus, layout.edges) : null), [focus, layout.edges]);

  const linkedShown = graph.inViewCount - graph.unlinkedCount;

  // Fit the whole graph to the card's width (never past 100%).
  const fit = useCallback(() => {
    const w = scroller.current?.clientWidth || 0;
    if (!w || !layout.width) return;
    setZoom(Math.max(0.35, Math.min(1, (w - 8) / layout.width)));
  }, [layout.width]);
  const step = (dir) => setZoom((z) => {
    const i = ZOOMS.findIndex((v) => v >= z - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.length - 1 : i) + dir))];
    return next;
  });

  const nameOf = (uid) => profiles[uid]?.displayName || profiles[uid]?.email || '';

  if (loading) return <div className="nd-empty"><span className="spinner" /> Loading tasks…</div>;

  return (
    <div className="nd">
      <PageSubtitle>
        {plural(graph.inViewCount, 'task')} · {linkedShown} connected by {plural(layout.edges.length, 'line')}
        {graph.unlinkedCount > 0 && (showLoose
          ? <> · {graph.unlinkedCount} not connected yet</>
          : <> · {graph.unlinkedCount} not connected, hidden</>)}
        {graph.contextCount > 0 && <> · {graph.contextCount} outside your filter, shown faded</>}
      </PageSubtitle>
      <PageActions>
        {graph.unlinkedCount > 0 && (
          <button type="button" className={`cmd${showLoose ? ' is-on' : ''}`} aria-pressed={showLoose}
            onClick={() => setShowLoose((v) => !v)}>
            {showLoose ? 'Hide' : 'Show'} unconnected ({graph.unlinkedCount})
          </button>
        )}
      </PageActions>

      <div className="bx-panel nd-panel">
        <div className="nd-head">
          <div className="nd-legend" aria-label="What the lines mean">
            <span className="nd-key"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="nd-edge k-depends" /><path d="M22 1 L30 5 L22 9 z" className="nd-arrow k-depends" /></svg>Comes before</span>
            <span className="nd-key"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="nd-edge k-part" /><path d="M22 1 L30 5 L22 9 z" className="nd-arrow k-part" /></svg>Part of</span>
            <span className="nd-key"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" className="nd-edge k-related" /></svg>Related</span>
            <span className="nd-key"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="nd-edge k-duplicate" /><path d="M22 1 L30 5 L22 9 z" className="nd-arrow k-duplicate" /></svg>Duplicate of</span>
            <span className="nd-key"><span className="nd-swatch is-context" />Outside your filter</span>
          </div>
          <div className="nd-zoom" role="group" aria-label="Zoom">
            <button type="button" className="nd-zbtn" onClick={() => step(-1)} aria-label="Zoom out" disabled={zoom <= ZOOMS[0]}>−</button>
            <span className="nd-zval" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className="nd-zbtn" onClick={() => step(1)} aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]}>+</button>
            <button type="button" className="nd-zbtn is-word" onClick={fit}>Fit</button>
            <button type="button" className="nd-zbtn is-word" onClick={() => setZoom(1)}>100%</button>
          </div>
        </div>

        {layout.nodes.length > 0 && layout.edges.length === 0 && (
          <div className="nd-hint">
            No task here is connected to another yet. Open one, then <strong>Details → Dependencies &amp; relations</strong>,
            to say what it waits on, blocks, is part of or relates to — each becomes a line.
          </div>
        )}
        {layout.nodes.length === 0 ? (
          <div className="nd-empty">
            <div className="nd-empty-title">
              {inView.length ? 'None of these tasks is connected to another yet' : 'No tasks match these filters'}
            </div>
            {inView.length > 0 && (
              <p>
                Open a task, then <strong>Details → Dependencies &amp; relations</strong>, to say what it waits on,
                what it blocks, what it is part of or what it relates to. Each one becomes a line here.
              </p>
            )}
            {graph.unlinkedCount > 0 && (
              <button type="button" className="cmd" onClick={() => setShowLoose(true)}>Show the {graph.unlinkedCount} unconnected tasks</button>
            )}
          </div>
        ) : (
          <div className="nd-canvas" ref={measure}>
            <svg
              className={`nd-svg${lit ? ' has-focus' : ''}`}
              width={layout.width * zoom}
              height={layout.height * zoom}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="group"
              aria-label={`Task connections: ${plural(layout.nodes.length, 'task')}, ${plural(layout.edges.length, 'connection')}`}
            >
              <defs>
                {['depends', 'part', 'duplicate', 'loop'].map((k) => (
                  <marker key={k} id={`nd-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M0 1 L10 5 L0 9 z" className={`nd-arrow k-${k}`} />
                  </marker>
                ))}
              </defs>

              {layout.headings.map((hd) => (hd.kind === 'section' ? (
                <text key={`s${hd.y}`} x={PAD} y={hd.y + 16} className="nd-loose-label">{hd.label}</text>
              ) : (
                <g key={`p${hd.y}`} transform={`translate(${PAD} ${hd.y})`}>
                  <circle cx="5" cy="9" r="5" style={{ fill: hd.color || 'var(--c-text-muted)' }} />
                  <text x="16" y="13" className="nd-proj-head">{hd.label}<tspan className="nd-proj-count" dx="8">{hd.count}</tspan></text>
                </g>
              )))}

              {/* Lines under the nodes. */}
              {layout.edges.map((e) => {
                const on = lit?.edgeIds.has(e.id);
                const kind = e.loop ? 'loop' : e.kind;
                const def = EDGE_KINDS[e.kind];
                return (
                  <path key={e.id} d={e.d}
                    className={`nd-edge k-${kind}${on ? ' is-lit' : ''}${lit && !on ? ' is-dim' : ''}`}
                    markerEnd={def.directed ? `url(#nd-arrow-${kind})` : undefined}>
                    <title>{`${layout.nodes.find((n) => n.id === e.from)?.task?.title || ''} — ${def.label.toLowerCase()} → ${layout.nodes.find((n) => n.id === e.to)?.task?.title || ''}${e.loop ? ' (this closes a loop)' : ''}`}</title>
                  </path>
                );
              })}

              {layout.nodes.map((n) => {
                const t = n.task;
                const st = displayStatus(t, blockedIds, today);
                const project = projectById[t.projectId];
                const owner = (t.assignedTo || [])[0] || null;
                const ownerName = owner ? nameOf(owner) : (t.assignedToExternal || [])[0] || '';
                const due = t.plan?.endDate;
                const late = due && t.status !== 'done' && due < today;
                const dim = lit && !lit.ids.has(n.id);
                const chipW = 16 + st.label.length * 6.1;
                const label = `${t.title || 'Untitled task'} — ${st.label}${project ? `, ${project.name}` : ''}${due ? `, due ${shortDue(due)}` : ''}${n.context ? ', outside your filter' : ''}`;
                return (
                  <g key={n.id}
                    className={`nd-node${n.context ? ' is-context' : ''}${dim ? ' is-dim' : ''}${focus === n.id ? ' is-focus' : ''}`}
                    transform={`translate(${n.x} ${n.y})`}
                    onMouseEnter={() => setFocus(n.id)} onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(n.id)} onBlur={() => setFocus(null)}
                    {...activateProps(() => setEditing(t), { label: `Open ${label}` })}>
                    <title>{label}</title>
                    <rect className="nd-box" width={n.w} height={n.h} rx="12" />
                    <rect className="nd-rail" width="5" height={n.h} rx="2.5" style={{ fill: project?.color || 'var(--c-border)' }} />
                    <rect className={`nd-st st-${st.id}`} x="16" y="12" width={chipW} height="18" rx="9" />
                    <text className={`nd-st-text st-${st.id}`} x={16 + chipW / 2} y="24.5" textAnchor="middle">{st.label}</text>
                    <text className="nd-proj" x={n.w - 12} y="25" textAnchor="end">
                      {n.context ? 'outside filter' : clip(project?.name || '', Math.max(6, Math.floor((n.w - chipW - 40) / 6.2)))}
                    </text>
                    <text className="nd-title" x="16" y={40 + 13}>
                      {n.lines.map((line, i) => <tspan key={i} x="16" dy={i ? LINE_H : 0}>{line}</tspan>)}
                    </text>
                    <g transform={`translate(0 ${n.h - 22})`}>
                      {ownerName ? (
                        <>
                          <circle cx="25" cy="0" r="9" style={{ fill: avatarColor(owner || ownerName) }} />
                          <text className="nd-av" x="25" y="3.5" textAnchor="middle">{avatarInitial(ownerName)}</text>
                          <text className="nd-owner" x="40" y="4">{clip(ownerName.split(/[\s@]/)[0], 14)}</text>
                        </>
                      ) : (
                        <text className="nd-owner is-none" x="16" y="4">No owner</text>
                      )}
                      {due && <text className={`nd-due${late ? ' is-late' : ''}`} x={n.w - 12} y="4" textAnchor="end">{late ? `${shortDue(due)} · late` : shortDue(due)}</text>}
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>

      {editing && (
        <TaskEditor task={editing} projects={projects} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
