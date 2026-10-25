// src/services/nodeGraph.js — Board → Node: tasks as a graph of what leads to what.
//
// Pure: no React, no Firebase. The page (components/SwimlaneView.jsx) draws what
// this returns, and tests/ui + nodeGraph.test.mjs pin the rules.
//
// WHAT AN EDGE IS — what the task itself says:
//   · `dependsOn: [id]`          → id ──▶ task   "comes before"   (kind 'depends')
//   · link `blocks`   → target   → task ──▶ target                (kind 'depends')
//     (both are the same claim — the second task waits on the first — so a
//      pair stated both ways is ONE edge)
//   · link `child-of` → parent   → parent ──▶ task  "is part of"  (kind 'part')
//   · link `parent-of`→ child    → task ──▶ child                 (kind 'part')
//   · link `related-to`          → task ─ ─ other, no direction   (kind 'related')
//   · link `duplicate-of`        → task ─ ─▶ original              (kind 'duplicate')
//
// …and, only when the page's "Auto-connect by date" is on, ONE kind that is
// inferred rather than stated, drawn differently and named as such:
//   · 'sequence' — within one project, a task planned after another follows
//     it (`sequenceEdges`). It is a reading of the plan's dates, not a claim
//     anybody made, so it is never written unless somebody saves it as a
//     real "comes before" — and it never contradicts a stated connection.
//
// LAYOUT — swimlanes: a lane per person accountable, the work read top to
// bottom. A task's row is one past the furthest thing it waits on (the
// longest path in), so a chain reads in order. A task with nothing before it
// sits one row above the earliest task it leads to — beside what it feeds,
// not stranded at the top. Only 'depends'
// and 'part' edges decide columns; 'related' and 'duplicate' are drawn but do
// not push anything sideways, because they say nothing about order. Separate
// groups of connected tasks are stacked as their own blocks. A cycle — A waits
// on B waits on A — is data that should not exist; it must not hang or crash
// the page, so the edge that closes the loop is left out of the ranking (it is
// still DRAWN, and flagged, so the loop is visible rather than hidden).

export const EDGE_KINDS = {
  depends:   { label: 'Comes before',  directed: true,  ranks: true },
  part:      { label: 'Part of',       directed: true,  ranks: true },
  related:   { label: 'Related to',    directed: false, ranks: false },
  duplicate: { label: 'Duplicate of',  directed: true,  ranks: false },
  sequence:  { label: 'Then, by date', directed: true,  ranks: true, inferred: true },
};

/** The kinds a person can draw between two tasks, in the order they are offered. */
export const CONNECT_KINDS = ['depends', 'part', 'related', 'duplicate'];

// Geometry, in SVG units. A node has a fixed WIDTH and a capped label, so a
// long title wraps instead of stretching the graph — the user's requirement.
export const NODE_W = 220;
export const LABEL_CHARS = 28;   // per line, at the 13px label size
export const LABEL_LINES = 3;    // then "…"
export const LINE_H = 17;
// A node is its title and nothing else (on request): the status is its
// colour, and the rest is in its tooltip and its editor.
const NODE_TOP = 15;
const NODE_FOOT = 13;
export const PAD = 28;

/**
 * Wrap a label into at most `maxLines` lines of about `maxChars` each,
 * breaking at spaces; a word longer than a line is split. Anything that does
 * not fit ends the last line with "…".
 */
export function wrapLabel(text, maxChars = LABEL_CHARS, maxLines = LABEL_LINES) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return ['Untitled task'];
  const pieces = words.flatMap((w) => {
    if (w.length <= maxChars) return [w];
    const parts = [];
    for (let i = 0; i < w.length; i += maxChars - 1) parts.push(w.slice(i, i + maxChars - 1));
    return parts;
  });
  const lines = [];
  let line = '';
  let i = 0;
  for (; i < pieces.length; i += 1) {
    const next = line ? `${line} ${pieces[i]}` : pieces[i];
    if (next.length <= maxChars) { line = next; continue; }
    lines.push(line);
    line = pieces[i];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) { lines.push(line); line = ''; i = pieces.length; }
  if (i < pieces.length || line) {
    // There was more: the last line ends in an ellipsis, inside the width.
    const last = lines[maxLines - 1] || '';
    lines[maxLines - 1] = `${last.length > maxChars - 1 ? last.slice(0, maxChars - 1).trimEnd() : last}…`;
  }
  return lines.slice(0, maxLines);
}

