// src/services/nodeGraph.js — Board → Node: tasks as a graph of what leads to what.
//
// Pure: no React, no Firebase. The page (components/NodeView.jsx) draws what
// this returns, and tests/ui + nodeGraph.test.mjs pin the rules.
//
// WHAT AN EDGE IS — only what the task itself says, never a guess:
//   · `dependsOn: [id]`          → id ──▶ task   "comes before"   (kind 'depends')
//   · link `blocks`   → target   → task ──▶ target                (kind 'depends')
//     (both are the same claim — the second task waits on the first — so a
//      pair stated both ways is ONE edge)
//   · link `child-of` → parent   → parent ──▶ task  "is part of"  (kind 'part')
//   · link `parent-of`→ child    → task ──▶ child                 (kind 'part')
//   · link `related-to`          → task ─ ─ other, no direction   (kind 'related')
//   · link `duplicate-of`        → task ─ ─▶ original              (kind 'duplicate')
//
// LAYOUT — left to right, the way work flows. A task's column is one past the
// furthest thing it waits on (the longest path in), so a chain reads in order
// and everything that can start now sits in the first column. Only 'depends'
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
};

// Geometry, in SVG units. A node has a fixed WIDTH and a capped label, so a
// long title wraps instead of stretching the graph — the user's requirement.
export const NODE_W = 220;
export const LABEL_CHARS = 28;   // per line, at the 13px label size
export const LABEL_LINES = 3;    // then "…"
export const LINE_H = 17;
const NODE_TOP = 40;             // status chip row + gap above the label
const NODE_FOOT = 34;            // gap + the owner/due row + padding
export const GAP_X = 96;         // between columns: room for the curves
export const GAP_Y = 22;         // between nodes in a column
export const GROUP_GAP = 48;     // between separate groups
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

/**
 * The graph for the tasks in view.
 *
 * `inView` are the tasks the Board toolbar's filters left; `all` is every
 * task in the workspace(s). Edges are drawn between tasks in view — and to a
 * task one step OUTSIDE the filter, which is shown faded ("context"), because
 * hiding the other end of a dependency is hiding the reason a task is waiting.
 * Tasks with no connection at all are counted, and left out unless asked for:
 * the page is about connections.
 */
export function buildGraph(inView = [], all = [], { includeUnlinked = false } = {}) {
  const byId = Object.fromEntries(all.filter((t) => t && !t.deleted).map((t) => [t.id, t]));
  inView.forEach((t) => { if (t && !byId[t.id]) byId[t.id] = t; });
  const shown = new Set(inView.map((t) => t.id));

  // Edges where at least one end is in view.
  const edges = edgesOf(Object.values(byId), byId).filter((e) => shown.has(e.from) || shown.has(e.to));
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
  return { rank, loopEdges };
}

const dueKey = (t) => t?.plan?.endDate || '9999-99-99';

/**
 * Positions for every node, and a path for every edge.
 *
 * Within a column, nodes are ordered to keep lines short: by the average row
 * of what feeds them (two passes), then by due date, then by title — so the
 * same data always draws the same picture.
 */
