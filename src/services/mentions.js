// src/services/mentions.js — who a message is for, and what they are told.
//
// Comments already rendered `@someone` as a pill, but nobody was ever told:
// the pill was decoration. This works out which member of the workspace a
// mention names, and builds the notice that reaches them — the same notice
// shape the automation runner writes, so one inbox shows both.
//
// Pure: no Firebase, no network, no React. `services/firebase.js` does the
// writing and `useInbox` does the reading.

/** Every notice in the app is one of these. The inbox groups by it. */
export const NOTICE_KINDS = ['mention', 'assignment', 'comment', 'automation'];

/** Longest text we will ever store on a notice — an inbox row, not an essay. */
export const NOTICE_TEXT_MAX = 300;

const TOKEN = /(^|[\s(])@([\w.-]{2,60})/g;

/** A name as it would be typed after an @: no spaces, no case. */
export function mentionHandle(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')        // an email address is handled by its local part
    .replace(/[^\w.-]+/g, '');
}

/** The @tokens in a piece of text, lower-cased and deduplicated. */
export function mentionTokens(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(TOKEN)) found.add(m[2].toLowerCase());
  return [...found];
}

/**
 * Every way one member could be written after an @: their display name with the
 * spaces taken out, their first name, and the local part of their email.
 */
export function handlesFor(uid, profile = {}) {
  const handles = new Set();
  const add = (v) => { const h = mentionHandle(v); if (h.length >= 2) handles.add(h); };

  add(profile.displayName);
  const first = String(profile.displayName || '').trim().split(/\s+/)[0];
  add(first);
  const local = String(profile.email || '').split('@')[0];
  add(local);
  return [...handles];
}

/**
 * Which members a piece of text mentions.
 *
 * @param {string} text
 * @param {{ members?: string[], memberProfiles?: object, exclude?: string[] }} ctx
 * @returns {string[]} uids, each once, in the order they appear
 */
export function mentionedUids(text, { members = [], memberProfiles = {}, exclude = [] } = {}) {
  const tokens = mentionTokens(text);
  if (!tokens.length) return [];

  const skip = new Set(exclude.filter(Boolean));
  const byHandle = new Map();
  for (const uid of members) {
    if (skip.has(uid)) continue;
    for (const handle of handlesFor(uid, memberProfiles[uid] || {})) {
      // First member to claim a handle keeps it: two people called "Ana" means
      // "@ana" is ambiguous, and telling the wrong one is worse than telling one.
      if (!byHandle.has(handle)) byHandle.set(handle, uid);
    }
  }

  const hit = [];
  for (const token of tokens) {
    const uid = byHandle.get(token);
    if (uid && !hit.includes(uid)) hit.push(uid);
  }
  return hit;
}

/** The names a mention picker offers, as `@handle — Full Name`. */
export function mentionSuggestions({ members = [], memberProfiles = {}, exclude = [], query = '' } = {}) {
  const q = mentionHandle(query);
  const skip = new Set(exclude.filter(Boolean));
  return members
    .filter((uid) => !skip.has(uid))
    .map((uid) => {
      const profile = memberProfiles[uid] || {};
      const [handle] = handlesFor(uid, profile);
      return handle && {
        uid,
        handle,
        name: profile.displayName || profile.email || 'Member',
        email: profile.email || '',
      };
    })
    .filter(Boolean)
    .filter((s) => !q || s.handle.startsWith(q) || mentionHandle(s.name).startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const trim = (text) => {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one.length > NOTICE_TEXT_MAX ? `${one.slice(0, NOTICE_TEXT_MAX - 1)}…` : one;
};

/**
 * One notice, ready to be written.
 *
 * `text` is the whole sentence the inbox shows — built here rather than in the
 * component, so an old notice still reads correctly after the wording changes.
 */
export function buildNotice({
  kind, userId, workspaceId, fromUserId, fromName, taskId, taskTitle, body = '',
}) {
  if (!NOTICE_KINDS.includes(kind)) throw new Error(`Unknown notice kind: ${kind}`);
  if (!userId) throw new Error('A notice needs somebody to be for.');
  if (!workspaceId) throw new Error('A notice belongs to a workspace.');

  const who = fromName || 'Somebody';
  const what = taskTitle || 'a task';
  const excerpt = trim(body);

  const text = {
    mention: `${who} mentioned you on “${what}”${excerpt ? `: ${excerpt}` : ''}`,
    comment: `${who} commented on “${what}”${excerpt ? `: ${excerpt}` : ''}`,
    assignment: `${who} assigned you “${what}”`,
    automation: excerpt || `Something happened on “${what}”`,
  }[kind];

  return {
    userId,
    workspaceId,
    kind,
    source: kind === 'automation' ? 'automation' : 'person',
    fromUserId: fromUserId || null,
    taskId: taskId || null,
    taskTitle: taskTitle || '',
    text: trim(text),
    read: false,
  };
}

/**
 * Everybody who should hear about a new comment, and why.
 *
 * A mention beats a plain comment: somebody named in the text gets a "mentioned
 * you", and the people merely watching the task get a "commented on", and
 * nobody gets both. The author never hears about their own message.
 */
export function noticesForComment({
  body, task, authorId, authorName, members = [], memberProfiles = {}, watchers = [],
}) {
  const mentioned = mentionedUids(body, { members, memberProfiles, exclude: [authorId] });
  const alsoTell = [...new Set(watchers)]
    .filter((uid) => uid && uid !== authorId && !mentioned.includes(uid));

  const common = {
    workspaceId: task?.workspaceId,
    fromUserId: authorId,
    fromName: authorName,
    taskId: task?.id,
    taskTitle: task?.title,
    body,
  };

  return [
    ...mentioned.map((uid) => buildNotice({ ...common, kind: 'mention', userId: uid })),
    ...alsoTell.map((uid) => buildNotice({ ...common, kind: 'comment', userId: uid })),
  ];
}

/**
 * Who to tell that they have just been given a task: the people added to it by
 * this change, never the person making the change.
 */
export function noticesForAssignment({
  task, before = [], after = [], byUserId, byName,
}) {
  const had = new Set(before);
  return [...new Set(after)]
    .filter((uid) => uid && !had.has(uid) && uid !== byUserId)
    .map((uid) => buildNotice({
      kind: 'assignment',
      userId: uid,
      workspaceId: task?.workspaceId,
      fromUserId: byUserId,
      fromName: byName,
      taskId: task?.id,
      taskTitle: task?.title,
    }));
}

/**
 * Who is following a task without being told to: the person who created it and
 * everybody it is assigned to. There is no "subscribe" button — this is the
 * honest reading of who is already involved.
 */
export function watchersOf(task) {
  return [...new Set([task?.userId, ...(task?.assignedTo || [])].filter(Boolean))];
}

/** How many of these need attention — what the topbar count shows. */
export function unreadCount(notices = []) {
  return notices.filter((n) => n && !n.read).length;
}

/** Newest first, unread before read, so the inbox opens on what matters. */
export function sortNotices(notices = []) {
  const at = (n) => (n?.at?.toMillis ? n.at.toMillis() : (n?.at?.seconds ? n.at.seconds * 1000 : 0));
  return [...notices].sort((a, b) => (Number(!!a.read) - Number(!!b.read)) || (at(b) - at(a)));
}
