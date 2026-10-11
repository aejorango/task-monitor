// "All workspaces" — a view over every workspace, beside a REAL active one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeWorkspaceIds, mergedMemberProfiles, viewWorkspace } from './activeWorkspace.js';
import { mergeProjectLists } from './projects.js';

const WS = [
  { id: 'a', name: 'BRIDGED', members: ['u1', 'u2'], memberProfiles: { u1: { displayName: 'Ace' }, u2: { displayName: 'Mia' } }, acl: { u1: 'owner' } },
  { id: 'b', name: 'Personal', members: ['u1', 'u3'], memberProfiles: { u3: { displayName: 'Raf' } } },
  { id: 'c', name: 'Old', archived: true, members: ['u9'] },
];

test('the workspaces read: the active one, or every live one with the active first', () => {
  assert.deepEqual(scopeWorkspaceIds({ all: false, activeId: 'b', workspaces: WS }), ['b']);
  assert.deepEqual(scopeWorkspaceIds({ all: true, activeId: 'b', workspaces: WS }), ['b', 'a'], 'archived is left out');
  assert.deepEqual(scopeWorkspaceIds({ all: false, activeId: null, workspaces: WS }), []);
});

test('names come from every workspace, so a card from another one is still named', () => {
  const p = mergedMemberProfiles(WS);
  assert.deepEqual(Object.keys(p).sort(), ['u1', 'u2', 'u3']);
  assert.equal(p.u3.displayName, 'Raf');
});

test('the combined workspace keeps the ACTIVE id — that is where new things go', () => {
  assert.equal(viewWorkspace({ all: false, activeId: 'a', workspaces: WS }), WS[0]);
  const v = viewWorkspace({ all: true, activeId: 'a', workspaces: WS });
  assert.equal(v.id, 'a');
  assert.equal(v.name, 'All workspaces');
  assert.equal(v.all, true);
  assert.equal(v.home, WS[0]);
  assert.deepEqual(v.members.sort(), ['u1', 'u2', 'u3']);
  assert.equal(v.acl.u1, 'owner', 'your role is still the active workspace’s');
});

test('a shared project shows when its workspace is in view, and only then', () => {
  const shared = [{ id: 'p1', workspaceId: 'b' }, { id: 'p2', workspaceId: 'z' }];
  assert.deepEqual(mergeProjectLists([], shared, 'a').map((p) => p.id), []);
  assert.deepEqual(mergeProjectLists([], shared, 'b').map((p) => p.id), ['p1'], 'a single id still works');
  assert.deepEqual(mergeProjectLists([], shared, ['a', 'b']).map((p) => p.id), ['p1']);
});
