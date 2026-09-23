// src/services/approvalCopy.js — what a signed-in but not-yet-approved person
// is told, and what the Settings page says about their session.
//
// Two things were being promised that never happen: an approval email (there is
// no backend to send one), and an "anonymous session" (anonymous auth was
// removed — everyone signs in with Google). Copy that describes a version of
// the app that no longer exists is worse than no copy: it makes people wait for
// a message that is not coming.
//
// Pure, so the wording is tested rather than re-read.

/**
 * @param {object|null} profile  the users/{uid} document, or null if it has
 *   not arrived yet
 * @returns {{ state, title, message, waitNote, canRetry }}
 */
export function approvalCopy(profile) {
  const status = profile?.status || null;

  if (status === 'rejected') {
    return {
      state: 'rejected',
      title: 'Access declined',
      // "the people below" used to point at a list of superadmin addresses on
      // the card. That list was removed, so the sentence had to stop pointing
      // at it — a reference to something that is no longer on screen reads as a
      // rendering bug.
      message: 'An administrator declined this request. If you think that is a '
             + 'mistake, ask an administrator to look again.',
      // No point telling someone to keep the tab open: nothing will change on
      // its own from here.
      waitNote: null,
      canRetry: false,
    };
  }

  if (!profile) {
    return {
      state: 'setting-up',
      title: 'Setting up your account',
      message: 'We are finishing your sign-in. This usually takes a moment.',
      waitNote: 'This page updates by itself — there is nothing to click.',
      canRetry: true,
    };
  }

  return {
    state: 'pending',
    title: 'Waiting for approval',
    message: 'Your sign-in came through. An administrator needs to approve this '
           + 'account before you can use the app.',
    // The honest version of "we'll email you": we won't, but the page is live.
    waitNote: 'Leave this page open — it lets you in the moment someone approves '
            + 'you. No email is sent, so check back or ask an administrator directly.',
    canRetry: true,
  };
}

/**
 * The one-line identity for Settings → Your data.
 * @param {object|null} profile
 * @param {object|null} authUser  auth.currentUser, as a fallback
 */
export function sessionLine(profile, authUser) {
  const email = profile?.email || authUser?.email || '';
  const name  = profile?.displayName || authUser?.displayName || '';

  if (email && name) return `Signed in as ${name} (${email}).`;
  if (email) return `Signed in as ${email}.`;
  if (name)  return `Signed in as ${name}.`;
  return 'Signed in.';
}

/** Settings is more than preferences now; say what it actually holds. */
export const SETTINGS_SUBTITLE =
  'Your preferences on this device, plus the workspaces and people you manage.';
