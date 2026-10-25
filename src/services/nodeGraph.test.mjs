// Board → Node: what an edge is, where a node goes, and how a label wraps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapLabel, edgesOf, buildGraph, rankNodes, layoutSwimlanes, neighbourhood, groupsOf,
  sequenceEdges, connectionUpdate, disconnectUpdates,
  LABEL_CHARS, LABEL_LINES, NODE_W,
} from './nodeGraph.js';

const T = (id, o = {}) => ({ id, title: `Task ${id}`, status: 'todo', dependsOn: [], links: [], ...o });
const byId = (list) => Object.fromEntries(list.map((t) => [t.id, t]));

test('a label wraps at the node width: three lines at most, then "…"', () => {
  const long = 'Reconcile the September ledger against the bank statements and file variances with finance before close';
  const lines = wrapLabel(long);
  assert.equal(lines.length, LABEL_LINES);
  assert.ok(lines.every((l) => l.length <= LABEL_CHARS), lines.join(' | '));
  assert.ok(lines.at(-1).endsWith('…'), 'what does not fit is marked, not silently cut');
  assert.deepEqual(wrapLabel('Short one'), ['Short one']);
  assert.deepEqual(wrapLabel(''), ['Untitled task']);
  // A word longer than a line is split rather than overflowing the box.
  assert.ok(wrapLabel('Supercalifragilisticexpialidociousandthensome').every((l) => l.length <= LABEL_CHARS));
});

test('every edge is one the tasks state, and a claim made twice is one edge', () => {
  const tasks = [
    T('a'),
    T('b', { dependsOn: ['a'] }),                                   // a → b
    T('c', { links: [{ type: 'blocks', targetId: 'b' }] }),         // c → b
    T('d', { links: [{ type: 'child-of', targetId: 'a' }] }),       // a → d (part)
    T('e', { links: [{ type: 'related-to', targetId: 'd' }] }),     // d — e
    T('f', { links: [{ type: 'duplicate-of', targetId: 'e' }, { type: 'related-to', targetId: 'gone' }] }),
    T('g', { dependsOn: ['c'], links: [] }),
  ];
  // c blocks g, said both ways: still one edge.
  tasks[2].links.push({ type: 'blocks', targetId: 'g' });
  const edges = edgesOf(tasks, byId(tasks));
  const key = (e) => `${e.kind}:${e.from}>${e.to}`;
  assert.deepEqual(edges.map(key).sort(), [
    'depends:a>b', 'depends:c>b', 'depends:c>g', 'duplicate:f>e', 'part:a>d', 'related:d>e',
  ].sort());
  assert.ok(!edges.some((e) => e.to === 'gone'), 'a link to a task that no longer exists is not drawn');
});

test('the filter decides what is shown; the other end of a connection stays, faded', () => {
  const all = [T('a'), T('b', { dependsOn: ['a'] }), T('c'), T('d')];
  const g = buildGraph([all[1], all[2]], all);            // a and d are filtered out
  assert.deepEqual(g.nodes.map((n) => [n.id, n.context]).sort(), [['a', true], ['b', false]]);
  assert.equal(g.unlinkedCount, 1, 'c has no connection — counted, not drawn');
  assert.equal(g.contextCount, 1);
  assert.equal(buildGraph([all[1], all[2]], all, { includeUnlinked: true }).nodes.length, 3);
  assert.ok(!buildGraph([all[1]], all).nodes.some((n) => n.id === 'd'), 'an unrelated filtered-out task never appears');
});

test('columns follow the work: each task one past the furthest thing it waits on', () => {
  const tasks = [T('a'), T('b', { dependsOn: ['a'] }), T('c', { dependsOn: ['b'] }), T('d', { dependsOn: ['a', 'c'] }),
    T('e', { links: [{ type: 'related-to', targetId: 'a' }] })];
  const g = buildGraph(tasks, tasks);
  const { rank } = rankNodes(g.nodes, g.edges);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => rank.get(id)), [0, 1, 2, 3, 0],
    '"related" draws a line but does not push anything to a later column');
});

