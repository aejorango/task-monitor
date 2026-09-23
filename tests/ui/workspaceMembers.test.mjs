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

// T-0155 moved this onto the Access-control layout. The rule is unchanged:
// nobody is ever shown a Firebase UID unless they are a superadmin who asked.
test('a member row never shows a raw UID to a non-superadmin', () => {
  // The row is a template literal, so anchor on the map that builds it — that
  // way both the label lookup and the markup are inside the slice.
  const row = modal.slice(
    modal.indexOf('(workspace.members || []).map'),
    modal.indexOf('className="ac-foot"'),
  );
  assert.match(row, /isSuperadmin \? uid : '—'/, 'the UID must be gated behind superadmin');
  assert.match(row, /memberLabel\(/, 'and the name comes from memberLabel');
});

test('invitations that have not been taken up are listed', () => {
  assert.match(modal, /Pending invites/);
  assert.match(modal, /Joins as \{ROLE_TITLE\[inv\.role\] \|\| inv\.role\} when they next sign in/);
  assert.match(modal, /Nobody is waiting to join/, 'and an empty state that says so');
  // There is no expiry on an invitation and no email is sent; the card must
  // not borrow the mockup's "expires in 6 days".
  assert.doesNotMatch(modal, /expires in/, 'an invitation carries no expiry field');
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

test('nothing outside the superadmin escape hatch mentions an Account ID', () => {
  // The intro paragraph went in T-0155 — what each role can do is now stated
  // precisely in the Role definitions card instead of loosely in a sentence.
  // What must not come back is telling an ordinary admin to swap UIDs.
  // Only what is RENDERED counts — a code comment explaining the escape hatch
  // is not copy anybody reads on screen.
  const beforeAdvanced = modal
    .slice(0, modal.indexOf('Add by Account ID (advanced)'))
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(beforeAdvanced, /Account ID/,
    'inviting is by email; a UID is a superadmin escape hatch, not the route');
  assert.match(modal, /the invitation is\s+waiting for them when they sign in with that address/,
    'and the page still explains that inviting is by email address');
});
