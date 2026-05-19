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
  getFirestore,
  collection,
  doc,
  addDoc,
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
export const db = getFirestore(app);
export const auth = getAuth(app);

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

const tasksRef = collection(db, 'tasks');
const activitiesRef = collection(db, 'activities');
const projectsRef = collection(db, 'projects');
const templatesRef = collection(db, 'templates');

// ─── PROJECTS ───────────────────────────────────────────────────────────────
// A project is the top-level grouping. It contains an array of phases:
//   phases: [{ id, name, order }]
// Tasks reference projectId + phaseId.

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444'];

export async function addProject(userId, project) {
  const phases = (project.phases || []).map((p, i) => ({
    id: p.id || uid(),
    name: p.name,
    order: i,
  }));
  return await addDoc(projectsRef, {
    userId,
    name: project.name,
    description: project.description || '',
    color: project.color || PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
    phases,
    archived: false,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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

export function subscribeToProjects(userId, callback) {
  const q = query(
    projectsRef,
    where('userId', '==', userId),
    where('deleted', '==', false),
  );
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Sort client-side to avoid composite index requirement.
    data.sort((a, b) => {
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
  return await addDoc(tasksRef, {
    userId,
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

export function subscribeToTasks(userId, callback) {
  const q = query(
    tasksRef,
    where('userId',   '==', userId),
    where('deleted',  '==', false),
    where('archived', '==', false),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ─── ACTIVITIES ─────────────────────────────────────────────────────────────

export async function addActivity(userId, task, activity) {
  const batch = writeBatch(db);

  const newActivity = doc(activitiesRef);
  batch.set(newActivity, {
    taskId:       task.id,
    userId,
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

export function subscribeToActivities(taskId, callback) {
  const q = query(
    activitiesRef,
    where('taskId', '==', taskId),
    orderBy('date', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeToAllActivities(userId, callback) {
  const q = query(
    activitiesRef,
    where('userId', '==', userId),
    orderBy('date', 'desc'),
    limit(500),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeToRecentActivities(userId, sinceDate, callback) {
  const q = query(
    activitiesRef,
    where('userId', '==', userId),
    where('date',   '>=', sinceDate),
    orderBy('date', 'desc'),
    limit(200),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ─── TEMPLATES ──────────────────────────────────────────────────────────────
// A template is a reusable starting point for either a task or a project.
//   kind: 'task' | 'project'
//   payload: task or project shape (only the structural fields, no IDs/dates)

export async function addTemplate(userId, template) {
  return await addDoc(templatesRef, {
    userId,
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

export function subscribeToTemplates(userId, callback) {
  const q = query(
    templatesRef,
    where('userId', '==', userId),
    where('deleted', '==', false),
  );
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

