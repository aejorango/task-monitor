// T-0015 / BUG-007 — every export in the app goes through one helper, and the
// file the browser is handed is stamped with the user's own day.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupDom, teardownDom } from './dom.mjs';

const window = setupDom();

// jsdom has no Blob URL plumbing; record what the helper asks for.
const revoked = [];
let lastUrl = null;
let urlSeq = 0;
window.URL.createObjectURL = (blob) => { lastUrl = `blob:mock/${++urlSeq}/${blob.size}`; return lastUrl; };
window.URL.revokeObjectURL = (url) => revoked.push(url);
globalThis.URL.createObjectURL = window.URL.createObjectURL;
globalThis.URL.revokeObjectURL = window.URL.revokeObjectURL;
globalThis.Blob = window.Blob;

const { downloadFile } = await import('../../src/services/download.js');
const { todayLocal } = await import('../../src/services/recurrence.js');

const clicks = [];
before(() => {
  window.HTMLAnchorElement.prototype.click = function click() {
    clicks.push({ download: this.download, href: this.href });
  };
});
after(() => teardownDom());

test('the browser is handed a date-stamped filename', () => {
  const name = downloadFile('task-monitor-activities', 'csv', 'a,b\n1,2');
  assert.equal(name, `task-monitor-activities-${todayLocal()}.csv`);
  assert.equal(clicks.at(-1).download, name);
});

test('a project name is made safe on the way into the filename', () => {
  const name = downloadFile('Q3 Report: Sales/Marketing-activities', 'csv', 'x');
  assert.equal(name, `Q3-Report-Sales-Marketing-activities-${todayLocal()}.csv`);
  assert.doesNotMatch(name, /[/:\s]/);
});

test('the anchor is removed again so the page is not littered', () => {
  downloadFile('x', 'csv', 'y');
  assert.equal(document.querySelectorAll('a[download]').length, 0);
});

test('the object URL is released, but not before the click', async () => {
  downloadFile('release-me', 'csv', 'y');
  const mine = lastUrl;
  assert.ok(!revoked.includes(mine), 'revoking synchronously cancels the download in some browsers');
  await new Promise((r) => setTimeout(r, 1100));
  assert.ok(revoked.includes(mine), 'the URL must be released once the click has been handled');
});

test('a Blob is passed through unchanged', () => {
  const blob = new window.Blob(['%PDF-1.4'], { type: 'application/pdf' });
  const name = downloadFile('report', 'pdf', blob);
  assert.ok(name.endsWith('.pdf'));
});

// ─── regression guard ───────────────────────────────────────────────────────

test('no component builds a download filename from the UTC date any more', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', 'src');
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const line of src.split('\n')) {
        // The bug's exact shape: a filename built from an ISO (UTC) date.
        if (/(download|filename|fileName)\s*[=:].*toISOString\(\)/.test(line)) {
          offenders.push(`${path.relative(root, full)}: ${line.trim()}`);
        }
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], 'use downloadFile()/stampedName() from services/download.js');
});

test('every export goes through downloadFile rather than its own anchor', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      if (full.endsWith(path.join('services', 'download.js'))) continue;  // the helper itself
      const src = fs.readFileSync(full, 'utf8');
      // `a.download = …` anywhere else means a second, unstamped code path.
      if (/\.download\s*=/.test(src)) offenders.push(path.relative(root, full));
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], 'import { downloadFile } from services/download.js instead');
});
