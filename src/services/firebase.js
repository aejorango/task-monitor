// src/services/firebase.js
// Firestore service layer for the task monitor + PM suite.

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  linkWithPopup,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  increment,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';

// ─── Firebase init ──────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
// Try IndexedDB-backed offline persistence with multi-tab sync. Fall back
// to default (memory) cache if initialization throws — e.g. when an older
// stale IndexedDB schema is present, or in Safari private mode. Without the
// try/catch, an init failure here would leave Firestore unusable and the
// app would render with no data even though the docs still exist remotely.
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.warn('[firestore] persistent cache unavailable, falling back:', err);
  _db = initializeFirestore(app, {});
}
export const db = _db;
export const auth = getAuth(app);
export const storage = getStorage(app);

// Bootstrap auth: if no user is signed in after Firebase initializes, kick off
// anonymous auth. If a real user is signed in (Google), don't touch it.
let _authBootstrapped = false;
onAuthStateChanged(auth, (user) => {
  if (_authBootstrapped) return;
  _authBootstrapped = true;
  if (!user) {
    signInAnonymously(auth).catch((err) => {
      console.error('Anonymous sign-in failed:', err);
    });
  }
});

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Google sign-in. If the current user is anonymous, link the Google credential
// onto the anonymous account so existing data carries over.
// Returns { ok: true, user, mode } on success.
// Returns { ok: false, code, message } for known errors so callers can render
// actionable UI (e.g. "this account is already linked — switch to it?").
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const current = auth.currentUser;
  try {
    if (current?.isAnonymous) {
      const result = await linkWithPopup(current, provider);
      return { ok: true, user: result.user, mode: 'linked' };
    }
    const result = await signInWithPopup(auth, provider);
    return { ok: true, user: result.user, mode: 'signed-in' };
  } catch (err) {
    // 'credential-already-in-use' / 'email-already-in-use': the Google account
    // is already attached to a different Firebase user (typically the same
    // user signing in from a different device). Surface this to the caller —
    // calling signInWithPopup again here would be blocked because the user
    // gesture (the click) has already been consumed by the first popup.
    if (err?.code === 'auth/credential-already-in-use' ||
        err?.code === 'auth/email-already-in-use') {
      return {
        ok: false,
        code: 'account-already-exists',
        message: 'This Google account is already registered elsewhere. Click "Switch to this account" to sign out anonymous and switch (anonymous data on this device will no longer be visible — export it first if you need it).',
      };
    }
    if (err?.code === 'auth/popup-closed-by-user') {
      return { ok: false, code: 'popup-closed', message: 'Sign-in popup was closed.' };
    }
    if (err?.code === 'auth/popup-blocked') {
      return { ok: false, code: 'popup-blocked', message: 'Your browser blocked the popup. Allow popups for this site and try again.' };
    }
    if (err?.code === 'auth/unauthorized-domain') {
      return { ok: false, code: 'unauthorized-domain', message: 'This domain isn’t authorized for sign-in. Add it in Firebase → Auth → Settings → Authorized domains.' };
    }
    if (err?.code === 'auth/cancelled-popup-request') {
      return { ok: false, code: 'cancelled', message: 'Another sign-in popup is already open. Close it and try again.' };
    }
    console.error('signInWithGoogle failed:', err);
    return {
      ok: false,
      code: err?.code || 'unknown',
      message: err?.message || 'Unknown error during sign-in.',
    };
  }
}

// Used after signInWithGoogle returned account-already-exists. Must be invoked
// from a fresh user gesture (e.g. a button click). Signs out anonymous, then
// opens a popup to sign in to the existing account.
export async function switchToGoogle() {
  await signOut(auth);
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    return { ok: true, user: result.user, mode: 'switched' };
  } catch (err) {
    // Sign out already happened — if the popup is blocked or closed here, the
    // app will end up in a signed-out state. The auth bootstrap below will
    // re-create an anonymous user shortly via onAuthStateChanged.
    return { ok: false, code: err?.code || 'unknown', message: err?.message || 'Sign-in failed.' };
  }
}

