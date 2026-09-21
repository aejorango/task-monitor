// src/hooks/useBulkTasks.js — selecting rows, and running one action over them.
//
// Lifted out of TasksTableView for T-0129. Everything the acceptance criteria
// for IMP-017 describe happens here — "all ten are updated in one batch, a
// toast confirms the count with Undo, and the selection clears" — and inside a
// page that cannot render without a live workspace, none of it could be driven
// by a test. It was covered as three separate halves plus a source guard that
// the page joined them up; this is the join, and it can be mounted.
//
// The decisions all still belong to the pure `services/bulkTasks.js`. This owns
// only the sequencing: ask first if the action is destructive, plan, commit,
// clear, say so, offer the way back.

import { useCallback, useMemo, useState } from 'react';
import {
  bulkPlan, confirmFor, describeBulk, pruneSelection, selectionAfterClick,
} from '../services/bulkTasks';
import { bulkUpdateTasks } from '../services/firebase';
import { todayLocal } from '../services/recurrence';
import { friendlyError } from '../services/access';

/**
 * @param {object}   opts
 * @param {string[]} opts.orderedIds  the row ids in the order they are shown
 * @param {object}   opts.byId        id → task
 * @param {object}   opts.toast       useToast()
 * @param {object}   opts.ask         useDialog()
 * @param {function} opts.nameFor     uid → the person's name
 * @param {function} [opts.commit]    the write. Defaults to bulkUpdateTasks;
 *                                    a test passes a recorder. Nothing in the
 *                                    app passes it.
 * @param {function} [opts.today]     defaults to todayLocal()
 */
export function useBulkTasks({
  orderedIds = [], byId = {}, toast, ask, nameFor = (v) => v,
  commit = bulkUpdateTasks, today = todayLocal,
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [busy, setBusy] = useState(false);

  // Pruned during RENDER, not in an effect: an effect would let one frame paint
  // — and one click land — against rows that are already gone.
  const live = useMemo(() => pruneSelection(selected, orderedIds), [selected, orderedIds]);

  const selectedTasks = useMemo(
    () => orderedIds.filter((id) => live.has(id)).map((id) => byId[id]).filter(Boolean),
    [orderedIds, live, byId],
  );

  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => live.has(id));

  const clear = useCallback(() => { setSelected(new Set()); setAnchor(null); }, []);

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(orderedIds));
    setAnchor(null);
  }, [allSelected, orderedIds]);

  const clickRow = useCallback((id, e) => {
    const next = selectionAfterClick({
      selected: live, anchor, orderedIds, id,
      shiftKey: e.shiftKey, metaKey: e.metaKey || e.ctrlKey,
    });
    setSelected(next.selected);
    setAnchor(next.anchor);
  }, [live, anchor, orderedIds]);

  /** Run one bulk action over the current selection, with an Undo. */
  const run = useCallback(async (actionId, value) => {
    const chosen = selectedTasks;
    if (!chosen.length || busy) return;

    const question = confirmFor(actionId, chosen.length);
    if (question && !(await ask.confirm(question))) return;

    const plan = bulkPlan(chosen, actionId, value, { today: today() });
    if (!plan.changed) {
      toast.info(`Nothing to change — ${chosen.length === 1 ? 'that task is' : 'those tasks are'} already like that.`);
      return;
    }

    setBusy(true);
    try {
      await commit(plan.writes);
      clear();
      toast.success(describeBulk(actionId, value, plan, { nameFor }), {
        // Undo replays the values captured before the write — see bulkPlan.
        undo: async () => {
          await commit(plan.undo);
          toast.info(`Put ${plan.changed === 1 ? 'that task' : `those ${plan.changed} tasks`} back.`);
        },
      });
    } catch (err) {
      console.error('[bulk] update failed:', err);
      // A batch is all or nothing, but a run of several batches can stop part
      // way. How far it got and WHY it stopped are two different facts, and the
      // user needs both: passing the count as friendlyError's fallback loses it
      // the moment the error has a message of its own — which a permission
      // failure, the likeliest cause here, always does.
      const landed = err?.committed || 0;
      const why = friendlyError(err, 'Please try again.');
      toast.error(landed
        ? `Only ${landed} of ${plan.changed} could be changed — the rest were left as they were. ${why}`
        : friendlyError(err, 'Those tasks could not be changed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }, [selectedTasks, busy, ask, toast, nameFor, commit, today, clear]);

  return { selected: live, allSelected, busy, toggleAll, clickRow, clear, run };
}

export default useBulkTasks;
