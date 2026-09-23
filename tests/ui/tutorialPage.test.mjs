// T-0158 — Dashboard → Tutorial, rebuilt to `Dashboard Explorer.dc.html`.
//
// A 292px lesson rail beside the active lesson, the steps on a numbered spine,
// and a "Try it here" card. The guards are the same four this project has
// learned to write for a port, plus one this page needs more than most:
//
//   1. the old page is gone (two designs shipping at once looks fine in a
//      screenshot of either);
//   2. the mockup's own metrics survive;
//   3. NOTHING ON IT IS INVENTED. This page teaches people how the app works.
//      The mockup prints "3 min" per lesson and a "2/6" done count, and the
//      app had neither fact. One became the step count (real); the other was
//      RECORDED (real). A sandbox form with a Save button that saves nothing
//      would be the worst of the three, so it is not there;
//   4. the content moved rather than being deleted — the page still asks the
//      one app-wide tour rather than growing a second copy of the sequencing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'App.css');
const view = read('src', 'components', 'TutorialView.jsx');

/**
 * The file with every comment removed.
 *
 * These guards say "the page must not contain X", and the page's own header
 * explains at length why X is absent — so an unstripped read fails on its own
 * reasoning. Strips `//` lines, `/* … *\/` blocks and `{/* … *\/}` in JSX.
 */
const code = view
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* ── 1. the old page is gone ───────────────────────────────────────────── */

test('the Settings panel it replaced is deleted, not orphaned', () => {
  assert.equal(fs.existsSync(path.join(root, 'src', 'components', 'TutorialsPanel.jsx')), false);
  const settings = read('src', 'components', 'SettingsView.jsx');
  assert.ok(!settings.includes('TutorialsPanel'), 'SettingsView still mounts it');
  assert.ok(!/tutorial:\s+\['tutorial'\]/.test(settings), 'the Settings section entry is gone too');
});

test('the tutorial is a Dashboard page now, owned by exactly one hub', async () => {
  const { HUBS, hubForView, VIEW_REGISTRY } = await import('../../src/services/views.js');
  assert.equal(hubForView('tutorial')?.id, 'dashboard');
  const owners = HUBS.filter((h) => h.tabs.some((t) => t.view === 'tutorial'));
  assert.equal(owners.length, 1, 'two hubs claiming it makes the rail highlight ambiguous');
  assert.ok(VIEW_REGISTRY.some((v) => v.id === 'tutorial'));
  assert.match(read('src', 'App.jsx'), /route\.view === 'tutorial'\s+&& <TutorialView/);
});

test('the page does not write a title of its own — the chrome draws it', () => {
  assert.ok(!/<h1/.test(view));
  assert.ok(!view.includes('page-header') && !view.includes('page-title'));
  assert.ok(view.includes('<PageSubtitle>'));
});

/* ── 2. the mockup's own metrics ───────────────────────────────────────── */

const METRICS = [
  ['.tv-layout', /grid-template-columns: 292px minmax\(0, 1fr\)/],
  ['.tv-layout', /gap: 16px/],
  ['.tv-rail', /padding: 14px/],
  ['.tv-rail', /position: sticky/],
  ['.tv-rail-head', /padding: 2px 6px 11px/],
  ['.tv-lbl', /font-size: 9\.5px/],
  ['.tv-lbl', /letter-spacing: 0\.08em/],
  ['.tv-count', /font-size: 11px/],
  ['.tv-bar', /height: 6px/],
  ['.tv-bar', /margin: 0 6px 12px/],
  ['.tv-lesson', /padding: 9px 10px/],
  ['.tv-lesson', /border-radius: 11px/],
  ['.tv-dot', /width: 20px/],
  ['.tv-lesson-title', /font-size: 12\.5px/],
  ['.tv-lesson-meta', /font-size: 10px/],
  // the navy head: 18×22 padding, a 190px glow at -40/-70, a 19px display line
  ['.tv-head', /padding: 18px 22px/],
  ['.tv-head-glow', /width: 190px/],
  ['.tv-head-glow', /top: -70px/],
  ['.tv-head-n', /font-size: 11px/],
  ['.tv-head-title', /font-size: 19px/],
  ['.tv-head-title', /letter-spacing: -0\.015em/],
  ['.tv-head-meta', /font-size: 11\.5px/],
  // the spine: a 22px numeral, a 2px line, 13px step text
  ['.tv-body', /padding: 18px 22px/],
  ['.tv-step', /gap: 13px/],
  ['.tv-step-rail', /width: 24px/],
  ['.tv-step-n', /width: 22px/],
  ['.tv-step-n', /font-size: 10\.5px/],
  ['.tv-step-line', /width: 2px/],
  ['.tv-step-title', /font-size: 13px/],
  ['.tv-step-text', /padding-bottom: 16px/],
  ['.tv-step-where', /font-size: 10px/],
  // try it here
  ['.tv-try', /padding: 16px 18px/],
  ['.tv-try-bed', /border-radius: 13px/],
  ['.tv-try-bed', /padding: 14px/],
  ['.tv-try-icon', /width: 16px/],
  ['.tv-field-val', /border-radius: 9px/],
  ['.tv-field-val', /padding: 9px 11px/],
  ['.tv-field-lbl', /font-size: 9\.5px/],
];

