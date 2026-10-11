// src/hooks/useTasks.js
// React hooks wrapping the Firestore subscriptions. Every collection-level
// hook reads the workspaces IN VIEW: the active one, or — with "All
// workspaces" on — every one the user belongs to, merged (see
// useScopeWorkspaceIds and services/activeWorkspace.js). Each workspace is
// still its own query, on the same shared listener the single view uses, so
// no new index and no new rule is involved.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  subscribeToTasks,
  subscribeToActivities,
  subscribeToRecentActivities,
  subscribeToAllActivities,
  loadMoreActivities,
  ACTIVITY_PAGE_SIZE,
  subscribeToProjects,
  subscribeToProjectsAcrossWorkspaces,
  subscribeToTasksAcrossWorkspaces,
  subscribeToMyTasksAcrossWorkspaces,
  subscribeToSharedProjects,
  subscribeToTemplates,
  subscribeToGoals,
  subscribeToMinutes,
  subscribeToTaskComments,
  subscribeToSavedViews,
  subscribeToWebhooks,
  todayLocal,
} from '../services/firebase';
import {
  useActiveWorkspaceId, useWorkspaces, subscribeToAuthState, peekAuthState, useScopeWorkspaceIds,
} from './useWorkspace';
import { mergeProjectLists } from '../services/projects';
import { createSharedSubscription } from '../services/sharedSubscription';
import { isResolvingWorkspace } from '../services/activeWorkspace';

// ─── Shared listeners ───────────────────────────────────────────────────────
// One Firestore query per (collection, workspace), however many components ask.
// Board cards call these hooks by the hundred; see services/sharedSubscription.

const workspaceActivitiesCache = createSharedSubscription(
  (workspaceId, emit) => subscribeToAllActivities(workspaceId, emit),
  { name: 'activities', empty: [] },
);

// One listener per TASK, shared by every surface showing that task's log (the
// editor's Activity log, the Board card's inline list, TaskActivitiesModal).
//
// A task's log used to be filtered out of workspaceActivitiesCache instead.
// That listener is capped at ACTIVITY_PAGE_SIZE **workspace-wide**, so once a
// workspace had more recent entries than the cap, any task whose activities
// fell outside that window rendered as "No activities logged yet." — the work
// was still in Firestore, the screen just denied it.
//
// The key carries the workspace as well as the task because the query needs
// both (see subscribeToActivities: without the workspaceId clause the rules
// reject the query outright).
const TASK_KEY_SEP = '::';
const taskActivitiesCache = createSharedSubscription(
  (key, emit) => {
    // Split on the FIRST separator only: a plain split() would truncate an id
    // that happened to contain one.
    const at = key.indexOf(TASK_KEY_SEP);
    return subscribeToActivities(
      key.slice(0, at),
      key.slice(at + TASK_KEY_SEP.length),
      emit,
    );
  },
  { name: 'taskActivities', empty: [] },
);

const workspaceTasksCache = createSharedSubscription(
  (workspaceId, emit) => subscribeToTasks(workspaceId, emit),
  { name: 'tasks', empty: [] },
);

const workspaceProjectsCache = createSharedSubscription(
  (workspaceId, emit) => subscribeToProjects(workspaceId, emit),
  { name: 'projects', empty: [] },
);

const workspaceGoalsCache = createSharedSubscription(
  (workspaceId, emit) => subscribeToGoals(workspaceId, emit),
  { name: 'goals', empty: [] },
);
const workspaceMinutesCache = createSharedSubscription(
  (workspaceId, emit) => subscribeToMinutes(workspaceId, emit),
  { name: 'minutes', empty: [] },
);
const workspaceTemplatesCache = createSharedSubscription(
  (workspaceId, emit) => subscribeToTemplates(workspaceId, emit),
  { name: 'templates', empty: [] },
);
const recentActivitiesCache = createSharedSubscription(
  (key, emit) => {
    const at = key.indexOf(TASK_KEY_SEP);
    return subscribeToRecentActivities(key.slice(0, at), key.slice(at + TASK_KEY_SEP.length), emit);
  },
  { name: 'recentActivities', empty: [] },
);

