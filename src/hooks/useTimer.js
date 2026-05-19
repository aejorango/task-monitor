// src/hooks/useTimer.js — single-track timer with localStorage persistence.

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'task-monitor.timer.v1';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.taskId || !parsed?.startedAt) return null;
    return parsed;
  } catch { return null; }
}

let current = load();
const subs = new Set();

function setAll(next) {
  current = next;
  if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  else localStorage.removeItem(STORAGE_KEY);
  subs.forEach((cb) => cb(current));
}

export function useTimer() {
  const [state, setState] = useState(current);

  useEffect(() => {
    const cb = (s) => setState(s);
    subs.add(cb);
    return () => subs.delete(cb);
  }, []);

  // Live tick — only when running.
  const [, force] = useState(0);
  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback((task) => {
    setAll({
      taskId:    task.id,
      taskTitle: task.title,
      startedAt: Date.now(),
    });
  }, []);

  const stop = useCallback(() => {
    const stopped = current;
    setAll(null);
    return stopped;
  }, []);

  const elapsedMs = state ? Date.now() - state.startedAt : 0;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  return { running: !!state, state, elapsedMs, elapsedHours, start, stop };
}

export function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
