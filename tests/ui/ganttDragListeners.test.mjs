// T-0134 / IMP-012 — a Gantt drag installs its listeners once.
//
//   1. Given a user drags a plan bar across 200 pixels
//   2. When the gesture completes
//   3. Then the window pointermove/pointerup listeners were installed once, and
//      the committed dates match the final pointer position
//
// The effect used to depend on the drag state, and every pointermove replaced
// that state with a new object — so React tore both window listeners down and
// put them back dozens of times a second, on the one interaction in the app
// that has to hold 60fps. Worse, the write at pointerup came from whichever
// closure happened to be installed at that instant.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();

const { GanttRow } = await import('../../src/components/GanttView.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'src', 'components', 'GanttView.jsx'), 'utf8');

const DAY_WIDTH = 36;
const RANGE = { min: new Date(2026, 8, 21), max: new Date(2026, 9, 21) };
const TODAY = new Date(2026, 8, 21);

const ranged = () => ({
  id: 't2', title: 'Write the report', status: 'todo',
  plan: { startDate: '2026-09-21', endDate: '2026-09-25' },
});

let quiet;
let writes;
/** Counts of add/remove, per event name, for the whole gesture. */
let spy;

before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

beforeEach(() => {
  writes = [];
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  spy = { added: {}, removed: {}, live: {} };
  window.addEventListener = (type, fn, opts) => {
    spy.added[type] = (spy.added[type] || 0) + 1;
    spy.live[type] = (spy.live[type] || 0) + 1;
    return realAdd(type, fn, opts);
  };
  window.removeEventListener = (type, fn, opts) => {
    spy.removed[type] = (spy.removed[type] || 0) + 1;
    spy.live[type] = (spy.live[type] || 0) - 1;
    return realRemove(type, fn, opts);
  };
  spy.restore = () => {
    window.addEventListener = realAdd;
    window.removeEventListener = realRemove;
  };
});

// In afterEach, not at the end of each test: a test that fails part-way would
// otherwise leave its wrapper installed, and the next test would wrap the
// wrapper and count everything twice.
afterEach(() => { spy.restore(); });

const renderRow = (task = ranged()) => mount(h(ToastProvider, null, h(GanttRow, {
  task,
  onSavePlan: (id, patch) => { writes.push([id, patch]); },
  project: { id: 'p1', name: 'Bridged', color: '#4f46e5' },
  phaseName: 'Discovery',
  range: RANGE,
  zoomConf: { id: 'day', dayWidth: DAY_WIDTH },
  totalWidth: 31 * DAY_WIDTH, phaseWidth: 120, taskWidth: 200, rowWidth: 1400,
  today: TODAY,
})));

const barOf = (ui) => ui.container.querySelector('.gantt-bar.plan');
const fire = async (el, type, clientX) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  });
};

/** A drag with `steps` intermediate moves, as a real pointer produces. */
async function dragAcross(el, x0, x1, steps) {
  await fire(el, 'pointerdown', x0);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: x }));
    });
  }
  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: x1 }));
  });
}

// The acceptance case.
test('a 200px drag installs pointermove and pointerup once each', async () => {
  const ui = await renderRow();
  const bar = barOf(ui);

  // 40 moves across 200px — roughly what a real gesture produces.
  await dragAcross(bar, 100, 300, 40);

  assert.equal(spy.added.pointermove, 1,
    `pointermove was installed ${spy.added.pointermove} times — once per move is the bug`);
  assert.equal(spy.added.pointerup, 1);
  assert.equal(spy.removed.pointermove, 1, 'and taken down exactly once, at the end');
  assert.equal(spy.removed.pointerup, 1);
  assert.equal(spy.live.pointermove, 0, 'nothing left listening after the gesture');
  assert.equal(spy.live.pointerup, 0);

  ui.unmount();
});