/**
 * Subscribe to `cache` once per key and merge what comes back. `keys` empty
 * means "nothing to ask yet". Returns the rows per key as well, which the
 * activity pager needs to know how far back each workspace has gone.
 *
 * Rows from a previous set of keys are never shown under a new one: a switch
 * between one workspace and all of them reads as loading, not as the old
 * list for a frame.
 */
function useKeyedRows(cache, keys) {
  const sig = keys.join('|');
  const [got, setGot] = useState({ sig: null, rows: {} });
  useEffect(() => {
    if (!sig) return undefined;
    const rows = {};
    const unsubs = sig.split('|').map((k) => cache.subscribe(k, (data) => {
      rows[k] = data;
      setGot({ sig, rows: { ...rows } });
    }));
    return () => unsubs.forEach((u) => u());
  }, [cache, sig]);
  const fresh = got.sig === sig && !!sig;
  const list = useMemo(
    () => (fresh ? sig.split('|').flatMap((k) => got.rows[k] || []) : []),
    [fresh, got, sig],
  );
  const loading = !fresh || sig.split('|').some((k) => !(k in got.rows));
  return { list, byKey: fresh ? got.rows : {}, loading };
}

/**
 * The shared shape of a workspace-scoped hook: which workspaces to read, and
 * whether "nothing yet" is loading or really nothing.
 */
function useScope() {
  const { userId, ready } = useAuth();
  const { ids, all, activeId, pending } = useScopeWorkspaceIds();
  const live = ready && !!userId;
  const waiting = !ready || pending || isResolvingWorkspace({ ready, userId, workspaceId: activeId });
  return { userId, ready, live, ids: live ? ids : [], all, workspaceId: activeId, waiting };
}

// ─── useAuth ────────────────────────────────────────────────────────────────

export function useAuth() {
  // One onAuthStateChanged for the whole app — this hook is called from dozens
  // of components, including inside list items. See services/sharedSubscription.
  const [{ userId, ready }, setAuth] = useState(() => peekAuthState());

  useEffect(() => subscribeToAuthState(setAuth), []);

  return { userId, ready };
}

// ─── useProjects ────────────────────────────────────────────────────────────
// Live list of projects in the active workspace. Also kicks off the legacy
// category → projects migration on first sign-in.

export function useProjects() {
  const { userId, ready, live, ids, all, workspaceId, waiting } = useScope();
  const { list: workspaceProjects, loading: wsLoading } = useKeyedRows(workspaceProjectsCache, ids);
  const [sharedProjects, setSharedProjects] = useState([]);
  // Signed in with no workspace resolved YET is a loading state, not a
  // result: the query has not been asked, so its answer cannot be "none".
  const loading = ids.length ? wsLoading : waiting;

  // Projects shared with this user from OTHER workspaces. Without this, a
  // project that's been shared (recipient added to project.members) would
  // never appear in the recipient's list because the workspace-scoped query
  // above doesn't see it.
  useEffect(() => {
    if (!ready || !userId) return;
    const unsub = subscribeToSharedProjects(userId, setSharedProjects);
    return () => unsub();
  }, [userId, ready]);

  // Merge by id. Workspace-scoped doc wins on collision (same content; either
  // would work). Shared-only projects get `_shared: true` so the UI can label
  // them. Gated on `live` so a sign-out / user-switch never leaks stale shared
  // data through the memo. See services/projects.js.
  const projects = useMemo(() => {
    if (!live) return [];
    return mergeProjectLists(workspaceProjects, sharedProjects, ids);
  }, [workspaceProjects, sharedProjects, ids, live]);

  const byId = useMemo(() => {
    const map = {};
    projects.forEach((p) => { map[p.id] = p; });
    return map;
  }, [projects]);

  return { projects, byId, loading, userId, workspaceId, allWorkspaces: all };
}

// ─── useTasks ───────────────────────────────────────────────────────────────

