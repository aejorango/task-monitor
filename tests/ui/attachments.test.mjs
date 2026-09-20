// T-0073 / IMP-008 — the app stores attachments in the workspace, and removes
// the bytes when the record that referenced them goes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();

const { default: FileUpload } = await import('../../src/components/FileUpload.jsx');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const firebase = read('src', 'services', 'firebase.js');
const rules = read('storage.rules');

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

// ─── where an upload goes ───────────────────────────────────────────────────

test('uploadFile builds its path with the pure module, not by hand', () => {
  assert.match(firebase, /const path = uploadPath\(\{ workspaceId, taskId, scope, filename/);
  assert.doesNotMatch(firebase, /`users\/\$\{userId\}\/\$\{taskId/,
    'the per-uploader path is what made another member unable to delete the file');
});

test('uploadFile takes a workspace, and no longer takes the uploader', () => {
  const signature = /export async function uploadFile\(\{([^}]*)\}\)/.exec(firebase)[1];
  assert.match(signature, /workspaceId/);
  assert.doesNotMatch(signature, /userId/, 'the uploader no longer decides where the file lives');
});

// ─── what happens when the record goes ──────────────────────────────────────

const bodyOf = (name) => {
  const start = firebase.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const next = firebase.indexOf('\nexport ', start + 10);
  return firebase.slice(start, next > 0 ? next : undefined);
};

test('deleting an activity removes its stored files too', () => {
  assert.match(bodyOf('deleteActivity'), /deleteUploads\(attachmentPaths\(activity\)\)/);
});

test('a bulk delete removes every file those activities owned', () => {
  assert.match(bodyOf('bulkDeleteActivities'), /deleteUploads\(attachmentPaths\(activities\)\)/);
});

test('taking an attachment off in the editor removes the bytes, not just the row', () => {
  assert.match(bodyOf('editActivity'),
    /deleteUploads\(orphanedPaths\(oldActivity\.attachments, updates\.attachments\)\)/);
});

test('the cleanup happens after the write, so a stuck file cannot block the delete', () => {
  const body = bodyOf('deleteActivity');
  assert.ok(body.indexOf('batch.commit()') < body.indexOf('deleteUploads'),
    'the record must go even if the bucket refuses');
});

test('deleteUploads swallows a missing object and keeps going', () => {
  assert.match(firebase, /export async function deleteUploads\(paths\)/);
  assert.match(firebase, /Promise\.all\(\(paths \|\| \[\]\)\.map\(\(p\) => deleteUpload\(p\)\)\)/);
  assert.match(firebase, /if \(err\?\.code !== 'storage\/object-not-found'\)/);
});

// ─── the rules that make it possible ────────────────────────────────────────

test('storage rules gate a workspace folder on workspace membership', () => {
  assert.match(rules, /match \/workspaces\/\{workspaceId\}\/\{allPaths=\*\*\}/);
  assert.match(rules, /allow read, write: if isWorkspaceMember\(workspaceId\)/);
  assert.match(rules, /request\.auth\.uid in workspace\(workspaceId\)\.members/);
});

test('the rules check the workspace exists before reading it', () => {
  assert.match(rules, /firestore\.exists\(\/databases\/\(default\)\/documents\/workspaces\/\$\(workspaceId\)\)/);
});

test('the legacy per-user prefix is readable and deletable but frozen', () => {
  const legacy = rules.slice(rules.indexOf('match /users/{uid}'), rules.indexOf('// Nothing else'));
  assert.match(legacy, /allow read, delete: if signedIn\(\) && request\.auth\.uid == uid/);
  assert.match(legacy, /allow write: if false/);
});

test('everything outside those two prefixes is closed', () => {
  assert.match(rules, /match \/\{path=\*\*\} \{\s*allow read, write: if false;/);
});

// ─── the surfaces that upload ───────────────────────────────────────────────

test('the file picker renders and invites a file', async () => {
  const ui = await mount(h(FileUpload, { taskId: 't1', workspaceId: 'ws1', attachments: [], onChange: () => {} }));
  assert.match(text(ui.container), /Drop files here/);
  ui.unmount();
});

test('the file picker says what to do when there is no workspace yet', () => {
  const src = read('src', 'components', 'FileUpload.jsx');
  assert.match(src, /Pick a workspace before attaching a file/);
  assert.match(src, /workspaceId: fileWorkspaceId/);
});

test('an upload failure is put in plain words, not raw SDK text', () => {
  const src = read('src', 'components', 'FileUpload.jsx');
  assert.match(src, /friendlyError\(err, 'That file could not be uploaded\.'\)/);
});

test('both activity screens hand the file the workspace its record belongs to', () => {
  assert.match(read('src', 'components', 'ActivityLogger.jsx'),
    /<FileUpload taskId=\{task\.id\} workspaceId=\{task\.workspaceId\}/);
  assert.match(read('src', 'components', 'ActivityEditor.jsx'),
    /<FileUpload taskId=\{activity\.taskId\} workspaceId=\{activity\.workspaceId\}/);
});

test('a workspace logo goes in that workspace’s own folder', () => {
  const src = read('src', 'components', 'WorkspaceEditor.jsx');
  assert.match(src, /workspaceId: workspace\.id,\s*\n\s*scope: 'logo',/);
});

test('a workspace that does not exist yet says so instead of failing on upload', () => {
  const src = read('src', 'components', 'WorkspaceEditor.jsx');
  assert.match(src, /Create the workspace first, then come back and add a logo/);
  assert.match(src, /disabled=\{uploading \|\| !workspace\?\.id\}/);
});