for (const [cls, re] of METRICS) {
  test(`${cls} keeps the mockup's ${re.source.replace(/\\/g, '')}`, () => {
    const m = css.match(new RegExp(`^\\${cls} \\{[^}]*\\}`, 'm'));
    assert.ok(m, `${cls} is not in the stylesheet`);
    assert.match(m[0], re);
  });
}

test('the display face is used for the lesson head, as the mockup does', () => {
  assert.match(css.match(/^\.tv-head-title \{[^}]*\}/m)[0], /font-family: var\(--font-display\)/);
});

/* ── 3. nothing on it is invented ──────────────────────────────────────── */

test('a lesson\'s size is STEPS — nothing here measures minutes', () => {
  assert.ok(view.includes('lessonSize'), 'the page asks the module, it does not guess');
  assert.ok(!/\d+\s*min\b/.test(code), 'the mockup\'s "3 min" is a number this app does not have');
});

test('the done count is recorded, not decoration', async () => {
  const { progressOf } = await import('../../src/services/tutorialProgress.js');
  assert.deepEqual(progressOf([{ id: 'a' }, { id: 'b' }], new Set(['a'])),
    { done: 1, total: 2, pct: 50 });
  assert.ok(view.includes('progressOf'), 'the pill and the bar read the same function');
  assert.ok(!/>\s*2\/6\s*</.test(view), 'a hard-coded 2/6 is the first lie on a how-to page');
});

test('only finishing the tour counts as finishing a lesson', () => {
  const guide = read('src', 'components', 'TutorialGuide.jsx');
  // markDone sits in goNext's last-step branch, NOT in endTutorial — which is
  // what "Skip tour" and the ✕ both call.
  const goNext = guide.slice(guide.indexOf('const goNext ='), guide.indexOf('const goBack ='));
  assert.match(goNext, /markDone\(/, 'Done on the last step records it');
  const endFn = guide.slice(guide.indexOf('const endTutorial ='), guide.indexOf('const goNext ='));
  assert.ok(!endFn.includes('markDone'),
    'Skip tour must not count — the rail would be counting people who bailed out');
});

test('there is no sandbox, and the page does not pretend there is', () => {
  assert.ok(!/sandbox/i.test(code),
    'the mockup\'s "sandbox" chip promises something this app has no version of');
  assert.match(view, /your real data/, 'the chip says what it actually is');
  // The card's CTA has to DO something real.
  assert.match(view, /onClick=\{openFirstPage\}/);
  assert.match(view, /navigate\(\{ view: resolveView\(first\) \}\)/);
});

test('page names come from the registry, not retyped', () => {
  assert.match(view, /VIEW_REGISTRY\.find\(\(v\) => v\.id === target\)\?\.label/,
    'a step chip saying "projects" instead of "Portfolio" is a second vocabulary');
  assert.ok(view.includes('resolveView'), 'and a step pointing at a MOVED page still names it right');
});

/* ── 4. one tour, asked for — not a second copy of it ──────────────────── */

test('the page asks the app-wide tour; it does not run one', () => {
  assert.ok(view.includes('startTutorial'), 'it fires the event');
  assert.ok(!view.includes('TutorialOverlay'), 'the overlay is the shell\'s');
  assert.ok(!view.includes('stepIndex'), 'and so is the sequencing');
  const shell = read('src', 'components', 'AppShell.jsx');
  assert.match(shell, /<TutorialGuide route=\{route\} navigate=\{navigate\} showLauncher=\{false\} \/>/);
});

test('the lessons are data in a service, read by everything that needs them', () => {
  assert.ok(fs.existsSync(path.join(root, 'src', 'services', 'tutorials.js')));
  const guide = read('src', 'components', 'TutorialGuide.jsx');
  assert.ok(!/^export const TUTORIALS = \[/m.test(guide), 'the component must not own the list');
  for (const f of ['TutorialView.jsx', 'HowToUseView.jsx']) {
    assert.match(read('src', 'components', f), /from '\.\.\/services\/tutorials'/,
      `${f} should read the one list`);
  }
});

test('every selector the tour aims at is rendered somewhere', () => {
  // The whole point of a tour is that it points at a real control. T-0148
  // renamed the board's card classes and three steps would have highlighted
  // empty space.
  const tours = read('src', 'services', 'tutorials.js');
  const classes = [...tours.matchAll(/selector: '\.([a-z-]+)'/g)].map((m) => m[1]);
  const hooks   = [...tours.matchAll(/selector: '\[data-tutorial="([a-z-]+)"\]'/g)].map((m) => m[1]);
  assert.ok(classes.length + hooks.length >= 14, 'the tours should still have steps');

  const dir = path.join(root, 'src', 'components');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));

  for (const cls of new Set(classes)) {
    assert.ok(
      files.some((src) => src.includes(`className="${cls}`) || src.includes('className={`' + cls)),
      `the tour points at .${cls}, which nothing renders`,
    );
  }
  // The data-tutorial hooks exist ONLY for the tour, so nothing else would
  // notice if one were dropped in a restyle — which is exactly why they need
  // a guard more than the class selectors do.
  for (const hook of new Set(hooks)) {
    assert.ok(
      files.some((src) => src.includes(`data-tutorial="${hook}"`)
        // It may be COMPUTED — the rail writes
        // data-tutorial={h.id === 'projects' ? 'nav-projects' : `nav-${h.id}`}
        // so the literal never appears next to the attribute name.
        || (src.includes('data-tutorial=') && new RegExp(`['\`"]${hook}['\`"]`).test(src))),
      `the tour points at [data-tutorial="${hook}"], which nothing renders`,
    );
  }
});

