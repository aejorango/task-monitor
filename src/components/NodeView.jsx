// src/components/NodeView.jsx — Board → Node: every task as a node, joined to
// the tasks it waits on, leads to, is part of or relates to.
//
// Read left to right, the way work flows: a task sits one column after the
// furthest thing it waits on. The lines are what the tasks say — `dependsOn`
// and the editor's Dependencies & relations — so the picture is the
// connections somebody chose. "Auto-connect by date" is a switch, OFF unless
// turned on (remembered per device): it adds dotted lines that READ the plan
// — inside a project, a task follows the ones dated before it — as a guide
// to wiring the ones that matter. They are drawn differently, never stored,
// and one can be saved as a real "comes before".
//
// CONNECTING BY HAND: hover a task and a dot appears on each side. Drag the
// right-hand dot onto another task ("this comes first") or the left-hand one
// ("that comes first") and a menu asks what the connection is. It writes the
// same fields the task editor writes, so the line is real everywhere. Click
// a line to remove it (or to save a dotted one). Each write has an Undo.
// The geometry, the wrapping, the cycle-guarding and what each write is are
// the pure services/nodeGraph.js; this file draws them.
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useMemberProfiles } from '../hooks/useWorkspace';
import { useWorkspaces } from '../hooks/useWorkspace';
import { todayLocal, updateTask } from '../services/firebase';
import { scopeTasks, scopeOf, blockedTaskIds, displayStatus } from '../services/boardScope';
import {
  buildGraph, layoutGraph, neighbourhood, connectionUpdate, disconnectUpdates,
  EDGE_KINDS, LINE_H, NODE_W, GAP_X, PAD,
} from '../services/nodeGraph';
import { taskRights } from '../services/mobileModel';
import { friendlyError } from '../services/access';
import { activateProps } from '../hooks/useActivate';
import { useToast } from './Toast';
import { avatarColor, avatarInitial } from './Avatar';
import TaskEditor from './TaskEditor';
import { PageActions, PageSubtitle } from './PageHeader';

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2, 1.4];
const HIDE_KEY = 'task-monitor.node.hideUnconnected.v1';
const AUTO_KEY = 'task-monitor.node.autoConnect.v1';

// A per-device on/off. Only a departure from the default is stored, as '1'
// or '0', so the default can never be mistaken for a choice.
function useDeviceToggle(key, defaultOn) {
  const [on, setOn] = useState(() => {
    try { const v = localStorage.getItem(key); return v == null ? defaultOn : v === '1'; } catch { return defaultOn; }
  });
  const set = useCallback((next) => {
    setOn((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      try { v === defaultOn ? localStorage.removeItem(key) : localStorage.setItem(key, v ? '1' : '0'); } catch { /* private window */ }
      return v;
    });
  }, [key, defaultOn]);
  return [on, set];
}