export function nodeHeight(lines) {
  return NODE_TOP + lines * LINE_H + NODE_FOOT;
}

/**
 * Every edge the tasks state, deduplicated. `byId` is every task that exists
 * (so an edge to a deleted or unknown task is dropped, not drawn to nowhere).
 */
export function edgesOf(tasks = [], byId = {}) {
  const out = new Map();
  const add = (from, to, kind) => {
    if (!from || !to || from === to || !byId[from] || !byId[to]) return;
    const undirected = !EDGE_KINDS[kind].directed;
    const [a, b] = undirected && from > to ? [to, from] : [from, to];
    const key = `${kind}:${a}>${b}`;
    if (!out.has(key)) out.set(key, { id: key, from: a, to: b, kind });
  };
  tasks.forEach((t) => {
    (t.dependsOn || []).forEach((dep) => add(dep, t.id, 'depends'));
    (t.links || []).forEach((l) => {
      if (!l?.targetId) return;
      if (l.type === 'blocks') add(t.id, l.targetId, 'depends');
      else if (l.type === 'child-of') add(l.targetId, t.id, 'part');
      else if (l.type === 'parent-of') add(t.id, l.targetId, 'part');
      else if (l.type === 'duplicate-of') add(t.id, l.targetId, 'duplicate');
      else add(t.id, l.targetId, 'related');
    });
  });
  // "Part of" is also an order of a kind; but if A is part of B AND waits on
  // it, that is one connection drawn twice. Keep the dependency.
  for (const e of [...out.values()]) {
    if (e.kind === 'part' && out.has(`depends:${e.from}>${e.to}`)) out.delete(e.id);
  }
  return [...out.values()];
}

/** The date a task sits at in its project's sequence: its planned start, else its due date. */
export const sequenceDate = (t) => t?.plan?.startDate || t?.plan?.endDate || null;

// Does `from` already lead to `to` along the edges that order work?
function makeReach(edges) {
  const succ = new Map();
  const link = (a, b) => { if (!succ.has(a)) succ.set(a, []); succ.get(a).push(b); };
  edges.filter((e) => EDGE_KINDS[e.kind]?.ranks).forEach((e) => link(e.from, e.to));
  const reaches = (from, to) => {
    if (from === to) return true;
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      for (const m of succ.get(stack.pop()) || []) {
        if (m === to) return true;
        if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
    }
    return false;
  };
  return { reaches, link };
}

/**
 * "Auto-connect by date": inside each project, every task with a date
 * follows the tasks planned at the date before it. Tasks on the SAME date
 * are parallel — they share a column rather than being chained in an order
 * nobody chose. Between two small dates every pair is joined; between two
 * busy ones (more than four pairs) the lines go through the first task of
 * each, so a sprint of ten does not draw a hundred lines.
 *
 * Never against what the tasks say: a pair already connected — or already in
 * order through other tasks — gets no extra line, and a line that would make
 * a loop with a stated dependency is not drawn. A task with no date is not
 * guessed into the sequence.
 */
