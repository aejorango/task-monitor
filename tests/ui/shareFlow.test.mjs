// T-0083 / NEW-011 — the acceptance path, end to end.
//
//   1. Given a share link
//   2. When opened signed-out
//   3. Then the Gantt renders read-only
//
// The document is built exactly as firebase.js builds it, then rendered by the
// real page with nobody signed in. The last group is the one that matters most:
// what a leaked link does NOT contain.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();

const { default: SharedSnapshot } = await import('../../src/components/SharedSnapshot.jsx');
const {
  buildShareLink, isShareLive, shareUrl, tokenFromHash,
} = await import('../../src/services/shareLinks.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const project = {
  id: 'p1', name: 'SBLAF rollout', color: '#4f7cff',
  phases: [{ id: 'ph1', name: 'Discovery' }, { id: 'ph2', name: 'Build' }],
};

/** Tasks carrying every private field the app has, to prove none of it travels. */
const tasks = [
  {
    id: 'a', projectId: 'p1', phaseId: 'ph1', title: 'Requirements workshop',
    status: 'done', priority: 'high', progress: 100,
    plan: { startDate: '2026-09-01', endDate: '2026-09-05' },
    assignedTo: ['u-ace'], assignedToExternal: ['A contractor'],
    requestedBy: 'The board', totalHoursLogged: 22, activityCount: 9,
    tags: ['confidential'], customValues: { f1: 'Acme Holdings' },
    description: 'Internal: the client is unhappy about the fee.',
    links: [{ url: 'https://drive.example/secret' }],
    userId: 'u-ace', workspaceId: 'ws1',
  },
  {
    id: 'b', projectId: 'p1', phaseId: 'ph2', title: 'Build the intake form',
    status: 'doing', priority: 'medium', progress: 15,
    plan: { startDate: '2026-09-15', endDate: '2026-10-02' },
    assignedTo: ['u-mia'], totalHoursLogged: 3,
  },
  { id: 'x', projectId: 'p1', title: 'Deleted thing', deleted: true, plan: {} },
  { id: 'z', projectId: 'p2', title: 'Another project entirely', plan: {} },
];

const NOW = Date.UTC(2026, 8, 20, 9, 0, 0);
// A realistic token: the length the app actually generates.
const TOKEN = 'k3m9x7qp2rvt5wz8bn4hj6dc0f';

const link = (over = {}) => ({
  id: TOKEN,
  ...buildShareLink({
    token: TOKEN, workspaceId: 'ws1', project, tasks, kind: 'gantt',
    createdByUserId: 'u-ace', createdByName: 'Ace Jorango', expiryDays: 30, now: NOW,
    ...over,
  }),
});

// ─── step 1: the link ───────────────────────────────────────────────────────

test('a published link is live, and its URL carries the token it was made with', () => {
  const share = link();
  assert.equal(isShareLive(share, NOW), true);
  const url = shareUrl(share.token, { origin: 'https://tasks.blueinnovation.ph', base: '/' });
  assert.equal(tokenFromHash(url), TOKEN);
});

// ─── step 2 and 3: opened signed-out, it renders read-only ──────────────────

test('the timeline renders, with the project and what is on it', async () => {
  const ui = await mount(h(SharedSnapshot, { share: link() }));
  const shown = text(ui.container);
  assert.match(shown, /SBLAF rollout/);
  assert.match(shown, /Requirements workshop/);
  assert.match(shown, /Build the intake form/);
  assert.match(shown, /2 tasks · 1 finished/);
  assert.equal(ui.container.querySelectorAll('.shared-bar').length, 2);
  ui.unmount();
});

test('it is read-only: nothing to press, nothing to type, nobody to sign in as', async () => {
  const ui = await mount(h(SharedSnapshot, { share: link() }));
  assert.equal(ui.container.querySelectorAll('button').length, 0);
  assert.equal(ui.container.querySelectorAll('input, textarea, select').length, 0);
  assert.equal(ui.container.querySelectorAll('a').length, 0, 'no way back into the app');
  assert.doesNotMatch(text(ui.container), /sign in/i);
  ui.unmount();
});

test('it says it is a snapshot, and when it was taken', async () => {
  const ui = await mount(h(SharedSnapshot, { share: link() }));
  const shown = text(ui.container);
  assert.match(shown, /Shared with you · read only/);
  assert.match(shown, /As it was on 20 September 2026|As it was on September 20, 2026/);
  assert.match(shown, /snapshot of one project/);
  ui.unmount();
});

