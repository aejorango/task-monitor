// T-0081 / NEW-011 — a read-only share link: what goes in it, and when it dies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXPIRY_DAYS, EXPIRY_CHOICES, SHARED_TASK_FIELDS, SHARE_KINDS, TOKEN_LENGTH,
  buildShareLink, buildSnapshot, describeShare, expiryFrom, isShareLive, newShareToken,
  shareStatus, shareTask, shareUrl, tokenFromHash,
} from './shareLinks.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 20, 9, 0, 0);

const project = {
  id: 'p1', name: 'SBLAF rollout', color: '#4f7cff',
  phases: [{ id: 'ph1', name: 'Discovery' }, { id: 'ph2', name: 'Build' }],
};

const task = (over = {}) => ({
  id: 't1', projectId: 'p1', phaseId: 'ph1',
  title: 'Disbursement report', status: 'doing', priority: 'high', progress: 40,
  plan: { startDate: '2026-09-14', endDate: '2026-09-18' },
  // Everything below must never reach a snapshot.
  assignedTo: ['u-ace'], requestedBy: 'The board', totalHoursLogged: 12,
  customValues: { f1: 'Acme' }, tags: ['finance'], activityCount: 5,
  ...over,
});

// ─── tokens ─────────────────────────────────────────────────────────────────

test('a token is long, and made only of characters that survive a URL', () => {
  const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => i * 7);
  const token = newShareToken(bytes);
  assert.equal(token.length, TOKEN_LENGTH);
  assert.match(token, /^[0-9a-z]+$/);
});

test('two tokens from different randomness are different', () => {
  const a = newShareToken((n) => Uint8Array.from({ length: n }, () => 1));
  const b = newShareToken((n) => Uint8Array.from({ length: n }, () => 2));
  assert.notEqual(a, b);
});

test('a token can be read back out of the URL it lives in', () => {
  const url = shareUrl('abc123xyz', { origin: 'https://tasks.example.ph', base: '/app/' });
  assert.equal(url, 'https://tasks.example.ph/app/#/shared/abc123xyz');
  assert.equal(tokenFromHash(url), 'abc123xyz');
  assert.equal(tokenFromHash('#/board/all'), null);
  assert.equal(tokenFromHash(''), null);
});

// ─── when a link dies ───────────────────────────────────────────────────────

test('an expiry is a date, or nothing at all when that is what was chosen', () => {
  assert.equal(expiryFrom(30, NOW).getTime(), NOW + 30 * DAY);
  assert.equal(expiryFrom(0, NOW), null);
  assert.equal(expiryFrom('', NOW), null);
  assert.equal(expiryFrom(-5, NOW), null, 'a negative is not a live link');
});

test('the expiry choices include one that never expires, said plainly', () => {
  assert.ok(EXPIRY_CHOICES.some((c) => c.value === 0 && /turn it off/i.test(c.label)));
  assert.ok(EXPIRY_CHOICES.some((c) => c.value === DEFAULT_EXPIRY_DAYS));
});

test('a live link is live; a revoked or expired one is not', () => {
  assert.equal(isShareLive({ revoked: false, expiresAt: new Date(NOW + DAY) }, NOW), true);
  assert.equal(isShareLive({ revoked: false, expiresAt: null }, NOW), true);
  assert.equal(isShareLive({ revoked: true, expiresAt: null }, NOW), false);
  assert.equal(isShareLive({ revoked: false, expiresAt: new Date(NOW - 1) }, NOW), false);
  assert.equal(isShareLive(null, NOW), false);
});

test('a Firestore timestamp is understood as well as a date', () => {
  assert.equal(isShareLive({ revoked: false, expiresAt: { seconds: (NOW + DAY) / 1000 } }, NOW), true);
  assert.equal(isShareLive({ revoked: false, expiresAt: { toMillis: () => NOW - 1 } }, NOW), false);
});

test('a dead link says why, rather than just failing', () => {
  assert.match(shareStatus({ revoked: true }, NOW).text, /was turned off/);
  assert.match(shareStatus({ expiresAt: new Date(NOW - 1) }, NOW).text, /has expired/);
  assert.match(shareStatus(null, NOW).text, /does not exist/);
});

test('a live link says how long it has left', () => {
  assert.match(shareStatus({ expiresAt: new Date(NOW + 10 * DAY) }, NOW).text, /Stops working in 10 days/);
  assert.match(shareStatus({ expiresAt: new Date(NOW + 3600_000) }, NOW).text, /within a day/);
  assert.match(shareStatus({ expiresAt: null }, NOW).text, /until you turn it off/);
});

// ─── what leaves the workspace ──────────────────────────────────────────────

test('a shared task carries what a client needs and nothing else', () => {
  const shared = shareTask(task(), { phaseName: 'Discovery' });
  assert.deepEqual(Object.keys(shared).sort(), [...SHARED_TASK_FIELDS].sort());
  assert.equal(shared.title, 'Disbursement report');
  assert.equal(shared.phase, 'Discovery');
  assert.equal(shared.endDate, '2026-09-18');
});

