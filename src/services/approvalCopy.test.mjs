// T-0029 / POL-004 — the app must not describe a version of itself that no
// longer exists: no anonymous sessions, and no approval email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalCopy, sessionLine, SETTINGS_SUBTITLE } from './approvalCopy.js';

const ALL = [
  approvalCopy(null),
  approvalCopy({ status: 'pending' }),
  approvalCopy({ status: 'rejected' }),
];

test('no screen promises an email that is never sent', () => {
  for (const copy of ALL) {
    const shown = `${copy.title} ${copy.message} ${copy.waitNote || ''}`;
    assert.doesNotMatch(shown, /notify you by email|we'?ll email|email you once|by email when/i,
      `promised an email: ${shown}`);
  }
});

test('a pending user is told the truth: no email, but the page is live', () => {
  const copy = approvalCopy({ status: 'pending' });
  assert.equal(copy.state, 'pending');
  assert.match(copy.waitNote, /No email is sent/);
  assert.match(copy.waitNote, /the moment someone approves/);
});

test('a rejected user is not told to wait for something that will not happen', () => {
  const copy = approvalCopy({ status: 'rejected' });
  assert.equal(copy.state, 'rejected');
  assert.equal(copy.waitNote, null);
  assert.equal(copy.canRetry, false);
  // It must not point at something that is not on the card. The superadmin
  // list it used to say "below" about was removed from PendingApprovalView.
  assert.match(copy.message, /ask an administrator to look again/);
  assert.doesNotMatch(copy.message, /below/);
});

test('a profile that has not arrived yet is "setting up", not "rejected"', () => {
  const copy = approvalCopy(null);
  assert.equal(copy.state, 'setting-up');
  assert.doesNotMatch(copy.message, /declined|denied|reject/i);
});

test('an approved profile still yields pending copy — the screen is not shown to them', () => {
  // Defensive: if this screen is ever rendered for an approved user, it must
  // not claim they were rejected.
  assert.equal(approvalCopy({ status: 'approved' }).state, 'pending');
});

test('the session line names the person, never an "anonymous session"', () => {
  assert.equal(
    sessionLine({ displayName: 'Ace', email: 'ace@example.com' }, null),
    'Signed in as Ace (ace@example.com).',
  );
  assert.equal(sessionLine({ email: 'ace@example.com' }, null), 'Signed in as ace@example.com.');
  assert.equal(sessionLine({ displayName: 'Ace' }, null), 'Signed in as Ace.');
});

test('the session line falls back to the auth user, then to nothing', () => {
  assert.equal(sessionLine(null, { email: 'a@b.c' }), 'Signed in as a@b.c.');
  assert.equal(sessionLine(null, null), 'Signed in.');
});

test('the session line never shows a raw uid', () => {
  const line = sessionLine({ email: 'ace@example.com' }, { uid: 'kJ3n2X9aBcDeFgHi' });
  assert.doesNotMatch(line, /kJ3n2X9aBcDeFgHi/);
  assert.doesNotMatch(line, /anonymous/i);
});

test('the Settings subtitle describes what the page actually holds', () => {
  assert.doesNotMatch(SETTINGS_SUBTITLE, /^Per-device preferences\.$/);
  assert.match(SETTINGS_SUBTITLE, /workspaces/);
  assert.doesNotMatch(SETTINGS_SUBTITLE, /local storage/i, 'that is an implementation detail');
});
