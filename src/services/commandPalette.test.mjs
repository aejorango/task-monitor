// T-0055 / MISS-006 — ⌘K can create, not only search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TARGETS, buildCommands, commandsFirst, parseCreateIntent } from './commandPalette.js';

const NOW = new Date(2026, 8, 18);   // Friday
const cmds = (q) => buildCommands(q, { now: NOW });

test('an empty query offers nothing', () => {
  assert.deepEqual(cmds(''), []);
  assert.deepEqual(cmds('   '), []);
});

test('"new project X" offers exactly a project, named X', () => {
  const out = cmds('new project Website revamp');
  const create = out.filter((c) => c.kind === 'create');
  assert.equal(create.length, 1);
  assert.equal(create[0].entity, 'project');
  assert.equal(create[0].label, 'New project');
  assert.equal(create[0].payload.text, 'Website revamp');
});

test('every entity has a verb that finds it', () => {
  for (const [q, entity] of [
    ['new task Ship it', 'task'],
    ['add a project Rollout', 'project'],
    ['create meeting notes', 'minute'],
    ['new goal Digitise', 'goal'],
    ['log activity', 'activity'],
    ['log hours', 'activity'],
  ]) {
    const create = cmds(q).filter((c) => c.kind === 'create');
    assert.equal(create[0]?.entity, entity, q);
  }
});

test('a bare "new" offers all five, task first', () => {
  const create = cmds('new').filter((c) => c.kind === 'create');
  assert.deepEqual(create.map((c) => c.entity), ['task', 'project', 'minute', 'goal', 'activity']);
});

test('"new" with a name carries that name into every option', () => {
  const create = cmds('new Quarterly planning').filter((c) => c.kind === 'create');
  assert.ok(create.every((c) => c.payload.text === 'Quarterly planning'));
});

test('a new task previews what the natural-language parts will do', () => {
  const [task] = cmds('new task draft proposal next friday !urgent #client @mark');
  assert.match(task.hint, /“draft proposal”/, 'the title with the tokens stripped');
  assert.match(task.hint, /due 2026-09-25/);
  assert.match(task.hint, /high priority/);
  assert.match(task.hint, /#client/);
  assert.match(task.hint, /for mark/);
});

test('a create with no name says what will happen instead of showing empty quotes', () => {
  const [task] = cmds('new task');
  assert.equal(task.hint, 'Opens a blank one');
});

test('searching is not mistaken for creating', () => {
  for (const q of ['disbursement report', 'bank', 'what is overdue', 'newsletter']) {
    assert.equal(parseCreateIntent(q), null, q);
    assert.deepEqual(cmds(q).filter((c) => c.kind === 'create'), [], q);
  }
});

test('navigation is offered by view name and by nickname', () => {
  assert.ok(cmds('gantt').some((c) => c.payload?.view === 'gantt'));
  assert.ok(cmds('timeline').some((c) => c.payload?.view === 'gantt'));
  assert.ok(cmds('go to settings').some((c) => c.payload?.view === 'settings'));
  assert.ok(cmds('open calendar').some((c) => c.payload?.view === 'calendar'));
});

test('every navigable view is reachable and labelled', () => {
  for (const t of NAV_TARGETS) {
    assert.ok(t.label && t.view && t.words.length, t.view);
    const hit = cmds(t.label).find((c) => c.payload?.view === t.view);
    assert.ok(hit, `cannot reach ${t.view} by typing its name`);
    assert.match(hit.label, /^Go to /);
  }
});

test('nonsense offers nothing rather than a wrong guess', () => {
  assert.deepEqual(cmds('zzzqqq'), []);
});

test('the list is bounded, so the palette never becomes a wall', () => {
  assert.ok(cmds('new').length <= 8);
  assert.ok(cmds('a').length <= 8);
});

test('commands lead when the user is clearly issuing one', () => {
  assert.equal(commandsFirst('new task Ship it'), true);
  assert.equal(commandsFirst('/new project'), true);
  assert.equal(commandsFirst('> settings'), true);
  assert.equal(commandsFirst('disbursement'), false);
  assert.equal(commandsFirst(''), false);
});

test('every command is a descriptor — nothing here can perform anything', () => {
  for (const c of cmds('new')) {
    assert.equal(typeof c.id, 'string');
    assert.ok(['create', 'navigate'].includes(c.kind));
    assert.equal(typeof c.label, 'string');
    assert.equal(typeof c.run, 'undefined', 'the component owns the handlers');
  }
});

// ─── Recents (T-0062 / NEW-009) ─────────────────────────────────────────────

import { MAX_RECENTS, clearRecents, loadRecents, recentCommands, rememberRecent } from './commandPalette.js';

/** A stand-in for localStorage, so these tests touch nothing real. */
function fakeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('with nothing opened yet there are no recents', () => {
  const store = fakeStore();
  assert.deepEqual(loadRecents({ store }), []);
  assert.deepEqual(recentCommands({ store }), []);
});

test('opening something records it, most recent first', () => {
  const store = fakeStore();
  rememberRecent({ kind: 'task', id: 't1', label: 'Ship it' }, { store });
  rememberRecent({ kind: 'project', id: 'p1', label: 'Rollout' }, { store });
  assert.deepEqual(loadRecents({ store }).map((r) => r.label), ['Rollout', 'Ship it']);
});

test('opening the same thing again moves it to the front, not in twice', () => {
  const store = fakeStore();
  rememberRecent({ kind: 'task', id: 't1', label: 'Ship it' }, { store });
  rememberRecent({ kind: 'task', id: 't2', label: 'Other' }, { store });
  rememberRecent({ kind: 'task', id: 't1', label: 'Ship it' }, { store });
  assert.deepEqual(loadRecents({ store }).map((r) => r.id), ['t1', 't2']);
});

test('the list is bounded', () => {
  const store = fakeStore();
  for (let i = 0; i < 20; i += 1) rememberRecent({ kind: 'task', id: `t${i}`, label: `T${i}` }, { store });
  assert.equal(loadRecents({ store }).length, MAX_RECENTS);
});

test('an incomplete entry is ignored rather than stored half-formed', () => {
  const store = fakeStore();
  rememberRecent({ kind: 'task' }, { store });
  rememberRecent({ id: 'x', label: 'y' }, { store });
  rememberRecent(null, { store });
  assert.deepEqual(loadRecents({ store }), []);
});

test('corrupt storage yields no recents rather than an exception', () => {
  const store = fakeStore();
  store.setItem('task-monitor.palette.recents.v1', 'not json');
  assert.deepEqual(loadRecents({ store }), []);
  store.setItem('task-monitor.palette.recents.v1', '{"not":"an array"}');
  assert.deepEqual(loadRecents({ store }), []);
});

test('recents become rows the palette can render', () => {
  const store = fakeStore();
  rememberRecent({ kind: 'task', id: 't1', label: 'Ship it', projectId: 'p1' }, { store });
  const [row] = recentCommands({ store });
  assert.equal(row.kind, 'recent');
  assert.equal(row.label, 'Ship it');
  assert.equal(row.hint, 'Task');
  assert.equal(row.payload.projectId, 'p1');
  assert.ok(row.id.startsWith('recent:'));
});

test('clearing forgets them', () => {
  const store = fakeStore();
  rememberRecent({ kind: 'task', id: 't1', label: 'x' }, { store });
  clearRecents({ store });
  assert.deepEqual(loadRecents({ store }), []);
});

test('no storage at all is survivable', () => {
  assert.deepEqual(loadRecents({ store: null }), []);
  assert.doesNotThrow(() => rememberRecent({ kind: 'task', id: 'x', label: 'y' }, { store: null }));
});
