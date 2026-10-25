// src/components/SwimlaneView.jsx — Board → Swimlane: the work as a
// flowchart, one LANE per person accountable, read TOP TO BOTTOM.
//
// A task sits one row below the furthest thing it waits on, in the lane of
// the person it is assigned to (its first assignee; "Unassigned" last), and
// each task is coloured by its status — Not started · Working on it · In
// review · Done. It was Board → Node, a left-to-right graph; `#/node`
// forwards here (MOVED_VIEWS). The lines are what the tasks say — `dependsOn`
// and the editor's Dependencies & relations — so the picture is the
// connections somebody chose. "Auto-connect by date" is a switch, OFF unless
// turned on (remembered per device): it adds dotted lines that READ the plan
// — inside a project, a task follows the ones dated before it — as a guide
// to wiring the ones that matter. They are drawn differently, never stored,
// and one can be saved as a real "comes before".
//
// CONNECTING BY HAND: hover a task and a dot appears at its top and bottom.
// Drag the bottom dot onto another task ("this comes first") or the top one
// ("that comes first") and a menu asks what the connection is. It writes the
// same fields the task editor writes, so the line is real everywhere. Click
// a line to remove it (or to save a dotted one). Each write has an Undo.
// The geometry, the wrapping, the cycle-guarding and what each write is are
// the pure services/nodeGraph.js; this file draws them.
//
// EVERY task is on it (the toolbar's filters aside): the ones joined to
// another form the flow, and the rest sit in their lanes at the foot,
// because a plan has to see the work nobody has connected yet too.
// "Hide unconnected" narrows it to the chains alone, remembered per device.
//
// It is a Board page, so the toolbar above it narrows it like every other tab
// (Project · Status · person · Find, through `scopeTasks`). A task the filter
// left out but that a shown task connects to is drawn FADED rather than
// dropped: hiding the other end of a dependency hides the reason a task waits.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useMemberProfiles } from '../hooks/useWorkspace';
import { useWorkspaces, useActiveWorkspaceId } from '../hooks/useWorkspace';
import { todayLocal, updateTask } from '../services/firebase';
import { scopeTasks, scopeOf, blockedTaskIds, displayStatus } from '../services/boardScope';
import {
  buildGraph, layoutSwimlanes, neighbourhood, connectionUpdate, disconnectUpdates,
  EDGE_KINDS, LINE_H, PAD, LANE_HEAD,
} from '../services/nodeGraph';
import { taskRights } from '../services/mobileModel';
import { friendlyError } from '../services/access';
import { activateProps } from '../hooks/useActivate';
import { useToast } from './Toast';
import { avatarColor, avatarInitial } from './Avatar';
import TaskEditor, { newTaskDraft } from './TaskEditor';
import { PageActions, PageSubtitle } from './PageHeader';

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2, 1.4];
// A task is coloured by its own status (the four the board uses); the chip on
// it still says Stuck when it is, so a late "Working on it" reads as both.
const STATUS_FILL = { todo: 'todo', doing: 'doing', review: 'review', done: 'done' };
const STATUS_KEYS = [['todo', 'Not started'], ['doing', 'Working on it'], ['review', 'In review'], ['done', 'Done']];
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

