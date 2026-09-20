// T-0053 / MISS-004 — minutes must be shareable without a screenshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'src', 'components', 'MinutesView.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');
const card = src.slice(src.indexOf('function MinuteCard'));

test('a minute offers all three ways out: copy, print and export', () => {
  assert.match(card, /Copy as text/);
  assert.match(card, /⎙ Print/);
  assert.match(card, /<ExportButton/);
});

test('copy produces the same document the export does', () => {
  assert.match(card, /toMarkdown\(buildMinutesDocument\(minute, \{ projectName: project\?\.name \}\)\)/,
    'two ways of building the same thing drift apart');
  assert.match(card, /navigator\.clipboard\.writeText/);
});

test('copy confirms it worked', () => {
  assert.match(card, /setCopied\(true\)/);
  assert.match(card, /\{copied \? '✓ Copied'/);
});

test('printing marks the one card and cleans up after itself', () => {
  assert.match(card, /classList\.add\('printing-minute'\)/);
  assert.match(card, /classList\.add\('print-target'\)/);
  assert.match(card, /afterprint/, 'the page must go back to normal afterwards');
  assert.match(card, /setTimeout\(cleanup, 2000\)/, 'Safari does not always fire afterprint');
});

test('the buttons do not also open or close the card', () => {
  const copy = card.slice(card.indexOf('const copyMarkdown'), card.indexOf('const printMinute'));
  assert.match(copy, /e\.stopPropagation\(\)/);
  const print = card.slice(card.indexOf('const printMinute'), card.indexOf('const printMinute') + 800);
  assert.match(print, /e\.stopPropagation\(\)/);
});

test('the print stylesheet hides the app and shows only the minutes', () => {
  const block = css.slice(css.indexOf('body.printing-minute .app-sidebar'));
  assert.match(block, /\.app-sidebar/);
  assert.match(block, /\.app-topbar/);
  assert.match(block, /\.minute-card:not\(\.print-target\)/);
  assert.match(block, /\.minute-card-body \{ display: block/,
    'a collapsed card would print empty');
});

test('the action row itself is not printed', () => {
  assert.match(card, /minute-card-actions no-print/);
  assert.match(css, /\.minute-card-actions \{ display: none; \}/);
});
