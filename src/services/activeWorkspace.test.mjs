import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextActiveWorkspaceId, isResolvingWorkspace } from './activeWorkspace.js';

const WS = [{ id: 'w1', name: 'BRIDGED' }, { id: 'w2', name: 'Personal' }];

test('a member of the active workspace keeps it', () => {
  assert.equal(nextActiveWorkspaceId(WS, 'w2'), 'w2');
  assert.equal(nextActiveWorkspaceId(WS, 'w1'), 'w1');
});

test('nothing chosen yet falls to the first workspace', () => {
  assert.equal(nextActiveWorkspaceId(WS, null), 'w1');
  assert.equal(nextActiveWorkspaceId(WS, undefined), 'w1');
});

test('removed from the active workspace falls to the first one', () => {
  assert.equal(nextActiveWorkspaceId(WS, 'gone'), 'w1');
});

// ── the regression this module exists for ─────────────────────────────────
test('an EMPTY snapshot never clears the active workspace', () => {
  assert.equal(nextActiveWorkspaceId([], 'w1'), 'w1',
    'an empty snapshot is also what a failed listener looks like — clearing on it '
    + 'wipes the Activity log and Work performed pages and persists the damage to localStorage');
  assert.equal(nextActiveWorkspaceId(null, 'w1'), 'w1');
  assert.equal(nextActiveWorkspaceId(undefined, 'w1'), 'w1');
});

test('an empty snapshot with nothing active stays null', () => {
  assert.equal(nextActiveWorkspaceId([], null), null,
    'before the migration creates the default workspace there is genuinely nothing');
});

test('rows without an id do not count as a workspace', () => {
  assert.equal(nextActiveWorkspaceId([{ name: 'broken' }], 'w1'), 'w1');
  assert.equal(nextActiveWorkspaceId([{}, { id: 'w9' }], null), 'w9');
});

test('the common path does not churn the id', () => {
  // Every workspace-scoped listener tears down and rebuilds when this changes,
  // so returning a new-but-equal value on every snapshot would be its own bug.
  let id = 'w1';
  for (let i = 0; i < 50; i += 1) id = nextActiveWorkspaceId(WS, id);
  assert.equal(id, 'w1');
});

// ── waiting is not emptiness ──────────────────────────────────────────────
test('signed in with no workspace yet is RESOLVING, not empty', () => {
  assert.equal(isResolvingWorkspace({ ready: true, userId: 'u1', workspaceId: null }), true);
});

test('signed out is not resolving — it is simply nothing', () => {
  assert.equal(isResolvingWorkspace({ ready: true, userId: null, workspaceId: null }), false);
  assert.equal(isResolvingWorkspace({ ready: false, userId: null, workspaceId: null }), false);
});

test('a resolved workspace is not resolving', () => {
  assert.equal(isResolvingWorkspace({ ready: true, userId: 'u1', workspaceId: 'w1' }), false);
});