test('the committed dates match the final pointer position, not an earlier one', async () => {
  const ui = await renderRow();
  await dragAcross(barOf(ui), 100, 300, 40);

  // 200px at 36px/day is 5.56 days, which rounds to 6: 21–25 Sep becomes
  // 27 Sep – 1 Oct, keeping the four-day span. The write must come from the
  // LAST pointer position, not from whichever move installed the listener that
  // happened to be live at pointerup.
  assert.equal(writes.length, 1, 'one write, at the end of the gesture');
  assert.deepEqual(writes[0], ['t2', {
    'plan.startDate': '2026-09-27',
    'plan.endDate': '2026-10-01',
  }]);

  ui.unmount();
});

test('the bar follows the pointer while the listeners stay put', async () => {
  const ui = await renderRow();
  const bar = barOf(ui);
  const startLeft = bar.style.left;

  await fire(bar, 'pointerdown', 100);
  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 172 }));
  });
  assert.notEqual(barOf(ui).style.left, startLeft, 'the bar must still track the drag');
  assert.equal(spy.added.pointermove, 1, 'and it does so without re-installing anything');

  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 172 }));
  });
  ui.unmount();
});

test('a drag that ends where it started writes nothing', async () => {
  const ui = await renderRow();
  await dragAcross(barOf(ui), 100, 100, 10);
  assert.deepEqual(writes, [], 'a no-op drag is still a write if nobody checks');
  assert.equal(spy.added.pointermove, 1);
  ui.unmount();
});

test('a release outside the bar still ends the drag', async () => {
  // Why the listeners are on `window` and not on the bar: this is the case
  // that leaves a gesture stuck otherwise.
  const ui = await renderRow();
  await fire(barOf(ui), 'pointerdown', 100);
  await act(async () => {
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 250 }));
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 250 }));
  });
  assert.equal(writes.length, 1, 'the release happened over the page, not the bar');
  assert.equal(spy.live.pointermove, 0);
  ui.unmount();
});

test('two drags in a row each install once, and leave nothing behind', async () => {
  const ui = await renderRow();
  await dragAcross(barOf(ui), 100, 200, 20);
  await dragAcross(barOf(ui), 200, 260, 20);

  assert.equal(spy.added.pointermove, 2, 'one per gesture');
  assert.equal(spy.removed.pointermove, 2);
  assert.equal(spy.live.pointermove, 0);
  ui.unmount();
});

test('unmounting mid-drag takes the listeners with it', async () => {
  const ui = await renderRow();
  await fire(barOf(ui), 'pointerdown', 100);
  assert.equal(spy.live.pointermove, 1);
  ui.unmount();
  assert.equal(spy.live.pointermove, 0, 'a listener outliving its row is a leak');
});

/* ── how it is written ─────────────────────────────────────────────────── */

test('the effect is keyed on the mode, which does not change during a gesture', () => {
  assert.match(source, /const dragMode = drag\?\.mode \|\| null;/);
  assert.match(source, /\}, \[dragMode, zoomConf\.dayWidth, rangeMin, onSavePlan\]\);/,
    'depending on `drag` is what re-installed the listeners on every move');
  assert.doesNotMatch(source, /\}, \[drag, zoomConf\.dayWidth/);
});

test('the handlers read live geometry from a ref, not from a closure', () => {
  assert.match(source, /const live = dragRef\.current;/);
  assert.match(source, /const current = taskRef\.current;/,
    'and the task from a ref too — otherwise the commit can run against a stale plan');
  assert.match(source, /useEffect\(\(\) => \{ taskRef\.current = task; \}, \[task\]\);/,
    'assigned in an effect, not during render');
});

test('state and ref are set together, so they cannot drift apart', () => {
  assert.match(source, /const setBothDrag = \(next\) => \{ dragRef\.current = next; setDrag\(next\); \};/);
  assert.doesNotMatch(source, /\bsetDrag\(\{ mode,/, 'starting a drag must set both');
});

test('the listeners are still on window, which is the rule this must not break', () => {
  assert.match(source, /window\.addEventListener\('pointermove', onMove\)/);
  assert.match(source, /window\.addEventListener\('pointerup',\s+onUp\)/);
  assert.match(source, /window\.removeEventListener\('pointermove', onMove\)/);
  assert.match(source, /window\.removeEventListener\('pointerup',\s+onUp\)/);
});
