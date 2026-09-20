// T-0041 / MISS-001 — the members screen speaks in names and emails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'SettingsView.jsx'), 'utf8',
);
const modal = src.slice(
  src.indexOf('function WorkspaceMembersModal'),
  src.indexOf('// ─── User Management'),
);

test('the primary way to add somebody is their email address', () => {
  assert.match(modal, /Invite someone by email/);
  assert.match(modal, /type="email"/);
  assert.match(modal, /name@company\.com/, 'a placeholder anyone understands');
});

test('the Account ID box is behind an Advanced toggle, for superadmins only', () => {
  const advanced = modal.slice(modal.indexOf('Add by Account ID (advanced)') - 400);
  assert.match(modal, /isSuperadmin && \(\s*<details/,
    'a UID entry box must not be the first thing a workspace owner sees');
  assert.match(advanced, /<summary/);
});

test('a member row never shows a raw UID to a non-superadmin', () => {
  const row = modal.slice(modal.indexOf('ws-members-list'), modal.indexOf('Invited — waiting'));
  assert.match(row, /\{isSuperadmin && \(/, 'the UID line must be gated');
  assert.match(row, /memberLabel\(/, 'and the name comes from memberLabel');
});

test('invitations that have not been taken up are listed', () => {
  assert.match(modal, /Invited — waiting for them to sign in/);
  assert.match(modal, /Joins as \{inv\.role\} when they next open the app/);
});

test('an admin can withdraw an invitation', () => {
  assert.match(modal, /const withdraw = async \(email\)/);
  assert.match(modal, /revokeWorkspaceInvite\(workspace, email\)/);
  assert.match(modal, /onClick=\{\(\) => withdraw\(inv\.email\)\}/);
});

test('the invitation is validated before it is written', () => {
  assert.match(modal, /validateInvite\(newEmail, newRole, workspace\)/);
  assert.match(modal, /if \(!check\.ok\) \{ setInviteError\(check\.error\); return; \}/);
});

test('the screen is honest that no email is sent', () => {
  assert.match(modal, /No email is\s*\n?\s*sent/,
    'there is no backend to send one — say so rather than let them wait');
});

test('the invite form takes Enter, not only a click', () => {
  assert.match(modal, /if \(e\.key === 'Enter'\) invite\(\)/);
});

test('errors are shown in the form, not in an alert box', () => {
  const inviteFn = modal.slice(modal.indexOf('const invite = async'), modal.indexOf('const withdraw'));
  assert.doesNotMatch(inviteFn, /alert\(/);
  assert.match(inviteFn, /friendlyError/);
});

test('the modal copy no longer tells people to swap Account IDs', () => {
  const sub = modal.slice(modal.indexOf('<p className="modal-sub">'), modal.indexOf('<div className="ws-members-list">'));
  assert.doesNotMatch(sub, /Account ID/);
  assert.match(sub, /email\s+address/);
});
