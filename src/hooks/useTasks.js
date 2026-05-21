// src/hooks/useTasks.js
// React hooks wrapping the Firestore subscriptions. Every collection-level
// hook is scoped to the user's currently-active workspace.

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
  subscribeToWebhooks,
  migrateLegacyCategories,
  todayLocal,
} from '../services/firebase';
import { useActiveWorkspaceId } from './useWorkspace';

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
// Live list of projects in the active workspace. Also kicks off the legacy
// category → projects migration on first sign-in.

export function useProjects() {
  const { userId, ready } = useAuth();
  const workspaceId = useActiveWorkspaceId();
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
    return () => { cancelled = true; };
  }, [userId, ready]);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setProjects([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToProjects(workspaceId, (data) => {
      setProjects(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId]);

  const byId = useMemo(() => {
    const map = {};
    projects.forEach((p) => { map[p.id] = p; });
    return map;
  }, [projects]);

  return { projects, byId, loading, userId, workspaceId };
}

// ─── useTasks ───────────────────────────────────────────────────────────────

export function useTasks() {
  const { userId, ready } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setTasks([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToTasks(workspaceId, (data) => {
      setTasks(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId]);

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
    workspaceId,
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

// ─── useAllActivities (cross-task, Table/Analytics views) ──────────────────

export function useAllActivities() {
  const { userId, ready } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setActivities([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToAllActivities(workspaceId, (data) => {
      setActivities(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId]);

  return { activities, loading };
}

// ─── useWebhooks ───────────────────────────────────────────────────────────

export function useWebhooks() {
  const { userId, ready } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [hooks, setHooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setHooks([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToWebhooks(workspaceId, (data) => {
      setHooks(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId]);

  return { hooks, loading, userId, workspaceId };
}

// ─── useSavedViews ──────────────────────────────────────────────────────────

export function useSavedViews() {
  const { userId, ready } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setViews([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToSavedViews(workspaceId, userId, (data) => {
      setViews(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId]);

  return { views, loading, userId, workspaceId };
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
  const workspaceId = useActiveWorkspaceId();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setTemplates([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToTemplates(workspaceId, (data) => {
      setTemplates(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId]);

  return { templates, loading, userId, workspaceId };
}

// ─── useRecentActivities ───────────────────────────────────────────────────

export function useRecentActivities(days = 7) {
  const { userId, ready } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setActivities([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);

    const since = new Date();
    since.setDate(since.getDate() - days);
    const y = since.getFullYear();
    const m = String(since.getMonth() + 1).padStart(2, '0');
    const d = String(since.getDate()).padStart(2, '0');
    const sinceStr = `${y}-${m}-${d}`;

    const unsub = subscribeToRecentActivities(workspaceId, sinceStr, (data) => {
      setActivities(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId, days]);

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
