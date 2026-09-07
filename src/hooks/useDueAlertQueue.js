// src/hooks/useDueAlertQueue.js — one due task at a time for the in-app alert.
//
// Recomputes the queue every 60 s and whenever the task list changes, but
// keeps the task currently on screen pinned until it becomes ineligible so a
// Firestore update mid-read never swaps the task under the user. Snooze and
// skip are per-device (localStorage) — see services/dueAlerts.js for why.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTasks } from './useTasks';
import { useSettings } from './useSettings';
import { useTimer } from './useTimer';
import { setTaskStatus, todayLocal } from '../services/firebase';
import {
  buildAlertQueue, alertKey, loadAlertState, saveAlertState, snoozeUntil,
  isQuietNow, isMutedToday, setMutedOn,
  SNOOZE_KEY_PREFIX, SKIP_KEY_PREFIX, MUTE_KEY_PREFIX, DEFAULT_DUE_ALERT_SETTINGS,
} from '../services/dueAlerts';

// Every hook instance in this tab (modal + topbar bell) re-reads localStorage
// when this fires; other tabs get the native `storage` event instead.
export const REFRESH_EVENT = 'task-monitor:due-alerts-refresh';
const notifyLocal = () => window.dispatchEvent(new CustomEvent(REFRESH_EVENT));

const TICK_MS = 60_000;
// TaskDoneCelebration auto-dismisses after 4.2 s; advance a little later so
// the next alert never stacks on the confetti card.
const CELEBRATION_MS = 4_600;

// Another dialog is open — do not cover it. Checked on every tick, so the
// alert shows on the first tick after the other modal closes.
function anotherDialogOpen() {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector(
    '.modal-backdrop:not(.due-alert-backdrop), .celebrate-backdrop',
  );
}

export function useDueAlertQueue() {
  const { tasks, userId } = useTasks();
  const { settings } = useSettings();
  const { state: timerState } = useTimer();
  const prefs = { ...DEFAULT_DUE_ALERT_SETTINGS, ...(settings.dueAlerts || {}) };

  // Wall clock, refreshed by the heartbeat (never read Date.now() in render).
  // 0 until the first tick lands, during which nothing is shown.
  const [now, setNow] = useState(0);
  const [storeVersion, setStoreVersion] = useState(0);
  const [paused, setPaused] = useState(false);       // during Done → celebration
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(() => setNow(Date.now()), []);
  const reloadStore = useCallback(() => setStoreVersion((n) => n + 1), []);

  const today = todayLocal();

  // Per-device snooze / skip state. Derived (not copied into state) so a user
  // change re-reads it immediately; storeVersion bumps re-read after writes,
  // after another tab writes (storage event), and after Settings clears it.
  const alertState = useMemo(
    () => loadAlertState(userId, { today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, today, storeVersion],
  );
  const muted = useMemo(
    () => isMutedToday(userId, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, today, storeVersion],
  );

  useEffect(() => {
    if (!userId) return;
    const onStorage = (e) => {
      if (!e.key) return;
      if (e.key === SNOOZE_KEY_PREFIX + userId || e.key === SKIP_KEY_PREFIX + userId
        || e.key === MUTE_KEY_PREFIX + userId) reloadStore();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(REFRESH_EVENT, reloadStore);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(REFRESH_EVENT, reloadStore);
    };
  }, [userId, reloadStore]);

  // 60-second heartbeat: expires snoozes, re-checks quiet hours and whether
  // another dialog is still open.
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, TICK_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [refresh]);

  // Track whether another dialog is open so the alert never covers it. The
  // observer fires as soon as a modal mounts / unmounts; setState is a no-op
  // when the answer has not changed.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const check = () => setDialogOpen(anotherDialogOpen());
    const id = setTimeout(check, 0);
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { clearTimeout(id); mo.disconnect(); };
  }, []);

  const queue = useMemo(() => {
    if (!prefs.enabled) return [];
    return buildAlertQueue(tasks, {
      today,
      leadDays: prefs.leadDays,
      snoozes: alertState.snoozes,
      skips: alertState.skips,
      now,
    });
  }, [tasks, today, prefs.enabled, prefs.leadDays, alertState, now]);

  // Pin the on-screen task until it drops out of the queue ("previous render"
  // pattern: state adjusted during render, only when the queue changed).
  const [pin, setPin] = useState({ queue, id: null });
  let pinnedId = pin.id;
  if (pin.queue !== queue) {
    const still = pinnedId && queue.some((t) => t.id === pinnedId);
    pinnedId = still ? pinnedId : (queue[0]?.id ?? null);
    setPin({ queue, id: pinnedId });
  }
  const current = pinnedId ? queue.find((t) => t.id === pinnedId) || null : null;

  // Suppression hides the modal without dequeuing anything.
  const suppressed = paused
    || muted
    || now === 0
    || isQuietNow(prefs, new Date(now))
    || (current && timerState?.taskId === current.id)
    || dialogOpen;

  const persist = useCallback((next) => {
    saveAlertState(userId, next);
    notifyLocal();
  }, [userId]);

  // "Close all": hide every alert for the rest of today on this device.
  // Nothing is skipped or snoozed, so resuming brings the same queue back.
  const muteAll = useCallback(() => {
    setMutedOn(userId, today);
    notifyLocal();
  }, [userId, today]);

  const unmute = useCallback(() => {
    setMutedOn(userId, null);
    notifyLocal();
  }, [userId]);

  const snooze = useCallback((minutes = prefs.defaultSnoozeMin) => {
    if (!current) return null;
    const until = snoozeUntil(minutes);
    persist({ ...alertState, snoozes: { ...alertState.snoozes, [current.id]: until } });
    return { task: current, until };
  }, [current, alertState, persist, prefs.defaultSnoozeMin]);

  const skip = useCallback(() => {
    if (!current) return null;
    const key = alertKey(current, today);
    persist({ ...alertState, skips: [...alertState.skips, key] });
    return current;
  }, [current, alertState, persist, today]);

  const markDone = useCallback(async () => {
    if (!current) return;
    const task = current;
    setPaused(true);                       // close the alert before the celebration
    try {
      await setTaskStatus(task, 'done');   // fires emitTaskDone → celebration
    } catch (err) {
      console.error('[due-alert] mark done failed:', err);
      setPaused(false);
      throw err;
    }
    setTimeout(() => setPaused(false), CELEBRATION_MS);
  }, [current]);

  return {
    current: suppressed ? null : current,
    remaining: queue.length,   // due alerts not yet handled (even while muted)
    muted,
    enabled: prefs.enabled,
    today,
    prefs,
    snooze,
    skip,
    markDone,
    muteAll,
    unmute,
    refresh,
  };
}
