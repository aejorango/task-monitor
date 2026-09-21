// src/hooks/useMyWeek.js — the week, and what dragging inside it does.
//
// Lifted out of MyWeekView for T-0132, for the same reason useBulkTasks was
// lifted out of the task table: the page cannot render without a live
// workspace, so anything left inside it can only be checked by reading the
// source. The acceptance criteria for NEW-020 end in "dragging one to another
// day writes plan.endDate while preserving its duration" — that is a sentence
// about behaviour, and it belongs in a test that can actually perform it.
//
// The decisions still belong elsewhere: `services/myWeek.js` buckets, and
// `moveTaskToDay` in `services/workload.js` says what a drop writes. This owns
// the week you are looking at, and the sequence around one drop.

import { useCallback, useMemo, useState } from 'react';
import { buildMyWeek, clampOffset } from '../services/myWeek';
import { moveTaskToDay } from '../services/workload';
import { updateTask, todayLocal } from '../services/firebase';
import { friendlyError } from '../services/access';

export function useMyWeek({
  tasks = [], userId, workspaces = [], weekStart = 1, toast,
  commit = updateTask, today = todayLocal,
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(null);

  const now = today();
  const week = useMemo(
    () => buildMyWeek({ tasks, userId, workspaces, today: now, weekStart, offset }),
    [tasks, userId, workspaces, now, weekStart, offset],
  );

  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  const goToWeek = useCallback((next) => setOffset((o) => clampOffset(
    typeof next === 'function' ? next(o) : next,
  )), []);

  const onDragStart = useCallback(({ active }) => {
    setDragging(byId[active?.id] || null);
  }, [byId]);

  const onDragCancel = useCallback(() => setDragging(null), []);

  const onDragEnd = useCallback(async ({ active, over }) => {
    setDragging(null);
    if (!over) return;                       // dropped on nothing
    const task = byId[active?.id];
    const patch = moveTaskToDay(task, over.id);
    if (!patch) return;                      // dropped where it already was
    try {
      await commit(task.id, patch);
    } catch (err) {
      console.error('[my-week] reschedule failed:', err);
      toast?.error(friendlyError(err, 'Could not move that task. Please try again.'));
    }
  }, [byId, commit, toast]);

  return { week, offset, goToWeek, dragging, onDragStart, onDragEnd, onDragCancel };
}

export default useMyWeek;
