// T-0065 / POL-001 — the app must not use the browser's own dialogs.
//
// window.alert/confirm/prompt block the page, cannot be themed for dark mode,
// look like a browser warning on mobile, and give a screen-reader user no
// title and no focus management.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const srcDir = path.join(root, 'src');

function appFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(full);
    }
  };
  walk(srcDir);
  return out;
}

// Dialog.jsx keeps a deliberate fallback for when no provider is mounted.
const ALLOWED = new Set(['src/components/Dialog.jsx']);

const NATIVE = /(^|[^.\w$])(alert|confirm|prompt)\s*\(/;

test('nothing calls alert, confirm or prompt', () => {
  const offenders = [];
  for (const file of appFiles()) {
    const rel = path.relative(root, file);
    if (ALLOWED.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      const code = line.split('//')[0];
      if (NATIVE.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'use useToast() and useDialog() instead');
});

test('the only window.confirm left is the documented fallback', () => {
  const dialog = fs.readFileSync(path.join(root, 'src', 'components', 'Dialog.jsx'), 'utf8');
  const block = dialog.slice(dialog.indexOf('const FALLBACK'));
  assert.match(block, /window\.confirm/);
  assert.match(dialog, /fall back to the browser's own[\s\S]*?dialogs rather than hanging/);
});

test('every confirm asks a question and labels its own action', () => {
  const offenders = [];
  for (const file of appFiles()) {
    const rel = path.relative(root, file);
    if (ALLOWED.has(rel)) continue;      // the doc comment, not a call site
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/ask\.confirm\(\{([^}]*(?:\}[^}]*)??)\}\)/g)) {
      const body = m[1];
      if (!/title:/.test(body)) offenders.push(`${rel}: no title — ${body.slice(0, 60)}`);
      if (!/confirmLabel:/.test(body)) offenders.push(`${rel}: no button label — ${body.slice(0, 60)}`);
      if (/confirmLabel: 'OK'/.test(body)) offenders.push(`${rel}: "OK" says nothing about what happens`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('a destructive confirm is marked as destructive', () => {
  const offenders = [];
  for (const file of appFiles()) {
    if (ALLOWED.has(path.relative(root, file))) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/ask\.confirm\(\{([^}]*(?:\}[^}]*)??)\}\)/g)) {
      const body = m[1];
      const titleMatch = /title: ([^,]+)/.exec(body);
      const title = titleMatch ? titleMatch[1] : '';
      const destructive = /\b(Delete|Remove|Revoke)\b/.test(title);
      if (destructive && !/danger: true/.test(body)) {
        offenders.push(`${path.relative(root, file)}: ${title.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('no confirm crams an explanation into its title with newlines', () => {
  const offenders = [];
  for (const file of appFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/ask\.confirm\(\{ title: ([^,]+),/g)) {
      if (m[1].includes('\\n')) offenders.push(`${path.relative(root, file)}: ${m[1].slice(0, 70)}`);
    }
  }
  assert.deepEqual(offenders, [], 'the explanation goes in `message`');
});

test('no toast shows a raw SDK message', () => {
  const offenders = [];
  for (const file of appFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/toast\.(error|success|info)\((err|e)\.message/.test(line)) {
        offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'wrap it in friendlyError()');
});

test('both providers are mounted, once each', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  assert.equal((app.match(/<ToastProvider>/g) || []).length, 1);
  assert.equal((app.match(/<DialogProvider>/g) || []).length, 1);
});