export function sequenceEdges(tasks = [], stated = []) {
  const joined = new Set(stated.flatMap((e) => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));
  const { reaches, link } = makeReach(stated);
  const files = new Map();
  tasks.forEach((t) => {
    const d = sequenceDate(t);
    if (!t?.id || !d) return;
    const key = `${t.workspaceId || ''}|${t.projectId || ''}`;
    if (!files.has(key)) files.set(key, new Map());
    const days = files.get(key);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(t);
  });
  const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || '')) || a.id.localeCompare(b.id);
  const out = [];
  [...files.keys()].sort().forEach((key) => {
    const days = files.get(key);
    const levels = [...days.keys()].sort().map((d) => days.get(d).sort(byTitle));
    for (let i = 1; i < levels.length; i += 1) {
      const prev = levels[i - 1];
      const next = levels[i];
      const pairs = prev.length * next.length <= 4
        ? prev.flatMap((a) => next.map((b) => [a, b]))
        : [...prev.map((a) => [a, next[0]]), ...next.slice(1).map((b) => [prev[0], b])];
      pairs.forEach(([a, b]) => {
        if (joined.has(`${a.id}|${b.id}`) || reaches(a.id, b.id) || reaches(b.id, a.id)) return;
        out.push({ id: `sequence:${a.id}>${b.id}`, from: a.id, to: b.id, kind: 'sequence' });
        link(a.id, b.id);
      });
    }
  });
  return out;
}

/**
 * The graph for the tasks in view.
 *
 * `inView` are the tasks the Board toolbar's filters left; `all` is every
 * task in the workspace(s). Edges are drawn between tasks in view — and to a
 * task one step OUTSIDE the filter, which is shown faded ("context"), because
 * hiding the other end of a dependency is hiding the reason a task is waiting.
 * Tasks with no connection at all are counted, and left out unless asked for.
 * `autoConnect` adds the inferred date-order lines between tasks in view.
 */
export function buildGraph(inView = [], all = [], { includeUnlinked = false, autoConnect = false } = {}) {
  const byId = Object.fromEntries(all.filter((t) => t && !t.deleted).map((t) => [t.id, t]));
  inView.forEach((t) => { if (t && !byId[t.id]) byId[t.id] = t; });
  const shown = new Set(inView.map((t) => t.id));

  // Edges where at least one end is in view.
  const stated = edgesOf(Object.values(byId), byId);
  const sequence = autoConnect ? sequenceEdges(inView.filter((t) => t && !t.deleted), stated) : [];
  const edges = [...stated.filter((e) => shown.has(e.from) || shown.has(e.to)), ...sequence];
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));

  const nodes = [];
  linked.forEach((id) => nodes.push({ id, task: byId[id], context: !shown.has(id) }));
  const unlinked = inView.filter((t) => !linked.has(t.id));
  if (includeUnlinked) unlinked.forEach((t) => nodes.push({ id: t.id, task: t, context: false }));

  return {
    nodes,
    edges,
    unlinkedCount: unlinked.length,
    inViewCount: inView.length,
    contextCount: nodes.filter((n) => n.context).length,
    sequenceCount: sequence.length,
  };
}

/** Connected groups of node ids (edges of every kind join a group). */
export function groupsOf(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => { adj.get(e.from)?.push(e.to); adj.get(e.to)?.push(e.from); });
  const seen = new Set();
  const groups = [];
  nodes.forEach((n) => {
    if (seen.has(n.id)) return;
    const group = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop();
      group.push(id);
      (adj.get(id) || []).forEach((m) => { if (!seen.has(m)) { seen.add(m); stack.push(m); } });
    }
    groups.push(group);
  });
  return groups;
}

/**
 * Columns: longest path in, over the ordering edges, with every cycle broken.
 * Returns { rank: Map(id → column), loopEdges: Set(edge id) }.
 */
