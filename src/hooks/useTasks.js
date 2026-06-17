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
  subscribeToProjectsAcrossWorkspaces,
  subscribeToTasksAcrossWorkspaces,
  subscribeToTemplates,
  subscribeToGoals,
  subscribeToTaskComments,
  subscribeToSavedViews,
  subscribeToWebhooks,
  todayLocal,
} from '../services/firebase';
import { useActiveWorkspaceId, useWorkspaces } from './useWorkspace';

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

  // Note: the legacy category→project migration was removed. Workspace
  // onboarding is handled by migrateToWorkspaces() (see useWorkspaces).

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
// Subscribe via the workspace-scoped query and filter to this task client-side.
// A direct `where('taskId','==',id)` query is rejected by the security rules
// (they gate reads on workspaceId/owner/project, and "rules are not filters"),
// which silently returned an empty list — so the activity log looked empty
// everywhere except WBS/Table (which already use the workspace-scoped query).
export function useActivities(taskId) {
  const workspaceId = useActiveWorkspaceId();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId || !workspaceId) {
      setActivities([]);
      setLoading(!!taskId && !workspaceId);
      return;
    }
    setLoading(true);
    const unsub = subscribeToAllActivities(workspaceId, (all) => {
      setActivities(
        all
          .filter((a) => a.taskId === taskId)
          .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      );
      setLoading(false);
    });
    return () => unsub();
  }, [taskId, workspaceId]);

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

// ─── useGoals ───────────────────────────────────────────────────────────────

export function useGoals() {
  const { userId, ready } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !userId || !workspaceId) {
      setGoals([]);
      setLoading(workspaceId ? true : false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToGoals(workspaceId, (data) => {
      setGoals(data);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, ready, workspaceId]);

  return { goals, loading, userId, workspaceId };
}

// ─── Cross-workspace projects & tasks ───────────────────────────────────────
// Span every workspace the signed-in user belongs to (security rules already
// gate reads to member workspaces). Used by Goals, where a deliverable may link
// projects from other workspaces and we compute each project's completion.

export function useAllWorkspaceProjects() {
  const { workspaces } = useWorkspaces();
  const wsKey = workspaces.map((w) => w.id).sort().join(',');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = wsKey ? wsKey.split(',') : [];
    if (ids.length === 0) { setProjects([]); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToProjectsAcrossWorkspaces(ids, (data) => {
      setProjects(data);
      setLoading(false);
    });
    return () => unsub();
  }, [wsKey]);

  return { projects, loading };
}

export function useAllWorkspaceTasks() {
  const { workspaces } = useWorkspaces();
  const wsKey = workspaces.map((w) => w.id).sort().join(',');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = wsKey ? wsKey.split(',') : [];
    if (ids.length === 0) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToTasksAcrossWorkspaces(ids, (data) => {
      setTasks(data);
      setLoading(false);
    });
    return () => unsub();
  }, [wsKey]);

  return { tasks, loading };
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
