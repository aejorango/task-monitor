// src/hooks/useNotifications.js — service worker registration + permission +
// overdue scan on app load (and every 5 min while open).

import { useEffect, useState } from 'react';
import { useTasks } from './useTasks';
import { todayLocal } from '../services/firebase';

const LAST_CHECK_KEY = 'task-monitor.notif.lastCheck.v1';
const SHOWN_KEY      = 'task-monitor.notif.shown.v1';

export function getNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  const result = await Notification.requestPermission();
  return result;
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  // import.meta.env.BASE_URL = '/' in prod (custom domain) or '/' in dev.
  const swUrl   = `${import.meta.env.BASE_URL}sw.js`;
  const swScope = import.meta.env.BASE_URL;
  return navigator.serviceWorker
    .register(swUrl, { scope: swScope })
    .then((reg) => {
      console.info('[sw] registered at scope:', reg.scope);
      return reg;
    })
    .catch((err) => {
      console.warn('[sw] registration failed:', err);
      return null;
    });
}

function loadShown() {
  try { return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveShown(set) {
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...set])); } catch {}
}

async function fireOverdueNotification(task) {
  const title = '⚠️ Task overdue';
  const body  = `${task.title} was due ${task.plan.endDate}.`;
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (reg && reg.showNotification) {
    reg.showNotification(title, { body, tag: `overdue-${task.id}`, data: { url: import.meta.env.BASE_URL } });
  } else if (typeof Notification !== 'undefined') {
    new Notification(title, { body, tag: `overdue-${task.id}` });
  }
}

export function useOverdueScan() {
  const { tasks } = useTasks();
  const [permission, setPermission] = useState(getNotificationPermission());

  // Listen for permission changes (some browsers fire a 'change' event)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions.query({ name: 'notifications' }).then((status) => {
      if (cancelled) return;
      const update = () => setPermission(status.state);
      status.onchange = update;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;
    let cancelled = false;

    const scan = async () => {
      const today = todayLocal();
      const overdue = tasks.filter((t) =>
        t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today
      );
      if (overdue.length === 0) return;
      const shown = loadShown();
      let added = false;
      for (const t of overdue) {
        const key = `${t.id}|${t.plan.endDate}`;
        if (shown.has(key)) continue;
        shown.add(key);
        added = true;
        try { await fireOverdueNotification(t); } catch (e) { console.error(e); }
      }
      if (added) saveShown(shown);
      try { localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString()); } catch {}
    };

    scan();
    const id = setInterval(() => { if (!cancelled) scan(); }, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tasks, permission]);

  return { permission, refresh: () => setPermission(getNotificationPermission()) };
}
