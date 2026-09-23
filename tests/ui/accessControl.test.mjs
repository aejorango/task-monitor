// T-0155 — Settings → Members, rebuilt to the Dashboard Explorer's
// Access-control card.
//
// The two mockups disagree about where this belongs: Dashboard Explorer draws
// it as "Access control", Settings Explorer as "Members". It stayed in
// Settings — one surface, at the address the team already knows — and only the
// look changed.
//
// This page states what people are ALLOWED to do. A permissions table that
// lists a power nobody has is worse than no table, because somebody will rely
// on it; most of what follows guards that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'App.css');
const settings = read('src', 'components', 'SettingsView.jsx');

/* ── the mockup's metrics ───────────────────────────────────────────────── */

test('the tiles are the mockup’s tiles', () => {
  assert.match(css, /\.ac-tiles \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); gap: 12px/);
  assert.match(css, /\.ac-tile \{[\s\S]*?border-radius: 14px/);
  assert.match(css, /\.ac-tile \{[\s\S]*?padding: 14px 16px/);
  assert.match(css, /\.ac-tile \{[\s\S]*?border-top: 3px solid/);
  assert.match(css, /\.ac-tile-value \{[\s\S]*?font-size: 24px[\s\S]*?line-height: 1;/);
  assert.match(css, /\.ac-tile-label \{[\s\S]*?font-size: 10px[\s\S]*?letter-spacing: \.05em/);
});

test('the split and the table keep the mockup’s tracks', () => {
  assert.match(css, /\.ac-split \{ display: grid; grid-template-columns: 1\.5fr 1fr; gap: 16px/);
  assert.match(css, /\.ac-thead, \.ac-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 128px 108px 92px 28px/);
  assert.match(css, /\.ac-thead \{[\s\S]*?padding: 9px 18px/);
  assert.match(css, /\.ac-row \{[\s\S]*?padding: 11px 18px/);
  assert.match(css, /\.ac-name \{[\s\S]*?font-size: 12\.5px/);
  assert.match(css, /\.ac-email \{[\s\S]*?font-size: 10\.5px/);
  assert.match(css, /\.ac-role \{[\s\S]*?font-size: 10\.5px[\s\S]*?padding: 4px 10px/);
  assert.match(css, /\.ac-roledef \{[\s\S]*?padding: 11px 13px/);
});

test('the fifth column is reserved so rows line up for everybody', () => {
  // The remove button only renders for an admin; without a reserved track the
  // columns would shift depending on who is looking.
  assert.match(css, /the remove button; it is reserved even for a non-admin/);
});

test('one role, one colour, wherever it is printed', () => {
  for (const r of ['owner', 'admin', 'editor', 'viewer']) {
    assert.match(css, new RegExp(`\\.ac-role\\.role-${r}\\s+\\{ background:`), r);
  }
  // the table chip and the definitions badge are the same class
  assert.match(settings, /className=\{`ac-role role-\$\{role\}`\}/);
  assert.match(settings, /className=\{`ac-role role-\$\{r\.id\}`\}/);
});

/* ── honesty ────────────────────────────────────────────────────────────── */

test('the role definitions describe THIS app, not the mockup', async () => {
  // Check the DATA, not the source — the comments name the mockup's promises
  // precisely in order to explain why they are absent.
  const { ROLES } = await import('../../src/services/accessControl.js');
  const perms = ROLES.map((r) => r.perms).join(' ').toLowerCase();
  for (const invented of ['billing', 'pipeline', 'full control', 'sso']) {
    assert.ok(!perms.includes(invented),
      `"${invented}" is the mockup's promise — this app has no such power`);
  }
  assert.match(read('src', 'services', 'accessControl.js'), /firestore\.rules/,
    'the descriptions must cite where they came from');
});

test('no tile claims a number the data cannot support', async () => {
  const { accessTiles } = await import('../../src/services/accessControl.js');
  const labels = accessTiles({ members: ['u1'], acl: { u1: 'owner' } }, []).map((t) => t.label);
  // The mockup's Guests and Role-changes tiles have no data behind them here.
  assert.ok(!labels.includes('Guests'), 'there is no guest access in this app');
  assert.ok(!labels.includes('Role changes'), 'there is no audit trail of role changes');
  assert.deepEqual(labels, ['Members', 'Pending', 'Can change access', 'Read-only']);
  assert.match(read('src', 'services', 'accessControl.js'), /guest access and keeps no audit trail/,
    'and the substitution has to be explained where the next reader will find it');
});

test('an invitation never claims an expiry, because it has none', () => {
  assert.doesNotMatch(settings, /expires in/);
  assert.match(read('src', 'services', 'accessControl.js'),
    /No expiry field exists on an invitation/);
});

test('"last logged" says a dash means unknown, not never', () => {
  assert.match(settings, /not that they have\s+never been here/);
  assert.match(settings, /Nothing of theirs in the entries loaded — not necessarily never/);
});

test('scope is real: it counts projects that actually name the person', () => {
  assert.match(settings, /scopeOf\(uid, projects\)/);
  assert.match(read('src', 'services', 'accessControl.js'), /p\.acl && p\.acl\[uid\]/);
});

/* ── the functionality survived the restyle ─────────────────────────────── */

test('every control the old list had still works', () => {
  const members = settings.slice(settings.indexOf('export function WorkspaceMembers'));
  assert.match(members, /changeRole\(uid, e\.target\.value\)/, 'change a role');
  assert.match(members, /onClick=\{\(\) => remove\(uid\)\}/,   'remove a member');
  assert.match(members, /onClick=\{\(\) => withdraw\(inv\.email\)\}/, 'withdraw an invitation');
  assert.match(members, /Invite someone by email/,            'invite by email');
  assert.match(members, /Add by Account ID \(advanced\)/,      'the superadmin escape hatch');
});

test('an owner cannot be demoted or removed from the table', () => {
  const members = settings.slice(settings.indexOf('export function WorkspaceMembers'));
  assert.match(members, /isAdmin && role !== 'owner' \? \(/, 'the role select skips the owner');
  assert.match(members, /\{isAdmin && role !== 'owner' && \(/, 'and so does remove');
});

test('the "+ Invite member" button reaches the form it promises', () => {
  assert.match(settings, /document\.getElementById\('ac-invite-email'\)\?\.focus\(\)/);
  assert.match(settings, /id="ac-invite-email"/,
    'a button that scrolls nowhere is worse than no button');
});

test('the page degrades honestly when it is given nothing', () => {
  // The Workspaces modal renders the same component without projects or
  // activities; the table must say "Workspace" and a dash, not guess.
  assert.match(settings, /projects = \[\], activities = \[\],/);
  assert.match(settings, /degrades to "Workspace" and a\n \* dash/);
});

/* ── the old design is gone ─────────────────────────────────────────────── */

test('the old member list and its stylesheet are gone', () => {
  assert.doesNotMatch(css, /^\.ws-members-list/m);
  assert.doesNotMatch(css, /^\.ws-member-row/m);
  const dir = path.join(root, 'src', 'components');
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))
    .filter((f) => /className="ws-member/.test(read('src', 'components', f)));
  assert.deepEqual(offenders, []);
});

test('the harness twin was rebuilt with it', () => {
  const shell = read('dev', 'shell.jsx');
  assert.match(shell, /MembersSample/);
  assert.match(shell, /ac-roledef/);
  assert.doesNotMatch(shell, /ws-member-row/);
});
