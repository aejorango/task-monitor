// T-0013 / BUG-006 — the "Shared" badge must be able to render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjectLists } from './projects.js';

const at = (ms) => ({ toMillis: () => ms });
const WS = 'ws-1';

test('a project reached only through sharing is flagged as shared', () => {
  const out = mergeProjectLists(
    [],
    [{ id: 'p1', name: 'Shared with me', workspaceId: WS }],
    WS,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]._shared, true, 'ProjectsView and AppShell render the badge off this');
});

test('a project from the workspace query is not flagged', () => {
  const out = mergeProjectLists([{ id: 'p1', workspaceId: WS }], [], WS);
  assert.equal(out[0]._shared, undefined);
});

test('a project in both lists appears once and is not flagged', () => {
  const out = mergeProjectLists(
    [{ id: 'p1', name: 'Mine', workspaceId: WS }],
    [{ id: 'p1', name: 'Mine', workspaceId: WS }],
    WS,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]._shared, undefined, 'it is in your workspace; it is not "shared with you"');
});

test('a shared project from another workspace never bleeds in', () => {
  const out = mergeProjectLists(
    [{ id: 'p1', workspaceId: WS }],
    [{ id: 'other', name: 'BSP thing', workspaceId: 'ws-2' }],
    WS,
  );
  assert.deepEqual(out.map((p) => p.id), ['p1']);
});

test('flagging never mutates the source object', () => {
  const shared = { id: 'p1', workspaceId: WS };
  mergeProjectLists([], [shared], WS);
  assert.equal(shared._shared, undefined);
});

test('the merged list is newest-first', () => {
  const out = mergeProjectLists(
    [{ id: 'old', workspaceId: WS, createdAt: at(1) }, { id: 'new', workspaceId: WS, createdAt: at(9) }],
    [{ id: 'mid', workspaceId: WS, createdAt: at(5) }],
    WS,
  );
  assert.deepEqual(out.map((p) => p.id), ['new', 'mid', 'old']);
});

test('empty inputs produce an empty list, not a crash', () => {
  assert.deepEqual(mergeProjectLists(), []);
  assert.deepEqual(mergeProjectLists([], [], null), []);
});
