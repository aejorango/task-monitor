// T-0075 / NEW-004 — a mention has to reach somebody.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotice, handlesFor, mentionHandle, mentionSuggestions, mentionTokens,
  mentionedUids, noticesForAssignment, noticesForComment, sortNotices,
  unreadCount, watchersOf,
} from './mentions.js';

const members = ['u-ace', 'u-mia', 'u-bob'];
const memberProfiles = {
  'u-ace': { displayName: 'Ace Jorango', email: 'ace@blueinnovation.ph' },
  'u-mia': { displayName: 'Mia Santos', email: 'mia.santos@example.com' },
  'u-bob': { email: 'bob@example.com' },
};
const task = { id: 't1', workspaceId: 'ws1', title: 'Disbursement report', userId: 'u-bob', assignedTo: ['u-mia'] };

// ─── reading the text ───────────────────────────────────────────────────────

test('a name becomes the handle somebody would actually type', () => {
  assert.equal(mentionHandle('Ace Jorango'), 'acejorango');
  assert.equal(mentionHandle('mia.santos@example.com'), 'mia.santos');
  assert.equal(mentionHandle(''), '');
});

test('the @tokens are found once each, wherever they are in the line', () => {
  assert.deepEqual(mentionTokens('@ace can you look, (@mia too) — thanks @ace'), ['ace', 'mia']);
});

test('an email address in the text is not read as a mention of its domain', () => {
  assert.deepEqual(mentionTokens('write to ace@blueinnovation.ph'), [],
    'the @ is preceded by a letter, so it is part of an address');
});

test('somebody can be named by full name, first name or email local part', () => {
  assert.deepEqual(handlesFor('u-ace', memberProfiles['u-ace']).sort(), ['ace', 'acejorango'].sort());
  assert.deepEqual(handlesFor('u-bob', memberProfiles['u-bob']), ['bob']);
});

test('a mention resolves to the member it names', () => {
  assert.deepEqual(mentionedUids('@ace please review', { members, memberProfiles }), ['u-ace']);
  assert.deepEqual(mentionedUids('@mia.santos and @bob', { members, memberProfiles }), ['u-mia', 'u-bob']);
});

test('mentioning yourself tells nobody', () => {
  assert.deepEqual(mentionedUids('@ace note to self', { members, memberProfiles, exclude: ['u-ace'] }), []);
});

test('a name that is not in the workspace matches nobody', () => {
  assert.deepEqual(mentionedUids('@stranger hello', { members, memberProfiles }), []);
});

test('two people who would share a handle: exactly one is told, never the wrong two', () => {
  const twoAnas = {
    'u-1': { displayName: 'Ana Cruz' },
    'u-2': { displayName: 'Ana Reyes' },
  };
  const hit = mentionedUids('@ana look', { members: ['u-1', 'u-2'], memberProfiles: twoAnas });
  assert.equal(hit.length, 1);
  assert.equal(hit[0], 'u-1', 'the first member to claim the handle keeps it');
});

test('the picker offers each member once, by name, filtered as you type', () => {
  const all = mentionSuggestions({ members, memberProfiles });
  assert.deepEqual(all.map((s) => s.name), ['Ace Jorango', 'bob@example.com', 'Mia Santos']);
  assert.deepEqual(mentionSuggestions({ members, memberProfiles, query: 'mi' }).map((s) => s.uid), ['u-mia']);
  assert.deepEqual(mentionSuggestions({ members, memberProfiles, exclude: ['u-ace'], query: 'ace' }), []);
});

// ─── the notice itself ──────────────────────────────────────────────────────

test('a notice says who did what, in a whole sentence', () => {
  const n = buildNotice({
    kind: 'mention', userId: 'u-mia', workspaceId: 'ws1',
    fromUserId: 'u-ace', fromName: 'Ace Jorango',
    taskId: 't1', taskTitle: 'Disbursement report', body: 'can you check the totals?',
  });
  assert.equal(n.text, 'Ace Jorango mentioned you on “Disbursement report”: can you check the totals?');
  assert.equal(n.read, false);
  assert.equal(n.kind, 'mention');
  assert.equal(n.taskId, 't1');
});

