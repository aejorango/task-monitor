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
import { createSharedSubscription } from '../services/sharedSubscription';
import { nextActiveWorkspaceId } from '../services/activeWorkspace';
import {
  onAuthChange,
  subscribeToWorkspaces,
  migrateToWorkspaces,
  repairOrphanedDocuments,
  claimPendingWorkspaceInvites,
  auth as firebaseAuth,
  updateMyMemberProfileInWorkspace,
  auth,
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

// ONE workspaces listener per user, however many components ask. Board cards
// render AssigneeBadges, which needs memberProfiles — with a listener per card
// that was hundreds of identical onSnapshot subscriptions on a busy board.
const workspacesCache = createSharedSubscription(
  (userId, emit) => subscribeToWorkspaces(userId, emit),
  { name: 'workspaces', empty: [] },
);

// Same for auth: every hook that needs a uid used to register its own
// onAuthStateChanged.
const authCache = createSharedSubscription(
  (_key, emit) => onAuthChange((u) => emit({ userId: u?.uid || null, ready: true })),
  { name: 'auth', empty: { userId: null, ready: false } },
);

export function subscribeToAuthState(cb) {
  return authCache.subscribe('auth', cb);
}

/** The last known auth state, for seeding useState without a blank frame. */
export function peekAuthState() {
  return authCache.peek('auth');
}

export function useWorkspaces() {
  const [{ userId, ready: authReady }, setAuth] = useState(() => authCache.peek('auth'));
  // Seed from whatever the shared listener already has, so a card mounting
  // later paints with data instead of an empty frame.
  const [workspaces, setWorkspaces] = useState(() => workspacesCache.peek(authCache.peek('auth').userId) || []);
  const [loading, setLoading] = useState(true);

  useEffect(() => subscribeToAuthState(setAuth), []);

  useEffect(() => {
    if (!authReady || !userId) return;

    // Kick off the one-time migration (creates "Personal" workspace + backfills).
    // Memoized per-user so React Strict Mode's double-effect-fire in dev
    // doesn't trigger it twice.
    if (!_wsMigrationKickedOff.has(userId)) {
      _wsMigrationKickedOff.add(userId);
      // An invitation may have been sent while this person was already signed
      // in on another device, so check on load as well as at sign-in.
      claimPendingWorkspaceInvites(firebaseAuth.currentUser)
        .then((r) => { if (r?.joined) console.info('[invites] joined', r.joined, 'workspace(s)'); })
        .catch((err) => console.warn('[invites] claim failed:', err));
      migrateToWorkspaces(userId)
        .then((res) => {
          if (res?.migrated) console.info('[workspace-migration]', res);
          // Adopt any documents written without a workspaceId — recurrence
          // instances spawned before BUG-004 was fixed are invisible until
          // they belong to a workspace. Runs at most once per device.
          const wsId = res?.workspaceId || getActiveWorkspaceId();
          if (wsId) {
            return repairOrphanedDocuments(userId, wsId)
              .then((r) => { if (r?.repaired) console.info('[orphan-repair]', r); });
          }
          return undefined;
        })
        .catch((err) => console.error('[workspace-migration] failed:', err));
    }

    return workspacesCache.subscribe(userId, (data) => {
      setWorkspaces(data);
      setLoading(false);

      // Resolve the active workspace. The rule is `nextActiveWorkspaceId` and
      // nowhere else: an EMPTY snapshot must not clear it, because an empty
      // snapshot is also what `listenerError` hands back for any failure —
      // and clearing took the Activity log and Work performed pages down with
      // it, silently, all the way into localStorage. See the module header.
      setActiveWorkspaceId(nextActiveWorkspaceId(data, _activeWorkspaceId));
    });
  }, [authReady, userId]);

  return { workspaces, loading, userId, authReady };
}

// ─── useSyncMyMemberProfile ────────────────────────────────────────────────
// Whenever the signed-in user's workspaces (or their displayName) change,
// push their current display data into each workspace's memberProfiles map
// so other members can see their name without needing read access to
// /users/{uid}. Fire-and-forget; failures are logged but non-fatal.

const _syncedSignature = { uid: null, key: null };

export function useSyncMyMemberProfile(workspaces) {
  useEffect(() => {
    const user = auth.currentUser;
    if (!user?.uid || !workspaces || workspaces.length === 0) return;
    // Compute a signature so we don't re-fire on every render unnecessarily.
    const sig = `${user.displayName || ''}|${user.email || ''}|${user.photoURL || ''}|${workspaces.map((w) => w.id).join(',')}`;
    if (_syncedSignature.uid === user.uid && _syncedSignature.key === sig) return;
    _syncedSignature.uid = user.uid;
    _syncedSignature.key = sig;

    workspaces.forEach((w) => {
      const existing = w.memberProfiles?.[user.uid];
      // Only push if missing or display fields differ — keeps writes minimal.
      if (
        existing
        && existing.displayName === (user.displayName || '')
        && existing.email       === (user.email       || '')
        && existing.photoURL    === (user.photoURL    || '')
      ) return;
      updateMyMemberProfileInWorkspace(w.id, {
        displayName: user.displayName || '',
        email:       user.email       || '',
        photoURL:    user.photoURL    || '',
      });
    });
  }, [workspaces]);
}
