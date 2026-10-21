// Board → Node: what an edge is, where a node goes, and how a label wraps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapLabel, edgesOf, buildGraph, rankNodes, layoutGraph, neighbourhood, groupsOf,
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

test('a loop in the data does not hang the page — it is drawn and flagged', () => {
  const tasks = [T('a', { dependsOn: ['b'] }), T('b', { dependsOn: ['a'] }), T('c', { dependsOn: ['b'] })];
  const g = buildGraph(tasks, tasks);
  const layout = layoutGraph(g);
  assert.equal(layout.nodes.length, 3);
  assert.equal(layout.edges.filter((e) => e.loop).length, 1, 'exactly the edge that closes the loop');
  assert.ok(layout.edges.every((e) => typeof e.d === 'string' && e.d.startsWith('M ')));
});

test('the layout: fixed-width nodes, no overlaps, separate groups stacked, the unconnected as a grid', () => {
  const tasks = [
    T('a', { title: 'A very long task title that will certainly need to wrap onto several lines here' }),
    T('b', { dependsOn: ['a'] }), T('c', { dependsOn: ['a'] }),
    T('x'), T('y', { dependsOn: ['x'] }),
    T('lone1'), T('lone2'),
  ];
  const layout = layoutGraph(buildGraph(tasks, tasks, { includeUnlinked: true }));
  assert.ok(layout.nodes.every((n) => n.w === NODE_W));
  const boxes = layout.nodes;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const p = boxes[i]; const q = boxes[j];
      const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      assert.ok(!overlap, `${p.id} overlaps ${q.id}`);
    }
  }
  assert.equal(layout.groups, 2, 'a–b–c and x–y are two groups');
  assert.ok(layout.looseTop != null, 'the unconnected get their own heading');
  const lone = layout.nodes.filter((n) => n.id.startsWith('lone'));
  assert.ok(lone.every((n) => n.y > layout.looseTop), 'and sit under it');
  const a = layout.nodes.find((n) => n.id === 'a');
  assert.equal(a.lines.length, 3);
  assert.ok(layout.width > 0 && layout.height > a.y + a.h);
});

test('a hover lights a node and everything one step from it', () => {
  const tasks = [T('a'), T('b', { dependsOn: ['a'] }), T('c', { dependsOn: ['b'] })];
  const g = buildGraph(tasks, tasks);
  const { ids } = neighbourhood('b', g.edges);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...neighbourhood('a', g.edges).ids].sort(), ['a', 'b']);
  assert.equal(groupsOf(g.nodes, g.edges).length, 1);
});

test('a line between two tasks in one column is not clipped at the canvas edge', () => {
  const tasks = [T('p'), T('a', { links: [{ type: 'child-of', targetId: 'p' }] }),
    T('b', { links: [{ type: 'child-of', targetId: 'p' }, { type: 'duplicate-of', targetId: 'a' }] })];
  const layout = layoutGraph(buildGraph(tasks, tasks));
  const a = layout.nodes.find((n) => n.id === 'a');
  const b = layout.nodes.find((n) => n.id === 'b');
  assert.equal(a.x, b.x, 'both children sit in one column');
  assert.ok(layout.width >= a.x + a.w + 46, 'room for the bow to the right');
});