export function useTasks() {
  const { userId, ready, ids, all, workspaceId, waiting } = useScope();
  const { list: workspaceTasks, loading: wsLoading } = useKeyedRows(workspaceTasksCache, ids);
  const loading = ids.length ? wsLoading : waiting;

  // NOTE (BUG-033): there used to be a second listener here —
  // `subscribeTo{Tasks,Activities}ByProjects(sharedProjectIds)` — and it was
  // both REDUNDANT and DENIED in production.
  //
  //   · Redundant, because `sharedProjectIds` was already filtered to the
  //     ACTIVE workspace, and the workspace-wide listener above asks
  //     `where('workspaceId','==',id)` — so it returns every one of those rows
  //     already. `tests/rules/consoleErrors.rules.test.mjs` proves it.
  //   · Denied, because `where('projectId','in',[…])` states nothing the read
  //     rule can use: the rule's satisfiable branch for a teammate's document
  //     is `isProjectMember`, an exists()+get() PER DOCUMENT, and rules are not
  //     filters — one document the rule cannot clear refuses the whole query.
  //     The console filled with `permission-denied` on every load.
  //
  // A project shared from a workspace you do not belong to was never reachable
  // either way: it cannot become your active workspace, so the memo dropped it
  // before the query ran. Nothing was lost by removing this.

  const tasks = useMemo(() => {
    if (!ready || !userId) return [];
    return workspaceTasks;
  }, [workspaceTasks, ready, userId]);

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
    allWorkspaces: all,
  };
}

// ─── useActivities (one task) ───────────────────────────────────────────────
// Queried per task (scoped to the workspace so the rules accept it), NOT
// filtered out of the workspace-wide window: that window is capped at
// ACTIVITY_PAGE_SIZE newest rows across the whole workspace, so a task whose
// entries had scrolled past the cap showed "No activities logged yet." while
// the same rows were still listed in Table/WBS. One task's history is small,
// so this query needs no cap of its own.
//
// `taskWorkspaceId` is the TASK's own workspace. It must be passed whenever
// the task may not be in the active one — "All workspaces", a shared project
// — because the query is refused (or empty) under any other workspace.
export function useActivities(taskId, taskWorkspaceId = null) {
  const activeId = useActiveWorkspaceId();
  const workspaceId = taskWorkspaceId || activeId;
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId || !workspaceId) {
      setActivities([]);
      setLoading(!!taskId && !workspaceId);
      return;
    }
    setLoading(true);
    return taskActivitiesCache.subscribe(`${workspaceId}${TASK_KEY_SEP}${taskId}`, (rows) => {
      setActivities(rows);        // subscribeToActivities already date-sorts
      setLoading(false);
    });
  }, [taskId, workspaceId]);

  return { activities, loading };
}

// ─── useAllActivities (cross-task, Table/Analytics views) ──────────────────

export function useAllActivities() {
  const { userId, ready, live, ids, workspaceId, waiting } = useScope();
  const { byKey: liveByWs, loading: wsLoading } = useKeyedRows(workspaceActivitiesCache, ids);
  const loading = ids.length ? wsLoading : waiting;

  // NOTE (BUG-033): a second, by-project listener used to sit here; it was
  // redundant with the workspace-wide one and refused by the rules. See the
  // same note in useTasks.

  // ── Older history, fetched on demand ────────────────────────────────────
  // Each workspace's live listener holds one page (its newest
  // ACTIVITY_PAGE_SIZE entries). "Load more" appends older pages with a
  // one-shot read PER WORKSPACE that still has more, from that workspace's
  // own oldest row — one shared cursor across workspaces would skip entries.
  const [older, setOlder] = useState({});      // wsId → rows
  const [more, setMore] = useState({});        // wsId → false once it ran out
  const [loadingMore, setLoadingMore] = useState(false);

  // A change of scope invalidates every page fetched. Adjusted during render
  // (the React-recommended pattern), so the previous scope's history never
  // paints for a frame.
  const scopeKey = ids.join('|');
  const [seenScope, setSeenScope] = useState(scopeKey);
  if (seenScope !== scopeKey) {
    setSeenScope(scopeKey);
    setOlder({});
    setMore({});
  }

  const activities = useMemo(() => {
    if (!live) return [];
    const map = new Map();
    ids.forEach((ws) => (liveByWs[ws] || []).forEach((a) => map.set(a.id, a)));
    ids.forEach((ws) => (older[ws] || []).forEach((a) => { if (!map.has(a.id)) map.set(a.id, a); }));
    return [...map.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [liveByWs, older, ids, live]);

  // A workspace may have more only if its live page came back FULL — a
  // half-empty page IS the end — and no older read has said otherwise.
  const pending = ids.filter((ws) => (liveByWs[ws]?.length || 0) >= ACTIVITY_PAGE_SIZE && more[ws] !== false);
  const mayHaveMore = pending.length > 0;

  const loadMore = useCallback(async () => {
    if (loadingMore || !mayHaveMore) return;
    setLoadingMore(true);
    try {
      await Promise.all(pending.map(async (ws) => {
        const rows = [...(liveByWs[ws] || []), ...(older[ws] || [])];
        const oldest = rows.map((a) => a.date).filter(Boolean).sort()[0];
        if (!oldest) { setMore((m) => ({ ...m, [ws]: false })); return; }
        const res = await loadMoreActivities(ws, oldest);
        setOlder((o) => ({ ...o, [ws]: [...(o[ws] || []), ...res.activities] }));
        setMore((m) => ({ ...m, [ws]: res.hasMore }));
      }));
    } catch (err) {
      console.error('[activities] load more failed:', err);
      setMore((m) => Object.fromEntries([...Object.entries(m), ...pending.map((ws) => [ws, false])]));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, mayHaveMore, pending, liveByWs, older]);

  return { activities, loading, loadMore, hasMore: mayHaveMore, loadingMore, userId, ready, workspaceId };
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
      setLoading(!ready || isResolvingWorkspace({ ready, userId, workspaceId }));
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
      setLoading(!ready || isResolvingWorkspace({ ready, userId, workspaceId }));
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

export function useTaskComments(workspaceId, taskId) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !taskId) {
      setComments([]);
      setLoading(false);
      return;
    }
    const unsub = subscribeToTaskComments(workspaceId, taskId, (data) => {
      setComments(data);
      setLoading(false);
    });
    return () => unsub();
  }, [workspaceId, taskId]);

  return { comments, loading };
}