export async function signOutUser() {
  await signOut(auth);
  // After sign-out, the onAuthStateChanged listener will fire with null and
  // _authBootstrapped is still true, so manually kick off anonymous again so
  // the app stays usable.
  try { await signInAnonymously(auth); }
  catch (err) { console.error('Re-anonymous sign-in after sign-out failed:', err); }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const workspacesRef = collection(db, 'workspaces');
const tasksRef = collection(db, 'tasks');
const activitiesRef = collection(db, 'activities');
const projectsRef = collection(db, 'projects');
const templatesRef = collection(db, 'templates');
const taskCommentsRef = collection(db, 'taskComments');
const savedViewsRef = collection(db, 'savedViews');
const presenceRef   = collection(db, 'presence');
const webhooksRef   = collection(db, 'webhooks');
const invitesRef    = collection(db, 'invites');

// ─── WORKSPACES ─────────────────────────────────────────────────────────────
// A workspace is the top-level scope above projects. Every project, task,
// activity, template, comment, view, and webhook belongs to exactly ONE
// workspace. This gives us:
//   - clean horizontal sharding (every query scoped to one workspace)
//   - team boundaries (members of a workspace see its contents)
//   - bounded blast radius per user
//
// Schema:
//   workspaces/{id}
//     createdByUserId
//     name, description, color, icon
//     members:        [uid, ...]            // denormalized for array-contains
//     acl:            { uid: role }         // 'owner'|'admin'|'editor'|'viewer'
//     pendingInvites: [{ email, role, token }]  // future: email invites
//     archived, deleted, createdAt, updatedAt

const WORKSPACE_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const DEFAULT_WORKSPACE_ICON = '◆';

export async function addWorkspace(userId, workspace) {
  const ref = doc(workspacesRef);
  const data = {
    createdByUserId: userId,
    name: workspace.name,
    description: workspace.description || '',
    color: workspace.color || WORKSPACE_COLORS[Math.floor(Math.random() * WORKSPACE_COLORS.length)],
    icon:  workspace.icon  || DEFAULT_WORKSPACE_ICON,
    members: [userId],
    acl:     { [userId]: 'owner' },
    pendingInvites: [],
    archived: false,
    deleted:  false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  return { id: ref.id, ...data };
}

export async function updateWorkspace(workspaceId, updates) {
  return await updateDoc(doc(db, 'workspaces', workspaceId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function softDeleteWorkspace(workspaceId) {
  return await updateWorkspace(workspaceId, { deleted: true });
}

// Add a member by UID (used in current single-user flows or via UID-share).
// Role: 'admin'|'editor'|'viewer'. Owner is the original creator.
export async function addWorkspaceMember(workspace, memberUserId, role = 'editor') {
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  if ((workspace.members || []).includes(memberUserId)) return;
  const ref = doc(db, 'workspaces', workspace.id);
  await updateDoc(ref, {
    members: [...(workspace.members || []), memberUserId],
    [`acl.${memberUserId}`]: role,
    updatedAt: serverTimestamp(),
  });
}

export async function removeWorkspaceMember(workspace, memberUserId) {
  // Don't allow removing the owner via this API
  if (workspace.acl?.[memberUserId] === 'owner') {
    throw new Error('Cannot remove the workspace owner.');
  }
  const newMembers = (workspace.members || []).filter((u) => u !== memberUserId);
  const newAcl = { ...(workspace.acl || {}) };
  delete newAcl[memberUserId];
  await updateDoc(doc(db, 'workspaces', workspace.id), {
    members: newMembers,
    acl:     newAcl,
    updatedAt: serverTimestamp(),
  });
}

export async function updateWorkspaceMemberRole(workspace, memberUserId, newRole) {
  if (workspace.acl?.[memberUserId] === 'owner' && newRole !== 'owner') {
    throw new Error('Cannot demote the workspace owner.');
  }
  await updateDoc(doc(db, 'workspaces', workspace.id), {
    [`acl.${memberUserId}`]: newRole,
    updatedAt: serverTimestamp(),
  });
}

// Live list of workspaces the current user belongs to.
export function subscribeToWorkspaces(userId, callback) {
  // Single filter — array-contains plus an equality filter on a different
  // field would require a composite index. The deleted filter is tiny so we
  // apply it client-side.
  const q = query(workspacesRef, where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((w) => !w.deleted)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    callback(data);
  });
}

// ─── MIGRATION: existing user data → default "Personal" workspace ───────────
//
// On first sign-in after the workspaces feature ships, every existing user
// will have projects/tasks/activities/etc. without a workspaceId. This function:
//   1. Checks if the user is already a member of any workspace → if yes, no-op
//   2. Creates a "Personal" workspace
//   3. Batch-updates all the user's docs to set workspaceId = the new workspace's id
//
// Idempotent — safe to call on every load. Scoped to the legacy
// `userId == request.auth.uid` rules that still apply during the transition.

const _wsMigrationByUser = {};

export async function migrateToWorkspaces(userId) {
  if (_wsMigrationByUser[userId]) return _wsMigrationByUser[userId];
  _wsMigrationByUser[userId] = (async () => {
    // 1) Does the user already belong to a workspace?
    const existing = await getDocs(query(
      workspacesRef,
      where('members', 'array-contains', userId),
      limit(1),
    ));
    if (!existing.empty) {
      return { migrated: false, reason: 'user already has a workspace' };
    }

    // 2) Create the default workspace
    const wsDoc = await addWorkspace(userId, {
      name: 'Personal',
      description: 'Your starter workspace. All your existing projects, tasks, and activities live here.',
      icon:  '◆',
    });
    const wsId = wsDoc.id;

    // 3) Backfill workspaceId on existing data. We use batched writes (max 500
    // operations per batch).
    const collectionsToBackfill = [
      { ref: projectsRef,     name: 'projects'    },
      { ref: tasksRef,        name: 'tasks'       },
      { ref: activitiesRef,   name: 'activities'  },
      { ref: templatesRef,    name: 'templates'   },
      { ref: taskCommentsRef, name: 'taskComments'},
      { ref: savedViewsRef,   name: 'savedViews'  },
      { ref: webhooksRef,     name: 'webhooks'    },
    ];
    const counts = {};
    for (const { ref, name } of collectionsToBackfill) {
      const snap = await getDocs(query(ref, where('userId', '==', userId)));
      counts[name] = 0;
      // Batch in chunks of 400 (under 500 limit)
      let batch = writeBatch(db);
      let n = 0;
      for (const d of snap.docs) {
        if (d.data().workspaceId) continue;  // already has one
        batch.update(d.ref, { workspaceId: wsId });
        n++; counts[name]++;
        if (n % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (n % 400 !== 0) await batch.commit();
    }
    return { migrated: true, workspaceId: wsId, backfilled: counts };
  })();
  return _wsMigrationByUser[userId];
}

// ─── PROJECTS ───────────────────────────────────────────────────────────────
// A project is the top-level grouping. It contains an array of phases:
//   phases: [{ id, name, order }]
// Tasks reference projectId + phaseId.

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444'];

export async function addProject(userId, project) {
  if (!project.workspaceId) throw new Error('addProject requires project.workspaceId');
  const phases = (project.phases || []).map((p, i) => ({
    id: p.id || uid(),
    name: p.name,
    order: i,
  }));
  return await addDoc(projectsRef, {
    userId,
    workspaceId: project.workspaceId,
    name: project.name,
    description: project.description || '',
    color: project.color || PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
    phases,
    // Per-project ACL is retained for fine-grained sharing within a workspace.
    acl:     { [userId]: 'admin' },
    members: [userId],
    archived: false,
    deleted:  false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Add or update a member's role on a project. role: 'viewer' | 'editor' | 'admin'.
// Caller (UI) is responsible for resolving uid from email — done via a future
// Cloud Function. For now the UI accepts a raw UID input.
export async function setProjectMember(projectId, targetUid, role) {
  const projRef = doc(db, 'projects', projectId);
  // Read current doc to merge ACL safely. updateDoc dot-paths into a map
  // would also work but reading + setting is clearer here.
  const snap = await getDocs(query(projectsRef, where('__name__', '==', projectId)));
  const cur = snap.docs[0]?.data();
  if (!cur) throw new Error('Project not found');
  const acl = { ...(cur.acl || {}) };
  const members = new Set(cur.members || []);
  if (role) {
    acl[targetUid] = role;
    members.add(targetUid);
  } else {
    delete acl[targetUid];
    members.delete(targetUid);
  }
  await updateDoc(projRef, { acl, members: [...members], updatedAt: serverTimestamp() });
}

export async function updateProject(projectId, updates) {
  return await updateDoc(doc(db, 'projects', projectId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function archiveProject(projectId) {
  return await updateProject(projectId, { archived: true });
}

export async function softDeleteProject(projectId) {
  return await updateProject(projectId, { deleted: true });
}

// Subscribes to both owned projects AND shared projects (where the current
// user appears in the `members` array). Two listeners are merged into a
// single callback. Older projects without a `members` field are picked up
// by the owner query.
export function subscribeToProjects(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(projectsRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => !p.deleted)
      .sort((a, b) => {
        const at = a.createdAt?.toMillis?.() ?? 0;
        const bt = b.createdAt?.toMillis?.() ?? 0;
        return bt - at;
      });
    callback(data);
  });
}

// One-time migration: seed default projects from the legacy categories
// and link existing tasks. Idempotent — safe to call on every sign-in.
// Module-level promise cache prevents duplicate concurrent runs (React Strict
// Mode invokes the calling effect twice in dev, which previously caused 6 or 9
// projects to be seeded instead of 3).
const _migrationCache = new Map();  // userId → Promise
export function migrateLegacyCategories(userId) {
  if (_migrationCache.has(userId)) return _migrationCache.get(userId);
  const p = _migrateLegacyCategoriesImpl(userId);
  _migrationCache.set(userId, p);
  return p;
}
async function _migrateLegacyCategoriesImpl(userId) {
  const existing = await getDocs(query(projectsRef, where('userId', '==', userId), limit(1)));
  if (!existing.empty) return { migrated: false, reason: 'projects already exist' };

  const legacyCategories = ['BRIDGED', 'AIM', 'Personal'];
  const colorByCategory = { BRIDGED: '#6366f1', AIM: '#10b981', Personal: '#f59e0b' };
  const batch = writeBatch(db);
  const projectIdByCategory = {};

  legacyCategories.forEach((cat) => {
    const ref = doc(projectsRef);
    projectIdByCategory[cat] = ref.id;
    batch.set(ref, {
      userId,
      name: cat,
      description: `Migrated from legacy category "${cat}"`,
      color: colorByCategory[cat],
      phases: [
        { id: uid(), name: 'Planning',  order: 0 },
        { id: uid(), name: 'Execution', order: 1 },
        { id: uid(), name: 'Review',    order: 2 },
      ],
      archived: false,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();

  // Link existing tasks to their migrated project
  const tasksSnap = await getDocs(query(tasksRef, where('userId', '==', userId)));
  const linkBatch = writeBatch(db);
  let linked = 0;
  tasksSnap.forEach((d) => {
    const t = d.data();
    if (t.projectId) return;
    const projectId = projectIdByCategory[t.category];
    if (!projectId) return;
    linkBatch.update(d.ref, { projectId, updatedAt: serverTimestamp() });
    linked++;
  });
  if (linked > 0) await linkBatch.commit();

  return { migrated: true, projectsCreated: legacyCategories.length, tasksLinked: linked };
}

// ─── TASKS ──────────────────────────────────────────────────────────────────

export async function addTask(userId, task) {
  if (!task.workspaceId) throw new Error('addTask requires task.workspaceId');
  return await addDoc(tasksRef, {
    userId,
    workspaceId: task.workspaceId,
    title: task.title,
    description: task.description || '',
    category: task.category || 'Personal',     // legacy back-compat
    projectId: task.projectId || null,
    phaseId: task.phaseId || null,
    priority: task.priority || 'medium',
    status: 'todo',
    progress: 0,
    requestedBy: task.requestedBy || '',

    plan: {
      startDate: task.plan?.startDate || null,
      endDate:   task.plan?.endDate   || null,
    },
    actual: {
      startDate: null,
      endDate:   null,
    },

    // PM suite v4 fields
    dependsOn: task.dependsOn || [],      // [taskId, ...]
    subtasks:  task.subtasks  || [],      // [{ id, text, done }]
    tags:      task.tags      || [],      // [string, ...]

    // v5: recurrence rule. null means non-recurring.
    recurrence: task.recurrence || null,  // { rule: 'daily'|'weekly'|'monthly', interval, dayOfWeek?, dayOfMonth?, until? }
    recurrenceParentId: task.recurrenceParentId || null,  // points to the original recurring task

    // v7: typed task-to-task links (in addition to dependsOn).
    //   [{ targetId, type: 'blocks' | 'related-to' | 'duplicate-of' }]
    links: task.links || [],

    // v8 (Tier 4.4): per-project custom field values, keyed by field id.
    //   { [fieldId]: scalar }
    customValues: task.customValues || {},

    // v9: explicit assignees, picked from the project's member ACL. Distinct
    // from `requestedBy` which is a freeform "who asked for this".
    //   [uid, ...]
    assignedTo: task.assignedTo || [],

    activityCount:    0,
    totalHoursLogged: 0,
    attachmentCount:  0,
    lastActivityAt:   null,

    archived:  false,
    deleted:   false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTask(taskId, updates) {
  return await updateDoc(doc(db, 'tasks', taskId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

// Set status directly (used by drag-and-drop). If marked done and the task is
// recurring, also spawn the next instance.
export async function setTaskStatus(task, nextStatus) {
  if (task.status === nextStatus) return;
  const updates = { status: nextStatus, updatedAt: serverTimestamp() };

  if (nextStatus === 'doing' && !task.actual?.startDate) {
    updates['actual.startDate'] = todayLocal();
  }
  if (nextStatus === 'done') {
    updates['actual.endDate'] = todayLocal();
    updates.progress = 100;
    if (!task.actual?.startDate) updates['actual.startDate'] = todayLocal();
  }
  if (nextStatus === 'todo') {
    updates['actual.startDate'] = null;
    updates['actual.endDate']   = null;
    updates.progress = 0;
  }
  await updateDoc(doc(db, 'tasks', task.id), updates);

  if (nextStatus === 'done' && task.recurrence) {
    try { await spawnNextRecurrence(task); }
    catch (err) { console.error('Failed to spawn next recurrence:', err); }
  }
}

// ─── Recurrence ─────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysISO(s, n) {
  const d = parseISO(s); if (!d) return null;
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
function addMonthsISO(s, n) {
  const d = parseISO(s); if (!d) return null;
  d.setMonth(d.getMonth() + n);
  return isoOf(d);
}

// Given a recurring task, compute the next (start, end) plan dates.
// Returns { start, end } or null if no further occurrences.
export function nextRecurrenceDates(task) {
  const r = task.recurrence;
  if (!r) return null;
  const interval = r.interval || 1;
  const oldStart = task.plan?.startDate;
  const oldEnd   = task.plan?.endDate;

  if (!oldStart && !oldEnd) {
    // No anchoring dates → schedule starting today
    const t = todayLocal();
    return { start: t, end: t };
  }

  const shiftDays = r.rule === 'daily'   ? interval :
                    r.rule === 'weekly'  ? 7 * interval :
                    null;

  let nextStart, nextEnd;
  if (r.rule === 'monthly') {
    nextStart = oldStart ? addMonthsISO(oldStart, interval) : null;
    nextEnd   = oldEnd   ? addMonthsISO(oldEnd,   interval) : nextStart;
  } else {
    nextStart = oldStart ? addDaysISO(oldStart, shiftDays) : null;
    nextEnd   = oldEnd   ? addDaysISO(oldEnd,   shiftDays) : nextStart;
  }
  if (!nextStart && !nextEnd) return null;

  // Respect `until`
  if (r.until && (nextStart || nextEnd) > r.until) return null;

  return { start: nextStart, end: nextEnd };
}

async function spawnNextRecurrence(task) {
  const next = nextRecurrenceDates(task);
  if (!next) return null;

  // Idempotency: if a sibling task with the same recurrenceParentId already exists
  // with these dates, don't create a duplicate.
  const parentId = task.recurrenceParentId || task.id;
  const existing = await getDocs(query(
    tasksRef,
    where('userId', '==', task.userId),
    where('recurrenceParentId', '==', parentId),
    where('deleted', '==', false),
  ));
  const dup = existing.docs.find((d) => {
    const t = d.data();
    return t.plan?.startDate === next.start && t.plan?.endDate === next.end;
  });
  if (dup) return null;

  return await addDoc(tasksRef, {
    userId: task.userId,
    title: task.title,
    description: task.description || '',
    category: task.category || 'Personal',
    projectId: task.projectId || null,
    phaseId: task.phaseId || null,
    priority: task.priority || 'medium',
    status: 'todo',
    progress: 0,
    requestedBy: task.requestedBy || '',

    plan:   { startDate: next.start, endDate: next.end },
    actual: { startDate: null, endDate: null },

    dependsOn: [],
    subtasks: (task.subtasks || []).map((s) => ({ ...s, done: false })),  // reset checks
    tags: task.tags || [],

    recurrence: task.recurrence,
    recurrenceParentId: parentId,

    activityCount:    0,
    totalHoursLogged: 0,
    attachmentCount:  0,
    lastActivityAt:   null,

    archived:  false,
    deleted:   false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Cycle-only API — kept for back-compat with TaskList's Move button.
export async function moveTaskStatus(task) {
  const next =
    task.status === 'todo'  ? 'doing' :
    task.status === 'doing' ? 'done'  : 'todo';
  return setTaskStatus(task, next);
}

export async function archiveTask(taskId) {
  return await updateTask(taskId, { archived: true });
}

export async function softDeleteTask(taskId) {
  return await updateTask(taskId, { deleted: true });
}

export function subscribeToTasks(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  // We only filter by workspaceId on the server. `deleted`/`archived` filtering
  // and `createdAt` sort happen client-side. Reason: combining 3 where-clauses
  // with an orderBy requires a composite Firestore index per workspace —
  // workspaces are bounded scopes (typically < 1000 tasks) so client-side
  // sort/filter is cheap. Single equality filter uses auto-indexes only.
  const q = query(tasksRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !t.deleted && !t.archived)
      .sort((a, b) => {
        const at = a.createdAt?.toMillis?.() ?? 0;
        const bt = b.createdAt?.toMillis?.() ?? 0;
        return bt - at;
      });
    callback(data);
  });
}

// ─── ACTIVITIES ─────────────────────────────────────────────────────────────

export async function addActivity(userId, task, activity) {
  if (!task.workspaceId) throw new Error('addActivity requires task.workspaceId');
  const batch = writeBatch(db);

  const newActivity = doc(activitiesRef);
  batch.set(newActivity, {
    taskId:       task.id,
    userId,
    workspaceId:  task.workspaceId,
    taskTitle:    task.title,
    taskCategory: task.category,
    projectId:    task.projectId || null,
    phaseId:      task.phaseId   || null,

    date:         activity.date || todayLocal(),
    comment:      activity.comment || '',
    hoursSpent:   Number(activity.hoursSpent) || 0,
    statusAtTime: task.status,
    attachments:  activity.attachments || [],

    // PM suite fields
    completionStatus:  activity.completionStatus  || 'in-progress',
    bottleneckRemarks: activity.bottleneckRemarks || '',
    requestedBy:       activity.requestedBy       || '',

    loggedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'tasks', task.id), {
    activityCount:    increment(1),
    totalHoursLogged: increment(Number(activity.hoursSpent) || 0),
    attachmentCount:  increment((activity.attachments || []).length),
    lastActivityAt:   serverTimestamp(),
    updatedAt:        serverTimestamp(),
  });

  return await batch.commit();
}

export async function updateActivity(activityId, updates) {
  return await updateDoc(doc(db, 'activities', activityId), updates);
}

// Atomic edit: writes the activity update AND syncs the task's denormalized
// counters when hours or attachment count changed. Pass the OLD activity
// object so we can compute deltas.
export async function editActivity(oldActivity, updates) {
  const batch = writeBatch(db);

  batch.update(doc(db, 'activities', oldActivity.id), updates);

  const newHours = updates.hoursSpent !== undefined ? Number(updates.hoursSpent) || 0 : (oldActivity.hoursSpent || 0);
  const oldHours = oldActivity.hoursSpent || 0;
  const hoursDelta = newHours - oldHours;

  const newAttachCount = updates.attachments !== undefined ? updates.attachments.length : (oldActivity.attachments?.length || 0);
  const oldAttachCount = oldActivity.attachments?.length || 0;
  const attachDelta = newAttachCount - oldAttachCount;

  if (hoursDelta !== 0 || attachDelta !== 0) {
    batch.update(doc(db, 'tasks', oldActivity.taskId), {
      totalHoursLogged: increment(hoursDelta),
      attachmentCount:  increment(attachDelta),
      updatedAt:        serverTimestamp(),
    });
  }

  return await batch.commit();
}

export async function deleteActivity(activity) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'activities', activity.id));
  batch.update(doc(db, 'tasks', activity.taskId), {
    activityCount:    increment(-1),
    totalHoursLogged: increment(-(activity.hoursSpent || 0)),
    attachmentCount:  increment(-(activity.attachments?.length || 0)),
    updatedAt:        serverTimestamp(),
  });
  return await batch.commit();
}

// Bulk delete — used by Table bulk actions. Groups counter updates per-task.
export async function bulkDeleteActivities(activities) {
  const batch = writeBatch(db);
  const taskDeltas = {};
  activities.forEach((a) => {
    batch.delete(doc(db, 'activities', a.id));
    if (!taskDeltas[a.taskId]) taskDeltas[a.taskId] = { count: 0, hours: 0, attach: 0 };
    taskDeltas[a.taskId].count += 1;
    taskDeltas[a.taskId].hours += a.hoursSpent || 0;
    taskDeltas[a.taskId].attach += a.attachments?.length || 0;
  });
  Object.entries(taskDeltas).forEach(([taskId, d]) => {
    batch.update(doc(db, 'tasks', taskId), {
      activityCount:    increment(-d.count),
      totalHoursLogged: increment(-d.hours),
      attachmentCount:  increment(-d.attach),
      updatedAt:        serverTimestamp(),
    });
  });
  return await batch.commit();
}

// Bulk update completionStatus on multiple activities (no counter changes).
export async function bulkUpdateActivityCompletion(activities, completionStatus) {
  const batch = writeBatch(db);
  activities.forEach((a) => {
    batch.update(doc(db, 'activities', a.id), { completionStatus });
  });
  return await batch.commit();
}

// Activities per task — single where, sort client-side by date desc.
export function subscribeToActivities(taskId, callback) {
  const q = query(activitiesRef, where('taskId', '==', taskId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    callback(data);
  });
}

// Cross-task activities in a workspace — single where, sort + cap client-side.
// 500 cap matches the previous server-side limit; for workspaces with more
// than 500 activities we'd switch to paginated fetches.
export function subscribeToAllActivities(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(activitiesRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 500);
    callback(data);
  });
}

export function subscribeToRecentActivities(workspaceId, sinceDate, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(activitiesRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => !sinceDate || (a.date || '') >= sinceDate)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 200);
    callback(data);
  });
}

// ─── TEMPLATES ──────────────────────────────────────────────────────────────
// A template is a reusable starting point for either a task or a project.
//   kind: 'task' | 'project'
//   payload: task or project shape (only the structural fields, no IDs/dates)

export async function addTemplate(userId, template) {
  if (!template.workspaceId) throw new Error('addTemplate requires template.workspaceId');
  return await addDoc(templatesRef, {
    userId,
    workspaceId: template.workspaceId,
    name:        template.name,
    description: template.description || '',
    kind:        template.kind,
    payload:     template.payload,
    deleted:     false,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  });
}

export async function updateTemplate(templateId, updates) {
  return await updateDoc(doc(db, 'templates', templateId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function softDeleteTemplate(templateId) {
  return await updateTemplate(templateId, { deleted: true });
}

export function subscribeToTemplates(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(templatesRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !t.deleted)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    callback(data);
  });
}

// Save the structural shape of a task as a template (no dates, IDs, counters).
export function taskAsTemplatePayload(task) {
  return {
    title: task.title,
    description: task.description || '',
    priority: task.priority || 'medium',
    requestedBy: task.requestedBy || '',
    projectId: task.projectId || null,
    phaseId: task.phaseId || null,
    tags: task.tags || [],
    subtasks: (task.subtasks || []).map((s) => ({ id: uid(), text: s.text, done: false })),
    recurrence: task.recurrence || null,
  };
}

export function projectAsTemplatePayload(project) {
  return {
    name: project.name,
    description: project.description || '',
    color: project.color,
    phases: (project.phases || []).map((p) => ({ id: uid(), name: p.name, order: p.order })),
  };
}

// ─── STORAGE (file uploads) ─────────────────────────────────────────────────

// Compress an image File via canvas. Returns a new Blob if compression helps,
// or the original file. Non-image files are returned unchanged.
export async function maybeCompressImage(file, { maxEdge = 1600, quality = 0.85 } = {}) {
  if (!file.type?.startsWith('image/')) return file;
  // Skip SVG (already vector) and GIFs (animation would be flattened)
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;

  const img = await new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload  = () => { URL.revokeObjectURL(url); res(i); };
    i.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    i.src = url;
  });

  const { width, height } = img;
  if (Math.max(width, height) <= maxEdge && file.size < 500_000) return file;

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) return file;
  // Only swap if compression actually saved bytes
  return blob.size < file.size ? blob : file;
}

// Upload a file to Firebase Storage under users/{uid}/{taskId}/{filename}.
// Returns { name, url, type, size, path } shaped to fit our `attachments` array.
// `onProgress(fraction)` is called as the upload progresses.
export async function uploadFile({ userId, taskId, file, filename, onProgress }) {
  const base = `users/${userId}/${taskId || 'general'}`;
  const safeName = (filename || file.name || 'file').replace(/[^\w.\-]/g, '_');
  const finalName = `${Date.now()}-${safeName}`;
  const path = `${base}/${finalName}`;

  const compressed = await maybeCompressImage(file);
  const ref = storageRef(storage, path);
  const task = uploadBytesResumable(ref, compressed, {
    contentType: file.type || 'application/octet-stream',
  });

  return new Promise((resolve, reject) => {
    task.on('state_changed',
      (snap) => {
        if (onProgress) onProgress(snap.bytesTransferred / snap.totalBytes);
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            name: file.name || safeName,
            url,
            type: file.type?.startsWith('image/') ? 'image' : 'file',
            size: compressed.size ?? file.size,
            path,
          });
        } catch (e) { reject(e); }
      });
  });
}

// Best-effort delete of a stored file. Won't throw if the object is missing.
export async function deleteUpload(path) {
  if (!path) return;
  try { await deleteObject(storageRef(storage, path)); }
  catch (err) {
    // object-not-found is fine; warn for anything else
    if (err?.code !== 'storage/object-not-found') console.warn('deleteUpload failed:', err);
  }
}


// ─── TASK COMMENTS ──────────────────────────────────────────────────────────
// Discussion thread per task, separate from activity log.

// Note: `task` here can be either a task object (preferred — carries workspaceId
// directly) or the raw taskId for back-compat. Callers should pass the task.
export async function addTaskComment(userId, task, body) {
  const taskObj = typeof task === 'string' ? null : task;
  const taskId  = typeof task === 'string' ? task  : task?.id;
  if (!taskObj?.workspaceId) throw new Error('addTaskComment requires a task with workspaceId');
  return await addDoc(taskCommentsRef, {
    userId,
    workspaceId: taskObj.workspaceId,
    taskId,
    body: String(body || ''),
    createdAt: serverTimestamp(),
    deleted: false,
  });
}

export async function updateTaskComment(commentId, body) {
  return await updateDoc(doc(db, 'taskComments', commentId), {
    body: String(body || ''),
    editedAt: serverTimestamp(),
  });
}

export async function softDeleteTaskComment(commentId) {
  return await updateDoc(doc(db, 'taskComments', commentId), {
    deleted: true,
    deletedAt: serverTimestamp(),
  });
}

export function subscribeToTaskComments(taskId, callback) {
  const q = query(taskCommentsRef, where('taskId', '==', taskId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => !c.deleted)
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
    callback(data);
  });
}

// ─── SAVED VIEWS ────────────────────────────────────────────────────────────
// A reusable filter combo (view + project + tag + status + sort) the user
// can pin in the sidebar.

export async function addSavedView(userId, view) {
  if (!view.workspaceId) throw new Error('addSavedView requires view.workspaceId');
  return await addDoc(savedViewsRef, {
    userId,
    workspaceId:   view.workspaceId,
    name:          view.name,
    icon:          view.icon || '',
    view:          view.view,
    projectFilter: view.projectFilter || 'all',
    tagFilter:     view.tagFilter || null,
    statusFilter:  view.statusFilter || null,
    sortBy:        view.sortBy || null,
    sortDir:       view.sortDir || 'desc',
    deleted:       false,
    createdAt:     serverTimestamp(),
    updatedAt:     serverTimestamp(),
  });
}

export async function updateSavedView(viewId, updates) {
  return await updateDoc(doc(db, 'savedViews', viewId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function softDeleteSavedView(viewId) {
  return await updateSavedView(viewId, { deleted: true });
}

// Saved views are personal AND workspace-scoped: a user only sees their own
// saved views within the current workspace.
export function subscribeToSavedViews(workspaceId, userId, callback) {
  if (!workspaceId || !userId) { callback([]); return () => {}; }
  // Single where (workspaceId) + client-side userId/deleted filter avoids the
  // composite (workspaceId, userId, deleted) index. Saved views per workspace
  // are tiny — typically < 20.
  const q = query(savedViewsRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((v) => v.userId === userId && !v.deleted)
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
    callback(data);
  });
}

// ─── PRESENCE ───────────────────────────────────────────────────────────────
// Lightweight presence: while a user is viewing a task, ping presence/{taskId}/{uid}
// every ~20s. Listeners filter heartbeats older than 60s.
// Doc shape:
//   presence/{compositeId} = { taskId, userId, displayName, photoURL, lastSeen }

export async function pingPresence({ taskId, userId, displayName, photoURL }) {
  const docId = `${taskId}__${userId}`;
  return setDoc(doc(db, 'presence', docId), {
    taskId,
    userId,
    displayName: displayName || '',
    photoURL:    photoURL    || '',
    lastSeen:    serverTimestamp(),
  });
}

export async function clearPresence({ taskId, userId }) {
  const docId = `${taskId}__${userId}`;
  return deleteDoc(doc(db, 'presence', docId));
}

export function subscribeToPresence(taskId, callback) {
  const q = query(presenceRef, where('taskId', '==', taskId));
  return onSnapshot(q, (snap) => {
    const now = Date.now();
    const fresh = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => {
        const ts = p.lastSeen?.toMillis?.() ?? 0;
        return now - ts < 60_000;  // 60s freshness window
      });
    callback(fresh);
  });
}

// ─── WEBHOOKS ───────────────────────────────────────────────────────────────
// Stored config only — actually firing the HTTP POST requires a Cloud
// Function listening on Firestore changes (see FEATURE_ROADMAP.md → Tier 4).

export async function addWebhook(userId, hook) {
  if (!hook.workspaceId) throw new Error('addWebhook requires hook.workspaceId');
  return await addDoc(webhooksRef, {
    userId,
    workspaceId: hook.workspaceId,
    name:    hook.name || '',
    url:     hook.url,
    secret:  hook.secret || '',
    events:  hook.events || ['task.created', 'task.completed'],
    enabled: hook.enabled !== false,
    createdAt: serverTimestamp(),
    deleted: false,
  });
}
export async function updateWebhook(hookId, updates) {
  return await updateDoc(doc(db, 'webhooks', hookId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}
export async function softDeleteWebhook(hookId) {
  return await updateWebhook(hookId, { deleted: true });
}
export function subscribeToWebhooks(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(webhooksRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((h) => !h.deleted)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    callback(data);
  });
}

// ─── INVITES (v9 multi-user) ────────────────────────────────────────────────
// A shareable link that lets the recipient join a project. The URL is the
// secret. Each invite tracks role + optional expiry + a claims log.

export async function createInvite(userId, { projectId, role, expiresInDays }) {
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400 * 1000)
    : null;
  return await addDoc(invitesRef, {
    userId,
    projectId,
    role: role || 'viewer',
    revoked: false,
    expiresAt,
    claims: [],
    createdAt: serverTimestamp(),
  });
}

export async function revokeInvite(inviteId) {
  return await updateDoc(doc(db, 'invites', inviteId), { revoked: true });
}

export async function getInvite(inviteId) {
  const snap = await getDocs(query(invitesRef, where('__name__', '==', inviteId)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export function subscribeToInvitesForProject(projectId, callback) {
  const q = query(invitesRef, where('projectId', '==', projectId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    data.sort((a, b) => {
      const at = a.createdAt?.toMillis?.() ?? 0;
      const bt = b.createdAt?.toMillis?.() ?? 0;
      return bt - at;
    });
    callback(data);
  });
}

// Claim an invite — record the claim on the invite + add self to the
// project's acl + members. Uses a batch so both writes either succeed
// or fail together.
export async function claimInvite(inviteId, currentUser) {
  const invite = await getInvite(inviteId);
  if (!invite)         throw new Error('Invite not found.');
  if (invite.revoked)  throw new Error('Invite has been revoked.');
  if (invite.expiresAt) {
    const expiresMs = invite.expiresAt.toMillis?.() ?? Date.parse(invite.expiresAt);
    if (expiresMs < Date.now()) throw new Error('Invite has expired.');
  }

  // Already a member? Just succeed.
  const projSnap = await getDocs(query(projectsRef, where('__name__', '==', invite.projectId)));
  const proj = projSnap.docs[0]?.data();
  if (!proj) throw new Error('Project not found.');
  if ((proj.members || []).includes(currentUser.uid)) {
    return { projectId: invite.projectId, alreadyMember: true };
  }

  const batch = writeBatch(db);
  // Record claim on invite
  const claim = {
    uid: currentUser.uid,
    displayName: currentUser.displayName || '',
    email: currentUser.email || '',
    claimedAt: new Date(),  // serverTimestamp not allowed inside array
  };
  batch.update(doc(db, 'invites', inviteId), { claims: [...(invite.claims || []), claim] });

  // Add to project: members + acl. The lastClaimInviteId is a side channel
  // the security rule reads to verify this claim is legitimate.
  const newAcl = { ...(proj.acl || {}), [currentUser.uid]: invite.role };
  const newMembers = [...(proj.members || []), currentUser.uid];
  batch.update(doc(db, 'projects', invite.projectId), {
    acl: newAcl,
    members: newMembers,
    lastClaimInviteId: inviteId,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return { projectId: invite.projectId, alreadyMember: false };
}
