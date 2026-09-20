// T-0073 / IMP-008 — an attachment belongs to the workspace, not to whoever
// happened to upload it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachmentPaths, isLegacyPath, orphanedPaths, safeFilename, uploadPath, workspaceOfPath,
} from './uploadPaths.js';

// ─── where a file goes ──────────────────────────────────────────────────────

test('an upload lands under its workspace, in a folder for its task', () => {
  const p = uploadPath({ workspaceId: 'ws1', taskId: 't7', filename: 'report.pdf', now: 1700000000000 });
  assert.equal(p, 'workspaces/ws1/t7/1700000000000-report.pdf');
});

test('an upload with no task yet still belongs to the workspace', () => {
  const p = uploadPath({ workspaceId: 'ws1', taskId: null, filename: 'note.txt', now: 1 });
  assert.equal(p, 'workspaces/ws1/general/1-note.txt');
});

test('a file with no workspace is refused, in words that say why', () => {
  assert.throws(() => uploadPath({ workspaceId: '', filename: 'x.png' }), /needs a workspace/);
  assert.throws(() => uploadPath({ workspaceId: null, filename: 'x.png' }), /manage the file/);
});

test('a hostile filename cannot climb out of its folder', () => {
  const p = uploadPath({ workspaceId: 'ws1', taskId: 't1', filename: '../../etc/passwd', now: 5 });
  assert.equal(p, 'workspaces/ws1/t1/5-etc_passwd');
  assert.equal(p.split('/').length, 4, 'no extra path segments were smuggled in');
});

test('a task id cannot climb out either', () => {
  const p = uploadPath({ workspaceId: 'ws1', taskId: '../other-ws', filename: 'a.txt', now: 5 });
  assert.equal(workspaceOfPath(p), 'ws1');
  assert.equal(p, 'workspaces/ws1/other-ws/5-a.txt');
  assert.doesNotMatch(p, /\.\./, 'no dot-dot segment survives');
});

test('a filename keeps its extension, loses everything unsafe, and stays short', () => {
  assert.equal(safeFilename('Quarterly Report (final).pdf'), 'Quarterly_Report_final_.pdf');
  assert.equal(safeFilename(''), 'file');
  assert.equal(safeFilename(null), 'file');
  assert.ok(safeFilename('a'.repeat(400)).length <= 120);
});

test('the workspace can be read back off the path — that is what the rules check', () => {
  assert.equal(workspaceOfPath('workspaces/ws1/t7/1-a.pdf'), 'ws1');
  assert.equal(workspaceOfPath('users/uid-1/t7/1-a.pdf'), null);
  assert.equal(workspaceOfPath(''), null);
  assert.equal(workspaceOfPath(undefined), null);
});

test('files from before this change are recognised as legacy', () => {
  assert.equal(isLegacyPath('users/uid-1/t7/1-a.pdf'), true);
  assert.equal(isLegacyPath('workspaces/ws1/t7/1-a.pdf'), false);
});

// ─── what to clean up ───────────────────────────────────────────────────────

const att = (path) => ({ name: 'f', url: 'https://x', type: 'file', size: 1, path });

test('deleting an activity gives back every stored file it owned', () => {
  const activity = { attachments: [att('workspaces/ws1/t1/1-a.pdf'), att('workspaces/ws1/t1/2-b.png')] };
  assert.deepEqual(attachmentPaths(activity), [
    'workspaces/ws1/t1/1-a.pdf', 'workspaces/ws1/t1/2-b.png',
  ]);
});

test('a pasted link is not a stored file and is never deleted', () => {
  const activity = { attachments: [{ name: 'Drive doc', url: 'https://drive.google.com/x' }] };
  assert.deepEqual(attachmentPaths(activity), []);
});

test('an activity with no attachments gives back nothing, rather than throwing', () => {
  assert.deepEqual(attachmentPaths({}), []);
  assert.deepEqual(attachmentPaths([]), []);
  assert.deepEqual(attachmentPaths([{ attachments: null }]), []);
});

test('a bulk delete collects across activities and never lists one file twice', () => {
  const shared = att('workspaces/ws1/t1/1-a.pdf');
  const paths = attachmentPaths([
    { attachments: [shared] },
    { attachments: [shared, att('workspaces/ws1/t2/2-b.png')] },
  ]);
  assert.deepEqual(paths, ['workspaces/ws1/t1/1-a.pdf', 'workspaces/ws1/t2/2-b.png']);
});

test('editing an activity orphans the attachment that was taken off it', () => {
  const before = [att('workspaces/ws1/t1/1-a.pdf'), att('workspaces/ws1/t1/2-b.png')];
  const after = [att('workspaces/ws1/t1/2-b.png')];
  assert.deepEqual(orphanedPaths(before, after), ['workspaces/ws1/t1/1-a.pdf']);
});

test('an edit that adds a file orphans nothing', () => {
  const before = [att('workspaces/ws1/t1/1-a.pdf')];
  const after = [att('workspaces/ws1/t1/1-a.pdf'), att('workspaces/ws1/t1/3-c.png')];
  assert.deepEqual(orphanedPaths(before, after), []);
});

test('an edit that did not touch attachments orphans nothing', () => {
  const before = [att('workspaces/ws1/t1/1-a.pdf')];
  assert.deepEqual(orphanedPaths(before, undefined), [],
    'undefined means "not part of this edit", not "all of them were removed"');
});

test('clearing the attachments orphans all of them', () => {
  const before = [att('workspaces/ws1/t1/1-a.pdf'), att('workspaces/ws1/t1/2-b.png')];
  assert.deepEqual(orphanedPaths(before, []), [
    'workspaces/ws1/t1/1-a.pdf', 'workspaces/ws1/t1/2-b.png',
  ]);
});