/* ── 5. the things the harness has actually caught ─────────────────────── */

test('the selected lesson is a CONSTANT navy, not var(--c-text)', () => {
  const rule = css.match(/^\.tv-lesson\.is-sel \{[^}]*\}/m)[0];
  assert.match(rule, /background: var\(--c-hero-from\)/,
    'var(--c-text) inverts to near-white in dark mode and the row\'s white title, '
    + 'white dot and rgba(255,255,255,.78) meta line all vanish onto it');
  assert.doesNotMatch(rule, /var\(--c-text\)/);
});

test('no grid track can push a scrollbar onto a phone', () => {
  assert.match(css.match(/^\.tv-layout \{[^}]*\}/m)[0], /minmax\(0, 1fr\)/);
  assert.match(css.match(/^\.tv-try-grid \{[^}]*\}/m)[0], /minmax\(0, 0\.7fr\) minmax\(0, 2fr\) minmax\(0, 0\.9fr\)/);
});

test('the rail stops being a rail on a phone', () => {
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.tv-layout \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.tv-rail \{ position: static; \}/);
});

test('the harness twin moved with the markup', () => {
  const shell = read('dev', 'shell.jsx');
  assert.ok(shell.includes('TutorialSample'), 'no twin at all is better than a stale one');
  for (const cls of ['tv-layout', 'tv-rail', 'tv-head', 'tv-step-n', 'tv-try-bed']) {
    assert.ok(shell.includes(cls), `the twin still draws the old markup (${cls} missing)`);
  }
});

/* ── 6. it actually renders ────────────────────────────────────────────────
   Source inspection cannot catch a missing import: an undefined <PageSubtitle>
   is a ReferenceError that only fires when the page is MOUNTED, and
   `vite build` says nothing about it. This page is behind sign-in, so the
   harness and this mount are the only two places it gets looked at. */

const { setupDom, teardownDom, mount, muteConsoleError } = await import('./dom.mjs');
setupDom();
const React = (await import('react')).default;
const { default: TutorialView } = await import('../../src/components/TutorialView.jsx');
const { TUTORIALS } = await import('../../src/services/tutorials.js');
const { progressKey } = await import('../../src/services/tutorialProgress.js');

test('the page mounts, and the rail counts what is really finished', async () => {
  const quiet = muteConsoleError();
  try {
    try { localStorage.removeItem(progressKey(null)); } catch { /* ignore */ }

    const nav = [];
    const ui = await mount(React.createElement(TutorialView, { navigate: (p) => nav.push(p) }));
    const text = ui.container.textContent;

    // the rail
    assert.equal(ui.container.querySelectorAll('.tv-lesson').length, TUTORIALS.length);
    assert.match(text, new RegExp(`0/${TUTORIALS.length}`),
      'nothing finished yet — and it says so rather than showing the mockup\'s 2/6');
    assert.equal(ui.container.querySelector('.tv-bar-fill').style.width, '0%');
    assert.equal(ui.container.querySelectorAll('.tv-dot.st-done').length, 0);

    // the active lesson is the first one, and its steps are drawn
    assert.match(text, new RegExp(TUTORIALS[0].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(ui.container.querySelectorAll('.tv-step').length, TUTORIALS[0].steps.length);
    assert.match(text, /Lesson 1 of/);

    // Back is disabled on the first lesson rather than doing nothing
    const back = [...ui.container.querySelectorAll('.tv-btn')].find((b) => b.textContent.includes('Back'));
    assert.equal(back.disabled, true);

    // picking another lesson moves the card
    ui.container.querySelectorAll('.tv-lesson')[2].click();
    await new Promise((r) => setTimeout(r, 0));
    assert.match(ui.container.textContent, /Lesson 3 of/);

    // the Try-it CTA navigates for real
    ui.container.querySelector('.tv-btn-open').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(nav.length > 0 && nav.at(-1).view, 'Open <page> must actually go somewhere');

    ui.unmount();
  } finally {
    quiet.restore();
    teardownDom();
  }
});