test('a very long comment is cut down to an inbox row', () => {
  const n = buildNotice({
    kind: 'comment', userId: 'u-mia', workspaceId: 'ws1', taskTitle: 'T',
    body: 'x'.repeat(5000),
  });
  assert.ok(n.text.length <= 300);
  assert.match(n.text, /…$/);
});

test('a notice with nobody to be for, or no workspace, is refused rather than written', () => {
  assert.throws(() => buildNotice({ kind: 'mention', workspaceId: 'ws1' }), /somebody to be for/);
  assert.throws(() => buildNotice({ kind: 'mention', userId: 'u1' }), /belongs to a workspace/);
  assert.throws(() => buildNotice({ kind: 'shout', userId: 'u1', workspaceId: 'ws1' }), /Unknown notice kind/);
});

// ─── who hears about a comment ──────────────────────────────────────────────

test('the person named gets a mention; the people involved get a comment', () => {
  const notices = noticesForComment({
    body: '@ace can you look at this?',
    task, authorId: 'u-mia', authorName: 'Mia Santos', members, memberProfiles,
    watchers: watchersOf(task),
  });
  const byUser = Object.fromEntries(notices.map((n) => [n.userId, n.kind]));
  assert.equal(byUser['u-ace'], 'mention');
  assert.equal(byUser['u-bob'], 'comment', 'the person who created the task is involved');
  assert.equal(byUser['u-mia'], undefined, 'the author never hears about their own message');
});

test('somebody both mentioned and watching is told once, as a mention', () => {
  const notices = noticesForComment({
    body: '@mia please see',
    task, authorId: 'u-ace', authorName: 'Ace', members, memberProfiles,
    watchers: watchersOf(task),
  });
  const mine = notices.filter((n) => n.userId === 'u-mia');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, 'mention');
});

test('a comment with no mentions still reaches the people on the task', () => {
  const notices = noticesForComment({
    body: 'done', task, authorId: 'u-ace', authorName: 'Ace', members, memberProfiles,
    watchers: watchersOf(task),
  });
  assert.deepEqual(notices.map((n) => n.userId).sort(), ['u-bob', 'u-mia']);
  assert.ok(notices.every((n) => n.kind === 'comment'));
});

test('watchers are the creator and the assignees, each once', () => {
  assert.deepEqual(watchersOf({ userId: 'u-a', assignedTo: ['u-b', 'u-a'] }), ['u-a', 'u-b']);
  assert.deepEqual(watchersOf({}), []);
  assert.deepEqual(watchersOf(null), []);
});

// ─── who hears about an assignment ──────────────────────────────────────────

test('only the people newly put on the task are told', () => {
  const notices = noticesForAssignment({
    task, before: ['u-mia'], after: ['u-mia', 'u-bob'], byUserId: 'u-ace', byName: 'Ace',
  });
  assert.deepEqual(notices.map((n) => n.userId), ['u-bob']);
  assert.equal(notices[0].text, 'Ace assigned you “Disbursement report”');
});

test('assigning something to yourself tells you nothing', () => {
  const notices = noticesForAssignment({
    task, before: [], after: ['u-ace'], byUserId: 'u-ace', byName: 'Ace',
  });
  assert.deepEqual(notices, []);
});

test('taking somebody off a task does not send them anything', () => {
  assert.deepEqual(noticesForAssignment({ task, before: ['u-mia'], after: [], byUserId: 'u-ace' }), []);
});

// ─── the inbox ──────────────────────────────────────────────────────────────

test('the count is the unread ones', () => {
  assert.equal(unreadCount([{ read: false }, { read: true }, { read: false }]), 2);
  assert.equal(unreadCount([]), 0);
  assert.equal(unreadCount(), 0);
});

test('unread comes first, and within that the newest', () => {
  const at = (s) => ({ seconds: s });
  const sorted = sortNotices([
    { id: 'old-read', read: true, at: at(100) },
    { id: 'old-unread', read: false, at: at(100) },
    { id: 'new-unread', read: false, at: at(200) },
    { id: 'new-read', read: true, at: at(300) },
  ]);
  assert.deepEqual(sorted.map((n) => n.id), ['new-unread', 'old-unread', 'new-read', 'old-read']);
});

test('a notice written a moment ago, before the server stamped it, still sorts', () => {
  const sorted = sortNotices([{ id: 'a', read: false, at: null }, { id: 'b', read: false, at: { seconds: 1 } }]);
  assert.equal(sorted.length, 2);
});
