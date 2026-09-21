// T-0118 / BUG-032 — a div acting as a button obeys the button contract.
//
//   1. Given any row rendered with role=button
//   2. When the user presses either Enter or Space on it
//   3. Then the same action fires and the page does not scroll
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();
const { activateProps } = await import('../../src/hooks/useActivate.js');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const Row = ({ onActivate, ...opts }) =>
  h('div', { ...activateProps(onActivate, opts), 'data-testid': 'row' }, 'Draft proposal');

const press = async (el, key) => {
  const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => { el.dispatchEvent(e); });
  return e;
};

test('it is announced as a button and can be reached by Tab', async () => {
  const ui = await mount(h(Row, { onActivate() {} }));
  const row = ui.container.querySelector('[data-testid="row"]');
  assert.equal(row.getAttribute('role'), 'button');
  assert.equal(row.tabIndex, 0);
  ui.unmount();
});

test('Enter activates it', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await press(ui.container.querySelector('[data-testid="row"]'), 'Enter');
  assert.equal(fired, 1);
  ui.unmount();
});

test('Space activates it too — this is the whole bug', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await press(ui.container.querySelector('[data-testid="row"]'), ' ');
  assert.equal(fired, 1, 'a screen-reader user pressing the spacebar got a page scroll');
  ui.unmount();
});

test('Space does not scroll the page', async () => {
  const ui = await mount(h(Row, { onActivate() {} }));
  const e = await press(ui.container.querySelector('[data-testid="row"]'), ' ');
  assert.equal(e.defaultPrevented, true, 'without preventDefault the page jumps');
  ui.unmount();
});

test('an older browser spelling of Space works as well', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await press(ui.container.querySelector('[data-testid="row"]'), 'Spacebar');
  assert.equal(fired, 1);
  ui.unmount();
});

test('a click still activates it', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  await act(async () => {
    ui.container.querySelector('[data-testid="row"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.equal(fired, 1);
  ui.unmount();
});

test('any other key is left alone', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; } }));
  const row = ui.container.querySelector('[data-testid="row"]');
  for (const key of ['a', 'Escape', 'ArrowDown', 'Tab']) {
    const e = await press(row, key);
    assert.equal(e.defaultPrevented, false, `${key} must not be swallowed`);
  }
  assert.equal(fired, 0);
  ui.unmount();
});

test('the key press does not also reach whatever the row sits inside', async () => {
  let rowFired = 0;
  let parentFired = 0;
  const ui = await mount(h('div', { onKeyDown: () => { parentFired += 1; } },
    h(Row, { onActivate: () => { rowFired += 1; } })));
  await press(ui.container.querySelector('[data-testid="row"]'), 'Enter');
  assert.equal(rowFired, 1);
  assert.equal(parentFired, 0, 'a row often sits inside something else clickable');
  ui.unmount();
});

test('a disabled row is announced as disabled and cannot be operated', async () => {
  let fired = 0;
  const ui = await mount(h(Row, { onActivate: () => { fired += 1; }, disabled: true }));
  const row = ui.container.querySelector('[data-testid="row"]');
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  assert.equal(row.tabIndex, -1);
  await press(row, 'Enter');
  await act(async () => { row.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.equal(fired, 0);
  ui.unmount();
});

test('a row whose text says nothing can be given a name', async () => {
  const ui = await mount(h(Row, { onActivate() {}, label: 'Open Draft proposal' }));
  assert.equal(ui.container.querySelector('[data-testid="row"]').getAttribute('aria-label'), 'Open Draft proposal');
  ui.unmount();
});

test('a row that reads as a sentence is not given a redundant name', async () => {
  const ui = await mount(h(Row, { onActivate() {} }));
  assert.equal(ui.container.querySelector('[data-testid="row"]').getAttribute('aria-label'), null,
    'a label that repeats the visible text is noise to a screen-reader user');
  ui.unmount();
});
