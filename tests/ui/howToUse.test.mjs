// T-0156 — Dashboard → How to use, rebuilt to `Dashboard Explorer.dc.html`.
//
// The four things that go wrong with a port all look fine in a screenshot:
//
//   1. the old markup is left behind and two designs ship at once;
//   2. a metric drifts — 9.5px becomes 10px — and the page stops being the
//      mockup while still looking roughly like it;
//   3. the panel prints something the app cannot do, because the mockup drew
//      it. This one is the real hazard on a HOW-TO page: a shortcut card is
//      read as a promise, and every key on it that does nothing costs the
//      reader their trust in the rest of the page;
//   4. content is deleted to match a screenshot that had no room for it.
//
// The numbers asserted here are the mockup's OWN, copied from the style
// objects in its <script type="text/x-dc"> block, not measured off a picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'App.css');
const view = read('src', 'components', 'HowToUseView.jsx');

/* ── 1. the old page is gone ───────────────────────────────────────────── */

// The long-form playbook was a TOC rail beside ten `.review-section`s under a
// hero carrying its own <h1>. All of that went; only `.htu-section` stayed,
// and only because Settings, Knowledge and Automations wear it.
const RETIRED = [
  '.htu-hero-title', '.htu-hero-subtitle', '.htu-layout', '.htu-toc',
  '.htu-toc-label', '.htu-toc-link', '.htu-content', '.htu-lede',
  '.htu-overview-grid', '.htu-callout', '.htu-hierarchy', '.htu-hier-row',
  '.htu-hier-dot', '.htu-hier-arrow', '.htu-views-grid', '.htu-view-card',
  '.htu-concept-card', '.htu-concept-header', '.htu-concept-oneline',
  '.htu-decision', '.htu-decision-step', '.htu-scenario', '.htu-workflows',
  '.htu-workflow', '.htu-principle', '.htu-antipattern', '.htu-glossary',
  '.htu-twocol-pane', '.htu-pane-label', '.htu-example', '.htu-ap-icon',
];

test('the classes the old playbook was built from are gone from the stylesheet', () => {
  const alive = RETIRED.filter((cls) => new RegExp(`^\\${cls}(\\s|\\{|,|\\.|:)`, 'm').test(css));
  assert.deepEqual(alive, [],
    'two designs shipping at once is the failure this whole file is about');
});

test('…and nothing renders them either', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsx'))) {
    const src = read('src', 'components', f);
    for (const cls of ['htu-toc', 'htu-layout', 'htu-content', 'htu-hier', 'htu-callout',
                       'htu-hero-title', 'htu-decision', 'htu-scenario"', 'htu-glossary']) {
      if (src.includes(cls)) offenders.push(`${f} → ${cls}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('.htu-section survives — Settings, Knowledge and Automations all wear it', () => {
  assert.match(css, /^\.htu-section \{/m,
    'deleting it with the old page would have re-spaced fifteen Settings blocks');
  const settings = read('src', 'components', 'SettingsView.jsx');
  assert.ok(settings.includes('htu-section'), 'the borrower is still there');
});

test('the page no longer writes a title of its own — the chrome draws it', () => {
  assert.ok(!/<h1/.test(view), 'an <h1> here puts the page name on screen twice');
  assert.ok(!view.includes('page-header') && !view.includes('page-title'));
  assert.ok(view.includes('<PageSubtitle>'), 'the count line goes through the portal');
});

/* ── 2. the mockup's own metrics ───────────────────────────────────────── */

const METRICS = [
  // hero: padding:18px 22px, radius 16, 9.5px/.11em eyebrow, 20px display line
  ['.htu-hero', /padding: 18px 22px/],
  ['.htu-hero', /border-radius: 16px/],
  ['.htu-hero-eyebrow', /font-size: 9\.5px/],
  ['.htu-hero-eyebrow', /letter-spacing: 0\.11em/],
  ['.htu-hero-line', /font-size: 20px/],
  ['.htu-hero-line', /letter-spacing: -0\.015em/],
  // the glow: right:-40px; top:-70px; 190px circle
  ['.htu-hero-glow', /width: 190px/],
  ['.htu-hero-glow', /top: -70px/],
  // the card and its uppercase label
  ['.htu-card', /padding: 16px 18px/],
  ['.htu-lbl', /font-size: 9\.5px/],
  ['.htu-lbl', /letter-spacing: 0\.08em/],
  // the nesting: 14 / 12 / 10 radii, 11px padding, 9px badges
  ['.htu-nest-ws', /border-radius: 14px/],
  ['.htu-nest-proj', /border-radius: 12px/],
  ['.htu-nest-item', /border-radius: 10px/],
  ['.htu-nest-badge', /font-size: 9px/],
  ['.htu-nest-tick', /width: 16px/],
  // the loop: a 25px numeral in an 8px square, 12.5px title, 10px mono path
  ['.htu-loop-num', /width: 25px/],
  ['.htu-loop-num', /border-radius: 8px/],
  ['.htu-loop-title', /font-size: 12\.5px/],
  ['.htu-loop-where', /font-size: 10px/],
  ['.htu-loop-arrow', /width: 16px/],
  // status pill at 96px, so five sentences start on one line
  ['.htu-status-pill', /min-width: 96px/],
  ['.htu-status-when', /font-size: 12px/],
  // keycap at 54px
  ['.htu-keycap', /min-width: 54px/],
  ['.htu-keycap', /font-size: 10px/],
];

for (const [cls, re] of METRICS) {
  test(`${cls} keeps the mockup's ${re.source.replace(/\\/g, '')}`, () => {
    const m = css.match(new RegExp(`^\\${cls} \\{[^}]*\\}`, 'm'));
    assert.ok(m, `${cls} is not in the stylesheet`);
    assert.match(m[0], re);
  });
}

