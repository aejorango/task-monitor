// T-0040 / MISS-001 — invite people by email, not by Firebase UID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inviteFields, inviteFor, memberLabel, memberSubLabel, normalizeEmail,
  revokeInviteFields, validateInvite, WORKSPACE_ROLES,
} from './invites.js';

const WS = {
  members: ['u1', 'u2'],
  memberProfiles: {
    u1: { displayName: 'Ace', email: 'ace@example.com' },
    u2: { email: 'sam@example.com' },
  },
  pendingInvites: [{ email: 'pending@example.com', role: 'editor' }],
  pendingInviteEmails: ['pending@example.com'],
  pendingInviteRoles: { 'pending@example.com': 'editor' },
};

test('emails are compared without case or spacing mattering', () => {
  assert.equal(normalizeEmail('  Ace@Example.COM '), 'ace@example.com');
  assert.equal(normalizeEmail(null), '');
});

test('a good invitation validates', () => {
  const r = validateInvite('New.Person@Example.com', 'editor', WS);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'new.person@example.com', 'stored normalized so the claim matches');
});

test('an empty or malformed address is refused in plain words', () => {
  assert.match(validateInvite('', 'editor', WS).error, /Enter the email address/);
  assert.match(validateInvite('   ', 'editor', WS).error, /Enter the email address/);
  for (const bad of ['notanemail', 'a@b', 'a@b.c', '@example.com', 'a b@example.com']) {
    const r = validateInvite(bad, 'editor', WS);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /does not look like an email address/);
    assert.doesNotMatch(r.error, /regex|invalid|undefined/i);
  }
});

test('an existing member is not invited twice', () => {
  assert.match(validateInvite('ACE@example.com', 'editor', WS).error, /already a member/);
  assert.match(validateInvite('sam@example.com', 'viewer', WS).error, /already a member/);
});

test('a duplicate invitation says when they will join', () => {
  const r = validateInvite('Pending@Example.com', 'editor', WS);
  assert.equal(r.ok, false);
  assert.match(r.error, /already been invited/);
  assert.match(r.error, /next sign in/);
});

test('a bad role is refused', () => {
  assert.match(validateInvite('x@example.com', 'owner', WS).error, /Pick a role/);
  assert.match(validateInvite('x@example.com', '', WS).error, /Pick a role/);
  for (const role of WORKSPACE_ROLES) {
    assert.equal(validateInvite('x@example.com', role, WS).ok, true, role);
  }
});

test('writing an invitation keeps both fields in step', () => {
  const f = inviteFields(WS, ' New@Example.com ', 'admin', 'u1');
  assert.equal(f.pendingInvites.length, 2);
  assert.equal(f.pendingInvites[1].email, 'new@example.com');
  assert.equal(f.pendingInvites[1].role, 'admin');
  assert.equal(f.pendingInvites[1].invitedBy, 'u1');
  assert.deepEqual(f.pendingInviteEmails, ['pending@example.com', 'new@example.com']);
  assert.deepEqual(f.pendingInviteRoles, {
    'pending@example.com': 'editor', 'new@example.com': 'admin',
  }, 'the rule reads the role from here — an array of maps cannot be checked');
});

test('the queryable email list never gains a duplicate', () => {
  const f = inviteFields(WS, 'PENDING@example.com', 'viewer', 'u1');
  assert.deepEqual(f.pendingInviteEmails, ['pending@example.com']);
});

test('withdrawing an invitation clears both fields', () => {
  const f = revokeInviteFields(WS, 'Pending@Example.com');
  assert.deepEqual(f.pendingInvites, []);
  assert.deepEqual(f.pendingInviteEmails, []);
  assert.deepEqual(f.pendingInviteRoles, {});
});

test('withdrawing something that is not there changes nothing', () => {
  const f = revokeInviteFields(WS, 'nobody@example.com');
  assert.equal(f.pendingInvites.length, 1);
});

test('a signing-in user finds the invitation meant for them', () => {
  assert.deepEqual(inviteFor(WS, 'PENDING@example.com'), { email: 'pending@example.com', role: 'editor' });
  assert.equal(inviteFor(WS, 'someone.else@example.com'), null);
  assert.equal(inviteFor(WS, ''), null);
  assert.equal(inviteFor(null, 'pending@example.com'), null);
});

test('a malformed role on an invitation grants the least, not the most', () => {
  const ws = { pendingInvites: [{ email: 'x@example.com', role: 'owner' }] };
  assert.equal(inviteFor(ws, 'x@example.com').role, 'viewer');
  const missing = { pendingInvites: [{ email: 'x@example.com' }] };
  assert.equal(inviteFor(missing, 'x@example.com').role, 'viewer');
});

test('members are labelled by name, then email — never by a raw UID', () => {
  assert.equal(memberLabel('u1', WS.memberProfiles), 'Ace');
  assert.equal(memberLabel('u2', WS.memberProfiles), 'sam@example.com');
  const unknown = memberLabel('kJ3n2X9aBcDeFgHiJkLmNoPq', WS.memberProfiles);
  assert.equal(unknown, 'Invited member');
  assert.doesNotMatch(unknown, /kJ3n2X9/, 'a UID means nothing to anyone');
});

test('you are labelled "You" when nothing else is known', () => {
  assert.equal(memberLabel('me', {}, { selfUid: 'me' }), 'You');
});

test('the second line shows the email only when the name is already shown', () => {
  assert.equal(memberSubLabel('u1', WS.memberProfiles), 'ace@example.com');
  assert.equal(memberSubLabel('u2', WS.memberProfiles), '', 'the email is already the label');
  assert.equal(memberSubLabel('nobody', WS.memberProfiles), '');
});
