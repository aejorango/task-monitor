// src/hooks/useRecurrenceCatchUp.js — keep recurring tasks coming round.
//
// A recurring task used to appear only when the previous one was ticked off, so
// a weekly ritual nobody completed died at the first missed week. This runs the
// catch-up: on load, and once an hour after that, so a series that is due
// appears without anybody having to finish anything.
//
// It runs in the app rather than on a schedule in the cloud, deliberately: this
// stays a static front end with one narrow Cloud Functions deployment, and a
// task app is opened daily by the people who use it. The trade-off is honest
// and worth saying out loud — a workspace nobody opens for a month catches up
// the next time somebody opens it, not before.

import { useEffect, useRef } from 'react';
import { materialiseRecurrences } from '../services/firebase';
import { describeCatchUp } from '../services/recurrenceSchedule';
import { todayLocal } from '../services/recurrence';

/** How often to look again while the app is left open. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

export function useRecurrenceCatchUp(tasks, { userId, enabled = true } = {}) {
  // The tasks the run should read, without making the run itself restart every
  // time the list changes. Assigned in an effect, not during render.
  const latest = useRef(tasks);
  useEffect(() => { latest.current = tasks; }, [tasks]);

  // One run per day per device is enough; the interval is a safety net for an
  // app left open across midnight.
  const ranFor = useRef(null);

  useEffect(() => {
    if (!enabled || !userId) return undefined;

    let alive = true;
    const run = async () => {
      const today = todayLocal();
      if (!alive || ranFor.current === today) return;
      const list = latest.current;
      if (!Array.isArray(list) || list.length === 0) return;   // nothing loaded yet
      ranFor.current = today;
      try {
        const created = await materialiseRecurrences(list, { userId, today });
        if (created.length) console.info('[recurrence]', describeCatchUp(created));
      } catch (err) {
        // A catch-up that fails is not worth interrupting anybody over: the
        // next run, or ticking a task off, does the same job.
        console.warn('[recurrence] catch-up failed', err);
        ranFor.current = null;
      }
    };

    // A short delay so the first paint is not competing with a write.
    const kickoff = setTimeout(run, 4000);
    const timer = setInterval(run, CHECK_EVERY_MS);
    return () => { alive = false; clearTimeout(kickoff); clearInterval(timer); };
  }, [enabled, userId]);
}

export default useRecurrenceCatchUp;
