// T-0067 / POL-002 — an existing modal made into a real dialog.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom, teardownDom, mount, muteConsoleError } from './dom.mjs';

const window = setupDom();
const { useModalDialog } = await import('../../src/hooks/useModalDialog.js');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

/** A modal shaped like the ones already in the app. */
function Panel({ onClose, title, withTitleEl = true, ...opts }) {
  const modal = useModalDialog({ onClose, ...(withTitleEl ? {} : { title }), ...opts });
  return h('div', { className: 'modal-backdrop', ...modal.backdropProps },
    h('div', { className: 'modal', ...modal.dialogProps },
      withTitleEl ? h('h3', { id: modal.titleId }, title) : null,
      h('button', { type: 'button' }, 'first'),
      h('input', { type: 'text', 'aria-label': 'middle' }),
      h('button', { type: 'button' }, 'last')));
}

const press = async (key, opts = {}) => {
  const { act } = await import('react');
  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
  });
};

test('the panel becomes a dialog a screen reader can announce', async () => {
  const ui = await mount(h(Panel, { onClose() {}, title: 'Edit task' }));
  const dialog = ui.container.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Edit task');
  ui.unmount();
});

test('a modal with no title element gets an aria-label instead', async () => {
  const ui = await mount(h(Panel, { onClose() {}, title: 'Log activity', withTitleEl: false }));
  const dialog = ui.container.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-label'), 'Log activity');
  assert.equal(dialog.getAttribute('aria-labelledby'), null);
  ui.unmount();
});

test('focus moves inside on open', async () => {
  const ui = await mount(h(Panel, { onClose() {}, title: 'x' }));
  assert.ok(ui.container.querySelector('[role="dialog"]').contains(document.activeElement));
  ui.unmount();
});

test('focus goes back where it came from on close', async () => {
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  outside.focus();

  const ui = await mount(h(Panel, { onClose() {}, title: 'x' }));
  assert.notEqual(document.activeElement, outside);
  ui.unmount();
  assert.equal(document.activeElement, outside, 'the page must not jump to the top');
  outside.remove();
});

test('Escape closes', async () => {
  let closed = 0;
  const ui = await mount(h(Panel, { onClose: () => { closed += 1; }, title: 'x' }));
  await press('Escape');
  assert.equal(closed, 1);
  ui.unmount();
});

test('Escape can be opted out of, for a modal mid-save', async () => {
  let closed = 0;
  const ui = await mount(h(Panel, { onClose: () => { closed += 1; }, title: 'x', closeOnEscape: false }));
  await press('Escape');
  assert.equal(closed, 0);
  ui.unmount();
});

test('Tab wraps at both ends instead of walking out of the dialog', async () => {
  const ui = await mount(h(Panel, { onClose() {}, title: 'x' }));
  const dialog = ui.container.querySelector('[role="dialog"]');
  const items = [...dialog.querySelectorAll('button, input')];

  items[items.length - 1].focus();
  await press('Tab');
  assert.equal(document.activeElement, items[0]);

  items[0].focus();
  await press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, items[items.length - 1]);
  ui.unmount();
});

test('focus that escapes is brought back', async () => {
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  const ui = await mount(h(Panel, { onClose() {}, title: 'x' }));
  outside.focus();
  await press('Tab');
  assert.ok(ui.container.querySelector('[role="dialog"]').contains(document.activeElement));
  ui.unmount();
  outside.remove();
});

test('clicking the backdrop closes; clicking inside does not', async () => {
  const { act } = await import('react');
  let closed = 0;
  const ui = await mount(h(Panel, { onClose: () => { closed += 1; }, title: 'x' }));
  const backdrop = ui.container.querySelector('.modal-backdrop');
  const dialog = ui.container.querySelector('[role="dialog"]');

  await act(async () => { dialog.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
  assert.equal(closed, 0, 'a click inside must not close it');

  await act(async () => { backdrop.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
  assert.equal(closed, 1);
  ui.unmount();
});

test('backdrop closing can be turned off for a modal mid-import', async () => {
  const { act } = await import('react');
  let closed = 0;
  const ui = await mount(h(Panel, { onClose: () => { closed += 1; }, title: 'x', closeOnBackdrop: false }));
  const backdrop = ui.container.querySelector('.modal-backdrop');
  await act(async () => { backdrop.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
  assert.equal(closed, 0);
  ui.unmount();
});

test('a nested dialog closes only itself', async () => {
  let outerClosed = 0;
  let innerClosed = 0;
  function Nested() {
    return h(Panel, { onClose: () => { outerClosed += 1; }, title: 'outer' },
      h(Panel, { onClose: () => { innerClosed += 1; }, title: 'inner' }));
  }
  const ui = await mount(h('div', null, h(Nested)));
  await press('Escape');
  assert.equal(innerClosed + outerClosed, 1, 'Escape must not close the whole stack at once');
  ui.unmount();
});