test('nothing private is smuggled through: no people, no hours, no notes', () => {
  const shared = shareTask(task());
  for (const leak of ['assignedTo', 'requestedBy', 'totalHoursLogged', 'customValues', 'tags', 'activityCount', 'userId', 'workspaceId']) {
    assert.equal(leak in shared, false, `${leak} must not leave the workspace`);
  }
});

test('a done task reads as finished, whatever its progress number says', () => {
  assert.equal(shareTask(task({ status: 'done', progress: 10 })).progress, 100);
});

test('a task with no dates is shown with none, not with today’s', () => {
  const shared = shareTask(task({ plan: {} }));
  assert.equal(shared.startDate, null);
  assert.equal(shared.endDate, null);
});

// ─── the snapshot ───────────────────────────────────────────────────────────

const tasks = [
  task({ id: 'a', plan: { endDate: '2026-09-25' } }),
  task({ id: 'b', title: 'Board pack', plan: { endDate: '2026-09-18' } }),
  task({ id: 'c', title: 'Done thing', status: 'done', plan: { endDate: '2026-09-10' } }),
  task({ id: 'd', title: 'Late thing', plan: { endDate: '2026-09-01' } }),
  task({ id: 'x', title: 'Deleted', deleted: true }),
  task({ id: 'y', title: 'Archived', archived: true }),
  task({ id: 'z', title: 'Another project', projectId: 'p2' }),
];

test('the snapshot holds this project’s live tasks, soonest first', () => {
  const snap = buildSnapshot(project, tasks, { now: new Date(NOW) });
  assert.deepEqual(snap.tasks.map((t) => t.id), ['d', 'c', 'b', 'a']);
});

test('deleted, archived and other projects’ tasks never reach it', () => {
  const ids = buildSnapshot(project, tasks, { now: new Date(NOW) }).tasks.map((t) => t.id);
  for (const gone of ['x', 'y', 'z']) assert.ok(!ids.includes(gone), `${gone} leaked`);
});

test('the snapshot counts what it holds, so the page needs no arithmetic', () => {
  const snap = buildSnapshot(project, tasks, { now: new Date(NOW) });
  assert.equal(snap.counts.total, 4);
  assert.equal(snap.counts.done, 1);
  assert.equal(snap.counts.overdue, 2, '"b" (18 Sep) and "d" (1 Sep) are both unfinished and past');
});

test('the phases come with it, so a board can be grouped without the project', () => {
  const snap = buildSnapshot(project, tasks, { now: new Date(NOW) });
  assert.deepEqual(snap.phases, [{ id: 'ph1', name: 'Discovery' }, { id: 'ph2', name: 'Build' }]);
  assert.equal(snap.tasks[0].phase, 'Discovery');
});

test('the snapshot says when it was taken — a client is reading a moment, not a feed', () => {
  const snap = buildSnapshot(project, tasks, { now: new Date(NOW) });
  assert.equal(snap.generatedAt, new Date(NOW).toISOString());
});

test('a project with nothing in it still makes a valid snapshot', () => {
  const snap = buildSnapshot({ id: 'p9', name: 'Empty' }, [], { now: new Date(NOW) });
  assert.deepEqual(snap.tasks, []);
  assert.deepEqual(snap.phases, []);
  assert.equal(snap.counts.total, 0);
});

// ─── the document ───────────────────────────────────────────────────────────

const link = (over = {}) => buildShareLink({
  token: 'tok123', workspaceId: 'ws1', project, tasks,
  kind: 'gantt', createdByUserId: 'u-ace', createdByName: 'Ace Jorango',
  now: NOW, ...over,
});

test('the document carries the snapshot, not a pointer to the live data', () => {
  const doc = link();
  assert.equal(doc.token, 'tok123');
  assert.equal(doc.workspaceId, 'ws1');
  assert.equal(doc.projectId, 'p1');
  assert.equal(doc.revoked, false);
  assert.equal(doc.expiresAt.getTime(), NOW + DEFAULT_EXPIRY_DAYS * DAY);
  assert.equal(doc.snapshot.tasks.length, 4);
});

test('a link is born live — never already revoked or already expired', () => {
  assert.equal(isShareLive(link(), NOW), true);
  assert.equal(isShareLive(link({ expiryDays: 0 }), NOW), true);
});

test('a link without a workspace, a publisher or a token is refused', () => {
  assert.throws(() => link({ token: '' }), /needs a token/);
  assert.throws(() => link({ workspaceId: '' }), /belongs to a workspace/);
  assert.throws(() => link({ createdByUserId: '' }), /records who published it/);
  assert.throws(() => link({ kind: 'everything' }), /Unknown share kind/);
});

test('only the two kinds the app can actually render are offered', () => {
  assert.deepEqual(SHARE_KINDS.map((k) => k.value), ['board', 'gantt']);
  for (const k of SHARE_KINDS) assert.match(k.label, /—/, 'each kind explains itself');
});

test('the person publishing it is told exactly what they are handing out', () => {
  const text = describeShare(link());
  assert.match(text, /Anyone with this link can see the timeline/);
  assert.match(text, /“SBLAF rollout”/);
  assert.match(text, /4 tasks/);
  assert.match(text, /cannot see comments, attachments, hours, or who is on what/);
  assert.match(text, /cannot change anything/);
});
