// T-0076 / NEW-004 — the topbar inbox, and the @ picker that fills it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();

const { default: InboxBell } = await import('../../src/components/InboxBell.jsx');
const { MarkdownEditor } = await import('../../src/components/Markdown.jsx');
const { noticeWhen } = await import('../../src/services/mentions.js');
const { OPEN_TASK_EVENT, goToTask, requestOpenTask } = await import('../../src/services/openTask.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const bell = read('src', 'components', 'InboxBell.jsx');
const panel = read('src', 'components', 'InboxPanel.jsx');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

// ─── getting to the task ────────────────────────────────────────────────────

test('opening a task is one navigation and one request, wherever it is asked for', () => {
  const routes = [];
  const fired = [];
  const target = {
    dispatchEvent: (e) => fired.push(e.detail?.taskId),
    setTimeout: (fn) => fn(),
  };
  goToTask({ id: 't1', projectId: 'p1' }, (r) => routes.push(r), { target });
  assert.deepEqual(routes, [{ view: 'board', projectFilter: 'p1' }]);
  assert.deepEqual(fired, ['t1']);
});

test('a task with no project still opens, on all projects', () => {
  const routes = [];
  goToTask({ id: 't1' }, (r) => routes.push(r), { delay: 0, target: { dispatchEvent: () => {} } });
  assert.deepEqual(routes, [{ view: 'board', projectFilter: 'all' }]);
});

test('asking to open nothing does nothing', () => {
  let called = 0;
  requestOpenTask(null, { target: { dispatchEvent: () => { called += 1; } } });
  assert.equal(called, 0);
});

test('the board listens for the same event the helper names', () => {
  const board = read('src', 'components', 'Board.jsx');
  assert.match(board, /import \{ OPEN_TASK_EVENT \} from '\.\.\/services\/openTask'/);
  assert.match(board, /addEventListener\(OPEN_TASK_EVENT, onOpen\)/);
  assert.equal(OPEN_TASK_EVENT, 'task-monitor:open-task');
});

// ─── the bell ───────────────────────────────────────────────────────────────

test('with nobody signed in the bell is not there at all', async () => {
  const ui = await mount(h(InboxBell, { navigate: () => {} }));
  assert.equal(text(ui.container).trim(), '');
  ui.unmount();
});

test('the bell says what it is, for a screen reader and on hover', () => {
  assert.match(bell, /aria-label=\{label\}/);
  assert.match(bell, /title=\{label\}/);
  assert.match(bell, /Inbox — \$\{unread\} unread/);
  assert.match(bell, /Inbox — nothing new/);
});

test('a count over 99 does not stretch the topbar', () => {
  assert.match(bell, /unread > 99 \? '99\+' : unread/);
});

test('an empty inbox explains what will land in it', () => {
  assert.match(panel, /Nothing here yet/);
  assert.match(panel, /mentions you with an @, comments on your/);
});

test('a row names what kind of notice it is, not just the sentence', () => {
  assert.match(panel, /mention: 'Mentioned you'/);
  assert.match(panel, /assignment: 'Assigned to you'/);
  assert.match(panel, /comment: 'New comment'/);
  assert.match(panel, /automation: 'An automation ran'/);
});

test('opening a notice marks it read and goes to its task', () => {
  assert.match(bell, /const openNotice = \(notice\) => \{\s*\n\s*markRead\(notice\)/);
  assert.match(bell, /goToTask\(task, navigate\)/);
});

test('the panel closes on Escape and on a click outside', () => {
  assert.match(bell, /if \(e\.key === 'Escape'\) \{ setOpen\(false\); buttonRef\.current\?\.focus\(\); \}/);
  assert.match(bell, /document\.addEventListener\('mousedown', onDown\)/);
  assert.match(bell, /document\.removeEventListener\('mousedown', onDown\)/);
});

test('"Mark all as read" is offered only when there is something to clear', () => {
  assert.match(panel, /\{unread > 0 && \(\s*\n\s*<button[^>]*onClick=\{onMarkAllRead\}/);
});

// The bell came off the top bar with everything else on it. What must NOT
// happen is the notices going with it: `mentions.js` would still be writing
// them and nobody could read one, which is the "action with nowhere to land"
// this codebase keeps tripping over. They are a page in the Messages hub now.
test('the notices still have a page to land on', async () => {
  const { hubForView, VIEW_REGISTRY } = await import('../../src/services/views.js');
  assert.ok(VIEW_REGISTRY.some((v) => v.id === 'inbox'), 'inbox is a real page');
  assert.equal(hubForView('inbox')?.id, 'messages');

  const view = read('src', 'components', 'InboxView.jsx');
  assert.match(view, /useInbox\(\)/, 'the same one listener, not a second');
  assert.match(view, /<InboxPanel/, 'the same list the bell used');
  assert.match(view, /goToTask\(task, navigate\)/, 'a notice still opens its task');

  const app = read('src', 'App.jsx');
  assert.match(app, /route\.view === 'inbox'/);

  const shell = read('src', 'components', 'AppShell.jsx');
  assert.ok(!shell.includes('<InboxBell'), 'the topbar was cleared on purpose');
});

test('times read as a person would say them', () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  const ago = (mins) => ({ seconds: (now - mins * 60000) / 1000 });
  assert.equal(noticeWhen(ago(0), now), 'just now');
  assert.equal(noticeWhen(ago(5), now), '5 min ago');
  assert.equal(noticeWhen(ago(120), now), '2 hours ago');
  assert.equal(noticeWhen(ago(60 * 24 * 2), now), '2 days ago');
  assert.equal(noticeWhen(null, now), 'just now', 'a notice the server has not stamped yet');
});

// ─── naming somebody in a comment ───────────────────────────────────────────

const members = ['u-ace', 'u-mia'];
const memberProfiles = {
  'u-ace': { displayName: 'Ace Jorango', email: 'ace@example.com' },
  'u-mia': { displayName: 'Mia Santos', email: 'mia@example.com' },
};

const mountEditor = (value, onChange) => mount(h(MarkdownEditor, {
  value, onChange, mentions: { members, memberProfiles },
}));

/** Put the caret at the end of what is in the box, as typing would. */
const typeAt = async (ui, value) => {
  const area = ui.container.querySelector('textarea');
  area.value = value;
  area.selectionStart = value.length;
  await act(async () => {
    area.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true }));
  });
  return area;
};

