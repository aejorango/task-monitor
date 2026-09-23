// T-0154 — Dashboard → Goals, rebuilt to `Dashboard Explorer.dc.html`.
//
// Three cards across: a conic ring, a Target / Now band, the key results as
// named bars and the projects as chips. What it replaced was a full-width SP3
// one-pager per goal.
//
// The guard that matters most here is the honesty one. This page averages
// numbers, and the tempting bug — counting a deliverable nobody has linked as
// 0% — makes a goal read as failing when the truth is that nobody has wired it
// up. The arithmetic tests live beside the module; these hold the SURFACE to
// it, and hold the port to the mockup's own metrics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'App.css');
const view = read('src', 'components', 'GoalsView.jsx');

/* ── the mockup's metrics ───────────────────────────────────────────────── */

test('the card is the mockup’s card, to the pixel', () => {
  assert.match(css, /\.gl-card \{[\s\S]*?border-radius: 16px/);
  assert.match(css, /\.gl-card \{[\s\S]*?padding: 18px 20px/);
  assert.match(css, /\.gl-card \{[\s\S]*?border-top: 3px solid var\(--gl-dot/);
  assert.match(css, /\.gl-grid \{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.gl-grid \{[\s\S]*?gap: 14px/);
});

test('the ring is 62 over 46, in the display face', () => {
  assert.match(css, /\.gl-ring \{[\s\S]*?width: 62px;\s*height: 62px/);
  assert.match(css, /\.gl-ring-in \{[\s\S]*?width: 46px;\s*height: 46px/);
  assert.match(css, /\.gl-ring-in \{[\s\S]*?font-family: var\(--font-display\)/);
  assert.match(css, /\.gl-ring-in \{[\s\S]*?font-size: 13px;\s*font-weight: 800/);
});

test('the ring is a conic gradient, not a charting dependency', () => {
  assert.match(css, /conic-gradient\(var\(--gl-dot\) var\(--gl-deg, 0deg\), var\(--c-surface-2\) 0\)/);
  assert.match(view, /'--gl-deg': `\$\{\(g\.pct \?\? 0\) \* 3\.6\}deg`/);
});

test('the Target / Now band and the key-result rows keep their sizes', () => {
  assert.match(css, /\.gl-band \{[\s\S]*?padding: 10px 12px/);
  assert.match(css, /\.gl-band \{[\s\S]*?border-radius: 11px/);
  assert.match(css, /\.gl-lbl \{[\s\S]*?font-size: 9\.5px;\s*font-weight: 800/);
  assert.match(css, /\.gl-now \{ font-family: var\(--font-display\); font-size: 15px/);
  assert.match(css, /\.gl-kr-name \{[\s\S]*?font-size: 11\.5px/);
  assert.match(css, /\.gl-kr-pct \{[\s\S]*?width: 34px/);
  assert.match(css, /\.gl-kr-track \{ height: 6px/);
  assert.match(css, /\.gl-proj \{[\s\S]*?font-size: 10\.5px/);
});

test('one tone drives the edge, the ring and the percentage together', () => {
  for (const t of ['red', 'amber', 'green', 'navy']) {
    assert.match(css, new RegExp(`\\.gl-card\\.tone-${t}\\s+\\{[^}]*--gl-dot`), t);
    assert.match(css, new RegExp(`\\.gl-card\\.tone-${t}\\s+\\{[^}]*--gl-ink`), `${t} ink`);
  }
  // Ink on a card, never the fill — the same rule every other tinted surface
  // in this app follows.
  assert.match(css, /\.gl-card\.tone-red\s+\{[^}]*--gl-ink: var\(--c-danger-ink\)/);
  assert.match(css, /\.gl-card\.tone-green \{[^}]*--gl-ink: var\(--c-success-ink\)/);
});

/* ── honesty ────────────────────────────────────────────────────────────── */

test('a deliverable with no number gets NO bar, not a zero-width one', () => {
  assert.match(view, /\{d\.pct == null \? '—' : `\$\{d\.pct\}%`\}/);
  assert.match(view, /\{d\.pct != null && \(/,
    'a 0%-wide track reads as "started, got nowhere" for something nobody wired up');
});

test('the card says when part of it is not in the ring', () => {
  assert.match(view, /\{g\.unmeasured\} of \{g\.total\} not linked to a project/);
  assert.match(css, /\.gl-unmeasured \{ font-style: italic/);
});

test('Now is a measured count, not an invented reading', () => {
  // The mockup prints a current value ("31h") against the target. This app has
  // no such field, so Now is the deliverables actually finished.
  assert.match(view, /\{g\.total \? `\$\{g\.done\}\/\$\{g\.total\}` : '—'\}/);
  assert.match(view, /this app has no "current reading" field/,
    'and the reason has to be written where the next reader will find it');
});

test('the arithmetic is the pure module, not inlined in the page', () => {
  assert.match(view, /from '\.\.\/services\/goalProgress'/);
  assert.doesNotMatch(view, /function deliverableProjectIds/,
    'a second copy is how the card and the export come to disagree');
  assert.ok(fs.existsSync(path.join(root, 'src', 'services', 'goalProgress.test.mjs')));
});

test('the ring and "at risk" ask the same function', () => {
  assert.match(view, /atRiskCount\(goals, projectStats\)/);
  assert.match(view, /goalProgress\(goal, projectStats\)/);
});

/* ── the old design is gone, and took nothing with it ───────────────────── */

const RETIRED = [
  '.goal-card', '.goal-banner', '.goal-body', '.goals-list', '.goal-panel',
  '.goal-srow', '.goal-chip', '.goal-cols-head', '.goal-cols-body', '.goal-col',
  '.goal-ft-label', '.goal-ft-text', '.goal-muted', '.goal-deliv-row',
  '.goal-deliv-pill', '.goal-code-badge', '.goal-edit-btn', '.goal-divider',
];

test('the SP3 one-pager’s stylesheet is gone', () => {
  const alive = RETIRED.filter((cls) => new RegExp(`^\\${cls}(\\s|\\{|,|\\.|:)`, 'm').test(css));
  assert.deepEqual(alive, [], 'two designs shipping at once looks fine in a screenshot of either');
});

test('…and nothing renders it', () => {
  for (const cls of RETIRED) {
    assert.doesNotMatch(view, new RegExp(`className="[^"]*\\${cls.slice(1)}\\b`), cls);
  }
});

test('but the data it showed still has a home', () => {
  // The change agenda and each deliverable's own date and status are edited in
  // the modal and written out by the exporter. Dropping the layout must not
  // drop the fields.
  assert.match(view, /changeAgenda/, 'the change agenda is still edited');
  assert.match(view, /targetDate/);
  assert.match(view, /buildGoalsDocument/, 'and Export still writes the full one-pager');
  assert.match(read('src', 'services', 'exporters.js'), /changeAgenda/,
    'the exporter is what people actually send — it must still carry it');
});

test('the editor’s own controls survived the sweep', () => {
  // These share the `goal-` prefix but belong to the modal, not the one-pager.
  for (const cls of ['.goal-swatch', '.goal-proj-chip', '.goal-edit-row']) {
    assert.match(css, new RegExp(`^\\${cls}`, 'm'), `${cls} is still rendered by the editor`);
  }
});

test('the harness twin was rebuilt with the page', () => {
  const shell = read('dev', 'shell.jsx');
  assert.match(shell, /gl-card tone-/, 'a stale twin verifies the design that went');
  assert.match(shell, /goals:\s+\(\) => <GoalsSample \/>/);
  assert.doesNotMatch(shell, /ArchiveSample \/>/, 'that page went in T-0153');
});
