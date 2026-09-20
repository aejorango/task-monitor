// T-0082 / NEW-011 — publishing a link, and the page a client opens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();

const { default: SharedViewPage } = await import('../../src/components/SharedViewPage.jsx');
const { buildBars } = await import('../../src/services/shareLinks.js');
const { db } = await import('../../src/services/firebase.js');
const { terminate } = await import('firebase/firestore');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const page = read('src', 'components', 'SharedViewPage.jsx');
const snapshot = read('src', 'components', 'SharedSnapshot.jsx');
const panel = read('src', 'components', 'ShareLinksPanel.jsx');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(async () => {
  quiet?.restore();
  teardownDom();
  // Reading a share link opens a Firestore connection; without this the test
  // process never exits.
  await terminate(db).catch(() => {});
});

// ─── the page a stranger opens ──────────────────────────────────────────────

test('a link that is not available renders without asking anybody to sign in', async () => {
  const ui = await mount(h(SharedViewPage, { token: 'no-such-token' }));
  const shown = text(ui.container);
  assert.doesNotMatch(shown, /Sign in/i);
  assert.doesNotMatch(shown, /Google/i);
  ui.unmount();
});

test('missing, switched off and expired all say the same thing', () => {
  assert.match(page, /This link is not available/);
  assert.match(page, /may have been switched off, or it may have expired/);
  assert.doesNotMatch(page, /revoked</, 'telling a stranger which would confirm the token was real');
});

test('the page says what it is and what it is not', () => {
  assert.match(snapshot, /Shared with you · read only/);
  assert.match(snapshot, /This is a snapshot of one project/);
  assert.match(snapshot, /does not show comments, attachments, hours or who is working on what/);
  assert.match(snapshot, /nothing here can be changed/);
});

test('it says when the snapshot was taken — a client is reading a moment', () => {
  assert.match(snapshot, /As it was on \{niceDate\(snapshot\.generatedAt\)\}/);
});

test('the page reads one document and nothing else', () => {
  const imports = page.split('\n').filter((l) => l.startsWith('import '));
  assert.deepEqual(imports.map((l) => l.split("'")[1]),
    ['react', '../services/firebase', './SharedSnapshot']);
  assert.match(page, /getSharedView\(token\)/);
  for (const file of [page, snapshot]) {
    assert.doesNotMatch(file, /useTasks|useProjects|useWorkspaces|AppShell/,
      'the public page must not pull in the signed-in app');
  }
});

test('a new token never shows the previous project underneath it', () => {
  assert.match(page, /if \(state\.token !== token\) setState\(\{ loading: true, share: null, token \}\);/);
});

// ─── the timeline it draws ──────────────────────────────────────────────────

test('bars are laid out across the window the tasks themselves cover', () => {
  const { start, span, rows } = buildBars([
    { id: 'a', startDate: '2026-09-01', endDate: '2026-09-11' },
    { id: 'b', startDate: '2026-09-11', endDate: '2026-09-21' },
  ]);
  // Dates are local days, so compare the local day rather than the UTC one.
  assert.equal(new Date(start).getDate(), 1);
  assert.equal(new Date(start).getMonth(), 8);
  assert.equal(span, 20);
  assert.equal(Math.round(rows[0].left), 0);
  assert.equal(Math.round(rows[0].width), 50);
  assert.equal(Math.round(rows[1].left), 50);
});

test('a task with one date still gets a bar, not a crash', () => {
  const { rows } = buildBars([{ id: 'a', endDate: '2026-09-11' }]);
  assert.ok(rows[0].width >= 2, 'a single day is still visible');
});

test('a task with no dates is shown as having none, rather than as starting today', () => {
  const { rows } = buildBars([{ id: 'a' }]);
  assert.equal(rows[0].width, null);
  assert.match(snapshot, /No dates yet/);
});

test('no bar can run off the end of its track', () => {
  const { rows } = buildBars([
    { id: 'a', startDate: '2026-09-01', endDate: '2026-09-02' },
    { id: 'b', startDate: '2026-12-01', endDate: '2027-06-01' },
  ]);
  for (const row of rows) assert.ok(row.left + row.width <= 100.01, `${row.task.id} overflows`);
});

