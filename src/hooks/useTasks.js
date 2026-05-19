// src/hooks/useTasks.js
// React hooks wrapping the Firestore subscriptions.

import { useEffect, useState } from 'react';
import {
  onAuthChange,
  subscribeToTasks,
  subscribeToActivities,
  subscribeToRecentActivities,
  todayLocal,
} from '../services/firebase';

// ─── useAuth ────────────────────────────────────────────────────────────────
// Tracks the anonymous user session. `ready` flips true once Firebase responds,
// even if userId is still null (lets you show a loading state vs failed auth).

export function useAuth() {
  const [userId, setUserId] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setUserId(user?.uid || null);
      setReady(true);
    });
    return () => unsub();
  }, []);

  return { userId, ready };
}

// ─── useTasks ───────────────────────────────────────────────────────────────
// Live list of the user's active tasks plus convenience filters.

export function useTasks() {
  const { userId, ready } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId) return;
    const unsub = subscribeToTasks(userId, (data) => {
      setTasks(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready]);

  const byStatus = (status) => tasks.filter((t) => t.status === status);
  const byCategory = (cat) =>
    cat === 'All' ? tasks : tasks.filter((t) => t.category === cat);

  // Overdue: plan.endDate is past AND status isn't done
  const today = todayLocal();
  const overdue = tasks.filter(
    (t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today
  );

  return {
    tasks,
    loading,
    todo:  byStatus('todo'),
    doing: byStatus('doing'),
    done:  byStatus('done'),
    overdue,
    byCategory,
    userId,
  };
}

// ─── useActivities ──────────────────────────────────────────────────────────
// Live activity log for ONE task.

export function useActivities(taskId) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId) {
      setActivities([]);
      setLoading(false);
      return;
    }
    const unsub = subscribeToActivities(taskId, (data) => {
      setActivities(data);
      setLoading(false);
    });
    return () => unsub();
  }, [taskId]);

  return { activities, loading };
}

// ─── useRecentActivities ────────────────────────────────────────────────────
// Cross-task daily/weekly journal — accepts a lookback in days.

export function useRecentActivities(days = 7) {
  const { userId, ready } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId) return;

    // Compute "since" date in local TZ
    const since = new Date();
    since.setDate(since.getDate() - days);
    const y = since.getFullYear();
    const m = String(since.getMonth() + 1).padStart(2, '0');
    const d = String(since.getDate()).padStart(2, '0');
    const sinceStr = `${y}-${m}-${d}`;

    const unsub = subscribeToRecentActivities(userId, sinceStr, (data) => {
      setActivities(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, days]);

  // Group by date for journal-style rendering
  const byDay = activities.reduce((acc, a) => {
    (acc[a.date] = acc[a.date] || []).push(a);
    return acc;
  }, {});

  const totalHours = activities.reduce(
    (sum, a) => sum + (a.hoursSpent || 0),
    0
  );

  return { activities, byDay, totalHours, loading };
}
