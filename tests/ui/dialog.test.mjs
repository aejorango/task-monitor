// T-0064 / POL-001 + POL-002 — asking a question without window.confirm.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom, teardownDom, mount, text, clickText, typeInto, muteConsoleError } from './dom.mjs';

const window = setupDom();
const { DialogProvider, Modal, useDialog } = await import('../../src/components/Dialog.jsx');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

async function withDialog() {
  let api = null;
  function Probe() {
    api = useDialog();
    return h('button', { type: 'button' }, 'behind the dialog');
  }
  const ui = await mount(h(DialogProvider, null, h(Probe)));
  return { ui, api: () => api };
}

const press = async (key, opts = {}) => {
  const { act } = await import('react');
  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
  });
};

test('nothing is shown until something is asked', async () => {
  const { ui } = await withDialog();
  assert.equal(ui.container.querySelectorAll('[role="dialog"]').length, 0);
  ui.unmount();
});

test('a confirm shows its question and resolves true on the confirm button', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  let answer;
  await act(async () => {
    api().confirm({ title: 'Delete this task?', message: 'It goes to Trash.', confirmLabel: 'Delete' })
      .then((v) => { answer = v; });
  });
  assert.match(text(ui.container), /Delete this task\?/);
  assert.match(text(ui.container), /It goes to Trash\./);
  await clickText(ui.container, 'Delete');
  await act(async () => {});
  assert.equal(answer, true);
  assert.equal(ui.container.querySelectorAll('[role="dialog"]').length, 0);
  ui.unmount();
});

test('cancelling resolves false, not undefined', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  let answer;
  await act(async () => { api().confirm({ title: 'Sure?' }).then((v) => { answer = v; }); });
  await clickText(ui.container, 'Cancel');
  await act(async () => {});
  assert.equal(answer, false);
  ui.unmount();
});

test('Escape cancels', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  let answer;
  await act(async () => { api().confirm({ title: 'Sure?' }).then((v) => { answer = v; }); });
  await press('Escape');
  await act(async () => {});
  assert.equal(answer, false);
  ui.unmount();
});

test('a prompt returns the trimmed text, or null when cancelled', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  let answer;
  await act(async () => {
    api().prompt({ title: 'Name this view', label: 'Name', defaultValue: 'My view' }).then((v) => { answer = v; });
  });
  const input = ui.container.querySelector('input.input');
  assert.equal(input.value, 'My view', 'prefilled, like window.prompt');
  await typeInto(input, '  Weekly report  ');
  await clickText(ui.container, 'Save');
  await act(async () => {});
  assert.equal(answer, 'Weekly report');
  ui.unmount();
});

test('a prompt will not submit an empty answer', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  await act(async () => { api().prompt({ title: 'Name it' }); });
  const save = [...ui.container.querySelectorAll('button')].find((b) => b.textContent === 'Save');
  assert.equal(save.disabled, true);
  ui.unmount();
});

test('the dialog is a dialog, with a title a screen reader can read', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  await act(async () => { api().confirm({ title: 'Delete?' }); });
  const dialog = ui.container.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const labelId = dialog.getAttribute('aria-labelledby');
  assert.ok(labelId);
  assert.equal(document.getElementById(labelId).textContent, 'Delete?');
  ui.unmount();
});

test('focus moves into the dialog and comes back afterwards', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  const behind = ui.container.querySelector('button');
  behind.focus();
  assert.equal(document.activeElement, behind);

  await act(async () => { api().confirm({ title: 'Sure?' }); });
  assert.ok(ui.container.querySelector('[role="dialog"]').contains(document.activeElement),
    'a keyboard user must not have to hunt for the dialog');

  await clickText(ui.container, 'Cancel');
  await act(async () => {});
  assert.equal(document.activeElement, behind, 'and must not be dumped at the top of the page');
  ui.unmount();
});

test('Tab cannot escape the dialog', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  await act(async () => { api().confirm({ title: 'Sure?' }); });

  const dialog = ui.container.querySelector('[role="dialog"]');
  const focusables = [...dialog.querySelectorAll('button')];
  focusables[focusables.length - 1].focus();
  await press('Tab');
  assert.ok(dialog.contains(document.activeElement), 'Tab wrapped out of the dialog');

  focusables[0].focus();
  await press('Tab', { shiftKey: true });
  assert.ok(dialog.contains(document.activeElement), 'Shift+Tab wrapped out of the dialog');
  ui.unmount();
});

test('a destructive confirm can be styled as such', async () => {
  const { ui, api } = await withDialog();
  const { act } = await import('react');
  await act(async () => { api().confirm({ title: 'Delete forever?', danger: true, confirmLabel: 'Delete' }); });
  assert.ok(ui.container.querySelector('.btn-danger'));
  ui.unmount();
});

test('the Modal shell can be used on its own', async () => {
  let closed = false;
  const ui = await mount(h(Modal, { title: 'A panel', onClose: () => { closed = true; } }, h('p', null, 'body')));
  assert.equal(ui.container.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
  await press('Escape');
  assert.equal(closed, true);
  ui.unmount();
});

test('useDialog without a provider falls back rather than hanging', async () => {
  let api = null;
  function Probe() { api = useDialog(); return null; }
  const ui = await mount(h(Probe));
  window.confirm = () => true;
  assert.equal(await api.confirm({ title: 'x' }), true, 'a promise that never resolves would freeze the app');
  ui.unmount();
});
