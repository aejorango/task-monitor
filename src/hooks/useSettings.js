// src/hooks/useSettings.js — localStorage-backed user settings.
// Per-device by design (matches the anonymous-auth model).

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'task-monitor.settings.v1';

const DEFAULTS = {
  theme:           'system',  // 'system' | 'light' | 'dark'
  defaultProject:  null,      // projectId to preselect in quick-add
  weekStart:       1,         // 0=Sun, 1=Mon
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
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
    setAll({ ...current, ...patch });
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