const namesShown = (ui) => [...ui.container.querySelectorAll('.mention-choice-name')]
  .map((n) => n.textContent);

test('the editor is unchanged when no mention list is given', async () => {
  const ui = await mount(h(MarkdownEditor, { value: 'hello @a', onChange: () => {} }));
  assert.equal(ui.container.querySelector('.mention-picker'), null);
  ui.unmount();
});

test('typing an @ offers the people you can name', async () => {
  const ui = await mountEditor('', () => {});
  await typeAt(ui, 'hi @');
  assert.deepEqual(namesShown(ui), ['Ace Jorango', 'Mia Santos']);
  ui.unmount();
});

test('the list narrows as the name is typed, and closes when nothing matches', async () => {
  const ui = await mountEditor('', () => {});
  await typeAt(ui, 'hi @mi');
  assert.deepEqual(namesShown(ui), ['Mia Santos']);
  await typeAt(ui, 'hi @zzz');
  assert.equal(ui.container.querySelector('.mention-picker'), null);
  ui.unmount();
});

test('an email address in the text does not open the picker', async () => {
  const ui = await mountEditor('', () => {});
  await typeAt(ui, 'write to ace@');
  assert.equal(ui.container.querySelector('.mention-picker'), null);
  ui.unmount();
});

test('choosing a name puts it in the text, ready to keep typing', async () => {
  let value = 'hi @mi';
  const ui = await mountEditor(value, (v) => { value = v; });
  await typeAt(ui, value);
  const choice = [...ui.container.querySelectorAll('.mention-choice')]
    .find((b) => b.textContent.includes('Mia Santos'));
  assert.ok(choice, 'Mia is not in the list');
  await act(async () => {
    // The picker commits on mousedown, so the textarea never loses focus first.
    choice.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  assert.equal(value, 'hi @mia ');
  ui.unmount();
});

test('the picker is a listbox, so a screen reader announces the options', () => {
  const md = read('src', 'components', 'Markdown.jsx');
  assert.match(md, /role="listbox"/);
  assert.match(md, /aria-label="People you can mention"/);
  assert.match(md, /role="option"/);
  assert.match(md, /aria-selected=\{i === active\}/);
});

test('arrow keys and Enter work, so the mouse is optional', () => {
  const md = read('src', 'components', 'Markdown.jsx');
  assert.match(md, /e\.key === 'ArrowDown'/);
  assert.match(md, /e\.key === 'Enter' \|\| e\.key === 'Tab'/);
  assert.match(md, /e\.key === 'Escape'/);
});

// ─── the surfaces that raise notices ────────────────────────────────────────

test('a comment is posted with the audience, so an @name becomes a notice', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  assert.match(editor, /await addTaskComment\(userId, task, text, \{\s*\n\s*members,\s*\n\s*memberProfiles,\s*\n\s*authorName: memberLabel\(userId, memberProfiles\),/);
  assert.match(editor, /mentions=\{\{ members, memberProfiles, exclude: \[userId\] \}\}/);
  assert.match(editor, /type @ to tell somebody about it/);
});

test('assigning somebody tells them, and only after the save went through', () => {
  const editor = read('src', 'components', 'TaskEditor.jsx');
  const save = editor.slice(editor.indexOf('await updateTask(task.id, updates)'));
  assert.match(save.slice(0, 600), /await notifyAssignment\(\{/);
  assert.match(save.slice(0, 600), /before: task\.assignedTo \|\| \[\]/);
  assert.match(save.slice(0, 600), /after: assignedTo/);
});

test('the automations panel points at the inbox instead of repeating it', () => {
  const section = read('src', 'components', 'AutomationsSection.jsx');
  assert.match(section, /Anyone a rule tells finds it in their inbox/);
  assert.doesNotMatch(section, /subscribeToMyNotifications/);
});