test('the board form groups by status, in the order work moves', () => {
  assert.match(snapshot, /const STATUS_ORDER = \['todo', 'doing', 'done'\]/);
  assert.match(snapshot, /share\.kind === 'board' \? \(/);
});

test('an overdue task is marked as such on both forms', () => {
  assert.match(snapshot, /const isLate = \(task\) => task\.status !== 'done' && task\.endDate && task\.endDate < todayIso\(\)/);
  assert.match(snapshot, /isLate\(task\) \? 'shared-late' : ''/);
  assert.match(snapshot, /isLate\(row\.task\) \? 'is-late' : ''/);
});

// ─── publishing one ─────────────────────────────────────────────────────────

test('the panel says what will be visible before anything is published', () => {
  assert.match(panel, /see the tasks, where each one stands and when it is due/);
  assert.match(panel, /<strong>not<\/strong>\{' '\}\s*\n\s*comments, attachments, hours, or who is working on what/);
  assert.match(panel, /they cannot\s*\n\s*change anything/);
});

test('publishing asks first, and the question spells out the consequence', () => {
  assert.match(panel, /const preview = describeShare\(\{/);
  assert.match(panel, /title: 'Publish a read-only link\?'/);
  assert.match(panel, /message: preview/);
  assert.match(panel, /confirmLabel: 'Publish the link'/);
});

test('publishing is admin-only, and a member is told who can', () => {
  assert.match(panel, /const canShare = role === 'owner' \|\| role === 'admin'/);
  assert.match(panel, /A workspace owner or admin can publish a read-only link/);
});

test('turning a link off is marked destructive and says it is immediate', () => {
  assert.match(panel, /title: 'Turn this link off\?'/);
  assert.match(panel, /stop being able to open it, straight away/);
  assert.match(panel, /danger: true/);
});

test('every live link shows how long it has left, and its own URL', () => {
  assert.match(panel, /const status = shareStatus\(link\)/);
  assert.match(panel, /\{status\.text\}/);
  assert.match(panel, /className="mono small share-url">\{url\}/);
});

test('a link can be refreshed, so a stale snapshot is fixable without a new URL', () => {
  assert.match(panel, /refreshShareLink\(link\.id, project, tasks\)/);
  assert.match(panel, /now shows where the project stands today/);
});

test('the panel is honest that a link does not keep up on its own', () => {
  assert.match(panel, /it does not keep up on its own/);
});

test('an unsaved project says so instead of offering a broken button', () => {
  assert.match(panel, /Save the project first, then you can share it/);
});

// ─── wiring ─────────────────────────────────────────────────────────────────

test('the shared page renders before the sign-in gate, which is the point', () => {
  const app = read('src', 'App.jsx');
  const sharedAt = app.indexOf("route.view === 'shared'");
  const gateAt = app.indexOf('if (!ready) {');
  assert.ok(sharedAt > 0 && sharedAt < gateAt, 'the public page must not wait for auth');
  assert.match(app, /<SharedViewPage token=\{route\.projectFilter\} \/>/);
});

test('the panel is in the project editor, where sharing already lives', () => {
  const projects = read('src', 'components', 'ProjectsView.jsx');
  assert.match(projects, /Share with a client/);
  assert.match(projects, /<ShareLinksPanel project=\{project\} tasks=\{tasks\} \/>/);
});

test('the page that fetches and the page that renders are separate files', () => {
  assert.match(page, /import SharedSnapshot from '\.\/SharedSnapshot'/);
  assert.doesNotMatch(snapshot, /getSharedView/, 'rendering must not fetch');
});

test('the public page is code-split, so it costs a client nothing extra', () => {
  const app = read('src', 'App.jsx');
  assert.match(app, /const SharedViewPage\s+= lazy\(\(\) => import\('\.\/components\/SharedViewPage'\)\)/);
});
