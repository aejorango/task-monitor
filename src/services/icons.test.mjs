// T-0056 / MISS-007 — an icon per group, chosen from a list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GROUP_ICON, GROUP_ICONS, iconFor, normalizeIcon, suggestIcon,
} from './icons.js';

test('the set is small enough to choose from and has no duplicates', () => {
  assert.ok(GROUP_ICONS.length >= 16 && GROUP_ICONS.length <= 40);
  assert.equal(new Set(GROUP_ICONS).size, GROUP_ICONS.length);
  assert.ok(GROUP_ICONS.includes(DEFAULT_GROUP_ICON));
});

test('every icon is a single mark that sits next to text', () => {
  for (const icon of GROUP_ICONS) {
    assert.equal([...icon].length, 1, `${icon} is more than one character`);
    assert.doesNotMatch(icon, /\s/);
  }
});

test('anything outside the set is refused', () => {
  assert.equal(normalizeIcon('<script>'), DEFAULT_GROUP_ICON);
  assert.equal(normalizeIcon('AAAA'), DEFAULT_GROUP_ICON);
  assert.equal(normalizeIcon(''), DEFAULT_GROUP_ICON);
  assert.equal(normalizeIcon(null), DEFAULT_GROUP_ICON);
  assert.equal(normalizeIcon(undefined, '★'), '★');
});

test('a real icon passes through, with surrounding space trimmed', () => {
  assert.equal(normalizeIcon('★'), '★');
  assert.equal(normalizeIcon('  ★  '), '★');
});

test('a thing shows its own icon, then its parent’s, then the default', () => {
  assert.equal(iconFor({ icon: '★' }, { icon: '✿' }), '★');
  assert.equal(iconFor({}, { icon: '✿' }), '✿', 'a phase inherits its project’s mark');
  assert.equal(iconFor({}, {}), DEFAULT_GROUP_ICON);
  assert.equal(iconFor(null, null), DEFAULT_GROUP_ICON);
});

test('a junk icon on the child still falls back to the parent', () => {
  assert.equal(iconFor({ icon: 'nonsense' }, { icon: '✿' }), '✿');
});

test('a project with no icon still gets a stable one, so lists stay readable', () => {
  const a = suggestIcon('project-abc');
  assert.ok(GROUP_ICONS.includes(a));
  assert.equal(suggestIcon('project-abc'), a, 'it must not change between renders');
  assert.notEqual(suggestIcon('project-xyz'), undefined);
});

test('different ids mostly get different icons', () => {
  const seen = new Set(Array.from({ length: 24 }, (_, i) => suggestIcon(`p${i}`)));
  assert.ok(seen.size >= 8, `only ${seen.size} distinct icons across 24 projects`);
});

test('no id yields the default rather than an exception', () => {
  assert.equal(suggestIcon(''), DEFAULT_GROUP_ICON);
  assert.equal(suggestIcon(null), DEFAULT_GROUP_ICON);
});
