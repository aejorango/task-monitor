// The Board hub's Status menu, end to end.
//
//   1. Given the Board hub, with the Status menu in the tab row
//   2. When the user picks a status (or Stuck), then moves to another tab
//   3. Then the URL carries the choice, the list narrows to it, and the
//      choice survives the tab change
//
// Everything here is the real thing: the router (`useRoute`), the tab strip
// (`PageHeader`), the dropdown (`FilterMenu`) and the filter (`scopeTasks`).
// Only the task list is a stand-in for a Board page — every Board page runs
// its tasks through the same `scopeTasks(…, { status: route.statusFilter })`,
// which tests/ui/boardHub.test.mjs checks page by page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, clickText, muteConsoleError } from './dom.mjs';

setupDom();

const { useRoute } = await import('../../src/components/AppShell.jsx');
const { default: PageHeader } = await import('../../src/components/PageHeader.jsx');
const { default: FilterMenu } = await import('../../src/components/FilterMenu.jsx');
const {
  STATUS_OPTIONS, statusOf, statusPatch, scopeTasks, scopeOf,
} = await import('../../src/services/boardScope.js');

const h = React.createElement;
const TODAY = '2026-07-20';

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const TASKS = [
  { id: 'a', title: 'Draft copy',      status: 'todo',   plan: { endDate: '2026-08-01' } },
  { id: 'b', title: 'Build API',       status: 'doing',  plan: { endDate: '2026-08-01' } },
  { id: 'c', title: 'Legal review',    status: 'review', plan: { endDate: '2026-08-01' } },
  { id: 'd', title: 'Ship v1',         status: 'done',   plan: { endDate: '2026-07-01' } },
  { id: 'e', title: 'Migrate records', status: 'doing',  plan: { endDate: '2026-07-10' } }, // late → Stuck
  { id: 'f', title: 'KYC contract',    status: 'todo',   plan: { endDate: '2026-09-01' } }, // blocked → Stuck
];
const BLOCKED = new Set(['f']);

/** The shell, cut down to what the Status menu touches. */
function Hub() {
  const { route, navigate } = useRoute();
  const shown = scopeTasks(TASKS, {
    scope: scopeOf(route), status: route.statusFilter, blockedIds: BLOCKED, today: TODAY,
  });
  return h('div', null,
    h(PageHeader, {
      route, navigate, pageLabel: 'Kanban', pageIcon: 'board',
      filters: h(FilterMenu, {
        name: 'Status',
        icon: h('svg', { 'data-status-icon': true }),
        value: statusOf(route),
        options: STATUS_OPTIONS,
        onChange: (id) => navigate(statusPatch(id)),
      }),
    }),
    h('ul', { id: 'list' }, shown.map((t) => h('li', { key: t.id }, t.title))),
    h('output', { id: 'view' }, route.view),
  );
}

// Setting location.hash fires `hashchange` asynchronously in jsdom.
const settle = () => act(() => new Promise((r) => setTimeout(r, 10)));
const listed = (ui) => [...ui.container.querySelectorAll('#list li')].map((li) => li.textContent);
const trigger = (ui) => ui.container.querySelector('.chrome-tabtools .fbx');

async function choose(ui, label) {
  await act(async () => {
    trigger(ui).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  const item = [...ui.container.querySelectorAll('[role="menuitemradio"]')]
    .find((el) => el.textContent.trim() === label);
  assert.ok(item, `no "${label}" option in the Status menu`);
  await act(async () => {
    item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

async function freshHub() {
  window.location.hash = '#/board/all';
  await settle();
  return mount(h(Hub));
}

test('the trigger is an icon and a value — the word "Status" is for a screen reader', async () => {
  const ui = await freshHub();
  const btn = trigger(ui);
  assert.ok(btn.querySelector('[data-status-icon]'), 'the status icon is on the trigger');
  assert.ok(!btn.querySelector('.fbx-k'), 'no visible "Status" word');
  assert.equal(btn.getAttribute('aria-label'), 'Status: All');
  assert.equal(listed(ui).length, TASKS.length, 'All filters nothing');
  ui.unmount();
});

test('picking a status narrows the list and writes ?status=', async () => {
  const ui = await freshHub();
  await choose(ui, 'Done');
  assert.deepEqual(listed(ui), ['Ship v1']);
  assert.match(window.location.hash, /[?&]status=done\b/);
  assert.equal(trigger(ui).getAttribute('aria-label'), 'Status: Done');

  await choose(ui, 'Working on it');
  assert.deepEqual(listed(ui), ['Build API', 'Migrate records']);
  assert.match(window.location.hash, /[?&]status=doing\b/);
  ui.unmount();
});

test('Stuck is a status option: late OR blocked, and it clears ?status=', async () => {
  const ui = await freshHub();
  await choose(ui, 'Done');
  await choose(ui, 'Stuck');
  assert.deepEqual(listed(ui), ['Migrate records', 'KYC contract'],
    'late and blocked both count, whatever column they are in');
  assert.match(window.location.hash, /[?&]stuck=1\b/);
  assert.doesNotMatch(window.location.hash, /[?&]status=/, 'never both at once');

  await choose(ui, 'All');
  assert.equal(listed(ui).length, TASKS.length);
  assert.doesNotMatch(window.location.hash, /stuck=|status=/);
  ui.unmount();
});

test('the choice survives moving to another Board tab', async () => {
  const ui = await freshHub();
  await choose(ui, 'In review');
  assert.deepEqual(listed(ui), ['Legal review']);

  await clickText(ui.container.querySelector('.chrome-tabs'), 'Gantt');
  await settle();
  assert.equal(ui.container.querySelector('#view').textContent, 'gantt', 'the tab navigated');
  assert.deepEqual(listed(ui), ['Legal review'], 'and the Status filter came with it');
  assert.equal(trigger(ui).getAttribute('aria-label'), 'Status: In review');
  ui.unmount();
});

test('the menu closes on Escape and on a click outside', async () => {
  const ui = await freshHub();
  const open = () => act(async () => {
    trigger(ui).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  const menu = () => ui.container.querySelector('.chrome-tabtools [role="menu"]');

  await open();
  assert.ok(menu(), 'it opens');
  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(menu(), null, 'Escape closes it');

  await open();
  await act(async () => {
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  });
  assert.equal(menu(), null, 'a click outside closes it');
  ui.unmount();
});
