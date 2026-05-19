// src/hooks/useTasks.js
// React hooks wrapping the Firestore subscriptions.

import { useEffect, useMemo, useState } from 'react';
import {
  onAuthChange,
  subscribeToTasks,
  subscribeToActivities,
  subscribeToRecentActivities,
  subscribeToAllActivities,
  subscribeToProjects,
  subscribeToTemplates,
  subscribeToTaskComments,
  subscribeToSavedViews,
  migrateLegacyCategories,
  todayLocal,
} from '../services/firebase';

// ─── useAuth ────────────────────────────────────────────────────────────────

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

// ─── useProjects ────────────────────────────────────────────────────────────
// Live list of the user's projects. Runs a one-time migration on first sign-in
// to seed default projects from the legacy categories.

export function useProjects() {
  const { userId, ready } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId) return;

    let cancelled = false;
    migrateLegacyCategories(userId)
      .then((result) => {
        if (!cancelled && result.migrated) {
          console.info('[migration]', result);
        }
      })
      .catch((err) => console.error('[migration] failed:', err));

    const unsub = subscribeToProjects(userId, (data) => {
      setProjects(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [userId, ready]);

  const byId = useMemo(() => {
    const map = {};
    projects.forEach((p) => { map[p.id] = p; });
    return map;
  }, [projects]);

  return { projects, byId, loading, userId };
}

// ─── useTasks ───────────────────────────────────────────────────────────────

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
    userId,
  };
}

// ─── useActivities (one task) ───────────────────────────────────────────────

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

// ─── useAllActivities (cross-task, Table view) ──────────────────────────────

export function useAllActivities() {
  const { userId, ready } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId) return;
    const unsub = subscribeToAllActivities(userId, (data) => {
      setActivities(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready]);

  return { activities, loading };
}

// ─── useRecentActivities ────────────────────────────────────────────────────

// ─── useSavedViews ──────────────────────────────────────────────────────────

export function useSavedViews() {
  const { userId, ready } = useAuth();
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId) return;
    const unsub = subscribeToSavedViews(userId, (data) => {
      setViews(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready]);

  return { views, loading, userId };
}

// ─── useTaskComments ────────────────────────────────────────────────────────

export function useTaskComments(taskId) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId) {
      setComments([]);
      setLoading(false);
      return;
    }
    const unsub = subscribeToTaskComments(taskId, (data) => {
      setComments(data);
      setLoading(false);
    });
    return () => unsub();
  }, [taskId]);

  return { comments, loading };
}

// ─── useTemplates ───────────────────────────────────────────────────────────

export function useTemplates() {
  const { userId, ready } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId) return;
    const unsub = subscribeToTemplates(userId, (data) => {
      setTemplates(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready]);

  return { templates, loading, userId };
}

export function useRecentActivities(days = 7) {
  const { userId, ready } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId) return;

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
