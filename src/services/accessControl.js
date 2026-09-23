// src/services/accessControl.js — who has access to a workspace, what that
// lets them do, and how recently they used it (T-0155).
//
// Pure: no Firebase, no clock of its own (`today`/`now` is passed in). The
// Members page renders what this returns.
//
// The role descriptions below are taken from `firestore.rules`, not from the
// mockup. The Dashboard Explorer's Access-control card promises "billing" and
// "run pipelines"; this app has neither, and a permissions table that lists a
// power nobody has is worse than no table — somebody will rely on it.

/** The four roles, worst-privileged last, exactly as the rules enforce them. */
export const ROLES = [
  {
    id: 'owner',
    label: 'Owner',
    // firestore.rules: only `acl[uid] == 'owner'` may delete the workspace.
    perms: 'Created the workspace. Everything an admin can do, plus deleting the workspace itself. Cannot be removed or demoted.',
  },
  {
    id: 'admin',
    label: 'Admin',
    // isWorkspaceAdmin() — owner or admin — gates every workspace update.
    perms: 'Invite and remove people, change roles, and edit everything an editor can.',
  },
  {
    id: 'editor',
    label: 'Editor',
    // canEditWorkspace() — owner, admin or editor.
    perms: 'Create and edit projects, tasks and activity. Cannot change who has access.',
  },
  {
    id: 'viewer',
    label: 'Viewer',
    perms: 'Read-only. Sees the boards, reports and minutes; changes nothing.',
  },
];

export const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));

/** A member's role, defaulting the way the rest of the app defaults it. */
export function roleOf(workspace, uid) {
  return workspace?.acl?.[uid] || 'editor';
}

/** How many members hold each role. */
export function roleCounts(workspace) {
  const counts = Object.fromEntries(ROLES.map((r) => [r.id, 0]));
  for (const uid of workspace?.members || []) {
    const r = roleOf(workspace, uid);
    if (counts[r] !== undefined) counts[r] += 1;
  }
  return counts;
}

/**
 * How recently somebody logged something, as "now / 12m / 2h / 3d".
 *
 * `null` when nothing of theirs is in the activities handed over — which is
 * NOT the same as "never active", because the workspace listener only holds
 * the newest page of entries. The caller says so rather than printing a zero.
 */
export function lastLogged(uid, activities = [], now = Date.now()) {
  let newest = null;
  for (const a of activities) {
    if (a?.userId !== uid) continue;
    const at = a.loggedAt?.toMillis ? a.loggedAt.toMillis()
      : a.loggedAt instanceof Date ? a.loggedAt.getTime()
      : typeof a.loggedAt === 'number' ? a.loggedAt
      : a.date ? Date.parse(`${a.date}T12:00:00`) : null;
    if (at == null || Number.isNaN(at)) continue;
    if (newest == null || at > newest) newest = at;
  }
  if (newest == null) return null;
  const mins = Math.floor((now - newest) / 60000);
  if (mins < 2) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * What a member's access is scoped to.
 *
 * The workspace ACL is workspace-wide, so "Workspace" is the honest answer for
 * almost everybody. A project that carries its OWN acl narrows it, and that is
 * what the count reports. It is never "3 projects" unless three projects
 * really name that person.
 */
export function scopeOf(uid, projects = []) {
  const own = projects.filter((p) => p && !p.deleted && p.acl && p.acl[uid]);
  if (own.length === 0) return { label: 'Workspace', count: 0 };
  return { label: own.length === 1 ? '1 project' : `${own.length} projects`, count: own.length };
}

/**
 * The four tiles.
 *
 * The mockup's are Members / Pending / Guests / Role changes. This app has no
 * guest access and keeps no audit trail of role changes, so rather than print
 * two zeros that look like facts, those two slots carry numbers the data can
 * actually support: who can change access, and who cannot change anything.
 */
export function accessTiles(workspace, pendingInvites = []) {
  const counts = roleCounts(workspace);
  const total = (workspace?.members || []).length;
  const collaborators = Math.max(0, total - counts.owner);
  const admins = counts.owner + counts.admin;
  const pending = pendingInvites.length;
  return [
    {
      id: 'members',
      label: 'Members',
      value: String(total),
      sub: total === 0 ? 'nobody yet'
        : `${counts.owner} owner · ${collaborators} collaborator${collaborators === 1 ? '' : 's'}`,
      tone: 'navy',
    },
    {
      id: 'pending',
      label: 'Pending',
      value: String(pending),
      // No expiry field exists on an invitation, so this never claims one.
      sub: pending === 0 ? 'nobody waiting' : 'waiting to be claimed',
      tone: pending > 0 ? 'amber' : 'green',
    },
    {
      id: 'admins',
      label: 'Can change access',
      value: String(admins),
      sub: `${counts.owner} owner · ${counts.admin} admin${counts.admin === 1 ? '' : 's'}`,
      tone: 'navy',
    },
    {
      id: 'viewers',
      label: 'Read-only',
      value: String(counts.viewer),
      sub: counts.viewer === 0 ? 'everybody can edit' : 'viewers',
      tone: 'green',
    },
  ];
}