test('a task with nothing before it sits beside what it leads to, not at the far left', () => {
  // a → b → c → d, and x (connected later) comes before d only.
  const tasks = [T('a'), T('b', { dependsOn: ['a'] }), T('c', { dependsOn: ['b'] }),
    T('d', { dependsOn: ['c', 'x'] }), T('x', { assignedTo: ['other'] }), T('y'), T('z', { dependsOn: ['y'] })];
  const g = buildGraph(tasks, tasks);
  const { rank } = rankNodes(g.nodes, g.edges);
  assert.equal(rank.get('x'), 2, 'one column before d');
  assert.equal(rank.get('d'), 3, 'what it leads to does not move');
  assert.equal(rank.get('a'), 0, 'the start of the longest chain stays first');
  assert.equal(rank.get('y'), 0);
  const layout = layoutSwimlanes(g);
  const x = layout.nodes.find((n) => n.id === 'x');
  const c = layout.nodes.find((n) => n.id === 'c');
  const d = layout.nodes.find((n) => n.id === 'd');
  assert.equal(x.y, c.y, 'in the row just above d, beside c — not at the top');
  assert.ok(x.y < d.y);
});

test('a loop in the data does not hang the page — it is drawn and flagged', () => {
  const tasks = [T('a', { dependsOn: ['b'] }), T('b', { dependsOn: ['a'] }), T('c', { dependsOn: ['b'] })];
  const g = buildGraph(tasks, tasks);
  const layout = layoutSwimlanes(g);
  assert.equal(layout.nodes.length, 3);
  assert.equal(layout.edges.filter((e) => e.loop).length, 1, 'exactly the edge that closes the loop');
  assert.ok(layout.edges.every((e) => typeof e.d === 'string' && e.d.startsWith('M ')));
});

const who = (t) => (t.owner ? { key: t.owner, label: t.owner.toUpperCase() } : { key: '', label: 'Unassigned' });

test('swimlanes: a lane per person, read top to bottom, nothing overlaps', () => {
  const tasks = [
    T('a', { owner: 'ann', title: 'A very long task title that will certainly need to wrap onto several lines here' }),
    T('b', { owner: 'bob', dependsOn: ['a'] }), T('c', { owner: 'ann', dependsOn: ['a'] }),
    T('x', { owner: 'cy' }), T('y', { owner: 'bob', dependsOn: ['x'] }),
    T('lone1', { owner: 'ann' }), T('lone2'),
  ];
  const layout = layoutSwimlanes(buildGraph(tasks, tasks, { includeUnlinked: true }), { laneOf: who });
  assert.deepEqual(layout.lanes.map((l) => l.label), ['ANN', 'BOB', 'CY'],
    'lanes in the order their work first appears — and only for connected work');
  assert.deepEqual(layout.lanes.map((l) => l.count), [2, 2, 1]);
  const at = (id) => layout.nodes.find((n) => n.id === id);
  const laneX = (label) => layout.lanes.find((l) => l.label === label).x;
  assert.ok(at('a').x > laneX('ANN') && at('a').x < laneX('BOB'), 'a sits in Ann\'s lane');
  assert.ok(at('b').x > laneX('BOB'), 'b sits in Bob\'s lane');
  assert.ok(at('b').y > at('a').y && at('c').y > at('a').y, 'what follows sits below');
  assert.equal(at('b').y, at('c').y, 'one step, one row — across lanes');
  assert.ok(layout.nodes.every((n) => n.w === NODE_W));
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let k = i + 1; k < layout.nodes.length; k += 1) {
      const p = layout.nodes[i]; const q = layout.nodes[k];
      assert.ok(!(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h), `${p.id} overlaps ${q.id}`);
    }
  }
  assert.equal(layout.groups, 2);
  assert.equal(layout.dividers.length, 1, 'the second group is ruled off from the first');
  const lastLane = layout.lanes.at(-1);
  assert.ok(layout.tray && layout.tray.count === 2, 'the unconnected wait in a tray');
  assert.ok(['lone1', 'lone2'].every((id) => at(id).x >= layout.tray.x && at(id).x > lastLane.x + lastLane.w),
    'the tray sits to the right of every lane');
  assert.ok(layout.width >= layout.tray.x + layout.tray.w);
  assert.equal(at('a').lines.length, 3);
  assert.ok(layout.height > at('a').y + at('a').h);
});