test('the status chips are the board\'s own fills, not a second set', () => {
  assert.ok(view.includes('bx-st st-'),
    'a hand-rolled pill here is a sixth surface free to disagree with the card');
});

/* ── 3. nothing on the page is invented ────────────────────────────────── */

// The mockup lists N, L, "G then B", "G then R" and "?" — none of which this
// app has. A shortcut card that lies is worse than no shortcut card.
test('the shortcuts panel lists only keys the app actually handles', () => {
  const shell = read('src', 'components', 'AppShell.jsx');
  const alert = read('src', 'components', 'DueTaskAlertModal.jsx');

  const block = view.slice(view.indexOf('const SHORTCUTS'), view.indexOf('const SHORTCUTS') + 700);
  assert.ok(block.includes("'⌘K'") || block.includes('⌘K'));
  assert.match(shell, /key\.toLowerCase\(\) === 'k'/, '⌘K is really handled');
  assert.match(shell, /e\.key === 'ArrowDown'/, 'the arrows really move the highlight');
  assert.match(alert, /e\.key === 'd' \|\| e\.key === 'D'/, 'D really marks done');
  assert.match(alert, /e\.key === 's' \|\| e\.key === 'S'/, 'S really skips');

  // Scoped to the SHORTCUTS array — the file's header names these keys in
  // prose precisely to explain why they are not in it.
  for (const invented of ["{ k: 'N'", "{ k: 'L'", "'G then B'", "'G then R'", "{ k: '?'"]) {
    assert.ok(!block.includes(invented), `the mockup's ${invented} does not exist in this app`);
  }
});

test('the loop points at pages that exist', () => {
  const views = read('src', 'services', 'views.js');
  for (const id of ['dashboard', 'board', 'analytics', 'review']) {
    assert.ok(view.includes(`view: '${id}'`), `the loop names ${id}`);
    assert.ok(views.includes(`'${id}'`), `${id} is in the registry`);
  }
});

test('the data model draws the reader\'s own row, and says when it cannot', () => {
  assert.ok(view.includes('modelExample'), 'the panel is wired, not hardcoded');
  assert.ok(view.includes('real: true') && view.includes('real: false'));
  assert.match(view, /your most recent entry/);
  assert.match(view, /nothing logged yet — the activity row is an example/,
    'a fabrication passed off as a reading is the one thing this panel must not do');
  assert.ok(view.includes('{model.note}'), 'and the head prints which it is');
});

test('Stuck is named as computed, not as a fifth column', () => {
  assert.ok(view.includes("import { STATUS_TEXT } from '../services/boardScope'"),
    'the four column names come from the one definition');
  assert.match(view, /past its plan date/, 'the guide says what Stuck actually means here');
  assert.match(view, /Four of those are the board's columns/,
    'and that the fifth is not one');
});

test('the tutorial button really starts the tour', () => {
  assert.ok(view.includes('startTutorial'), 'it fires the app-wide event');
  const guide = read('src', 'services', 'tutorials.js');
  assert.match(guide, /export function startTutorial/);
});

/* ── 4. the long answers were re-homed, not deleted ────────────────────── */