// ─── useTemplates ───────────────────────────────────────────────────────────

export function useTemplates() {
  const { userId, ids, workspaceId, waiting } = useScope();
  const { list: templates, loading: wsLoading } = useKeyedRows(workspaceTemplatesCache, ids);
  return { templates, loading: ids.length ? wsLoading : waiting, userId, workspaceId };
}

// ─── useGoals ───────────────────────────────────────────────────────────────

export function useGoals() {
  const { userId, ids, workspaceId, waiting } = useScope();
  const { list: goals, loading: wsLoading } = useKeyedRows(workspaceGoalsCache, ids);
  return { goals, loading: ids.length ? wsLoading : waiting, userId, workspaceId };
}

// ─── useMinutes ─────────────────────────────────────────────────────────────

export function useMinutes() {
  const { userId, ids, workspaceId, waiting } = useScope();
  const { list, loading: wsLoading } = useKeyedRows(workspaceMinutesCache, ids);
  // Each workspace's listener sorts its own; merged, they need sorting again.
  const minutes = useMemo(
    () => (ids.length > 1 ? [...list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) : list),
    [list, ids.length],
  );
  return { minutes, loading: ids.length ? wsLoading : waiting, userId, workspaceId };
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

/**
 * Every task assigned to the signed-in person, in every workspace they belong
 * to — the data behind My Week (T-0130).
 *
 * Deliberately NOT `useAllWorkspaceTasks()` with a filter applied afterwards:
 * that one subscribes to every task in every workspace, and this is a screen
 * somebody leaves open all day. The filter is at the server.
 */
export function useMyTasksAcrossWorkspaces() {
  const { userId, ready } = useAuth();
  const { workspaces, loading: wsLoading } = useWorkspaces();
  const wsKey = workspaces.map((w) => w.id).sort().join(',');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = wsKey ? wsKey.split(',') : [];
    if (!ready || !userId || ids.length === 0) {
      setTasks([]);
      // Still waiting for the workspace list is not the same as having none.
      setLoading(Boolean(!ready || wsLoading));
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeToMyTasksAcrossWorkspaces(ids, userId, (data) => {
      setTasks(data);
      setLoading(false);
    });
    return () => unsub();
  }, [wsKey, userId, ready, wsLoading]);

  return { tasks, loading, userId, workspaces };
}

// ─── useRecentActivities ───────────────────────────────────────────────────

export function useRecentActivities(days = 7) {
  const { ids, waiting } = useScope();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
  const { list: activities, loading: wsLoading } = useKeyedRows(
    recentActivitiesCache,
    ids.map((ws) => `${ws}${TASK_KEY_SEP}${sinceStr}`),
  );
  const loading = ids.length ? wsLoading : waiting;

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
