// The theme: deep blue and light blue, on cloud and white (on request — it was
// navy and orange on warm cream). Guards the tokens rather than every rule,
// because every rule reads the tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const css = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');
const all = (re) => [...css.matchAll(re)].map((m) => m[1].toLowerCase());

test('the accent is light blue in all three theme blocks', () => {
  const accents = all(/--c-accent:\s*(#[0-9a-f]{6})/gi);
  assert.equal(accents.length, 3, 'light, the automatic dark and the forced dark');
  assert.deepEqual(accents, ['#2b8bdb', '#3a97e3', '#3a97e3']);
  assert.equal(all(/--m-accent:\s*(#[0-9a-f]{6})/gi).length, 3, 'and the phone app has its own, in all three');
});

test('the neutrals are cloud and white, not warm cream', () => {
  assert.match(css, /--c-bg:\s+#f2f5f9/);
  assert.match(css, /--c-surface:\s+#ffffff/);
  ['#f4ece1', '#faf5ec', '#e6dbc9', '#efe5d5', '#fdfaf4', '#f7f2ea'].forEach((cream) => {
    assert.ok(!css.toLowerCase().includes(cream), `${cream} (the old cream) is back`);
  });
});

test('orange survives only where it means something', () => {
  // "Working on it" is orange on every board, and amber is a warning; neither
  // is the brand, so the rebrand must not have touched them.
  assert.match(css, /--c-st-doing:\s+#e2892e/);
  assert.match(css, /\.m-rail-doing\s+\{ background: var\(--m-orange\); \}/);
  assert.match(css, /\.crumb-live\.is-off \{ color: #f0a94f/, 'offline is still amber');
  // …and nowhere else is the old brand orange written by hand.
  const stray = css.split('\n').filter((l) => /#f0a94f|#ef9a43/i.test(l)
    && !/crumb-chip\.warn|crumb-live\.is-off|--m-orange/.test(l));   // --m-orange* IS the meaning orange
  assert.deepEqual(stray, []);
});
