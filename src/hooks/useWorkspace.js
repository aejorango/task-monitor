// src/hooks/useWorkspace.js
// Active workspace state + workspaces list. Module-level state with a
// pub/sub layer so any hook can subscribe and re-render when the user
// switches workspaces.
//
// Active workspace ID is persisted to localStorage (per device) AND mirrored
// in the URL hash by the route layer. Source of truth on app boot:
//   1. URL hash (if present and the user is a member)
//   2. localStorage (if still a member)
//   3. First workspace the user is a member of
//   4. null → triggers default-workspace creation in migration

import { useEffect, useState } from 'react';
import {
  onAuthChange,
  subscribeToWorkspaces,
  migrateToWorkspaces,
} from '../services/firebase';

const WS_STORAGE_KEY = 'task-monitor.activeWorkspace.v1';

// ─── Module-level state ─────────────────────────────────────────────────────

let _activeWorkspaceId = null;
try {
  const stored = localStorage.getItem(WS_STORAGE_KEY);
  if (stored) _activeWorkspaceId = stored;
} catch {/* ignored */}

const _activeSubs = new Set();

export function getActiveWorkspaceId() {
  return _activeWorkspaceId;
}

export function setActiveWorkspaceId(id) {
  if (_activeWorkspaceId === id) return;
  _activeWorkspaceId = id;
  try { id ? localStorage.setItem(WS_STORAGE_KEY, id) : localStorage.removeItem(WS_STORAGE_KEY); }
  catch {/* ignored */}
  _activeSubs.forEach((cb) => { try { cb(id); } catch {/* ignored */} });
}

// ─── useActiveWorkspaceId ───────────────────────────────────────────────────

export function useActiveWorkspaceId() {
  const [ws, setWs] = useState(_activeWorkspaceId);
  useEffect(() => {
    const cb = (id) => setWs(id);
    _activeSubs.add(cb);
    return () => _activeSubs.delete(cb);
  }, []);
  return ws;
}

// ─── useWorkspaces ──────────────────────────────────────────────────────────
// All workspaces the current user belongs to. Also runs the one-time
// workspace migration for legacy users on first authenticated load.

const _wsMigrationKickedOff = new Set();

export function useWorkspaces() {
  const [userId, setUserId] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthChange((u) => {
      setUserId(u?.uid || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !userId) return;

    // Kick off the one-time migration (creates "Personal" workspace + backfills).
    // Memoized per-user so React Strict Mode's double-effect-fire in dev
    // doesn't trigger it twice.
    if (!_wsMigrationKickedOff.has(userId)) {
      _wsMigrationKickedOff.add(userId);
      migrateToWorkspaces(userId)
        .then((res) => {
          if (res?.migrated) console.info('[workspace-migration]', res);
        })
        .catch((err) => console.error('[workspace-migration] failed:', err));
    }

    const unsub = subscribeToWorkspaces(userId, (data) => {
      setWorkspaces(data);
      setLoading(false);

      // Resolve initial active workspace:
      // 1. If current _activeWorkspaceId still valid → keep it
      // 2. Otherwise pick the first workspace
      const stillValid = data.some((w) => w.id === _activeWorkspaceId);
      if (!stillValid) {
        const next = data[0]?.id || null;
        setActiveWorkspaceId(next);
      }
    });
    return () => unsub();
  }, [authReady, userId]);

  return { workspaces, loading, userId, authReady };
}
