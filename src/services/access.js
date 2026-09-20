// src/services/access.js — who is allowed to do what, as pure functions.
//
// These mirror firestore.rules. The rules are the real guard; this module
// exists so the UI can hide controls a person cannot use, instead of letting
// them click a button that comes back "Missing or insufficient permissions".
// Keep the two in step: every function here names the rule it mirrors.

/** Role a user holds on a workspace — mirrors workspaceRole() in the rules. */
export function workspaceRole(workspace, userId) {
  if (!workspace || !userId) return null;
  return workspace.acl?.[userId] || null;
}

export function isWorkspaceAdmin(workspace, userId) {
  const role = workspaceRole(workspace, userId);
  return role === 'owner' || role === 'admin';
}

/** Role a user holds on a project — mirrors hasProjectRole() in the rules. */
export function projectRole(project, userId) {
  if (!project || !userId) return null;
  return project.acl?.[userId] || null;
}

/**
 * May this person hand out access to the project?
 * Mirrors canAdministerProject() in firestore.rules: project admins, the
 * person who created the project, and admins/owners of its workspace.
 */
export function canAdministerProject(project, workspace, userId) {
  if (!project || !userId) return false;
  if (project.userId === userId) return true;
  if (projectRole(project, userId) === 'admin') return true;
  return isWorkspaceAdmin(workspace, userId);
}

/** May this person edit the project's tasks? Mirrors canEditProject(). */
export function canEditProject(project, workspace, userId) {
  if (canAdministerProject(project, workspace, userId)) return true;
  return projectRole(project, userId) === 'editor';
}

// ─── Plain-language error text ──────────────────────────────────────────────
// Firebase throws things like "FirebaseError: Missing or insufficient
// permissions." and "7 PERMISSION_DENIED". Nobody outside this repo should
// ever read those words, so every catch block in the UI runs through here.

const FRIENDLY_BY_CODE = {
  'permission-denied': 'You do not have permission to do that. Ask a project or workspace admin.',
  'unauthenticated':   'You are signed out. Reload the page and sign in again.',
  'not-found':         'That item no longer exists. It may have been deleted.',
  'already-exists':    'That already exists.',
  'unavailable':       'Cannot reach the server right now. Check your connection and try again.',
  'deadline-exceeded': 'The server took too long to answer. Try again in a moment.',
  'resource-exhausted': 'Too many requests at once. Wait a few seconds and try again.',
  'failed-precondition': 'That cannot be done right now — something it depends on has changed. Reload and try again.',
  'cancelled':         'That was cancelled before it finished.',
};

/**
 * Turn any thrown value into one sentence a non-technical person can act on.
 * @param {unknown} err       the caught value
 * @param {string}  fallback  what to say when we cannot recognise it
 */
export function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;
  const code = typeof err === 'object' && err !== null ? err.code : null;
  if (code && FRIENDLY_BY_CODE[code]) return FRIENDLY_BY_CODE[code];

  const raw = typeof err === 'string' ? err : (err.message || '');
  // Firestore sometimes only puts the code in the message text, and the gRPC
  // layer spells it PERMISSION_DENIED rather than permission-denied.
  const needle = raw.toLowerCase().replace(/_/g, '-');
  for (const [key, text] of Object.entries(FRIENDLY_BY_CODE)) {
    if (needle.includes(key)) return text;
  }
  if (/missing or insufficient permissions/i.test(raw)) return FRIENDLY_BY_CODE['permission-denied'];

  // A message we wrote ourselves (plain sentence, no SDK noise) is worth
  // showing; anything that looks like an SDK dump is not.
  if (raw && !/^[A-Za-z]+Error:|^\d+\s[A-Z_]+/.test(raw) && raw.length < 200) return raw;
  return fallback;
}
