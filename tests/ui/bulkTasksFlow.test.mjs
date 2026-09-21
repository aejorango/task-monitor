// T-0129 / IMP-017 — the acceptance path, end to end.
//
//   1. Given ten tasks selected in the Task table
//   2. When the user picks "Set priority → High" from the bulk bar
//   3. Then all ten are updated in one batch, a toast confirms the count with
//      Undo, and the selection clears
//
// The three halves are covered on their own — the plan in
// src/services/bulkTasks.test.mjs, the committing in bulkTasksApi.test.mjs, the
// surface in bulkTasksUi.test.mjs. This is the join: the real grid, the real
// bar and the real hook, wired the way TasksTableView wires them, with the
// write and the toast recorded instead of performed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { useMemo, act } from 'react';
import { setupDom, teardownDom, mount, clickText, muteConsoleError } from './dom.mjs';

setupDom();

const { TasksTableGrid, TaskBulkBar } = await import('../../src/components/TasksTableView.jsx');
const { useBulkTasks } = await import('../../src/hooks/useBulkTasks.js');
const { groupTasks, headerCells, normalizeTableConfig } = await import('../../src/services/tableViews.js');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const TASKS = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i}`, title: `Task ${i}`, status: 'todo', priority: 'low',
  projectId: 'p1', plan: { endDate: '2026-10-01' }, actual: {}, tags: [], assignedTo: [],
}));
const ctx = {
  projectById: { p1: { id: 'p1', name: 'BRIDGED' } },
  memberProfiles: { 'u-mia': { displayName: 'Mia Santos' } },
  projects: [{ id: 'p1', name: 'BRIDGED' }],
};
const config = normalizeTableConfig({ groupBy: 'none' }, ctx);

/** Everything the page hands the hook, recorded. */
function makeRig({ tasks = TASKS, commitFails = null, confirmAnswer = true } = {}) {
  const rig = {
    commits: [],            // each call to the write path
    toasts: [],             // { tone, text, undo }
    confirms: [],           // the questions actually asked
  };
  rig.commit = async (writes) => {
    rig.commits.push(writes);
    if (commitFails !== null) {
      // Shaped like the real thing: a bulk edit that fails does so because one
      // of the tasks is outside what this person may write.
      throw Object.assign(
        new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'),
        { code: 'permission-denied', committed: commitFails },
      );
    }
    return { committed: writes.length, batches: 1 };
  };
  rig.toast = {
    success: (text, o = {}) => rig.toasts.push({ tone: 'success', text, undo: o.undo }),
    error:   (text) => rig.toasts.push({ tone: 'error', text }),
    info:    (text) => rig.toasts.push({ tone: 'info', text }),
  };
  rig.ask = {
    confirm: async (q) => { rig.confirms.push(q); return confirmAnswer; },
  };

  function Page() {
    const groups = useMemo(() => groupTasks(tasks, config, ctx), []);
    const orderedIds = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups]);
    const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), []);
    const nameFor = (uid) => ctx.memberProfiles[uid]?.displayName || uid;

    const bulk = useBulkTasks({
      orderedIds, byId, toast: rig.toast, ask: rig.ask, nameFor,
      commit: rig.commit, today: () => '2026-09-22',
    });
    rig.bulk = bulk;

    return h(React.Fragment, null,
      bulk.selected.size > 0 && h(TaskBulkBar, {
        count: bulk.selected.size, busy: bulk.busy, members: ['u-mia'], nameFor,
        onClear: bulk.clear, onRun: bulk.run,
      }),
      h(TasksTableGrid, {
        groups, header: headerCells(config, ctx), config, ctx,
        selected: bulk.selected, allSelected: bulk.allSelected,
        totalRows: orderedIds.length,
        onToggleAll: bulk.toggleAll, onSelectRow: bulk.clickRow,
        onOpenTask: () => {}, onSort: () => {},
      }),
    );
  }
  return { rig, Page };
}

const headBox = (ui) => ui.container.querySelector('th.tt-pick input');
const barText = (ui) => ui.container.querySelector('.bulk-bar-count')?.textContent.replace(/\s+/g, ' ').trim();
const click = async (el, init = {}) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
};

/* ── the acceptance sentence, one test ─────────────────────────────────── */

test('ten selected, Set priority → High: one batch, a toast with Undo, selection cleared', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));

  // 1. Given ten tasks selected.
  await click(headBox(ui));
  assert.equal(rig.bulk.selected.size, 10);
  assert.equal(barText(ui), '10 selected');

  // 2. When the user picks "Set priority → High".
  await clickText(ui.container, 'Set priority');
  await clickText(ui.container, 'High');

  // 3a. ...all ten are updated in one batch.
  assert.equal(rig.commits.length, 1, 'one call, not one per row');
  assert.equal(rig.commits[0].length, 10);
  assert.ok(rig.commits[0].every((w) => w.patch.priority === 'high'));
  assert.deepEqual(rig.commits[0].map((w) => w.id), TASKS.map((t) => t.id));

  // 3b. ...a toast confirms the count with Undo.
  assert.equal(rig.toasts.length, 1);
  assert.equal(rig.toasts[0].tone, 'success');
  assert.equal(rig.toasts[0].text, '10 tasks set to High priority');
  assert.equal(typeof rig.toasts[0].undo, 'function', 'a bulk change with no way back is a trap');

  // 3c. ...and the selection clears.
  assert.equal(rig.bulk.selected.size, 0);
  assert.equal(ui.container.querySelector('.bulk-bar'), null, 'the bar goes with the selection');
  assert.deepEqual(
    [...ui.container.querySelectorAll('td.tt-pick input')].map((b) => b.checked),
    Array(10).fill(false),
  );
  ui.unmount();
});

test('Undo puts every one of them back the way it was', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Set priority');
  await clickText(ui.container, 'High');

  await act(async () => { await rig.toasts[0].undo(); });

  assert.equal(rig.commits.length, 2, 'Undo is the same write path, replayed');
  assert.equal(rig.commits[1].length, 10);
  assert.ok(rig.commits[1].every((w) => w.patch.priority === 'low'),
    'the values from before the write — not a guess from the action');
  assert.match(rig.toasts.at(-1).text, /Put those 10 tasks back/);
  ui.unmount();
});

/* ── the rest of the flow ──────────────────────────────────────────────── */

test('a status change carries its stamps all the way to the write', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Set status');
  await clickText(ui.container, 'Done');

  const first = rig.commits[0][0].patch;
  assert.equal(first.status, 'done');
  assert.equal(first.progress, 100);
  assert.equal(first['actual.endDate'], '2026-09-22', 'the day passed in, not the UTC day');
  assert.match(rig.toasts[0].text, /10 tasks moved to Done/);
  ui.unmount();
});

test('assigning names the person in the toast, never their account id', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Assign to');
  await clickText(ui.container, 'Mia Santos');

  assert.equal(rig.toasts[0].text, '10 tasks assigned to Mia Santos');
  assert.doesNotMatch(rig.toasts[0].text, /u-mia/);
  ui.unmount();
});

test('delete asks first, and says where the tasks go', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Delete');

  assert.equal(rig.confirms.length, 1);
  assert.match(rig.confirms[0].title, /Delete 10 tasks\?/);
  assert.match(rig.confirms[0].message, /Trash/);
  assert.equal(rig.confirms[0].danger, true);
  assert.ok(rig.commits[0].every((w) => w.patch.deleted === true), 'soft delete, never a removal');
  ui.unmount();
});

test('saying no to the confirmation writes nothing at all', async () => {
  const { rig, Page } = makeRig({ confirmAnswer: false });
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Delete');

  assert.equal(rig.confirms.length, 1);
  assert.deepEqual(rig.commits, []);
  assert.deepEqual(rig.toasts, [], 'nothing happened, so nothing is announced');
  assert.equal(rig.bulk.selected.size, 10, 'and the selection is still there to try again');
  ui.unmount();
});

test('only the non-destructive actions skip the question', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Set priority');
  await clickText(ui.container, 'High');
  assert.deepEqual(rig.confirms, [], 'a priority change is not worth interrupting for');
  ui.unmount();
});

test('an action that would change nothing says so instead of writing', async () => {
  const already = TASKS.map((t) => ({ ...t, priority: 'high' }));
  const { rig, Page } = makeRig({ tasks: already });
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Set priority');
  await clickText(ui.container, 'High');

  assert.deepEqual(rig.commits, [], 'an empty batch is still a round trip');
  assert.equal(rig.toasts[0].tone, 'info');
  assert.match(rig.toasts[0].text, /already like that/);
  assert.equal(rig.bulk.selected.size, 10, 'nothing happened, so nothing is cleared');
  ui.unmount();
});

test('a write that stops part way says how far it got, and keeps the selection', async () => {
  const { rig, Page } = makeRig({ commitFails: 4 });
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Set priority');
  await clickText(ui.container, 'High');

  assert.equal(rig.toasts[0].tone, 'error');
  assert.match(rig.toasts[0].text, /Only 4 of 10/, '"nothing happened" would be a lie');
  assert.match(rig.toasts[0].text, /left as they were/, 'and what happened to the other six');
  assert.match(rig.toasts[0].text, /permission/i,
    'how far it got and WHY it stopped are two facts; one must not replace the other');
  assert.doesNotMatch(rig.toasts[0].text, /PERMISSION_DENIED|^7 /,
    'and the gRPC dump is not what the user reads');
  assert.equal(rig.bulk.selected.size, 10, 'the rows stay selected so it can be retried');
  ui.unmount();
});

test('a write that fails outright does not claim a partial result', async () => {
  const { rig, Page } = makeRig({ commitFails: 0 });
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Set priority');
  await clickText(ui.container, 'High');

  assert.equal(rig.toasts[0].tone, 'error');
  assert.doesNotMatch(rig.toasts[0].text, /Only 0/, '"0 of 10 changed" is a confusing way to say none');
  assert.doesNotMatch(rig.toasts[0].text, /PERMISSION_DENIED/);
  assert.match(rig.toasts[0].text, /permission/i);
  ui.unmount();
});

test('nothing selected means nothing runs', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  assert.equal(ui.container.querySelector('.bulk-bar'), null, 'no selection, no bar');
  await act(async () => { await rig.bulk.run('delete'); });
  assert.deepEqual(rig.commits, []);
  assert.deepEqual(rig.confirms, [], 'an empty selection must not even ask');
  ui.unmount();
});

test('Clear drops the selection without writing anything', async () => {
  const { rig, Page } = makeRig();
  const ui = await mount(h(Page));
  await click(headBox(ui));
  await clickText(ui.container, 'Clear');
  assert.equal(rig.bulk.selected.size, 0);
  assert.deepEqual(rig.commits, []);
  ui.unmount();
});
