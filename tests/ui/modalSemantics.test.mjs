// T-0068 / POL-002 — every modal in the app is a real dialog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const dir = path.join(root, 'src', 'components');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'));

// These implement the behaviour themselves rather than using the hook:
//   Dialog.jsx            — it IS the implementation
//   DueTaskAlertModal.jsx — role="alertdialog" (not "dialog"), its own focus
//                           handling and its own describedby; the hook would
//                           override all three.
const SELF_IMPLEMENTED = new Set(['Dialog.jsx', 'DueTaskAlertModal.jsx']);

const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

function modalFiles() {
  return files.filter((f) => read(f).includes('modal-backdrop'));
}

test('there are modals to check', () => {
  assert.ok(modalFiles().length >= 15);
});

test('the self-implemented dialogs really do implement it', () => {
  const alert = read('DueTaskAlertModal.jsx');
  assert.match(alert, /role="alertdialog"/, 'a due alert interrupts — that is not a plain dialog');
  assert.match(alert, /aria-modal="true"/);
  assert.match(alert, /aria-labelledby=\{titleId\}/);
  assert.match(alert, /aria-describedby=\{descId\}/);
  assert.doesNotMatch(alert, /useModalDialog/, 'the hook would override its role and its ref');

  const dialog = fs.readFileSync(path.join(dir, 'Dialog.jsx'), 'utf8');
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
});

test('every modal backdrop uses the hook', () => {
  const offenders = [];
  for (const f of modalFiles()) {
    if (SELF_IMPLEMENTED.has(f)) continue;
    const src = read(f);
    const backdrops = (src.match(/className="modal-backdrop/g) || []).length;
    const wired = (src.match(/\{\.\.\.modal\d?\.backdropProps\}/g) || []).length;
    if (backdrops !== wired) offenders.push(`${f}: ${backdrops} backdrops, ${wired} wired`);
  }
  assert.deepEqual(offenders, [], 'use useModalDialog()');
});

test('every modal panel carries the dialog props', () => {
  const offenders = [];
  for (const f of modalFiles()) {
    if (SELF_IMPLEMENTED.has(f)) continue;
    const src = read(f);
    const backdrops = (src.match(/\{\.\.\.modal\d?\.backdropProps\}/g) || []).length;
    const panels = (src.match(/\{\.\.\.modal\d?\.dialogProps\}/g) || []).length;
    if (backdrops !== panels) offenders.push(`${f}: ${backdrops} backdrops, ${panels} panels`);
  }
  assert.deepEqual(offenders, []);
});

test('every dialog is labelled — by a heading or by an explicit title', () => {
  const offenders = [];
  for (const f of modalFiles()) {
    if (SELF_IMPLEMENTED.has(f)) continue;
    const src = read(f);
    for (const m of src.matchAll(/\{\.\.\.(modal\d?)\.dialogProps\}>/g)) {
      const varName = m[1];
      const labelled = new RegExp(`id=\\{${varName}\\.titleId\\}`).test(src);
      const explicit = new RegExp(`const ${varName} = useModalDialog\\(\\{[^}]*title:`).test(src);
      if (!labelled && !explicit) {
        offenders.push(`${f}: ${varName} has nothing for aria-labelledby to point at`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('no modal is left closing only on a backdrop click', () => {
  const offenders = [];
  for (const f of modalFiles()) {
    if (SELF_IMPLEMENTED.has(f)) continue;
    const src = read(f);
    // The old shape: a backdrop whose onClick is the only way out.
    if (/className="modal-backdrop"\s+onClick=/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'Escape and the focus trap come with the hook');
});

test('no modal re-implements the stopPropagation dance the hook now owns', () => {
  const offenders = [];
  for (const f of modalFiles()) {
    if (SELF_IMPLEMENTED.has(f)) continue;
    const src = read(f);
    for (const m of src.matchAll(/\{\.\.\.modal\d?\.dialogProps\}/g)) {
      const around = src.slice(Math.max(0, m.index - 260), m.index);
      if (/onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(around)) offenders.push(f);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the hook is imported wherever it is used', () => {
  const offenders = [];
  for (const f of files) {
    const src = read(f);
    if (!/useModalDialog\(/.test(src)) continue;
    if (!/from '\.\.\/hooks\/useModalDialog'/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});

test('a modal that must not be dismissed mid-operation says so', () => {
  // CsvImporter and ImportWizard are writing rows; closing mid-import would
  // leave a half-applied import with no way to tell what got in.
  for (const f of ['CsvImporter.jsx', 'ImportWizard.jsx']) {
    assert.match(read(f), /importing \? undefined : onClose/, `${f} can be dismissed mid-import`);
  }
});
