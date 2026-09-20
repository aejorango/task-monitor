// src/services/shareLinks.js — a read-only link to one board or timeline.
//
// A client who should see progress does not want an account, and this app is
// invite-only, so today they see nothing. A share link is a URL that shows a
// SNAPSHOT of one project — what is on it, where each task stands, when things
// are due — to anyone holding the link, and nothing else.
//
// Three deliberate decisions, because this is the only thing in the app that a
// stranger can read:
//
//   · It is a snapshot, not a window. The document holds the rows it shows.
//     Nothing in `tasks`, `projects` or `workspaces` is opened up, so a leaked
//     token leaks exactly one project's headline state and never grows into
//     more.
//   · What goes in is a short list, written out below. Comments, activity,
//     attachments, the people's identities and every internal note stay out.
//   · It can be switched off. Revoked or past its date, the link is dead — and
//     firestore.rules enforces that, not the page that would have hidden it.
//
// Pure: no Firebase, no network. `services/firebase.js` writes what this builds.

const DAY_MS = 86400000;

/** What a link can show. */
export const SHARE_KINDS = [
  { value: 'board', label: 'Board — the tasks, grouped by status' },
  { value: 'gantt', label: 'Timeline — the schedule, as a Gantt chart' },
];

/** How long a link lasts. "Until I turn it off" is deliberate, not a default. */
export const EXPIRY_CHOICES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 0, label: 'Until I turn it off' },
];

export const DEFAULT_EXPIRY_DAYS = 30;

/** Tokens are 26 characters of Crockford-ish base32 — about 128 bits. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const TOKEN_LENGTH = 26;

/**
 * A token nobody can guess.
 *
 * @param {(n: number) => Uint8Array} randomBytes  injected so this stays pure
 *        and testable; the app passes crypto.getRandomValues.
 */
export function newShareToken(randomBytes) {
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** The browser's own randomness, as `newShareToken` wants it. */
export const cryptoBytes = (n) => {
  const source = globalThis.crypto;
  if (!source?.getRandomValues) {
    throw new Error('This browser cannot make a secure link. Try a different one.');
  }
  return source.getRandomValues(new Uint8Array(n));
};

/** When a link should stop working, or null for "until I turn it off". */
export function expiryFrom(days, now = Date.now()) {
  const n = Number(days);
  return Number.isFinite(n) && n > 0 ? new Date(now + n * DAY_MS) : null;
}

const ms = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Is this link still working? The same question firestore.rules asks. */
export function isShareLive(share, now = Date.now()) {
  if (!share || share.revoked) return false;
  const until = ms(share.expiresAt);
  return until === null || until > now;
}

/** Why it is not working, in a sentence, or null when it is. */
export function shareStatus(share, now = Date.now()) {
  if (!share) return { live: false, text: 'This link does not exist.' };
  if (share.revoked) return { live: false, text: 'This link was turned off.' };
  const until = ms(share.expiresAt);
  if (until !== null && until <= now) {
    return { live: false, text: 'This link has expired.' };
  }
  if (until === null) return { live: true, text: 'Works until you turn it off.' };
  const days = Math.max(0, Math.round((until - now) / DAY_MS));
  return {
    live: true,
    text: days <= 1 ? 'Stops working within a day.' : `Stops working in ${days} days.`,
  };
}

/** The URL to hand out. */
export function shareUrl(token, { origin = '', base = '/' } = {}) {
  const path = `${base}`.replace(/\/+$/, '');
  return `${origin}${path}/#/shared/${token}`;
}

/** The token in a hash route, or null. */
export function tokenFromHash(hash = '') {
  const m = /#\/shared\/([0-9a-z]{8,64})/i.exec(String(hash));
  return m ? m[1] : null;
}

// ─── the snapshot ───────────────────────────────────────────────────────────

/**
 * The ONLY fields that ever leave the workspace. Anything not on this list —
 * a comment, an attachment, who is on it, what was said in the activity log —
 * stays behind, by construction rather than by remembering to strip it.
 */
export const SHARED_TASK_FIELDS = [
  'id', 'title', 'status', 'priority', 'progress', 'startDate', 'endDate', 'phase',
];

const clean = (value) => (value === undefined ? null : value);

/** One task, reduced to what a client outside the company may see. */
export function shareTask(task, { phaseName = '' } = {}) {
  return {
    id: task?.id || '',
    title: String(task?.title || 'Untitled'),
    status: task?.status || 'todo',
    priority: task?.priority || 'medium',
    progress: task?.status === 'done' ? 100 : Number(task?.progress) || 0,
    startDate: clean(task?.plan?.startDate),
    endDate: clean(task?.plan?.endDate),
    phase: phaseName || '',
  };
}

/**
 * The snapshot a link holds.
 *
 * Done tasks are kept — progress is the point — but deleted and archived ones
 * are not, and neither is anything from another project.
 */
export function buildSnapshot(project, tasks = [], { now = new Date() } = {}) {
  const phases = (project?.phases || []).map((p) => ({ id: p.id, name: p.name || '' }));
  const phaseName = (id) => phases.find((p) => p.id === id)?.name || '';

  const rows = tasks
    .filter((t) => t && !t.deleted && !t.archived)
    .filter((t) => !project?.id || t.projectId === project.id)
    .map((t) => shareTask(t, { phaseName: phaseName(t.phaseId) }))
    .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999')
      || a.title.localeCompare(b.title));

  return {
    generatedAt: now instanceof Date ? now.toISOString() : String(now),
    projectName: String(project?.name || 'Project'),
    projectColor: project?.color || null,
    phases,
    tasks: rows,
    counts: {
      total: rows.length,
      done: rows.filter((t) => t.status === 'done').length,
      overdue: rows.filter((t) => t.status !== 'done' && t.endDate && t.endDate < isoDay(now)).length,
    },
  };
}

const isoDay = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** The whole document, ready to be written. */
export function buildShareLink({
  token, workspaceId, projectId, project, tasks = [], kind = 'gantt',
  createdByUserId, createdByName = '', expiryDays = DEFAULT_EXPIRY_DAYS, now = Date.now(),
}) {
  if (!token) throw new Error('A share link needs a token.');
  if (!workspaceId) throw new Error('A share link belongs to a workspace.');
  if (!createdByUserId) throw new Error('A share link records who published it.');
  if (!SHARE_KINDS.some((k) => k.value === kind)) throw new Error(`Unknown share kind: ${kind}`);

  return {
    token,
    workspaceId,
    projectId: projectId || project?.id || null,
    projectName: String(project?.name || 'Project'),
    kind,
    createdByUserId,
    createdByName: String(createdByName || ''),
    revoked: false,
    expiresAt: expiryFrom(expiryDays, now),
    snapshot: buildSnapshot(project, tasks, { now: new Date(now) }),
  };
}

/** What the person publishing it is told they are about to do. */
export function describeShare(share) {
  const kind = SHARE_KINDS.find((k) => k.value === share?.kind)?.label || 'This project';
  const what = kind.split('—')[0].trim().toLowerCase();
  const n = share?.snapshot?.tasks?.length ?? 0;
  return `Anyone with this link can see the ${what} for “${share?.projectName || 'this project'}” `
    + `— ${n} task${n === 1 ? '' : 's'}, as they were when you made or last refreshed it. `
    + 'They cannot see comments, attachments, hours, or who is on what, and they cannot change anything.';
}
