// src/services/invites.js — inviting somebody by email, as pure functions.
//
// Until now a workspace admin had to paste a raw Firebase UID, which nobody
// outside this repo can find, and the member list showed those UIDs back.
//
// The approach here needs no backend: an admin records an invitation on the
// workspace, and the invited person joins themselves the next time they open
// the app. Two fields do it:
//
//   pendingInvites:      [{ email, role, invitedBy, invitedAt }]   — the record
//   pendingInviteEmails: ['someone@example.com', …]                — queryable
//   pendingInviteRoles:  { 'someone@example.com': 'editor' }        — checkable
//
// The last two exist because of what security rules can and cannot do with an
// array of maps: `array-contains` matches whole elements, so you cannot ask "is
// there an object in here whose email is X", and you certainly cannot read that
// object's role back out. The flat list answers "were they invited"; the map
// answers "at what role" — and without the map, a claimer could hand themselves
// `owner` on the way in.

export const WORKSPACE_ROLES = ['admin', 'editor', 'viewer'];

/** Emails are compared case-insensitively and without surrounding space. */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Check one invitation before it is written.
 * @returns {{ ok: true, email, role } | { ok: false, error }}
 */
export function validateInvite(email, role, { members = [], memberProfiles = {}, pendingInvites = [] } = {}) {
  const normalized = normalizeEmail(email);

  if (!normalized) return { ok: false, error: 'Enter the email address of the person you want to add.' };
  if (!EMAIL_RE.test(normalized)) {
    return { ok: false, error: `“${email.trim()}” does not look like an email address.` };
  }
  if (!WORKSPACE_ROLES.includes(role)) {
    return { ok: false, error: 'Pick a role for this person.' };
  }

  const alreadyMember = members.some(
    (uid) => normalizeEmail(memberProfiles[uid]?.email) === normalized,
  );
  if (alreadyMember) {
    return { ok: false, error: 'That person is already a member of this workspace.' };
  }
  if (pendingInvites.some((i) => normalizeEmail(i.email) === normalized)) {
    return { ok: false, error: 'That person has already been invited. They join when they next sign in.' };
  }

  return { ok: true, email: normalized, role };
}

/** The two fields to write when adding an invitation. */
export function inviteFields(workspace, email, role, invitedBy) {
  const normalized = normalizeEmail(email);
  const existing = workspace?.pendingInvites || [];
  return {
    pendingInvites: [
      ...existing,
      { email: normalized, role, invitedBy: invitedBy || null, invitedAt: new Date().toISOString() },
    ],
    pendingInviteEmails: [
      ...new Set([...(workspace?.pendingInviteEmails || []), normalized]),
    ],
    pendingInviteRoles: { ...(workspace?.pendingInviteRoles || {}), [normalized]: role },
  };
}

/** The two fields to write when withdrawing one. */
export function revokeInviteFields(workspace, email) {
  const normalized = normalizeEmail(email);
  const roles = { ...(workspace?.pendingInviteRoles || {}) };
  delete roles[normalized];
  return {
    pendingInvites: (workspace?.pendingInvites || [])
      .filter((i) => normalizeEmail(i.email) !== normalized),
    pendingInviteEmails: (workspace?.pendingInviteEmails || [])
      .filter((e) => normalizeEmail(e) !== normalized),
    pendingInviteRoles: roles,
  };
}

/**
 * The invitation that matches this user, if any.
 * @returns {{ email, role } | null}
 */
export function inviteFor(workspace, userEmail) {
  const normalized = normalizeEmail(userEmail);
  if (!normalized) return null;
  const match = (workspace?.pendingInvites || [])
    .find((i) => normalizeEmail(i.email) === normalized);
  if (!match) return null;
  // Never let a malformed record grant more than it should.
  const role = WORKSPACE_ROLES.includes(match.role) ? match.role : 'viewer';
  return { email: normalized, role };
}

/**
 * How to display a member. Prefers the name, falls back to the email, and
 * shows a UID only when there is genuinely nothing else — and even then says
 * what it is rather than printing 28 characters of noise.
 */
export function memberLabel(uid, memberProfiles = {}, { selfUid = null } = {}) {
  const p = memberProfiles[uid] || {};
  if (p.displayName) return p.displayName;
  if (p.email) return p.email;
  if (uid && uid === selfUid) return 'You';
  return 'Invited member';
}

/** The secondary line under a member's name: their email, when we have one. */
export function memberSubLabel(uid, memberProfiles = {}) {
  const p = memberProfiles[uid] || {};
  return p.displayName && p.email ? p.email : '';
}
