// src/services/firebase.js
// Firestore service layer for the task monitor + PM suite.

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
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

signInAnonymously(auth).catch((err) => {
  console.error('Anonymous sign-in failed:', err);
});

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
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
export async function migrateLegacyCategories(userId) {
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

// Set status directly (used by drag-and-drop).
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
  return await updateDoc(doc(db, 'tasks', task.id), updates);
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