export default function SwimlaneView({ projectFilter = 'all', route = {} }) {
  const { tasks, loading, userId } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities } = useAllActivities();
  const profiles = useMemberProfiles();
  const blockedIds = useMemo(() => blockedTaskIds(activities), [activities]);
  const today = todayLocal();

  const { workspaces } = useWorkspaces();
  const activeWs = useActiveWorkspaceId();
  const toast = useToast();
  // "New task" opens the editor on a task that does not exist yet, as on the
  // WBS and the Gantt — creating one and editing one are one screen.
  const [creating, setCreating] = useState(false);

  // Every task by default; hiding the unconnected is a choice, kept per device.
  const [hideLoose, setHideLoose] = useDeviceToggle(HIDE_KEY, false);
  const showLoose = !hideLoose;
  const setShowLoose = useCallback((v) => setHideLoose((cur) => !(typeof v === 'function' ? v(!cur) : v)), [setHideLoose]);
  // The dotted date-order lines: a guide, off unless somebody switches it on here.
  const [autoConnect, setAutoConnect] = useDeviceToggle(AUTO_KEY, false);
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
  // A lane is the person accountable: the task's first assignee, else the
  // first name typed for somebody outside the workspace, else Unassigned.
  const layout = useMemo(() => layoutSwimlanes(graph, {
    laneOf: (t) => {
      const uid = (t?.assignedTo || [])[0];
      if (uid) return { key: uid, label: profiles[uid]?.displayName || profiles[uid]?.email || 'Someone', person: uid };
      const ext = (t?.assignedToExternal || [])[0];
      return ext ? { key: `ext:${ext}`, label: ext, person: ext } : { key: '', label: 'Unassigned', person: null };
    },
    // A band is a PHASE of a project, in the project's own phase order;
    // a task with no phase closes its project, and no project comes last.
    bandOf: (t) => {
      const p = projectById[t?.projectId];
      if (!p) return { key: '|', label: 'No project', project: null, color: null, order: [null] };
      const phases = [...(p.phases || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      // A project with no phases at all is one band, named for the project.
      if (!phases.length) return { key: `${p.id}|`, label: p.name || 'Untitled project', project: null, color: p.color || null, order: [p.name || '', 0] };
      const i = phases.findIndex((ph) => ph.id === t.phaseId);
      return {
        key: `${p.id}|${i === -1 ? '' : t.phaseId}`,
        label: i === -1 ? 'No phase' : phases[i].name || 'Untitled phase',
        project: p.name,
        color: p.color || null,
        order: [p.name || '', i === -1 ? 1e6 : i],
      };
    },
  }), [graph, profiles, projectById]);
  // With more than one project on the page, a phase name alone is ambiguous.
  const manyProjects = new Set(layout.bands.map((b) => b.project || b.label)).size > 1;
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
    setDrag({ fromId: n.id, side, x0: n.x + n.w / 2, y0: side === 'out' ? n.y + n.h : n.y, x: p.x, y: p.y, overId: null });
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
    // The lower of the canvas's own edge and the window's, in canvas units.
    const seen = Math.min(box.scrollTop + box.clientHeight, window.innerHeight - box.getBoundingClientRect().top + box.scrollTop);
    if (top + el.offsetHeight > seen - 8) {
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
        <button type="button" className="cmd cmd-primary" onClick={() => setCreating(true)}>
          <span className="cmd-icon">+</span>New task
        </button>
        {graph.unlinkedCount > 0 && (
          <button type="button" className={`cmd${showLoose ? ' is-on' : ''}`} aria-pressed={showLoose}
            onClick={() => setShowLoose((v) => !v)}>
            {showLoose ? 'Hide' : 'Show'} unconnected ({graph.unlinkedCount})
          </button>
        )}
      </PageActions>

      {/* No card around it: the legend and the graph sit on the page itself. */}
      <div className="nd-panel">
        <div className="nd-head">
          <div className="nd-legend" aria-label="What the colours and lines mean">
            {STATUS_KEYS.map(([k, text]) => (
              <span key={k} className="nd-key"><span className={`sl-swatch fill-${k}`} />{text}</span>
            ))}
            <span className="nd-key-sep" aria-hidden="true" />
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
            One column per person accountable, read top to bottom. Hover a task and drag the{' '}
            <span className="nd-hint-dot" aria-hidden="true" /> at its bottom onto the task that comes next — or the one
            at its top onto the task that comes first. You choose what the line means; click a line to remove it.
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
          <div className="nd-canvas" ref={scroller}>
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

              {/* The lanes: a column per person, its name at the head, ruled full height. */}
              {layout.lanes.map((ln, i) => (
                <g key={ln.key || 'unassigned'} className={`sl-lane${i % 2 ? ' is-alt' : ''}`}>
                  <rect className="sl-lane-bg" x={ln.x} y={PAD} width={ln.w} height={layout.height - PAD * 2} />
                  <rect className="sl-lane-head" x={ln.x} y={PAD} width={ln.w} height={LANE_HEAD} />
                  {ln.person ? (
                    <>
                      <circle cx={ln.x + 26} cy={PAD + LANE_HEAD / 2} r="11" style={{ fill: avatarColor(ln.person) }} />
                      <text className="nd-av sl-av" x={ln.x + 26} y={PAD + LANE_HEAD / 2 + 4} textAnchor="middle">{avatarInitial(ln.label)}</text>
                    </>
                  ) : (
                    <circle className="sl-av-none" cx={ln.x + 26} cy={PAD + LANE_HEAD / 2} r="10" />
                  )}
                  <text className="sl-lane-name" x={ln.x + 44} y={PAD + LANE_HEAD / 2 + 4.5}>{clip(ln.label, 22)}</text>
                  <text className="sl-lane-count" x={ln.x + ln.w - 14} y={PAD + LANE_HEAD / 2 + 4.5} textAnchor="end">{ln.count}</text>
                </g>
              ))}
              {/* The phase column: each phase's band named bottom to top, a rule between bands. */}
              {layout.phaseW > 0 && (
                <g className="sl-phases">
                  <rect className="sl-lane-head" x={PAD} y={PAD} width={layout.phaseW} height={LANE_HEAD} />
                  {layout.bands.map((b) => {
                    // Written bottom to top. With several projects on the page
                    // the project rides on a quieter second line beside the phase.
                    const sub = manyProjects && b.project ? b.project : null;
                    const fits = Math.max(4, Math.floor((b.h - 18) / 7.4));
                    return (
                      <g key={b.key}>
                        <title>{sub ? `${sub} — ${b.label}` : b.label}</title>
                        <rect className="sl-phase-cell" x={PAD} y={b.y} width={layout.phaseW} height={b.h} />
                        {b.color && <rect x={PAD} y={b.y} width="4" height={b.h} style={{ fill: b.color }} />}
                        <g transform={`translate(${PAD + layout.phaseW / 2 + 2} ${b.y + b.h / 2}) rotate(-90)`}>
                          {sub && <text className="sl-phase-project" textAnchor="middle" y="-4">{clip(sub, Math.floor(fits * 1.15))}</text>}
                          <text className="sl-phase-name" textAnchor="middle" y={sub ? 10 : 4}>{clip(b.label, fits)}</text>
                        </g>
                      </g>
                    );
                  })}
                </g>
              )}
              {layout.dividers.map((y) => (
                <line key={`d${y}`} className={`sl-divider${layout.phaseW ? ' is-phase' : ''}`} x1={PAD}
                  x2={PAD + layout.phaseW + layout.lanes.length * (layout.lanes[0]?.w || 0)} y1={y} y2={y} />
              ))}
              {/* The tray: every task with no connection yet, kept apart from the
                  lanes so they hold only the flow; drag one onto the flow to place it. */}
              {layout.tray && (
                <g className="sl-tray">
                  <rect className="sl-tray-bg" x={layout.tray.x} y={layout.tray.y} width={layout.tray.w} height={layout.tray.h} rx="14" />
                  <text className="sl-tray-title" x={layout.tray.x + 18} y={layout.tray.y + LANE_HEAD / 2 + 4.5}>NOT CONNECTED</text>
                  <text className="sl-lane-count" x={layout.tray.x + layout.tray.w - 16} y={layout.tray.y + LANE_HEAD / 2 + 4.5} textAnchor="end">{layout.tray.count}</text>
                </g>
              )}

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
                  d={`M ${drag.x0} ${drag.y0} C ${drag.x0} ${drag.y0 + (drag.side === 'out' ? 60 : -60)}, ${drag.x} ${drag.y}, ${drag.x} ${drag.y}`}
                  markerEnd={drag.side === 'out' ? 'url(#nd-arrow-draft)' : undefined}
                  markerStart={drag.side === 'in' ? 'url(#nd-arrow-draft)' : undefined} />
              )}

              {layout.nodes.map((n) => {
                const t = n.task;
                // The node shows the title alone; everything else is in its tooltip.
                const st = displayStatus(t, blockedIds, today);
                const project = projectById[t.projectId];
                const owner = (t.assignedTo || [])[0] || null;
                const ownerName = owner ? nameOf(owner) : (t.assignedToExternal || [])[0] || '';
                const due = t.plan?.endDate;
                const dim = lit && !lit.ids.has(n.id);
                const label = `${t.title || 'Untitled task'} — ${st.label}${ownerName ? `, ${ownerName}` : ''}${project ? `, ${project.name}` : ''}${due ? `, due ${shortDue(due)}` : ''}${n.context ? ', outside your filter' : ''}`;
                return (
                  <g key={n.id}
                    className={`nd-node${n.context ? ' is-context' : ''}${dim && drag?.overId !== n.id ? ' is-dim' : ''}${focusId === n.id ? ' is-focus' : ''}${drag?.overId === n.id ? ' is-target' : ''}`}
                    transform={`translate(${n.x} ${n.y})`}
                    onMouseEnter={() => setFocus(n.id)} onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(n.id)} onBlur={() => setFocus(null)}
                    {...activateProps(() => { if (!justDragged) setEditing(t); }, { label: `Open ${label}` })}>
                    <title>{label}</title>
                    <rect className={`nd-box fill-${STATUS_FILL[t.status] || 'todo'}`} width={n.w} height={n.h} rx="12" />
                    <text className="nd-title" x={n.w / 2} y={15 + 12.5} textAnchor="middle">
                      {n.lines.map((line, k) => <tspan key={k} x={n.w / 2} dy={k ? LINE_H : 0}>{line}</tspan>)}
                    </text>
                    {/* The connect dots: shown on hover, for a task this person may change. */}
                    {focus === n.id && !drag && canEdit(t) && [['in', 0], ['out', n.h]].map(([side, y]) => (
                      <g key={side} className={`nd-handle is-${side}`} aria-hidden="true"
                        onPointerDown={(ev) => startDrag(n, side, ev)} onClick={(ev) => ev.stopPropagation()}>
                        <title>{side === 'out' ? 'Drag onto the task that comes after this one' : 'Drag onto the task that comes before this one'}</title>
                        <circle className="nd-handle-hit" cx={n.w / 2} cy={y} r="14" />
                        <circle className="nd-handle-dot" cx={n.w / 2} cy={y} r="6.5" />
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
      {creating && (
        <TaskEditor
          task={newTaskDraft({ workspaceId: activeWs, projectId: projectFilter })}
          projects={projects}
          onClose={() => setCreating(false)}
        />
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
