// Minutes ported from "Minutes Redesign.dc.html": the project list and the
// card. These pin the mockup's own numbers and the things the port must not
// lose on the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'src', 'components', 'MinutesView.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');
const card = src.slice(src.indexOf('function MinuteCard'), src.indexOf('function MinuteEditor'));

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\n)${esc}\\s*\\{`).exec(css);
  assert.ok(m, `${selector} has no rule`);
  return css.slice(m.index, css.indexOf('}', m.index));
}

test('the expanded card is two rows, as the mockup draws it', () => {
  assert.match(rule('.minute-top'), /grid-template-columns: minmax\(0, 0\.8fr\) minmax\(0, 1\.4fr\) minmax\(0, 1fr\) auto/);
  assert.match(rule('.minute-bottom.has-both'), /minmax\(0, 1\.35fr\) minmax\(0, 1fr\)/);
  assert.match(rule('.minute-bottom'), /border-top: 1px solid var\(--c-line\)/);
});

test('the mockup\'s metrics survive', () => {
  assert.match(rule('.minute-card'), /border-radius: 20px/);
  assert.match(rule('.minute-card-head'), /padding: 18px 22px/);
  assert.match(rule('.minute-card-head'), /border-left: 4px solid var\(--minute-accent/);
  assert.match(rule('.minute-card-title'), /font-size: 17px/);
  assert.match(rule('.minute-action'), /padding: 10px 14px/);
  assert.match(rule('.minute-sq'), /width: 26px/);
  assert.match(rule('.minutes-layout'), /236px minmax\(0, 1fr\)/);
  assert.match(rule('.minutes-nav-link'), /padding: 9px 12px/);
});

test('the selected project stays navy in dark mode', () => {
  // --c-text inverts to near-white in dark mode; the chrome navy does not.
  assert.match(rule('.minutes-nav-link.active,\n.minutes-nav-link.active:hover'), /var\(--c-te-nav\)/);
});

test('every Attendees / Notes / Decisions column is drawn, empty or not', () => {
  for (const label of ['Attendees', 'Notes', 'Decisions']) {
    assert.match(card, new RegExp(`<MinuteSection label="${label}"`));
  }
});

test('nothing the old card could do was dropped', () => {
  assert.match(card, /onClick=\{onEdit\}/, 'Edit');
  assert.match(card, /createTaskFromItem\(it\)/, 'add an action item as a task');
  assert.match(card, /deleteTaskForItem\(it\)/, 'delete the linked task');
  assert.match(card, /setEditingTask\(linked\)/, 'open the linked task');
  assert.match(card, /<ExportButton/, 'export');
});

test('the add-as-task square is not hidden until hover', () => {
  assert.doesNotMatch(css, /\.minute-action-add[^{]*\{[^}]*opacity: 0/);
  assert.doesNotMatch(rule('.minute-sq-add'), /opacity: 0/);
});

test('an overdue open action item reads red; a done one never does', () => {
  assert.match(card, /const late = !it\.done && it\.due && it\.due < today/);
});

test('the old card markup is gone', () => {
  for (const cls of ['minute-card-actions', 'minute-body-main', 'minute-body-side', 'minute-card-side',
    'minute-action-open', 'minute-action-add', 'minutes-nav-link-all']) {
    assert.ok(!src.includes(cls), `${cls} is back in MinutesView.jsx`);
    assert.ok(!css.includes(`.${cls}`), `.${cls} is back in App.css`);
  }
});
