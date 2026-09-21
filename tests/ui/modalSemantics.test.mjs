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
  // ImportWizard is writing rows; closing mid-import would
  // leave a half-applied import with no way to tell what got in.
  for (const f of ['ImportWizard.jsx']) {
    assert.match(read(f), /importing \? undefined : onClose/, `${f} can be dismissed mid-import`);
  }
});

// ─── Icon-only buttons (T-0069 / POL-002) ───────────────────────────────────

test('every icon-only button says what it does', () => {
  // ✕ ✎ ▶ ↑ ↓ ⎘ mean nothing to a screen reader, and nothing to anyone on a
  // touch device where there is no hover to reveal a title.
  const SYMBOLS = '✕✎▶↑↓⎘×⎙↩✓⚙≡▲▼';
  const pattern = new RegExp(
    `<button\\b((?:[^<>]|\\{[^{}]*\\})*?)>\\s*([${SYMBOLS}])\\s*</button>`, 'gs',
  );
  const offenders = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(pattern)) {
      if (!/aria-label=/.test(m[1])) {
        offenders.push(`${f}: <button>${m[2]}</button>`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('a label matches the title it sits next to, rather than contradicting it', () => {
  const offenders = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/<button\b((?:[^<>]|\{[^{}]*\})*?)>/gs)) {
      const attrs = m[1];
      const title = /title="([^"]+)"/.exec(attrs);
      const label = /aria-label="([^"]+)"/.exec(attrs);
      if (title && label && title[1] !== label[1]) {
        offenders.push(`${f}: title "${title[1]}" vs aria-label "${label[1]}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'two different descriptions of one button');
});

// ─── T-0121 / BUG-033: the glyph must mean what the label says ──────────────
//
// The Task table's column reorder buttons drew ↑ / ↓ and were named "left" and
// "right". The picker is a vertical list; the table it reorders is horizontal.
// The glyph followed the list and the label followed the table.

const ARROW_MEANS = {
  '←': 'left', '→': 'right', '↑': 'up', '↓': 'down',
  '▲': 'up', '▼': 'down', '‹': 'left', '›': 'right',
};
const DIRECTIONS = ['left', 'right', 'up', 'down'];

// An accessible name is almost never a bare string: it is
// `aria-label={`Move ${col.label} left`}`, and the direction word sits AFTER
// the interpolation. A regex that stops at the first `}` reads "Move ${col"
// and finds no direction at all — which is how this guard came within one
// character of passing on the very bug it was written for. Read the whole
// attribute value (one level of nesting is enough for JSX), then drop the
// `${…}` holes and keep the literal words around them.
function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}=(?:"([^"]*)"|\\{((?:[^{}]|\\{[^{}]*\\})*)\\})`);
  const m = re.exec(attrs);
  if (!m) return null;
  return (m[1] ?? m[2]).replace(/\$\{[^{}]*\}/g, ' ').replace(/[`'"]/g, ' ');
}

const directionIn = (text) =>
  DIRECTIONS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(text || ''));

// Every icon-only button whose visible glyph is an arrow, across all of
// src/components — gathered once so a test can also prove it found some.
function arrowButtons() {
  const found = [];
  for (const f of files) {
    for (const m of read(f).matchAll(
      /<button\b((?:[^<>]|\{(?:[^{}]|\{[^{}]*\})*\})*?)>\s*([←→↑↓▲▼‹›])\s*<\/button>/gs,
    )) {
      found.push({ file: f, attrs: m[1], glyph: m[2] });
    }
  }
  return found;
}

test('the arrow-button guard has arrow buttons to look at', () => {
  // Without this, deleting the last arrow button — or breaking the pattern
  // above — turns the check below into a test that can never fail.
  const buttons = arrowButtons();
  assert.ok(buttons.length >= 2, `expected arrow buttons, found ${buttons.length}`);
  assert.ok(
    buttons.some((b) => directionIn(attrValue(b.attrs, 'aria-label'))),
    'expected at least one arrow button whose accessible name names a direction',
  );
});

test('a direction word in a button’s name matches the arrow it draws', () => {
  const offenders = [];
  for (const { file, attrs, glyph } of arrowButtons()) {
    const name = attrValue(attrs, 'aria-label');
    const said = directionIn(name);
    if (!said) continue;                       // the name names no direction
    // If both say a direction, they have to say the same one. Anything else
    // tells a screen-reader user one thing and a sighted user another.
    const means = ARROW_MEANS[glyph];
    if (said !== means) {
      offenders.push(`${file}: "${glyph}" means ${means}, but the name says ${said} — "${name.trim()}"`);
    }
    // The title is what a mouse user gets; it must not disagree either.
    const title = attrValue(attrs, 'title');
    const titleSaid = directionIn(title);
    if (titleSaid && titleSaid !== said) {
      offenders.push(`${file}: the name says ${said}, the tooltip says ${titleSaid}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a screen-reader user and a sighted user must be told the same thing');
});

test('the column picker moves columns along the table, and says so', () => {
  const src = read('TasksTableView.jsx');
  assert.match(src, /aria-label=\{`Move \$\{col\.label\} left`\}\s*\n\s*title=\{`Move \$\{col\.label\} left`\}/,
    'the title must agree with the name');
  assert.match(src, /onClick=\{\(\) => moveColumn\(col\.id, -1\)\}\s*\n\s*>←<\/button>/,
    'left is ←, not ↑');
  assert.match(src, /onClick=\{\(\) => moveColumn\(col\.id, 1\)\}\s*\n\s*>→<\/button>/);
  assert.doesNotMatch(src, />↑<\/button>/);
  assert.doesNotMatch(src, />↓<\/button>/);
});