export function rankNodes(nodes, edges) {
  const out = new Map(nodes.map((n) => [n.id, []]));
  const ordering = edges.filter((e) => EDGE_KINDS[e.kind].ranks);
  ordering.forEach((e) => out.get(e.from)?.push(e));

  // Drop the edges that close a loop (a DFS back edge), so what is left is
  // acyclic and the ranking terminates.
  const loopEdges = new Set();
  const state = new Map(); // 1 visiting, 2 done
  const visit = (id) => {
    state.set(id, 1);
    (out.get(id) || []).forEach((e) => {
      const s = state.get(e.to);
      if (s === 1) loopEdges.add(e.id);
      else if (!s) visit(e.to);
    });
    state.set(id, 2);
  };
  [...nodes].sort((a, b) => a.id.localeCompare(b.id)).forEach((n) => { if (!state.get(n.id)) visit(n.id); });

  const incoming = new Map(nodes.map((n) => [n.id, []]));
  ordering.filter((e) => !loopEdges.has(e.id)).forEach((e) => incoming.get(e.to)?.push(e.from));
  const rank = new Map();
  const rankOf = (id) => {
    if (rank.has(id)) return rank.get(id);
    rank.set(id, 0); // provisional — the graph is acyclic now, this only guards
    const r = Math.max(-1, ...(incoming.get(id) || []).map(rankOf)) + 1;
    rank.set(id, r);
    return r;
  };
  nodes.forEach((n) => rankOf(n.id));

  // A task with nothing before it is not pinned to the first column: it sits
  // one column before the EARLIEST task it leads to, so a prior step joined
  // to a task far down a chain is drawn beside that task rather than at the
  // far left with a long line across the page. Its successors all have an
  // incoming line, so none of them moves, and one pass is enough.
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  ordering.filter((e) => !loopEdges.has(e.id)).forEach((e) => outgoing.get(e.from)?.push(e.to));
  nodes.forEach((n) => {
    if ((incoming.get(n.id) || []).length) return;
    const next = (outgoing.get(n.id) || []).map((id) => rank.get(id)).filter((r) => r != null);
    if (next.length) rank.set(n.id, Math.max(0, Math.min(...next) - 1));
  });
  return { rank, loopEdges };
}

const dueKey = (t) => t?.plan?.endDate || '9999-99-99';

// ── Swimlanes ────────────────────────────────────────────────────────────────
// One LANE (column) per person accountable, and the work read TOP TO BOTTOM:
// a task's row is its column in the ranking above (longest path in, a task
// with nothing before it pulled down beside what it leads to). Separate
// groups of connected tasks are stacked as their own bands — or, when the page
// passes `bandOf`, the bands are the PHASES: a column at the far left names
// each one, written bottom to top, and a subtle rule runs across between
// them, so you can see which tasks fall under which phase. The lanes hold
// only the CONNECTED work; every task with no connection waits in a separate
// TRAY to the right of the lanes, open work first, ready to be dragged onto
// the flow.

export const LANE_PAD = 22;                  // between a lane's edge and its tasks
export const LANE_W = NODE_W + LANE_PAD * 2;
export const LANE_HEAD = 44;                 // the lane's name row
export const ROW_GAP = 48;                   // between rows: room for the elbows
export const STACK_GAP = 14;                 // two tasks of one lane in one row
export const TRAY_GAP = 36;                  // between the last lane and the tray
export const PHASE_W = 46;                   // the phase column at the far left
const BAND_TOP = 34;                         // inside a band: above its first row
const BAND_FOOT = 26;                        // and below its last
const TRAY_ROWS = 10;                        // the tray adds a column every ten tasks, up to three

const defaultLaneOf = (t) => {
  const uid = (t?.assignedTo || [])[0];
  if (uid) return { key: uid, label: uid };
  const ext = (t?.assignedToExternal || [])[0];
  return ext ? { key: `ext:${ext}`, label: ext } : { key: '', label: 'Unassigned' };
};

/**
 * Positions for every task in lanes, and an orthogonal path for every line.
 * `laneOf(task)` → { key, label, … } names the lane (the key '' is
 * "Unassigned", always last). Lanes are ordered by where their work first
 * appears in the flow, so the chart reads left to right as the hand-offs do.
 */