test('a line runs at right angles and never through a task', () => {
  // a (Ann) → d (Ann) two rows down, with c (Ann) in between: the line must
  // leave the lane rather than run straight down through c.
  const tasks = [T('a', { owner: 'ann' }), T('b', { owner: 'bob', dependsOn: ['a'] }),
    T('c', { owner: 'ann', dependsOn: ['a'] }), T('d', { owner: 'ann', dependsOn: ['b'] })];
  const layout = layoutSwimlanes(buildGraph(tasks, tasks), { laneOf: who });
  const at = (id) => layout.nodes.find((n) => n.id === id);
  const path = layout.edges.find((e) => e.from === 'b' && e.to === 'd').d;
  assert.match(path, /^M [\d.]+ [\d.]+( (L|Q) [\d. ]+)+$/, 'straight runs and rounded corners only');
  // Sample the polyline's corner points and check none falls inside c.
  const c = at('c');
  const nums = path.replace(/[MLQ]/g, ' ').trim().split(/\s+/).map(Number);
  for (let i = 0; i < nums.length; i += 2) {
    const [x, y] = [nums[i], nums[i + 1]];
    assert.ok(!(x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h), `the line b→d passes through c at ${x},${y}`);
  }
  const ad = layout.edges.find((e) => e.from === 'a' && e.to === 'c').d;
  assert.match(ad, new RegExp(`^M ${at('a').x + NODE_W / 2} ${at('a').y + at('a').h} L ${at('c').x + NODE_W / 2} ${at('c').y}$`),
    'straight down when nothing is in the way');
});

test('a hover lights a node and everything one step from it', () => {
  const tasks = [T('a'), T('b', { dependsOn: ['a'] }), T('c', { dependsOn: ['b'] })];
  const g = buildGraph(tasks, tasks);
  const { ids } = neighbourhood('b', g.edges);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...neighbourhood('a', g.edges).ids].sort(), ['a', 'b']);
  assert.equal(groupsOf(g.nodes, g.edges).length, 1);
});

test('every task is on the page: the unconnected are open work first, finished last', () => {
  const tasks = [
    T('a'), T('b', { dependsOn: ['a'] }),
    T('x1', { owner: 'ann', title: 'Later one', plan: { endDate: '2026-12-01' } }),
    T('x2', { owner: 'ann', title: 'Done one', status: 'done', plan: { endDate: '2026-01-01' } }),
    T('x3', { owner: 'ann', title: 'Sooner one', plan: { endDate: '2026-11-01' } }),
  ];
  const g = buildGraph(tasks, tasks, { includeUnlinked: true });
  assert.equal(g.nodes.length, tasks.length, 'no task is left out');
  const layout = layoutSwimlanes(g, { laneOf: who });
  const order = ['x1', 'x2', 'x3'].map((id) => layout.nodes.find((n) => n.id === id)).sort((p, q) => p.y - q.y).map((n) => n.id);
  assert.deepEqual(order, ['x3', 'x1', 'x2'], 'soonest due first, finished last');
  assert.equal(layout.tray.count, 3);
});

const D = (id, date, o = {}) => T(id, { projectId: 'p', plan: { startDate: date }, ...o });
const key = (e) => `${e.from}>${e.to}`;

test('auto-connect: inside a project, each date follows the one before; one date is one column', () => {
  const tasks = [D('a', '2026-10-01'), D('b', '2026-10-03'), D('c', '2026-10-03'), D('d', '2026-10-09'),
    T('nodate', { projectId: 'p' }), D('other', '2026-10-02', { projectId: 'q' })];
  const seq = sequenceEdges(tasks, []);
  assert.deepEqual(seq.map(key).sort(), ['a>b', 'a>c', 'b>d', 'c>d']);
  assert.ok(seq.every((e) => e.kind === 'sequence'));
  assert.ok(!seq.some((e) => e.from === 'other' || e.to === 'other'), 'another project is its own sequence');
  assert.ok(!seq.some((e) => e.to === 'nodate' || e.from === 'nodate'), 'no date, no guess');
  const g = buildGraph(tasks, tasks, { autoConnect: true });
  const { rank } = rankNodes(g.nodes, g.edges);
  assert.equal(rank.get('b'), rank.get('c'), 'same date, same column');
  assert.equal(rank.get('d'), 2);
  assert.equal(buildGraph(tasks, tasks).sequenceCount, 0, 'off unless asked for');
});

