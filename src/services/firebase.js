// src/services/firebase.js
// Firestore service layer for the scalable task monitor schema.

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

// Kick off anonymous auth on load so userId is available without a login screen.
// Enable Anonymous sign-in: Firebase console → Authentication → Sign-in method.
signInAnonymously(auth).catch((err) => {
  console.error('Anonymous sign-in failed:', err);
});

// Subscribe helper for auth state — used by the useAuth hook.
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// YYYY-MM-DD in the user's LOCAL timezone (avoids UTC rollover at 8am Manila).
export function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const tasksRef = collection(db, 'tasks');
const activitiesRef = collection(db, 'activities');

// ─── TASKS ──────────────────────────────────────────────────────────────────

export async function addTask(userId, task) {
  return await addDoc(tasksRef, {
    userId,
    title: task.title,
    description: task.description || '',
    category: task.category || 'Personal',
    priority: task.priority || 'medium',
    status: 'todo',
    progress: 0,

    plan: {
      startDate: task.plan?.startDate || null,   // 'YYYY-MM-DD' string
      endDate:   task.plan?.endDate   || null,
    },
    actual: {
      startDate: null,
      endDate:   null,
    },

    // Denormalized counters (kept in sync via batched writes below)
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

// Move task between todo → doing → done; auto-stamps actual dates.
export async function moveTaskStatus(task) {
  const next =
    task.status === 'todo'  ? 'doing' :
    task.status === 'doing' ? 'done'  : 'todo';

  const updates = { status: next, updatedAt: serverTimestamp() };

  if (next === 'doing' && !task.actual?.startDate) {
    updates['actual.startDate'] = todayLocal();
  }
  if (next === 'done') {
    updates['actual.endDate'] = todayLocal();
    updates.progress = 100;
    if (!task.actual?.startDate) updates['actual.startDate'] = todayLocal();
  }
  if (next === 'todo') {
    // Reverting — clear actual dates
    updates['actual.startDate'] = null;
    updates['actual.endDate']   = null;
    updates.progress = 0;
  }

  return await updateDoc(doc(db, 'tasks', task.id), updates);
}

export async function archiveTask(taskId) {
  return await updateTask(taskId, { archived: true });
}

export async function softDeleteTask(taskId) {
  return await updateTask(taskId, { deleted: true });
}

// Live subscription to active (non-deleted, non-archived) tasks for a user.
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

// Adds an activity AND atomically updates counters on the parent task.
export async function addActivity(userId, task, activity) {
  const batch = writeBatch(db);

  const newActivity = doc(activitiesRef);
  batch.set(newActivity, {
    taskId:       task.id,
    userId,

    // Denormalized snapshots for fast journal views
    taskTitle:    task.title,
    taskCategory: task.category,

    date:         activity.date || todayLocal(),
    comment:      activity.comment || '',
    hoursSpent:   Number(activity.hoursSpent) || 0,
    statusAtTime: task.status,
    attachments:  activity.attachments || [],

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

// Deletes an activity AND decrements counters atomically.
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

// All activities for one task, newest day first.
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

// Cross-task activity feed — useful for daily/weekly journals.
export function subscribeToRecentActivities(userId, sinceDate, callback) {
  const q = query(
    activitiesRef,
    where('userId', '==', userId),
    where('date',   '>=', sinceDate),       // 'YYYY-MM-DD'
    orderBy('date', 'desc'),
    limit(200),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
