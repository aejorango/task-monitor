// T-0155 — what the Members page is allowed to claim about access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, accessTiles, lastLogged, roleCounts, roleOf, scopeOf } from './accessControl.js';

const WS = {
  members: ['u1', 'u2', 'u3', 'u4'],
  acl: { u1: 'owner', u2: 'admin', u3: 'editor', u4: 'viewer' },
};

test('the roles are the four the rules enforce, in privilege order', () => {
  assert.deepEqual(ROLES.map((r) => r.id), ['owner', 'admin', 'editor', 'viewer']);
});

test('no role claims a power this app does not have', () => {
  const all = ROLES.map((r) => r.perms).join(' ').toLowerCase();
  for (const invented of ['billing', 'pipeline', 'sso', 'audit log']) {
    assert.ok(!all.includes(invented),
      `"${invented}" is the mockup's word, not this app's — somebody will rely on it`);
  }
  assert.match(ROLES.find((r) => r.id === 'owner').perms, /deleting the workspace/);
  assert.match(ROLES.find((r) => r.id === 'admin').perms, /change roles/);
  assert.match(ROLES.find((r) => r.id === 'viewer').perms, /Read-only/);
});

test('a member with no explicit role is an editor, as everywhere else', () => {
  assert.equal(roleOf({ acl: {} }, 'u9'), 'editor');
  assert.equal(roleOf(undefined, 'u9'), 'editor');
  assert.equal(roleOf(WS, 'u1'), 'owner');
});

test('the role counts add up to the membership', () => {
  const c = roleCounts(WS);
  assert.deepEqual(c, { owner: 1, admin: 1, editor: 1, viewer: 1 });
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), WS.members.length);
});

test('an empty workspace counts nothing rather than crashing', () => {
  assert.deepEqual(roleCounts({}), { owner: 0, admin: 0, editor: 0, viewer: 0 });
  const tiles = accessTiles({}, []);
  assert.equal(tiles.find((t) => t.id === 'members').value, '0');
  assert.equal(tiles.find((t) => t.id === 'members').sub, 'nobody yet');
});

test('the tiles report what the data supports, not the mockup’s wording', () => {
  const tiles = accessTiles(WS, [{ email: 'a@b.c' }]);
  assert.deepEqual(tiles.map((t) => t.id), ['members', 'pending', 'admins', 'viewers']);
  assert.equal(tiles[0].sub, '1 owner · 3 collaborators');
  assert.equal(tiles[2].value, '2', 'owner + admin are who can change access');
  // There is no expiry on an invitation, so nothing may say there is one.
  assert.ok(!tiles[1].sub.includes('expires'), 'invitations carry no expiry field');
  assert.equal(accessTiles(WS, []).find((t) => t.id === 'pending').sub, 'nobody waiting');
});

test('scope is Workspace unless a project really names that person', () => {
  const projects = [
    { id: 'p1', acl: { u3: 'editor' } },
    { id: 'p2', acl: { u3: 'viewer' } },
    { id: 'p3', acl: {} },
    { id: 'p4', deleted: true, acl: { u3: 'editor' } },
  ];
  assert.equal(scopeOf('u3', projects).label, '2 projects', 'a deleted project does not count');
  assert.equal(scopeOf('u1', projects).label, 'Workspace');
  assert.equal(scopeOf('u1', []).label, 'Workspace');
  assert.equal(scopeOf('u3', [{ id: 'p1', acl: { u3: 'editor' } }]).label, '1 project');
});

/* ── last logged ────────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-09-22T12:00:00');
const at = (iso) => ({ userId: 'u1', loggedAt: Date.parse(iso) });

test('a relative time, from the newest entry of theirs', () => {
  assert.equal(lastLogged('u1', [at('2026-09-22T11:59:00')], NOW), 'now');
  assert.equal(lastLogged('u1', [at('2026-09-22T11:30:00')], NOW), '30m');
  assert.equal(lastLogged('u1', [at('2026-09-22T09:00:00')], NOW), '3h');
  assert.equal(lastLogged('u1', [at('2026-09-19T12:00:00')], NOW), '3d');
});

test('the NEWEST wins, whatever order they arrive in', () => {
  assert.equal(
    lastLogged('u1', [at('2026-09-19T12:00:00'), at('2026-09-22T11:30:00')], NOW),
    '30m',
  );
});

test('somebody else’s activity is not theirs', () => {
  assert.equal(lastLogged('u2', [at('2026-09-22T11:30:00')], NOW), null);
});

test('nothing found is null — NOT "never", because the list is only a page', () => {
  assert.equal(lastLogged('u1', [], NOW), null,
    'the workspace listener holds one page; absent here does not mean absent ever');
});

test('a date-only entry still places them, and junk is skipped', () => {
  assert.equal(lastLogged('u1', [{ userId: 'u1', date: '2026-09-20' }], NOW), '2d');
  assert.equal(lastLogged('u1', [{ userId: 'u1', loggedAt: 'nonsense' }], NOW), null);
  assert.equal(lastLogged('u1', [{ userId: 'u1' }], NOW), null);
});

test('a Firestore Timestamp is understood too', () => {
  const ts = { toMillis: () => Date.parse('2026-09-22T10:00:00') };
  assert.equal(lastLogged('u1', [{ userId: 'u1', loggedAt: ts }], NOW), '2h');
});