export function layoutSwimlanes(graph, { labelOf = (t) => t?.title, laneOf = defaultLaneOf, bandOf = null } = {}) {
  const { nodes, edges } = graph;
  const { rank, loopEdges } = rankNodes(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines = new Map(nodes.map((n) => [n.id, wrapLabel(labelOf(n.task))]));
  const lane = new Map(nodes.map((n) => [n.id, laneOf(n.task) || { key: '', label: 'Unassigned' }]));
  const tie = (a, b) => dueKey(byId.get(a).task).localeCompare(dueKey(byId.get(b).task))
    || String(labelOf(byId.get(a).task) || '').localeCompare(String(labelOf(byId.get(b).task) || ''))
    || a.localeCompare(b);

  const linkedIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  const loose = nodes.filter((n) => !linkedIds.has(n.id)).map((n) => n.id);
  const groups = groupsOf(nodes.filter((n) => linkedIds.has(n.id)), edges)
    .map((ids) => ids.sort())
    .sort((a, b) => b.length - a.length
      || dueKey(byId.get(a[0])?.task).localeCompare(dueKey(byId.get(b[0])?.task))
      || a[0].localeCompare(b[0]));

  // The bands, top to bottom: each PHASE when the page names them (in the
  // order `bandOf` gives), else each connected group. A band's rows are the
  // ranks its tasks use, in order, with no empty rows — so inside a phase the
  // work still reads in the order it leads on.
  let bands;
  if (bandOf) {
    const byKey = new Map();
    groups.flat().forEach((id) => {
      const b = bandOf(byId.get(id).task) || { key: '', label: '' };
      if (!byKey.has(b.key)) byKey.set(b.key, { ...b, ids: [] });
      byKey.get(b.key).ids.push(id);
    });
    bands = [...byKey.values()].sort((a, b) => compareOrder(a.order, b.order) || String(a.label).localeCompare(String(b.label)));
  } else {
    bands = groups.map((ids, g) => ({ key: `group-${g}`, label: null, ids }));
  }
  const groupRows = bands.map((band) => {
    const ranks = [...new Set(band.ids.map((id) => rank.get(id) || 0))].sort((a, b) => a - b);
    return ranks.map((r) => band.ids.filter((id) => (rank.get(id) || 0) === r));
  });
  const phaseW = bandOf && bands.length ? PHASE_W : 0;

  // Lane order: where each lane's work first appears; Unassigned last.
  const first = new Map();
  const info = new Map();
  const note = (id, at) => {
    const l = lane.get(id);
    if (!info.has(l.key)) info.set(l.key, { ...l, count: 0 });
    info.get(l.key).count += 1;
    if (!first.has(l.key) || at < first.get(l.key)) first.set(l.key, at);
  };
  groupRows.forEach((rows, g) => rows.forEach((row, r) => row.forEach((id) => note(id, g * 10000 + r))));
  const lanes = [...info.values()].sort((a, b) => (!a.key) - (!b.key)
    || first.get(a.key) - first.get(b.key) || String(a.label).localeCompare(String(b.label)));
  const laneIdx = new Map(lanes.map((l, i) => [l.key, i]));
  lanes.forEach((l, i) => { l.x = PAD + phaseW + i * LANE_W; l.w = LANE_W; });
  const laneOfId = (id) => laneIdx.get(lane.get(id).key);

  const pos = new Map();
  const rowTopOf = new Map();
  const dividers = [];
  let top = PAD + LANE_HEAD;
  const place = (ids, rowTop, order = tie) => {
    // One row: in each lane its tasks stacked; the row is as tall as its tallest lane.
    const cells = new Map();
    ids.forEach((id) => { const i = laneOfId(id); if (!cells.has(i)) cells.set(i, []); cells.get(i).push(id); });
    let rowH = 0;
    cells.forEach((cell, i) => {
      let y = rowTop;
      cell.sort(order).forEach((id) => {
        const h = nodeHeight(lines.get(id).length);
        pos.set(id, { x: lanes[i].x + LANE_PAD, y, w: NODE_W, h, lane: i, lines: lines.get(id) });
        rowTopOf.set(id, rowTop);
        y += h + STACK_GAP;
      });
      rowH = Math.max(rowH, y - STACK_GAP - rowTop);
    });
    return rowH;
  };
  groupRows.forEach((rows, g) => {
    const band = bands[g];
    band.y = top;
    if (g > 0) dividers.push(top);
    top += BAND_TOP;
    rows.forEach((row) => { top += place(row, top) + ROW_GAP; });
    top += BAND_FOOT - ROW_GAP;
    band.h = top - band.y;
    delete band.ids;
  });

  const lanesBottom = bands.length ? top + PAD : 0;

  // The tray: everything not connected, in a box of its own right of the lanes.
  let tray = null;
  if (loose.length) {
    const cols = Math.min(3, Math.ceil(loose.length / TRAY_ROWS));
    const x = PAD + phaseW + lanes.length * LANE_W + (lanes.length ? TRAY_GAP : 0);
    const openFirst = (a, b) => (byId.get(a).task?.status === 'done') - (byId.get(b).task?.status === 'done') || tie(a, b);
    const sorted = [...loose].sort(openFirst);
    let y = PAD + LANE_HEAD + 18;
    for (let i = 0; i < sorted.length; i += cols) {
      const row = sorted.slice(i, i + cols);
      const rowH = Math.max(...row.map((id) => nodeHeight(lines.get(id).length)));
      row.forEach((id, c) => {
        pos.set(id, { x: x + LANE_PAD + c * (NODE_W + STACK_GAP), y, w: NODE_W, h: nodeHeight(lines.get(id).length), lane: null, lines: lines.get(id) });
      });
      y += rowH + STACK_GAP;
    }
    tray = { x, y: PAD, w: LANE_PAD * 2 + cols * NODE_W + (cols - 1) * STACK_GAP, h: y - STACK_GAP + LANE_PAD - PAD, count: loose.length };
  }

  const width = Math.max(PAD * 2 + LANE_W, tray ? tray.x + tray.w + PAD : PAD * 2 + phaseW + lanes.length * LANE_W);
  const height = Math.max(lanesBottom, tray ? tray.y + tray.h + PAD : 0, PAD * 2 + LANE_HEAD + 40);

  // Is the stretch of a lane between y1 and y2 free of tasks (other than a and b)?
  const inLane = lanes.map(() => []);
  pos.forEach((p, id) => { if (p.lane != null) inLane[p.lane].push({ id, ...p }); });
  const clear = (i, y1, y2, skip) => !inLane[i].some((p) => !skip.includes(p.id) && p.y < y2 && p.y + p.h > y1);

  const paths = edges.map((e, k) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return null;
    return { ...e, loop: loopEdges.has(e.id), d: laneEdgePath(a, b, { lanes, rowTopOf: (n) => rowTopOf.get(n), from: e.from, to: e.to, clear, nudge: ((k % 5) - 2) * 3 }) };
  }).filter(Boolean);

  return {
    nodes: nodes.map((n) => ({ ...n, ...pos.get(n.id) })),
    edges: paths,
    lanes,
    width,
    height,
    groups: groups.length,
    bands: bandOf ? bands : [],
    phaseW,
    dividers,
    lanesBottom,
    tray,
  };
}

