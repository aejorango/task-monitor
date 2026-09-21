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

// ---------------------------------------------------------------------------
// T-0085 / BUG-012 — a hook whose modal is not on screen must not take the key.
//
// The hook's Escape branch calls stopPropagation() from a document-capture
// listener, which kills the event before anything else in the app sees it. A
// component that calls the hook above an early return (TimerWidget did) left
// that listener installed for the whole life of the app, so Escape was dead in
// the search dropdown, the Export menu, the inbox, the column picker, the
// tutorial tour and the due-task alert — every one of which listens on window
// or on document-bubble.
// ---------------------------------------------------------------------------

/** A component that owns its own open/closed state, the way TimerWidget does. */
function Conditional({ onClose, showing, passOpen = true }) {
  const modal = useModalDialog({ onClose, title: 'Stop timer', ...(passOpen ? { open: showing } : {}) });
  if (!showing) return h('span', null, 'nothing on screen');
  return h('div', { className: 'modal-backdrop', ...modal.backdropProps },
    h('div', { className: 'modal', ...modal.dialogProps },
      h('h3', { id: modal.titleId }, 'Stop timer'),
      h('button', { type: 'button' }, 'Discard')));
}

/** Somebody else's Escape handler, registered on window in the bubble phase. */
function Bystander({ onEscape }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);
  return h('span', null, 'bystander');
}

test('a closed modal lets Escape through to the rest of the app', async () => {
  let bystanderHeard = 0;
  let closed = 0;
  const ui = await mount(h('div', null,
    h(Conditional, { onClose: () => { closed += 1; }, showing: false }),
    h(Bystander, { onEscape: () => { bystanderHeard += 1; } })));

  await press('Escape');
  assert.equal(bystanderHeard, 1, 'the window handler must still hear Escape');
  assert.equal(closed, 0, 'there was nothing on screen to close');
  ui.unmount();
});

test('a call site that forgets `open` still cannot swallow Escape', async () => {
  let bystanderHeard = 0;
  const ui = await mount(h('div', null,
    h(Conditional, { onClose() {}, showing: false, passOpen: false }),
    h(Bystander, { onEscape: () => { bystanderHeard += 1; } })));

  await press('Escape');
  assert.equal(bystanderHeard, 1, 'no panel in the document means nothing to close');
  ui.unmount();
});

test('once the modal is on screen Escape closes it and stops there', async () => {
  let bystanderHeard = 0;
  let closed = 0;
  const ui = await mount(h('div', null,
    h(Conditional, { onClose: () => { closed += 1; }, showing: true }),
    h(Bystander, { onEscape: () => { bystanderHeard += 1; } })));

  await press('Escape');
  assert.equal(closed, 1, 'the open dialog closes');
  assert.equal(bystanderHeard, 0, 'and the key goes no further');
  ui.unmount();
});

test('a closed modal moves nobody’s focus', async () => {
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  outside.focus();

  const ui = await mount(h(Conditional, { onClose() {}, showing: false }));
  assert.equal(document.activeElement, outside, 'focus stays where the user put it');
  ui.unmount();
  outside.remove();
});

test('opening the modal after mount installs the trap, closing it removes it', async () => {
  let bystanderHeard = 0;
  let closed = 0;
  const node = (showing) => h('div', null,
    h(Conditional, { onClose: () => { closed += 1; }, showing }),
    h(Bystander, { onEscape: () => { bystanderHeard += 1; } }));

  const ui = await mount(node(false));
  await press('Escape');
  assert.equal(bystanderHeard, 1);

  await ui.render(node(true));
  await press('Escape');
  assert.equal(closed, 1, 'now open: the dialog takes it');
  assert.equal(bystanderHeard, 1, 'and the bystander hears nothing');

  await ui.render(node(false));
  await press('Escape');
  assert.equal(bystanderHeard, 2, 'closed again: the bystander hears it once more');
  assert.equal(closed, 1);
  ui.unmount();
});
