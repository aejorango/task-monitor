import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAdministerProject, canEditProject, friendlyError,
  isWorkspaceAdmin, projectRole, workspaceRole,
  deniedDespiteRole, isPermissionDenied,
} from './access.js';

const WS = { id: 'ws', acl: { owner: 'owner', adm: 'admin', ed: 'editor', vw: 'viewer' } };
const PROJ = { id: 'p', userId: 'creator', workspaceId: 'ws', acl: { padm: 'admin', ped: 'editor', pvw: 'viewer' } };

test('workspaceRole / projectRole read the acl map', () => {
  assert.equal(workspaceRole(WS, 'adm'), 'admin');
  assert.equal(workspaceRole(WS, 'nobody'), null);
  assert.equal(workspaceRole(null, 'adm'), null);
  assert.equal(projectRole(PROJ, 'ped'), 'editor');
  assert.equal(projectRole(PROJ, undefined), null);
});

test('isWorkspaceAdmin covers owner and admin only', () => {
  assert.equal(isWorkspaceAdmin(WS, 'owner'), true);
  assert.equal(isWorkspaceAdmin(WS, 'adm'), true);
  assert.equal(isWorkspaceAdmin(WS, 'ed'), false);
  assert.equal(isWorkspaceAdmin(WS, 'vw'), false);
});

test('canAdministerProject matches the rule: project admin, creator, workspace admin', () => {
  assert.equal(canAdministerProject(PROJ, WS, 'padm'), true,   'project admin');
  assert.equal(canAdministerProject(PROJ, WS, 'creator'), true, 'project creator');
  assert.equal(canAdministerProject(PROJ, WS, 'owner'), true,  'workspace owner');
  assert.equal(canAdministerProject(PROJ, WS, 'adm'), true,    'workspace admin');
  assert.equal(canAdministerProject(PROJ, WS, 'ped'), false,   'project editor may not share');
  assert.equal(canAdministerProject(PROJ, WS, 'pvw'), false,   'project viewer may not share');
  assert.equal(canAdministerProject(PROJ, WS, 'ed'), false,    'workspace editor may not share');
  assert.equal(canAdministerProject(PROJ, null, 'ped'), false, 'no workspace loaded yet');
  assert.equal(canAdministerProject(null, WS, 'owner'), false, 'no project');
  assert.equal(canAdministerProject(PROJ, WS, null), false,    'signed out');
});

test('canEditProject adds project editors', () => {
  assert.equal(canEditProject(PROJ, WS, 'ped'), true);
  assert.equal(canEditProject(PROJ, WS, 'pvw'), false);
  assert.equal(canEditProject(PROJ, WS, 'padm'), true);
});

test('friendlyError turns Firestore codes into plain sentences', () => {
  const denied = friendlyError({ code: 'permission-denied', message: 'FirebaseError: Missing or insufficient permissions.' });
  assert.match(denied, /do not have permission/);
  assert.doesNotMatch(denied, /Firebase|permission-denied/);

  assert.match(friendlyError(new Error('FirebaseError: Missing or insufficient permissions.')), /do not have permission/);
  assert.match(friendlyError({ code: 'unavailable' }), /connection/);
});

test('friendlyError keeps a sentence we wrote ourselves', () => {
  assert.equal(
    friendlyError(new Error('Invite has been revoked.')),
    'Invite has been revoked.',
  );
});

test('friendlyError never leaks an SDK dump', () => {
  const msg = friendlyError(new Error('7 PERMISSION_DENIED: evaluation error at L340'));
  assert.match(msg, /do not have permission/);
  assert.equal(friendlyError(null), 'Something went wrong. Please try again.');
  assert.equal(friendlyError({}, 'Could not save.'), 'Could not save.');
});

// ─── T-0159 / BUG-034: "ask an admin" is wrong advice for an admin ─────────

test('a denial the UI did not expect does not tell the admin to ask an admin', () => {
  const err = { code: 'permission-denied' };
  const { message, operatorHint } = deniedDespiteRole(err, { believedAllowed: true });
  assert.ok(!/ask a project or workspace admin/i.test(message),
    'the page already established that they ARE the admin');
  assert.match(message, /reload/i, 'and it has to say what to actually do');
  assert.ok(operatorHint, 'the operator gets the real cause');
  assert.match(operatorHint, /deploy:rules/);
});

test('a denial the UI DID expect keeps the normal sentence', () => {
  const err = { code: 'permission-denied' };
  const { message, operatorHint } = deniedDespiteRole(err, { believedAllowed: false });
  assert.equal(message, friendlyError(err), 'a viewer really should ask an admin');
  assert.equal(operatorHint, null);
});

test('a non-permission error is untouched whatever the role', () => {
  const err = { code: 'unavailable' };
  for (const believedAllowed of [true, false]) {
    const { message, operatorHint } = deniedDespiteRole(err, { believedAllowed });
    assert.equal(message, friendlyError(err));
    assert.equal(operatorHint, null);
  }
});

test('the operator hint never reaches the screen', () => {
  const { message } = deniedDespiteRole({ code: 'permission-denied' }, { believedAllowed: true });
  for (const leak of ['firestore.rules', 'npm run', 'acl[uid]', 'console']) {
    assert.ok(!message.includes(leak), `"${leak}" is operator copy, not user copy`);
  }
});

test('permission-denied is recognised however Firestore spelled it', () => {
  assert.equal(isPermissionDenied({ code: 'permission-denied' }), true);
  assert.equal(isPermissionDenied(new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.')), true);
  assert.equal(isPermissionDenied('Missing permissions'), false);
  assert.equal(isPermissionDenied({ code: 'not-found' }), false);
  assert.equal(isPermissionDenied(null), false);
});