// Sort keys a page hands over as arrays — [project name, phase order] — compared
// item by item, numbers as numbers, anything missing last.
function compareOrder(a = [], b = []) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]; const y = b[i];
    if (x === y) continue;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    const c = String(x).localeCompare(String(y));
    if (c) return c;
  }
  return 0;
}

/**
 * The line from `a` to `b` as right angles, never through a task: lines run
 * down a lane only where it is clear, cross between lanes in the gap above a
 * row, and otherwise travel in the gutter between two lanes. A line that
 * goes up or sideways (a relation, or a loop) leaves and enters by the side.
 */
export function laneEdgePath(a, b, { lanes, rowTopOf, from, to, clear, nudge = 0 }) {
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  const skip = [from, to];
  const gutter = (i, toward) => (toward > i ? lanes[i].x + LANE_W : toward < i ? lanes[i].x : lanes[i].x + LANE_W) + nudge;
  const aBottom = a.y + a.h;
  const pts = [];
  if (b.y > aBottom) {
    // Lines crossing the same gap are nudged apart, so two never share a run.
    const gapY = rowTopOf(to) - (rowTopOf(to) > rowTopOf(from) ? ROW_GAP / 2 + nudge : STACK_GAP / 2);
    pts.push([ax, aBottom]);
    if (clear(a.lane, aBottom, gapY, skip)) pts.push([ax, gapY]);
    else {
      const g = gutter(a.lane, b.lane);
      pts.push([ax, aBottom + STACK_GAP / 2], [g, aBottom + STACK_GAP / 2], [g, gapY]);
    }
    if (clear(b.lane, gapY, b.y, skip)) pts.push([bx, gapY], [bx, b.y]);
    else {
      const g = gutter(b.lane, a.lane);
      pts.push([g, gapY], [g, b.y - STACK_GAP / 2], [bx, b.y - STACK_GAP / 2], [bx, b.y]);
    }
  } else {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    const right = b.lane >= a.lane;
    const aSide = right ? a.x + a.w : a.x;
    const bSide = b.lane > a.lane ? b.x : b.x + b.w;
    const gA = gutter(a.lane, b.lane === a.lane ? a.lane + 1 : b.lane);
    const gB = gutter(b.lane, b.lane === a.lane ? b.lane + 1 : a.lane);
    const gy = Math.min(rowTopOf(from), rowTopOf(to)) - ROW_GAP / 2;
    pts.push([aSide, ay], [gA, ay]);
    if (gA !== gB) pts.push([gA, gy], [gB, gy]);
    pts.push([gB, by], [bSide, by]);
  }
  return roundedPath(pts);
}