test('auto-connect never contradicts or repeats what the tasks say', () => {
  // b is dated after a, but the tasks say b comes BEFORE a: no line a→b (it would loop).
  const tasks = [D('a', '2026-10-01', { dependsOn: ['b'] }), D('b', '2026-10-02'), D('c', '2026-10-05', { dependsOn: ['a'] })];
  const stated = edgesOf(tasks, byId(tasks));
  const seq = sequenceEdges(tasks, stated);
  assert.ok(!seq.some((e) => key(e) === 'a>b'), 'against a stated dependency');
  assert.ok(!seq.some((e) => key(e) === 'b>c'), 'already in order through a');
  const layout = layoutSwimlanes(buildGraph(tasks, tasks, { autoConnect: true }));
  assert.equal(layout.edges.filter((e) => e.loop).length, 0);
});

test('a busy date is joined through its first task, not every pair', () => {
  const tasks = [...'abc'].map((x) => D(x, '2026-10-01')).concat([...'xyz'].map((x) => D(x, '2026-10-02')));
  assert.equal(sequenceEdges(tasks, []).length, 5, '3 into x, then a into y and z — not 9');
});

test('drawing a line writes what the task editor writes', () => {
  const a = T('a', { workspaceId: 'w' });
  const b = T('b', { workspaceId: 'w', dependsOn: ['z'] });
  assert.deepEqual(connectionUpdate(a, b, 'depends', [a, b]),
    { taskId: 'b', updates: { dependsOn: ['z', 'a'] }, undo: { dependsOn: ['z'] } });
  assert.deepEqual(connectionUpdate(a, b, 'part', [a, b]).updates, { links: [{ targetId: 'a', type: 'child-of' }] });
  const rel = connectionUpdate(a, b, 'related', [a, b]);
  assert.equal(rel.taskId, 'a');
  assert.deepEqual(rel.updates.links, [{ targetId: 'b', type: 'related-to' }]);
  assert.equal(connectionUpdate(a, b, 'duplicate', [a, b]).updates.links[0].type, 'duplicate-of');
  // The new line reads back as the edge the user drew.
  const after = [a, { ...b, dependsOn: ['z', 'a'] }];
  assert.ok(edgesOf(after, byId(after)).some((e) => e.kind === 'depends' && key(e) === 'a>b'));
});

test('a line that cannot be drawn says why, in a sentence', () => {
  const a = T('a', { workspaceId: 'w', title: 'Alpha' });
  const b = T('b', { workspaceId: 'w', title: 'Beta', dependsOn: ['a'] });
  assert.match(connectionUpdate(a, a, 'depends').error, /itself/);
  assert.match(connectionUpdate(a, b, 'related', [a, b]).error, /already connected/);
  const c = T('c', { workspaceId: 'w', dependsOn: ['b'] });
  assert.match(connectionUpdate(c, a, 'depends', [a, b, c]).error, /loop/);
  assert.ok(!connectionUpdate(c, a, 'related', [a, b, c]).error, 'a relation orders nothing, so it cannot loop');
  assert.match(connectionUpdate(a, T('x', { workspaceId: 'v' }), 'depends').error, /different workspaces/);
});

test('removing a line removes every statement behind it, and says how to undo', () => {
  const a = T('a', { links: [{ type: 'blocks', targetId: 'b' }, { type: 'related-to', targetId: 'c' }] });
  const b = T('b', { dependsOn: ['a', 'q'] });
  const c = T('c', { links: [{ type: 'related-to', targetId: 'a' }] });
  const ids = byId([a, b, c]);
  const dep = disconnectUpdates({ from: 'a', to: 'b', kind: 'depends' }, ids);
  assert.deepEqual(dep.map((w) => w.taskId).sort(), ['a', 'b']);
  assert.deepEqual(dep.find((w) => w.taskId === 'b').updates.dependsOn, ['q']);
  assert.deepEqual(dep.find((w) => w.taskId === 'a').updates.links, [{ type: 'related-to', targetId: 'c' }]);
  const rel = disconnectUpdates({ from: 'a', to: 'c', kind: 'related' }, ids);
  assert.equal(rel.length, 2, 'said from both ends, removed from both');
  assert.deepEqual(disconnectUpdates({ from: 'a', to: 'b', kind: 'sequence' }, ids), [], 'an inferred line is not stored');
});