test('everything the mockup had no room for is still on the page', () => {
  for (const kept of ['DECISION_TREE', 'CONCEPTS', 'SCENARIOS', 'WORKFLOWS',
                      'VIEWS_GUIDE', 'PRINCIPLES', 'ANTIPATTERNS', 'GLOSSARY']) {
    assert.ok(view.includes(`const ${kept} =`), `${kept} was dropped`);
    assert.ok(view.includes(`{${kept}.map`), `${kept} is defined but never rendered`);
  }
});

test('the folds are real disclosure widgets, closed by default', () => {
  assert.match(view, /<details className="bx-panel htu-card htu-fold">/,
    '<details> gives Enter, Space and the disclosure role for free');
  assert.ok(!view.includes('<details open'), 'eight open panels is the wall of text this replaces');
});

/* ── 5. the things the harness has actually caught before ──────────────── */

test('no grid track can push a horizontal scrollbar onto a phone', () => {
  const pair = css.match(/^\.htu-pair \{[^}]*\}/m)[0];
  assert.match(pair, /minmax\(0, 1\.25fr\) minmax\(0, 1fr\)/,
    "a bare fr's floor is its min-content — that is a scrollbar on the whole shell");
});

test('the loop numeral does not go white-on-white in dark mode', () => {
  for (const cls of ['.htu-loop-num', '.htu-step-n']) {
    const rule = css.match(new RegExp(`^\\${cls} \\{[^}]*\\}`, 'm'))[0];
    assert.match(rule, /background: var\(--c-text\)/);
    assert.match(rule, /color: var\(--c-bg\)/,
      'color:#fff on --c-text inverts to white on white');
  }
});

test('text on a soft tint uses an ink token, never the fill', () => {
  for (const cls of ['.htu-nest-hours', '.htu-case-verdict', '.htu-loop-where']) {
    const rule = css.match(new RegExp(`^\\${cls} \\{[^}]*\\}`, 'm'))[0];
    assert.match(rule, /color: var\(--c-[a-z]+-ink\)/, `${cls} must use an ink token`);
  }
});

test('every new token is defined in all three theme blocks', () => {
  const TOKENS = ['--c-hero-from', '--c-hero-to', '--c-hero-glow', '--c-hero-eyebrow',
                  '--c-cta', '--c-nest-ws-bg', '--c-nest-ws-line', '--c-nest-ws-ink',
                  '--c-nest-ws-name', '--c-nest-proj-bg', '--c-nest-proj-line',
                  '--c-nest-proj-ink', '--c-line-dash', '--c-arrow-faint'];
  for (const t of TOKENS) {
    const n = (css.match(new RegExp(`${t}:`, 'g')) || []).length;
    assert.equal(n, 3,
      `${t} is declared ${n}× — it needs :root, the media query AND [data-theme="dark"]`);
  }
});

/* ── 6. it actually renders ────────────────────────────────────────────────
   Source inspection cannot catch a missing import: an undefined <PageActions>
   is a ReferenceError that only fires when the page is MOUNTED, and
   `vite build` will not say a word about it. This page is behind sign-in, so
   the harness and this mount are the only two places it gets looked at. */

const { setupDom, teardownDom, mount, muteConsoleError } = await import('./dom.mjs');
setupDom();
const React = (await import('react')).default;
const { default: HowToUseView } = await import('../../src/components/HowToUseView.jsx');

test('the page mounts, with no data behind it', async () => {
  const quiet = muteConsoleError();
  try {
    const nav = [];
    const ui = await mount(React.createElement(HowToUseView, { navigate: (p) => nav.push(p) }));
    const text = ui.container.textContent;

    // the four panels
    assert.match(text, /Log the work\. Everything else is computed\./);
    assert.match(text, /Data model/);
    assert.match(text, /The loop/);
    assert.match(text, /Status language/);
    assert.match(text, /Shortcuts/);

    // the loop chips navigate
    const chips = [...ui.container.querySelectorAll('.htu-loop-chip')];
    assert.equal(chips.length, 4, 'four steps');
    chips[1].click();
    assert.deepEqual(nav.at(-1), { view: 'board' }, 'Track goes to the board');

    // signed out with no workspace, the panel must not pass an example off
    // as a reading
    assert.match(text, /an example|nothing logged yet/);

    // and every reference fold is present and shut
    const folds = [...ui.container.querySelectorAll('details.htu-fold')];
    assert.equal(folds.length, 8, 'eight reference panels');
    assert.ok(folds.every((f) => !f.open), 'all closed on arrival');

    ui.unmount();
  } finally {
    quiet.restore();
    teardownDom();
  }
});
