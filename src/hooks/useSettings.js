// src/hooks/useSettings.js — localStorage-backed user settings.
// Per-device by design (matches the anonymous-auth model).

import { useEffect, useState, useCallback } from 'react';
import { DEFAULT_DUE_ALERT_SETTINGS } from '../services/dueAlerts';

const STORAGE_KEY = 'task-monitor.settings.v1';

const DEFAULTS = {
  theme:           'light',   // 'system' | 'light' | 'dark'
  defaultProject:  null,      // projectId to preselect in quick-add
  weekStart:       1,         // 0=Sun, 1=Mon
  dueAlerts:       { ...DEFAULT_DUE_ALERT_SETTINGS }, // in-app due-task modal
};

// Shallow merge, except nested settings objects (dueAlerts) which merge one
// level deep so users who saved settings before a key existed get its default.
function merge(base, patch) {
  const next = { ...base, ...patch };
  if (patch && patch.dueAlerts) next.dueAlerts = { ...base.dueAlerts, ...patch.dueAlerts };
  return next;
}

// Due-task alerts used to default ON, so every device that ever saved any
// setting has `dueAlerts.enabled: true` written into it — a stored value the
// new default can never override. That `true` was inherited, not chosen, so it
// is cleared once, here. The flag means a later deliberate opt-in is never
// undone on the next load.
const DUE_ALERT_OPT_IN_KEY = 'task-monitor.dueAlerts.optIn.v1';

function applyDueAlertOptIn(settings) {
  try {
    if (localStorage.getItem(DUE_ALERT_OPT_IN_KEY)) return settings;
    localStorage.setItem(DUE_ALERT_OPT_IN_KEY, '1');
    return { ...settings, dueAlerts: { ...settings.dueAlerts, enabled: false } };
  } catch {
    return settings;
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return applyDueAlertOptIn({ ...DEFAULTS });
    return applyDueAlertOptIn(merge(DEFAULTS, JSON.parse(raw)));
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

// Module-level state so all hook consumers see updates immediately.
let current = load();
const subscribers = new Set();

// The settings as loaded, without subscribing — for callers outside React
// (and for tests, which need to see what load() resolved to).
export function readSettings() { return current; }

function setAll(next) {
  current = next;
  save(current);
  subscribers.forEach((cb) => cb(current));
  applyTheme(current.theme);
}

export function useSettings() {
  const [state, setState] = useState(current);

  useEffect(() => {
    const cb = (s) => setState(s);
    subscribers.add(cb);
    applyTheme(current.theme);
    return () => subscribers.delete(cb);
  }, []);

  const update = useCallback((patch) => {
    setAll(merge(current, patch));
  }, []);

  const reset = useCallback(() => setAll({ ...DEFAULTS }), []);

  return { settings: state, update, reset };
}

// Apply theme by setting [data-theme] on documentElement.
// `system` removes the attr and lets prefers-color-scheme decide.
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

// Initialize theme at module load
applyTheme(current.theme);
