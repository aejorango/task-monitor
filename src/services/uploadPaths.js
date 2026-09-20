// src/services/uploadPaths.js — where an uploaded file lives, and which files
// stop being referenced when an activity is edited or deleted.
//
// Files used to be stored under `users/{uid}/…`, which made the uploader the
// only person who could ever delete them: an admin who deleted somebody else's
// activity removed the record and left the bytes behind for ever. Attachments
// belong to the WORKSPACE, so that is where they are stored now, and the
// storage rules gate on workspace membership.
//
// Pure: no Firebase, no network. `services/firebase.js` does the writing.

/** The legacy per-uploader prefix. Files there are read-only history. */
export const LEGACY_PREFIX = 'users/';

/** Everything this app uploads from now on lives under here. */
export const WORKSPACE_PREFIX = 'workspaces/';

/** A filename safe for a storage path, and short enough to read in a console. */
export function safeFilename(name) {
  const cleaned = String(name || 'file')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '');
  return (cleaned || 'file').slice(0, 120);
}

/**
 * Where a new upload goes.
 *
 * `workspaces/{workspaceId}/{scope}/{timestamp}-{filename}`
 *
 * The scope keeps a workspace's bucket browsable — one folder per task, plus
 * `general` for an upload made before the task exists and `logo` for the
 * workspace's own image.
 *
 * @throws if there is no workspace: a file with no workspace is a file nobody
 *         but its uploader could ever delete, which is the bug this replaces.
 */
export function uploadPath({ workspaceId, taskId, scope, filename, now = Date.now() }) {
  const ws = String(workspaceId || '').trim();
  if (!ws) throw new Error('An upload needs a workspace, so everybody in it can manage the file.');
  const folder = safeFilename(scope || taskId || 'general');
  return `${WORKSPACE_PREFIX}${ws}/${folder}/${now}-${safeFilename(filename)}`;
}

/** The workspace a stored file belongs to, or null for a legacy per-user file. */
export function workspaceOfPath(path) {
  const m = /^workspaces\/([^/]+)\//.exec(String(path || ''));
  return m ? m[1] : null;
}

/** Was this file uploaded under the old per-uploader prefix? */
export function isLegacyPath(path) {
  return String(path || '').startsWith(LEGACY_PREFIX);
}

const pathsOf = (attachments) => (attachments || [])
  .map((a) => a?.path)
  .filter((p) => typeof p === 'string' && p.length > 0);

/**
 * Every stored file one or more activities own — what to remove when they are
 * deleted. A link somebody pasted (Drive, anything external) has no `path` and
 * is never touched.
 */
export function attachmentPaths(activities) {
  const list = Array.isArray(activities) ? activities : [activities];
  const seen = new Set();
  for (const a of list) for (const p of pathsOf(a?.attachments)) seen.add(p);
  return [...seen];
}

/**
 * Files the edit dropped: present before, gone after. Used so removing an
 * attachment in the editor actually removes the bytes, not just the row.
 *
 * `after` being undefined means "attachments were not part of this edit" —
 * nothing is orphaned.
 */
export function orphanedPaths(before, after) {
  if (after === undefined) return [];
  const kept = new Set(pathsOf(after));
  return pathsOf(before).filter((p) => !kept.has(p));
}