export function layoutGraph(graph, {
  labelOf = (t) => t?.title,
  // What a task with no connection is filed under in the grid: its project.
  groupOf = (t) => ({ key: t?.projectId || '', label: t?.projectId ? 'Project' : 'No project', color: null }),
  // How many across the grid may go — the page passes what fits its width.
  across: acrossWanted = 0,
} = {}) {
  const { nodes, edges } = graph;
  const { rank, loopEdges } = rankNodes(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines = new Map(nodes.map((n) => [n.id, wrapLabel(labelOf(n.task))]));

  // Bigger groups first, then the group whose earliest task is due soonest.
  // A task with no connection at all is not a group: those are laid out as a
  // grid at the foot (see below), not as a column of one-node "groups".
  const linkedIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  const loose = nodes.filter((n) => !linkedIds.has(n.id)).map((n) => n.id);
  const groups = groupsOf(nodes.filter((n) => linkedIds.has(n.id)), edges)
    .map((ids) => ids.sort())
    .sort((a, b) => b.length - a.length
      || dueKey(byId.get(a[0])?.task).localeCompare(dueKey(byId.get(b[0])?.task))
      || a[0].localeCompare(b[0]));

  const pos = new Map();
  let top = PAD;
  let width = 0;
  const neighbours = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => { neighbours.get(e.from)?.push(e.to); neighbours.get(e.to)?.push(e.from); });

  groups.forEach((ids) => {
    const cols = new Map();
    ids.forEach((id) => {
      const r = rank.get(id) || 0;
      if (!cols.has(r)) cols.set(r, []);
      cols.get(r).push(id);
    });
    const colIdx = [...cols.keys()].sort((a, b) => a - b);
    const order = new Map();
    const tie = (a, b) => dueKey(byId.get(a).task).localeCompare(dueKey(byId.get(b).task))
      || String(labelOf(byId.get(a).task) || '').localeCompare(String(labelOf(byId.get(b).task) || ''))
      || a.localeCompare(b);
    colIdx.forEach((c) => { cols.get(c).sort(tie).forEach((id, i) => order.set(id, i)); });
    // Two barycentre sweeps: a node moves toward the rows of its neighbours.
    for (let pass = 0; pass < 2; pass += 1) {
      colIdx.forEach((c) => {
        const bary = (id) => {
          const ns = (neighbours.get(id) || []).filter((m) => order.has(m) && rank.get(m) !== c);
          return ns.length ? ns.reduce((s, m) => s + order.get(m), 0) / ns.length : order.get(id);
        };
        cols.get(c).sort((a, b) => bary(a) - bary(b) || tie(a, b)).forEach((id, i) => order.set(id, i));
      });
    }
    // Stack each column; the group is as tall as its tallest column, and the
    // columns are centred against each other so a short chain does not hug
    // the top edge of a tall one.
    const colH = new Map(colIdx.map((c) => [c,
      cols.get(c).reduce((h, id) => h + nodeHeight(lines.get(id).length), 0) + (cols.get(c).length - 1) * GAP_Y]));
    const groupH = Math.max(...colH.values());
    colIdx.forEach((c) => {
      let y = top + (groupH - colH.get(c)) / 2;
      cols.get(c).forEach((id) => {
        const h = nodeHeight(lines.get(id).length);
        const x = PAD + c * (NODE_W + GAP_X);
        pos.set(id, { x, y, w: NODE_W, h, rank: c, lines: lines.get(id) });
        width = Math.max(width, x + NODE_W + PAD);
        y += h + GAP_Y;
      });
    });
    top += groupH + GROUP_GAP;
  });

  // Everything with no connection — the rest of the work, which a strategy
  // still has to see — as a grid under the graph, filed by PROJECT so it can
  // be read as "what is left in each", open work first by due date and the
  // finished last. One heading for the section, one per project.
  const headings = [];
  let looseTop = null;
  if (loose.length) {
    looseTop = top;
    headings.push({ kind: 'section', y: top, label: linkedIds.size ? 'NOT CONNECTED TO ANOTHER TASK' : 'NO CONNECTIONS YET — EVERY TASK, BY PROJECT' });
    top += 30;
    const across = Math.max(3, acrossWanted || 0, Math.round((width - PAD) / (NODE_W + GAP_X / 2)) || 0);
    const files = new Map();
    loose.forEach((id) => {
      const g = groupOf(byId.get(id).task) || { key: '', label: 'No project' };
      if (!files.has(g.key)) files.set(g.key, { ...g, ids: [] });
      files.get(g.key).ids.push(id);
    });
    const order = [...files.values()].sort((a, b) => (!a.key) - (!b.key) || String(a.label).localeCompare(String(b.label)));
    const openFirst = (a, b) => {
      const ta = byId.get(a).task; const tb = byId.get(b).task;
      return (ta?.status === 'done') - (tb?.status === 'done')
        || dueKey(ta).localeCompare(dueKey(tb))
        || String(labelOf(ta) || '').localeCompare(String(labelOf(tb) || ''))
        || a.localeCompare(b);
    };
    order.forEach((file) => {
      headings.push({ kind: 'project', y: top, label: file.label, color: file.color, count: file.ids.length });
      top += 24;
      const sorted = [...file.ids].sort(openFirst);
      for (let i = 0; i < sorted.length; i += across) {
        const row = sorted.slice(i, i + across);
        const rowH = Math.max(...row.map((id) => nodeHeight(lines.get(id).length)));
        row.forEach((id, j) => {
          const x = PAD + j * (NODE_W + GAP_X / 2);
          pos.set(id, { x, y: top, w: NODE_W, h: nodeHeight(lines.get(id).length), rank: null, lines: lines.get(id) });
          width = Math.max(width, x + NODE_W + PAD);
        });
        top += rowH + GAP_Y;
      }
      top += 14;
    });
    top += GROUP_GAP - GAP_Y - 14;
  }

  const paths = edges.map((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return null;
    // A line between two tasks in one column bows out to the right; the
    // canvas has to be wide enough for the bow, or it is clipped at the edge.
    if (a.x === b.x) width = Math.max(width, a.x + a.w + sameColumnBow(a, b) + PAD);
    return { ...e, loop: loopEdges.has(e.id), d: edgePath(a, b) };
  }).filter(Boolean);

  return {
    nodes: nodes.map((n) => ({ ...n, ...pos.get(n.id) })),
    edges: paths,
    width: Math.max(width, PAD * 2 + NODE_W),
    height: Math.max(top - GROUP_GAP + PAD, PAD * 2),
    groups: groups.length,
    looseTop,
    headings,
  };
}

/**
 * A curve from `a` to `b`. Forward (b to the right): right edge → left edge.
 * Same column: out of the right side and back in, bowing outward. Backward
 * (a loop, drawn anyway): out of the left of `a`, into the right of `b`.
 */
export function edgePath(a, b) {
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  if (b.x > a.x) {
    const x1 = a.x + a.w;
    const x2 = b.x;
    const k = Math.max(36, (x2 - x1) / 2);
    return `M ${x1} ${ay} C ${x1 + k} ${ay}, ${x2 - k} ${by}, ${x2} ${by}`;
  }
  if (b.x === a.x) {
    const x = a.x + a.w;
    const bow = sameColumnBow(a, b);
    return `M ${x} ${ay} C ${x + bow} ${ay}, ${x + bow} ${by}, ${x} ${by}`;
  }
  const x1 = a.x;
  const x2 = b.x + b.w;
  const k = Math.max(60, (x1 - x2) / 2);
  return `M ${x1} ${ay} C ${x1 - k} ${ay}, ${x2 + k} ${by}, ${x2} ${by}`;
}

/** How far a same-column line bows out: more for nodes further apart. */
export function sameColumnBow(a, b) {
  return 46 + Math.min(60, Math.abs((b.y + b.h / 2) - (a.y + a.h / 2)) / 4);
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