function shortDue(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : null;
}
const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A pointer position in the graph's own units, whatever the zoom and scroll.
function toSvg(svg, clientX, clientY) {
  const m = svg?.getScreenCTM?.();
  if (!m) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

export default function NodeView({ projectFilter = 'all', route = {} }) {
  const { tasks, loading, userId } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities } = useAllActivities();
  const profiles = useMemberProfiles();
  const blockedIds = useMemo(() => blockedTaskIds(activities), [activities]);
  const today = todayLocal();

  const { workspaces } = useWorkspaces();
  const toast = useToast();

  // Every task by default; hiding the unconnected is a choice, kept per device.
  const [hideLoose, setHideLoose] = useDeviceToggle(HIDE_KEY, false);
  const showLoose = !hideLoose;
  const setShowLoose = useCallback((v) => setHideLoose((cur) => !(typeof v === 'function' ? v(!cur) : v)), [setHideLoose]);
  // The dotted date-order lines: a guide, off unless somebody switches it on here.
  const [autoConnect, setAutoConnect] = useDeviceToggle(AUTO_KEY, false);
  // How wide the card is, so the grid of unconnected tasks fills it.
  const [canvasW, setCanvasW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(null);     // the node hovered or focused
  const [editing, setEditing] = useState(null);
  const [drag, setDrag] = useState(null);       // a line being drawn from a dot
  const [menu, setMenu] = useState(null);       // what to do with a drop or a clicked line
  const dragRef = useRef(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  const [justDragged, setJustDragged] = useState(false); // a drag that ends on its own task is not a click
  const svgRef = useRef(null);
  const menuRef = useRef(null);
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

  const taskById = useMemo(() => Object.fromEntries(all.map((t) => [t.id, t])), [all]);
  const wsById = useMemo(() => Object.fromEntries((workspaces || []).map((w) => [w.id, w])), [workspaces]);
  // What firestore.rules would let this person change — a button the server
  // refuses is worse than no button.
  const canEdit = useCallback((t) => !!t && taskRights(t, {
    uid: userId, workspace: wsById[t.workspaceId], project: projectById[t.projectId],
  }).canEdit, [userId, wsById, projectById]);

  const graph = useMemo(
    () => buildGraph(inView, all, { includeUnlinked: showLoose, autoConnect }),
    [inView, all, showLoose, autoConnect],
  );
  const across = Math.max(3, Math.floor((canvasW - PAD) / (NODE_W + GAP_X / 2)) || 0);
  const layout = useMemo(() => layoutGraph(graph, {
    across,
    groupOf: (t) => {
      const p = projectById[t?.projectId];
      return p ? { key: p.id, label: p.name, color: p.color } : { key: '', label: 'No project', color: null };
    },
  }), [graph, across, projectById]);
  const focusId = drag ? drag.fromId : focus;
  const lit = useMemo(() => (focusId ? neighbourhood(focusId, layout.edges) : null), [focusId, layout.edges]);

  const linkedShown = graph.inViewCount - graph.unlinkedCount;
  const statedLines = layout.edges.filter((e) => !EDGE_KINDS[e.kind].inferred).length;
  const datedLines = layout.edges.length - statedLines;

  // ── Drawing a line ─────────────────────────────────────────────────────
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  const startDrag = useCallback((n, side, ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    setMenu(null);
    const p = toSvg(ev.currentTarget.ownerSVGElement, ev.clientX, ev.clientY);
    setDrag({ fromId: n.id, side, x0: side === 'out' ? n.x + n.w : n.x, y0: n.y + n.h / 2, x: p.x, y: p.y, overId: null });
  }, []);
  const dragging = !!drag;
  // Keyed on whether a drag is ON, not on the drag — the move replaces the
  // drag state dozens of times a second (the Gantt's listener pitfall).
  useEffect(() => {
    if (!dragging) return undefined;
    const nodeAt = (x, y) => layoutRef.current.nodes.find((n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const p = toSvg(svgRef.current, ev.clientX, ev.clientY);
      const over = nodeAt(p.x, p.y);
      setDrag({ ...d, x: p.x, y: p.y, overId: over && over.id !== d.fromId ? over.id : null });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      setJustDragged(true);
      setTimeout(() => setJustDragged(false), 0);
      if (!d?.overId) return;
      const [firstId, secondId] = d.side === 'out' ? [d.fromId, d.overId] : [d.overId, d.fromId];
      setMenu({ type: 'connect', firstId, secondId, x: d.x, y: d.y });
    };
    const key = (ev) => { if (ev.key === 'Escape') setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [dragging]);

  // The menu sits by the drop, inside the part of the canvas you can see:
  // pulled in from the right edge, and above the point when there is no room below.
  useLayoutEffect(() => {
    const el = menuRef.current;
    const box = scroller.current;
    if (!menu || !el || !box) return;
    const minL = box.scrollLeft + 8;
    const maxL = box.scrollLeft + box.clientWidth - el.offsetWidth - 8;
    let top = menu.y * zoom + 10;
    if (top + el.offsetHeight > box.scrollTop + box.clientHeight - 8) {
      top = Math.max(box.scrollTop + 8, menu.y * zoom - el.offsetHeight - 10);
    }
    el.style.left = `${Math.max(minL, Math.min(menu.x * zoom - 24, maxL))}px`;
    el.style.top = `${top}px`;
  }, [menu, zoom]);

  // The menu closes on Escape or a press anywhere else, and takes focus when it opens.
  useEffect(() => {
    if (!menu) return undefined;
    menuRef.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    const away = (ev) => { if (!menuRef.current?.contains(ev.target)) setMenu(null); };
    const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); setMenu(null); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  const write = async (writes, doneText, failText) => {
    setMenu(null);
    if (!writes.length) return;
    try {
      await Promise.all(writes.map((w) => updateTask(w.taskId, w.updates)));
      toast.success(doneText, {
        undo: () => Promise.all(writes.map((w) => updateTask(w.taskId, w.undo))),
      });
    } catch (err) {
      toast.error(friendlyError(err, failText));
    }
  };
  const openEdgeMenu = (e, ev) => {
    ev.stopPropagation();
    const p = toSvg(ev.currentTarget.ownerSVGElement, ev.clientX, ev.clientY);
    setMenu({ type: 'edge', edge: e, x: p.x, y: p.y });
  };

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
  const q = (t) => `“${clip(t?.title || 'Untitled task', 34)}”`;

  if (loading) return <div className="nd-empty"><span className="spinner" /> Loading tasks…</div>;

  return (
    <div className="nd">
      <PageSubtitle>
        {plural(graph.inViewCount, 'task')} · {linkedShown} connected by {plural(statedLines, 'line')}
        {datedLines > 0 && <> + {datedLines} by date</>}
        {graph.unlinkedCount > 0 && (showLoose
          ? <> · {graph.unlinkedCount} not connected yet</>
          : <> · {graph.unlinkedCount} not connected, hidden</>)}
        {graph.contextCount > 0 && <> · {graph.contextCount} outside your filter, shown faded</>}
      </PageSubtitle>
      <PageActions>
        <button type="button" role="switch" aria-checked={autoConnect}
          className={`nd-switch${autoConnect ? ' is-on' : ''}`}
          title="Draw dotted lines between the tasks of a project in the order their dates put them. Nothing is saved."
          onClick={() => setAutoConnect((v) => !v)}>
          <span className="nd-switch-track" aria-hidden="true"><span className="nd-switch-knob" /></span>
          Auto-connect by date
        </button>
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
            {autoConnect && (
              <span className="nd-key"><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="nd-edge k-sequence" /><path d="M22 1 L30 5 L22 9 z" className="nd-arrow k-sequence" /></svg>Then, by date (auto)</span>
            )}
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

        {layout.nodes.length > 0 && (
          <div className="nd-hint">
            {statedLines === 0 && <><strong>No task here is connected to another yet.</strong> </>}
            Hover a task and drag the <span className="nd-hint-dot" aria-hidden="true" /> on its right edge onto the task
            that comes next — or the one on its left onto the task that comes first. You choose what the line means;
            click a line to remove it.
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
              ref={svgRef}
              className={`nd-svg${lit ? ' has-focus' : ''}${drag ? ' is-dragging' : ''}`}
              width={layout.width * zoom}
              height={layout.height * zoom}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="group"
              aria-label={`Task connections: ${plural(layout.nodes.length, 'task')}, ${plural(layout.edges.length, 'connection')}`}
            >
              <defs>
                {['depends', 'part', 'duplicate', 'sequence', 'loop', 'draft'].map((k) => (
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

              {/* Lines under the nodes; a wide invisible twin makes each one clickable. */}
              {layout.edges.map((e) => {
                const on = lit?.edgeIds.has(e.id);
                const kind = e.loop ? 'loop' : e.kind;
                const def = EDGE_KINDS[e.kind];
                const tip = `${taskById[e.from]?.title || ''} — ${def.label.toLowerCase()} → ${taskById[e.to]?.title || ''}`
                  + `${def.inferred ? ' (auto, from the dates)' : ''}${e.loop ? ' (this closes a loop)' : ''}. Click for options.`;
                return (
                  <g key={e.id} className="nd-edge-g">
                    <path d={e.d}
                      className={`nd-edge k-${kind}${on ? ' is-lit' : ''}${lit && !on ? ' is-dim' : ''}`}
                      markerEnd={def.directed ? `url(#nd-arrow-${kind})` : undefined} />
                    <path d={e.d} className="nd-hit" onClick={(ev) => openEdgeMenu(e, ev)}><title>{tip}</title></path>
                  </g>
                );
              })}

              {drag && (
                <path className="nd-edge k-draft"
                  d={`M ${drag.x0} ${drag.y0} C ${drag.x0 + (drag.side === 'out' ? 60 : -60)} ${drag.y0}, ${drag.x} ${drag.y}, ${drag.x} ${drag.y}`}
                  markerEnd={drag.side === 'out' ? 'url(#nd-arrow-draft)' : undefined}
                  markerStart={drag.side === 'in' ? 'url(#nd-arrow-draft)' : undefined} />
              )}

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
                    className={`nd-node${n.context ? ' is-context' : ''}${dim && drag?.overId !== n.id ? ' is-dim' : ''}${focusId === n.id ? ' is-focus' : ''}${drag?.overId === n.id ? ' is-target' : ''}`}
                    transform={`translate(${n.x} ${n.y})`}
                    onMouseEnter={() => setFocus(n.id)} onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(n.id)} onBlur={() => setFocus(null)}
                    {...activateProps(() => { if (!justDragged) setEditing(t); }, { label: `Open ${label}` })}>
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
                    {/* The connect dots: shown on hover, for a task this person may change. */}
                    {focus === n.id && !drag && canEdit(t) && [['in', 0], ['out', n.w]].map(([side, x]) => (
                      <g key={side} className={`nd-handle is-${side}`} aria-hidden="true"
                        onPointerDown={(ev) => startDrag(n, side, ev)} onClick={(ev) => ev.stopPropagation()}>
                        <title>{side === 'out' ? 'Drag onto the task that comes after this one' : 'Drag onto the task that comes before this one'}</title>
                        <circle className="nd-handle-hit" cx={x} cy={n.h / 2} r="14" />
                        <circle className="nd-handle-dot" cx={x} cy={n.h / 2} r="6.5" />
                      </g>
                    ))}
                  </g>
                );
              })}
            </svg>
            {menu && (
              <div ref={menuRef} className="nd-menu" role="group" aria-label="Connection">
                {menu.type === 'connect' ? (
                  <ConnectMenu first={taskById[menu.firstId]} second={taskById[menu.secondId]} all={all}
                    canEdit={canEdit} q={q} onCancel={() => setMenu(null)}
                    onPick={(res, text) => write([res], text, 'That connection could not be saved. Please try again.')} />
                ) : (
                  <EdgeMenu edge={menu.edge} taskById={taskById} all={all} canEdit={canEdit} q={q}
                    onCancel={() => setMenu(null)}
                    onWrite={(writes, text) => write(writes, text, 'That connection could not be changed. Please try again.')} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <TaskEditor task={editing} projects={projects} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// What a drop means: the four kinds, with the direction the drag gave and,
// for "comes before", the other way round too. An option that cannot be
// written says why instead of failing after the click.
function ConnectMenu({ first, second, all, canEdit, q, onPick, onCancel }) {
  if (!first || !second) return null;
  const options = [
    { kind: 'depends', a: first, b: second, text: `${q(first)} comes before ${q(second)}` },
    { kind: 'depends', a: second, b: first, text: `${q(second)} comes before ${q(first)}` },
    { kind: 'part', a: first, b: second, text: `${q(second)} is part of ${q(first)}` },
    { kind: 'related', a: first, b: second, text: 'They are related' },
    { kind: 'duplicate', a: first, b: second, text: `${q(first)} is a duplicate of ${q(second)}` },
  ].map((o) => {
    const res = connectionUpdate(o.a, o.b, o.kind, all);
    const error = res.error || (canEdit(all.find((t) => t.id === res.taskId)) ? null : 'You can view that task but not change it.');
    return { ...o, res, error };
  });
  // Something wrong with the pair itself (already joined, two workspaces…) is one sentence, not five.
  const shared = options.every((o) => o.error && o.error === options[0].error) ? options[0].error : null;
  return (
    <>
      <div className="nd-menu-title">Connect {q(first)} and {q(second)}</div>
      {shared ? <p className="nd-menu-note">{shared}</p> : options.map((o, i) => (
        <button key={i} type="button" className={`nd-menu-item${i === 0 ? ' is-first' : ''}`} disabled={!!o.error}
          title={o.error || undefined} onClick={() => onPick(o.res, `Connected: ${o.text.replace(/“|”/g, '')}.`)}>
          {o.text}
          {o.error && <span className="nd-menu-why">{o.error}</span>}
        </button>
      ))}
      <button type="button" className="nd-menu-item is-cancel" onClick={onCancel}>Cancel</button>
    </>
  );
}

// A clicked line: a stated one can be removed; a dotted one can be saved as
// a real "comes before", which is the only way an inferred line is written.
function EdgeMenu({ edge, taskById, all, canEdit, q, onWrite, onCancel }) {
  const a = taskById[edge.from];
  const b = taskById[edge.to];
  if (!a || !b) return null;
  const def = EDGE_KINDS[edge.kind];
  if (def.inferred) {
    const res = connectionUpdate(a, b, 'depends', all);
    const error = res.error || (canEdit(b) ? null : 'You can view that task but not change it.');
    return (
      <>
        <div className="nd-menu-title">{q(b)} is planned after {q(a)}</div>
        <p className="nd-menu-note">This dotted line comes from the dates; nothing is saved. Save it to make it a real dependency.</p>
        <button type="button" className="nd-menu-item is-first" disabled={!!error} title={error || undefined}
          onClick={() => onWrite([res], `Saved: ${a.title || 'the first task'} comes before ${b.title || 'the next'}.`)}>
          Save as “comes before”
          {error && <span className="nd-menu-why">{error}</span>}
        </button>
        <button type="button" className="nd-menu-item is-cancel" onClick={onCancel}>Cancel</button>
      </>
    );
  }
  const writes = disconnectUpdates(edge, taskById);
  const blocked = writes.some((w) => !canEdit(taskById[w.taskId]));
  const sentence = edge.kind === 'depends' ? `${q(a)} comes before ${q(b)}`
    : edge.kind === 'part' ? `${q(b)} is part of ${q(a)}`
      : edge.kind === 'duplicate' ? `${q(a)} is a duplicate of ${q(b)}`
        : `${q(a)} and ${q(b)} are related`;
  return (
    <>
      <div className="nd-menu-title">{sentence}</div>
      {edge.loop && <p className="nd-menu-note">This line closes a loop — each of these tasks waits on the other.</p>}
      <button type="button" className="nd-menu-item is-danger is-first" disabled={blocked || !writes.length}
        title={blocked ? 'You can view these tasks but not change them.' : undefined}
        onClick={() => onWrite(writes, 'Connection removed.')}>
        Remove this connection
        {blocked && <span className="nd-menu-why">You can view these tasks but not change them.</span>}
      </button>
      <button type="button" className="nd-menu-item is-cancel" onClick={onCancel}>Cancel</button>
    </>
  );
}
