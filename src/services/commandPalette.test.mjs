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