/** A polyline with softened corners; repeated and straight-through points are dropped. */
export function roundedPath(points, r = 8) {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  const keep = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const [x0, y0] = pts[i - 1]; const [x1, y1] = p; const [x2, y2] = pts[i + 1];
    return (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) !== 0;
  });
  if (keep.length < 2) return `M ${keep[0]?.[0] || 0} ${keep[0]?.[1] || 0}`;
  let d = `M ${keep[0][0]} ${keep[0][1]}`;
  for (let i = 1; i < keep.length - 1; i += 1) {
    const [px, py] = keep[i - 1]; const [x, y] = keep[i]; const [nx, ny] = keep[i + 1];
    const r1 = Math.min(r, Math.hypot(x - px, y - py) / 2);
    const r2 = Math.min(r, Math.hypot(nx - x, ny - y) / 2);
    const ux = Math.sign(x - px); const uy = Math.sign(y - py);
    const vx = Math.sign(nx - x); const vy = Math.sign(ny - y);
    d += ` L ${x - ux * r1} ${y - uy * r1} Q ${x} ${y} ${x + vx * r2} ${y + vy * r2}`;
  }
  const last = keep[keep.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/** Everything one hop from `id` — what a hover lights up. */
export function neighbourhood(id, edges = []) {
  const ids = new Set([id]);
  const edgeIds = new Set();
  edges.forEach((e) => {
    if (e.from === id || e.to === id) { ids.add(e.from); ids.add(e.to); edgeIds.add(e.id); }
  });
  return { ids, edgeIds };
}

// ── Drawing a connection by hand ────────────────────────────────────────────
// Dragging from one task onto another writes the SAME fields the task
// editor's Dependencies & relations writes, so a line drawn here is a line
// everywhere — the Gantt's arrows, the editor, the Kanban's 🔗 badge.

const stillJoined = (e, a, b) => (e.from === a && e.to === b) || (e.from === b && e.to === a);

/**
 * What connecting `first` → `second` as `kind` writes, or why it cannot:
 *   depends   — "first comes before second": second.dependsOn += first
 *   part      — "second is part of first":  second.links += child-of first
 *   related   — first.links += related-to second
 *   duplicate — "first is a duplicate of second": first.links += duplicate-of
 * Returns { taskId, updates, undo } (undo restores the field as it was), or
 * { error } with one plain sentence.
 */
export function connectionUpdate(first, second, kind, all = []) {
  if (!first || !second) return { error: 'Pick two tasks to connect.' };
  if (first.id === second.id) return { error: 'A task cannot be connected to itself.' };
  if ((first.workspaceId || '') !== (second.workspaceId || '')) {
    return { error: 'These two tasks are in different workspaces, so they cannot be connected.' };
  }
  if (!CONNECT_KINDS.includes(kind)) return { error: 'That is not a kind of connection.' };
  const byId = Object.fromEntries([...all, first, second].filter(Boolean).map((t) => [t.id, t]));
  const stated = edgesOf(Object.values(byId), byId);
  if (stated.some((e) => stillJoined(e, first.id, second.id))) return { error: 'These two tasks are already connected.' };
  if (EDGE_KINDS[kind].ranks && makeReach(stated).reaches(second.id, first.id)) {
    return { error: `That would make a loop — “${second.title || 'that task'}” already leads to “${first.title || 'this one'}”.` };
  }
  const links = (t) => (Array.isArray(t.links) ? t.links : []);
  if (kind === 'depends') {
    const before = second.dependsOn || [];
    return { taskId: second.id, updates: { dependsOn: [...before, first.id] }, undo: { dependsOn: before } };
  }
  if (kind === 'part') {
    return { taskId: second.id, updates: { links: [...links(second), { targetId: first.id, type: 'child-of' }] }, undo: { links: links(second) } };
  }
  const type = kind === 'related' ? 'related-to' : 'duplicate-of';
  return { taskId: first.id, updates: { links: [...links(first), { targetId: second.id, type }] }, undo: { links: links(first) } };
}

/**
 * What removing a drawn line writes: every statement that produced it, on
 * whichever task holds it (a dependency can be said as `dependsOn` on one end
 * or as a `blocks` link on the other). Returns [{ taskId, updates, undo }].
 * An inferred line has nothing to remove — it is not stored.
 */
export function disconnectUpdates(edge, byId = {}) {
  if (!edge || EDGE_KINDS[edge.kind]?.inferred) return [];
  const a = byId[edge.from];
  const b = byId[edge.to];
  if (!a || !b) return [];
  const writes = [];
  const dropLinks = (t, otherId, test) => {
    const links = Array.isArray(t.links) ? t.links : [];
    const kept = links.filter((l) => !(l?.targetId === otherId && test(l.type)));
    if (kept.length !== links.length) writes.push({ taskId: t.id, updates: { links: kept }, undo: { links } });
  };
  const ordered = ['blocks', 'child-of', 'parent-of', 'duplicate-of'];
  if (edge.kind === 'depends') {
    const deps = b.dependsOn || [];
    if (deps.includes(a.id)) writes.push({ taskId: b.id, updates: { dependsOn: deps.filter((id) => id !== a.id) }, undo: { dependsOn: deps } });
    dropLinks(a, b.id, (type) => type === 'blocks');
  } else if (edge.kind === 'part') {
    dropLinks(b, a.id, (type) => type === 'child-of');
    dropLinks(a, b.id, (type) => type === 'parent-of');
  } else if (edge.kind === 'duplicate') {
    dropLinks(a, b.id, (type) => type === 'duplicate-of');
  } else {
    dropLinks(a, b.id, (type) => !ordered.includes(type));
    dropLinks(b, a.id, (type) => !ordered.includes(type));
  }
  return writes;
}
