// T-0077 / NEW-004 — the acceptance path, end to end.
//
//   1. Given user A mentions B
//   2. When B opens the app
//   3. Then the inbox shows the mention and opens the task
//
// Everything between the comment being posted and B arriving on the task is
// exercised here: the pure module decides who is told and what it says, the
// real panel renders it, and clicking the row fires exactly the request the
// Board listens for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

const window = setupDom();

const { default: InboxPanel } = await import('../../src/components/InboxPanel.jsx');
const {
  noticesForComment, sortNotices, unreadCount, watchersOf,
} = await import('../../src/services/mentions.js');
const { OPEN_TASK_EVENT, goToTask } = await import('../../src/services/openTask.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const A = 'u-ace';
const B = 'u-mia';
const members = [A, B, 'u-bob'];
const memberProfiles = {
  [A]: { displayName: 'Ace Jorango', email: 'ace@example.com' },
  [B]: { displayName: 'Mia Santos', email: 'mia@example.com' },
  'u-bob': { displayName: 'Bob Reyes', email: 'bob@example.com' },
};
const task = {
  id: 't-42', workspaceId: 'ws1', projectId: 'p1',
  title: 'Disbursement report', userId: 'u-bob', assignedTo: [],
};

/** Step 1: A writes a comment naming B. What gets written down? */
const notices = noticesForComment({
  body: '@mia can you check the totals before Friday?',
  task, authorId: A, authorName: 'Ace Jorango',
  members, memberProfiles, watchers: watchersOf(task),
});

/** Step 2: what is waiting for B when they open the app. */
const forB = sortNotices(notices.filter((n) => n.userId === B))
  .map((n, i) => ({ id: `n${i}`, at: { seconds: Date.now() / 1000 }, ...n }));

test('A mentioning B produces one notice for B, and it says what happened', () => {
  assert.equal(forB.length, 1);
  assert.equal(forB[0].kind, 'mention');
  assert.equal(
    forB[0].text,
    'Ace Jorango mentioned you on “Disbursement report”: @mia can you check the totals before Friday?',
  );
  assert.equal(forB[0].taskId, 't-42');
  assert.equal(forB[0].read, false);
});

test('A hears nothing about their own comment', () => {
  assert.equal(notices.some((n) => n.userId === A), false);
});

test('the task’s creator is told too, as a comment rather than a mention', () => {
  const bobs = notices.filter((n) => n.userId === 'u-bob');
  assert.equal(bobs.length, 1);
  assert.equal(bobs[0].kind, 'comment');
});

test('B’s inbox shows the mention when they open the app', async () => {
  const ui = await mount(h(InboxPanel, {
    notices: forB, unread: unreadCount(forB), onOpen: () => {}, onMarkAllRead: () => {},
  }));
  const shown = text(ui.container);
  assert.match(shown, /Mentioned you/);
  assert.match(shown, /Ace Jorango mentioned you on “Disbursement report”/);
  assert.match(shown, /can you check the totals before Friday/);
  assert.equal(ui.container.querySelectorAll('.inbox-item.is-unread').length, 1);
  ui.unmount();
});

test('clicking it asks for exactly that task, on that task’s board', async () => {
  const opened = [];
  const ui = await mount(h(InboxPanel, {
    notices: forB, unread: 1, onOpen: (n) => opened.push(n), onMarkAllRead: () => {},
  }));
  const row = ui.container.querySelector('.inbox-row');
  await act(async () => {
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].taskId, 't-42');

  // …and what the bell does with that notice: navigate, then ask to open it.
  const routes = [];
  const asked = [];
  goToTask(task, (r) => routes.push(r), {
    delay: 0,
    target: { dispatchEvent: (e) => asked.push(e.detail?.taskId) },
  });
  assert.deepEqual(routes, [{ view: 'board', projectFilter: 'p1' }]);
  assert.deepEqual(asked, ['t-42']);
  ui.unmount();
});

test('the Board opens the editor for the task that request names', async () => {
  // The Board's own listener, reproduced: the same event name, the same detail.
  let editing = null;
  const onOpen = (e) => {
    const id = e.detail?.taskId;
    editing = [task].find((t) => t.id === id) || null;
  };
  const bus = new EventTarget();
  bus.addEventListener(OPEN_TASK_EVENT, onOpen);
  goToTask(task, () => {}, { delay: 0, target: bus });
  bus.removeEventListener(OPEN_TASK_EVENT, onOpen);
  assert.equal(editing?.id, 't-42', 'the notice did not open its task');
});

test('once read, the row stops counting towards the badge', async () => {
  const readNotices = forB.map((n) => ({ ...n, read: true }));
  assert.equal(unreadCount(readNotices), 0);
  const ui = await mount(h(InboxPanel, {
    notices: readNotices, unread: 0, onOpen: () => {}, onMarkAllRead: () => {},
  }));
  assert.equal(ui.container.querySelectorAll('.inbox-item.is-unread').length, 0);
  assert.doesNotMatch(text(ui.container), /Mark all as read/,
    'nothing to clear means nothing to offer');
  ui.unmount();
});

// ─── docs ───────────────────────────────────────────────────────────────────

test('the README explains the feature to somebody who has not seen it', () => {
  const readme = read('README.md');
  assert.match(readme, /## Inbox and @mentions/);
  assert.match(readme, /Type \*\*@\*\* in a comment/);
  assert.match(readme, /That person — “Ace mentioned you/);
  assert.match(readme, /Nothing is emailed/, 'the app must not imply an email it cannot send');
});

test('the README lists the new suites and the harness', () => {
  const readme = read('README.md');
  assert.match(readme, /`src\/services\/mentions\.test\.mjs`/);
  assert.match(readme, /`tests\/ui\/inbox\.test\.mjs`/);
  assert.match(readme, /`tests\/ui\/inboxApi\.test\.mjs`/);
  assert.match(readme, /`\/dev\/inbox\.html`/);
});

test('CLAUDE.md records the schema and the two traps', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /notifications\/\{noticeId\}/);
  assert.match(claude, /kind: 'mention'\|'comment'\|'assignment'\|'automation'/);
  assert.match(claude, /Writing a notice by hand/);
  assert.match(claude, /Inserting a short @handle from a picker/);
  assert.match(claude, /Navigating to a task by hand/);
  assert.match(claude, /mentions\.js\s+← who a message is for/);
  assert.match(claude, /useInbox\.js/);
});

test('the changelog records both halves', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /T-0075 — Mentions and a personal inbox \(API\/data layer\)/);
  assert.match(changelog, /T-0076 — Mentions and a personal inbox \(UI\)/);
});