test('the board form renders the same snapshot as three columns', async () => {
  const ui = await mount(h(SharedSnapshot, { share: link({ kind: 'board' }) }));
  const shown = text(ui.container);
  assert.match(shown, /To do/);
  assert.match(shown, /In progress/);
  assert.match(shown, /Done/);
  assert.match(shown, /Requirements workshop/);
  ui.unmount();
});

// ─── what a leaked link does not contain ────────────────────────────────────

test('nothing private is in the document, so nothing private can be rendered', () => {
  const serialised = JSON.stringify(link());
  for (const secret of [
    'u-mia', 'A contractor', 'The board', 'Acme Holdings',
    'confidential', 'the client is unhappy', 'drive.example',
  ]) {
    assert.ok(!serialised.includes(secret), `“${secret}” left the workspace`);
  }
});

test('the two things that DO travel are the publisher’s own name and id', () => {
  // Deliberate, and the only identities in the document: the client is told who
  // shared it with them, and firestore.rules needs the id to stop a link being
  // reassigned to somebody else. Nobody else on the project is named at all.
  const doc = link();
  assert.equal(doc.createdByName, 'Ace Jorango');
  assert.equal(doc.createdByUserId, 'u-ace');
  const inSnapshot = JSON.stringify(doc.snapshot);
  assert.ok(!inSnapshot.includes('u-ace'), 'no identity belongs in the snapshot itself');
  assert.ok(!inSnapshot.includes('Ace Jorango'));
});

test('no counters, no hours, no activity travel with it either', () => {
  const serialised = JSON.stringify(link());
  for (const field of ['totalHoursLogged', 'activityCount', 'assignedTo', 'customValues', 'description', 'links', 'userId']) {
    assert.ok(!serialised.includes(field), `${field} left the workspace`);
  }
});

test('a deleted task and another project’s task are not in it', () => {
  const ids = link().snapshot.tasks.map((t) => t.id);
  assert.deepEqual(ids, ['a', 'b']);
});

test('a page rendered from it cannot show what is not there', async () => {
  const ui = await mount(h(SharedSnapshot, { share: link() }));
  const shown = text(ui.container);
  for (const secret of ['Acme Holdings', 'confidential', 'A contractor', 'The board', 'unhappy']) {
    assert.doesNotMatch(shown, new RegExp(secret), `“${secret}” reached the page`);
  }
  // The person who shared it is named — that is the one identity on the page.
  assert.match(shown, /Shared by Ace Jorango/);
  ui.unmount();
});

// ─── and when it stops ──────────────────────────────────────────────────────

test('a revoked or expired link is not live, by the same rule the server applies', () => {
  assert.equal(isShareLive({ ...link(), revoked: true }, NOW), false);
  assert.equal(isShareLive(link({ expiryDays: 1 }), NOW + 2 * 86400000), false);
});

// ─── docs ───────────────────────────────────────────────────────────────────

test('the README explains sharing, including what it never shows', () => {
  const readme = read('README.md');
  assert.match(readme, /## Sharing a project with a client/);
  assert.match(readme, /It is a snapshot, not a window/);
  assert.match(readme, /\*\*What it never shows:\*\* comments, attachments, hours/);
  assert.match(readme, /It can be switched off/);
  assert.match(readme, /Deploy the rules\nwith `npm run deploy:rules` before the first link will open/);
});

test('the README lists the new suites and the harness', () => {
  const readme = read('README.md');
  assert.match(readme, /`src\/services\/shareLinks\.test\.mjs`/);
  assert.match(readme, /`tests\/ui\/shareLinks\.test\.mjs`/);
  assert.match(readme, /`tests\/ui\/shareLinksApi\.test\.mjs`/);
  assert.match(readme, /`\/dev\/shared\.html`/);
});

test('CLAUDE.md records the schema and the three traps', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /sharedViews\/\{token\}/);
  assert.match(claude, /the ONE world-readable document/);
  assert.match(claude, /Making a share link a window instead of a snapshot/);
  assert.match(claude, /Enforcing a link's expiry in the page/);
  assert.match(claude, /Putting the shared page behind the auth gate/);
  assert.match(claude, /shareLinks\.js\s+← the read-only snapshot a client outside can open/);
});

test('the changelog records both halves', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /T-0081 — Read-only share links for a board or Gantt \(API\/data layer\)/);
  assert.match(changelog, /T-0082 — Read-only share links for a board or Gantt \(UI\)/);
});
