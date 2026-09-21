// src/services/firebase.js
// Firestore service layer for the task monitor + PM suite.

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  clearIndexedDbPersistence,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteField,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  increment,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
// Recurrence maths + the next-instance payload live in a pure module so they
// can be unit-tested without the Firebase SDK. Re-exported here because the
// whole app already imports todayLocal/nextRecurrenceDates from this file.
import {
  todayLocal,
  nextRecurrenceDates,
  buildNextRecurrenceTask,
} from './recurrence';
export { todayLocal, nextRecurrenceDates };
import {
  inviteFields, inviteFor, normalizeEmail, revokeInviteFields, validateInvite,
} from './invites';
import { normalizeIcon } from './icons';
import { attachmentPaths, orphanedPaths, safeFilename, uploadPath } from './uploadPaths';
import { noticesForAssignment, noticesForComment, watchersOf } from './mentions';
import {
  buildShareLink, buildSnapshot, cryptoBytes, isShareLive, newShareToken,
} from './shareLinks';
import { catchUpPlan } from './recurrenceSchedule';

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

// Anonymous auth has been removed. All users must sign in with Google and
// be approved by a superadmin before they can access the app. The auth state
// is now "signed-out" until the user clicks the Google sign-in button on the
// landing screen.

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Hardcoded superadmin emails. Users signing in with these emails are
// auto-approved and given the 'superadmin' role on first sign-in. Anyone
// else lands in 'pending' state until a superadmin approves them.
export const SUPERADMIN_EMAILS = [
  'blueinnovation.ph@gmail.com',
  'aejorango888@gmail.com',
];

function isSuperadminEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  return SUPERADMIN_EMAILS.some((s) => s.toLowerCase() === e);
}

// Google sign-in. Always opens a Google popup — anonymous accounts no longer
// exist so there is nothing to link onto. After sign-in succeeds, ensures
// the user has a profile document in `users/{uid}`.
// Returns { ok: true, user } on success or { ok: false, code, message } on error.
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    await ensureUserProfile(result.user);
    // Somebody invited this person by email before they had an account — or
    // while they were signed out. Join those workspaces now, so they land in
    // the app with their team's work already there.
    try { await claimPendingWorkspaceInvites(result.user); }
    catch (err) { console.warn('[invites] claim failed:', err); }
    return { ok: true, user: result.user };
  } catch (err) {
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

// Keys we own in localStorage that are scoped to the signed-in user (NOT
// per-device preferences). These must be wiped on sign-out so the next account
// on a shared browser never inherits the previous user's context.
const PER_USER_LOCALSTORAGE_KEYS = [
  'task-monitor.activeWorkspace.v1',
];

// Drop the Firestore IndexedDB cache. The persistent local cache is keyed per
// Firebase project, NOT per user — so without this, account B on a shared
// browser can read documents account A cached while it had access, even after
// security rules would deny a fresh server read. Must terminate the client
// first; the caller is expected to reload immediately afterward since `db`
// becomes unusable once terminated.
async function clearFirestoreCache() {
  try { await terminate(_db); } catch { /* already terminated / in use */ }
  try { await clearIndexedDbPersistence(_db); }
  catch (err) {
    // Fails if another tab still holds the cache open. Non-fatal: server-side
    // rules remain the real guard; the purge will succeed once tabs close.
    console.warn('[firestore] cache clear skipped:', err?.code || err);
  }
}

export async function signOutUser() {
  for (const k of PER_USER_LOCALSTORAGE_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignored */ }
  }
  await signOut(auth);
  await clearFirestoreCache();
  // Hard reload to a clean slate: no live listeners, no in-memory state, and a
  // freshly re-initialized Firestore client with an empty cache.
  try { window.location.reload(); } catch { /* non-browser env */ }
}

// One-time purge of any Firestore cache written BEFORE the workspace-scoped
// security rules were deployed. Older builds (looser rules) cached other users'
// documents in IndexedDB; those stale copies still render even though the
// server now denies fresh reads (the console fills with permission-denied).
// Bumping CACHE_SCHEMA_VERSION forces every browser to drop that cache once.
// Returns true when a purge happened (caller should reload).
const CACHE_SCHEMA_VERSION = '2026-06-17-workspace-isolation';
const CACHE_VERSION_KEY = 'task-monitor.cacheSchema';
export async function purgeStaleCacheOnce() {
  let current;
  try { current = localStorage.getItem(CACHE_VERSION_KEY); } catch { return false; }
  if (current === CACHE_SCHEMA_VERSION) return false;
  // Set the flag BEFORE clearing so a failed/partial clear can't cause a
  // reload loop. Server-side rules are the real guard regardless.
  try { localStorage.setItem(CACHE_VERSION_KEY, CACHE_SCHEMA_VERSION); } catch { /* ignored */ }
  await clearFirestoreCache();
  return true;
}

// ─── User profile / approval ────────────────────────────────────────────────
// Each authenticated user has a doc at `users/{uid}` capturing their approval
// status. The doc is created on first sign-in. Superadmin emails are
// auto-approved. Everyone else lands in 'pending' until a superadmin clicks
// Approve in Settings → User Management.

const usersRef = collection(db, 'users');

async function ensureUserProfile(user) {
  if (!user?.uid) return;
  const ref = doc(usersRef, user.uid);
  const snap = await getDoc(ref);
  const superadmin = isSuperadminEmail(user.email);

  if (!snap.exists()) {
    // First sign-in for this UID. Create the profile.
    await setDoc(ref, {
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      status: superadmin ? 'approved' : 'pending',
      role:   superadmin ? 'superadmin' : 'user',
      createdAt: serverTimestamp(),
      approvedAt: superadmin ? serverTimestamp() : null,
      approvedBy: superadmin ? 'system' : null,
    });
    return;
  }

  // Existing profile — keep display fields fresh and ensure superadmin
  // emails are always promoted (handles the case where the superadmin list
  // changes after a user first signs in).
  const data = snap.data();
  const patch = {
    email: user.email || data.email,
    displayName: user.displayName || data.displayName,
    photoURL: user.photoURL || data.photoURL,
  };
  if (superadmin && (data.role !== 'superadmin' || data.status !== 'approved')) {
    patch.role = 'superadmin';
    patch.status = 'approved';
    patch.approvedAt = serverTimestamp();
    patch.approvedBy = 'system';
  }
  await updateDoc(ref, patch);
}

export function subscribeToUserProfile(uid, callback) {
  if (!uid) {
    callback(null);
    return () => {};
  }
  return onSnapshot(doc(usersRef, uid), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, listenerError('userProfile', () => callback(null)));
}

export function subscribeToAllUsers(callback) {
  // Used by superadmin User Management. Firestore rules restrict this query
  // to approved superadmins only.
  return onSnapshot(usersRef, (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  }, listenerError('allUsers', () => callback([])));
}

export async function approveUser(targetUid, approverUid) {
  await updateDoc(doc(usersRef, targetUid), {
    status: 'approved',
    approvedAt: serverTimestamp(),
    approvedBy: approverUid,
  });
}

export async function rejectUser(targetUid, approverUid) {
  await updateDoc(doc(usersRef, targetUid), {
    status: 'rejected',
    approvedAt: serverTimestamp(),
    approvedBy: approverUid,
  });
}

export async function setUserRole(targetUid, role) {
  // role must be 'user' or 'superadmin'
  await updateDoc(doc(usersRef, targetUid), { role });
}

// Assign a user to a company. companyId may be null/'' to unassign.
// Superadmin-only: firestore.rules refuses `companyId` on a self-update, so a
// member cannot put themselves in a company and read its shared API key.
export async function setUserCompany(targetUid, companyId) {
  await updateDoc(doc(usersRef, targetUid), {
    companyId: companyId || null,
  });
}

// ─── Companies ──────────────────────────────────────────────────────────────
// Each "company" is a billing/admin construct that owns a shared Anthropic
// API key. Users are assigned to at most one company; AI calls made by any
// user in the company use the company's key (their token budget). Only
// superadmins can create/edit companies. Company members can read their own
// company doc (so the client can pull the key for AI calls).
const companiesRef = collection(db, 'companies');

const DEFAULT_AI_MODEL = 'claude-sonnet-4-5-20250929';

// The Anthropic key lives in a subdocument that only superadmins (and the
// server-side aiProxy function) can read. It used to sit on the company
// document, which every member could read — and therefore spend.
export const companySecretRef = (companyId) =>
  doc(db, 'companies', companyId, 'secrets', 'anthropic');

/** Read the company's key. Superadmin-only; anyone else gets permission-denied. */
export async function getCompanyApiKey(companyId) {
  if (!companyId) return '';
  const snap = await getDoc(companySecretRef(companyId));
  return snap.exists() ? (snap.data().anthropicApiKey || '') : '';
}

/** Set (or clear) the company's key. Superadmin-only. */
export async function setCompanyApiKey(companyId, apiKey) {
  if (!companyId) throw new Error('setCompanyApiKey requires a companyId');
  await setDoc(companySecretRef(companyId), {
    anthropicApiKey: String(apiKey || '').trim(),
    updatedAt: serverTimestamp(),
  });
}

/** Does this company have a key, without reading the key itself? */
export async function companyHasApiKey(companyId) {
  return !!(await getCompanyApiKey(companyId));
}

export async function addCompany(creatorUid, company) {
  const ref = doc(companiesRef);
  const data = {
    name: company.name?.trim() || 'New company',
    // `hasApiKey` is a flag, not the key: Settings needs to show "key set" to
    // people who must never be able to read it.
    hasApiKey: !!String(company.anthropicApiKey || '').trim(),
    anthropicModel:  (company.anthropicModel  || DEFAULT_AI_MODEL).trim(),
    // Per-company AI switch. New companies start allowed; a superadmin can
    // revoke access from Settings → Companies without touching the key.
    aiEnabled: company.aiEnabled !== false,
    createdByUserId: creatorUid,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  if (data.hasApiKey) await setCompanyApiKey(ref.id, company.anthropicApiKey);
  return { id: ref.id, ...data };
}

export async function updateCompany(companyId, updates) {
  const { anthropicApiKey, ...rest } = updates;
  const patch = { ...rest, updatedAt: serverTimestamp() };
  if (typeof patch.anthropicModel === 'string') patch.anthropicModel = patch.anthropicModel.trim();
  if (typeof patch.name           === 'string') patch.name           = patch.name.trim();

  // The key never goes on the company document — it goes in the secret, and
  // the document only records WHETHER there is one.
  if (typeof anthropicApiKey === 'string') {
    const trimmed = anthropicApiKey.trim();
    await setCompanyApiKey(companyId, trimmed);
    patch.hasApiKey = !!trimmed;
  }
  await updateDoc(doc(companiesRef, companyId), patch);
}

// One-off: move a key that is still on the company document into the secret,
// and blank it where every member can read it. Superadmin-only, idempotent —
// the Companies panel runs it when it loads.
export async function migrateCompanyKeys(companies = []) {
  let moved = 0;
  for (const c of companies) {
    const legacyKey = String(c?.anthropicApiKey || '').trim();
    if (!legacyKey) continue;
    await setCompanyApiKey(c.id, legacyKey);
    await updateDoc(doc(companiesRef, c.id), {
      anthropicApiKey: deleteField(),
      hasApiKey: true,
      updatedAt: serverTimestamp(),
    });
    moved += 1;
  }
  return { moved };
}

export async function softDeleteCompany(companyId) {
  await updateDoc(doc(companiesRef, companyId), {
    deleted: true,
    updatedAt: serverTimestamp(),
  });
}

// Superadmin-wide list of all companies (firestore rules restrict reads).
export function subscribeToCompanies(callback) {
  return onSnapshot(companiesRef, (snap) => {
    const list = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => !c.deleted)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    callback(list);
  }, listenerError('companies', () => callback([])));
}

// Subscribe to a single company doc (e.g. the one the current user belongs
// to). Safe for non-superadmin members via the read rule.
export function subscribeToCompany(companyId, callback) {
  if (!companyId) {
    callback(null);
    return () => {};
  }
  return onSnapshot(doc(companiesRef, companyId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, listenerError('company', () => callback(null)));
}

// ─── Helpers ────────────────────────────────────────────────────────────────


export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const workspacesRef = collection(db, 'workspaces');
const tasksRef = collection(db, 'tasks');
const activitiesRef = collection(db, 'activities');
const projectsRef = collection(db, 'projects');
const templatesRef = collection(db, 'templates');
const goalsRef = collection(db, 'goals');
const minutesRef = collection(db, 'minutes');
const taskCommentsRef = collection(db, 'taskComments');
const conversationsRef = collection(db, 'conversations');
const messagesRef = collection(db, 'messages');
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
    pendingInvites: [],        // [{ email, role, invitedBy, invitedAt }]
    pendingInviteEmails: [],   // the same emails, flat, so array-contains works
    pendingInviteRoles: {},    // email → role, so the rule can check the role
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

export async function addSegmentToWorkspace(workspaceId, segmentName, icon = null) {
  if (!segmentName.trim()) throw new Error('Segment name is required');
  const ref = doc(db, 'workspaces', workspaceId);
  const snap = await getDoc(ref);
  const current = snap.data() || {};
  const segments = current.segments || [];
  if (segments.some((s) => s.name === segmentName.trim())) {
    throw new Error('Segment already exists');
  }
  const updated = [...segments, { id: uid(), name: segmentName.trim(), icon: normalizeIcon(icon) }];
  await updateDoc(ref, { segments: updated, updatedAt: serverTimestamp() });
  return updated;
}

export async function updateSegmentInWorkspace(workspaceId, segmentId, newName) {
  if (!newName.trim()) throw new Error('Segment name is required');
  const ref = doc(db, 'workspaces', workspaceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Workspace not found');

  const current = snap.data() || {};
  const segments = current.segments || [];
  const oldSegment = segments.find((s) => s.id === segmentId);
  if (!oldSegment) throw new Error('Segment not found');

  if (segments.some((s) => s.name === newName.trim() && s.id !== segmentId)) {
    throw new Error('Segment name already exists');
  }

  const updated = segments.map((s) =>
    s.id === segmentId ? { ...s, name: newName.trim() } : s
  );

  // Just update the workspace segments array
  // Projects with the old segment name will automatically use the new name from workspace.segments
  await updateDoc(ref, { segments: updated, updatedAt: serverTimestamp() });
  return updated;
}

export async function deleteSegmentFromWorkspace(workspaceId, segmentId) {
  const ref = doc(db, 'workspaces', workspaceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Workspace not found');

  const current = snap.data() || {};
  const segments = current.segments || [];
  const segment = segments.find((s) => s.id === segmentId);
  if (!segment) throw new Error('Segment not found');

  const updated = segments.filter((s) => s.id !== segmentId);

  // Just update the workspace segments array
  // Projects with this segment name will fallback to Uncategorized when the segment no longer exists
  await updateDoc(ref, { segments: updated, updatedAt: serverTimestamp() });
  return updated;
}

export async function softDeleteWorkspace(workspaceId) {
  return await updateWorkspace(workspaceId, { deleted: true });
}

// Add a member by UID (used in current single-user flows or via UID-share).
// Role: 'admin'|'editor'|'viewer'. Owner is the original creator.
// ─── Inviting by email ──────────────────────────────────────────────────────
// An admin records an invitation; the invited person joins themselves the next
// time they open the app (claimPendingWorkspaceInvites, called from the sign-in
// path). No backend, and no Firebase UID has to change hands. See
// services/invites.js for the rules this enforces.

export async function inviteToWorkspaceByEmail(workspace, email, role, invitedBy) {
  const check = validateInvite(email, role, workspace);
  if (!check.ok) throw new Error(check.error);
  await updateDoc(doc(db, 'workspaces', workspace.id), {
    ...inviteFields(workspace, check.email, check.role, invitedBy),
    updatedAt: serverTimestamp(),
  });
  return check;
}

export async function revokeWorkspaceInvite(workspace, email) {
  await updateDoc(doc(db, 'workspaces', workspace.id), {
    ...revokeInviteFields(workspace, email),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Join every workspace that has an invitation for this user's email address.
 * Called once per sign-in. Idempotent: an invitation is removed as it is taken,
 * and a user already in `members` is skipped.
 */
export async function claimPendingWorkspaceInvites(user) {
  const email = normalizeEmail(user?.email);
  if (!user?.uid || !email) return { joined: 0 };

  const snap = await getDocs(query(
    workspacesRef,
    where('pendingInviteEmails', 'array-contains', email),
  ));

  let joined = 0;
  for (const d of snap.docs) {
    const workspace = { id: d.id, ...d.data() };
    const invite = inviteFor(workspace, email);
    if (!invite) continue;
    if ((workspace.members || []).includes(user.uid)) {
      // Already in — just tidy the invitation away.
      await updateDoc(d.ref, {
        ...revokeInviteFields(workspace, email),
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    await updateDoc(d.ref, {
      members: arrayUnion(user.uid),
      [`acl.${user.uid}`]: invite.role,
      [`memberProfiles.${user.uid}`]: {
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
      },
      ...revokeInviteFields(workspace, email),
      // The rule reads this to confirm the claim is the one being offered.
      lastClaimedInviteEmail: email,
      updatedAt: serverTimestamp(),
    });
    joined += 1;
  }
  return { joined };
}

export async function addWorkspaceMember(workspace, memberUserId, role = 'editor') {
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  if ((workspace.members || []).includes(memberUserId)) return;
  const ref = doc(db, 'workspaces', workspace.id);
  const updates = {
    members: [...(workspace.members || []), memberUserId],
    [`acl.${memberUserId}`]: role,
    updatedAt: serverTimestamp(),
  };
  // Best-effort: snapshot the new member's profile into memberProfiles so their
  // name/email/photo show immediately. The /users/{uid} read only succeeds for
  // superadmins (per rules); otherwise we silently fall back to the existing
  // behavior where the slot fills in when that user next opens the app.
  try {
    const snap = await getDoc(doc(db, 'users', memberUserId));
    if (snap.exists()) {
      const u = snap.data();
      updates[`memberProfiles.${memberUserId}`] = {
        displayName: u.displayName || '',
        email:       u.email || '',
        photoURL:    u.photoURL || '',
      };
    }
  } catch { /* not readable — name appears once the user next signs in */ }
  await updateDoc(ref, updates);
}

// Best-effort read of several users' public profile fields. Only the slots the
// caller is allowed to read (their own, or any when superadmin) come back.
export async function fetchUserProfiles(uids) {
  const out = {};
  await Promise.all((uids || []).map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        const u = snap.data();
        out[uid] = { displayName: u.displayName || '', email: u.email || '', photoURL: u.photoURL || '' };
      }
    } catch { /* not readable */ }
  }));
  return out;
}

// Fill in memberProfiles for any members missing a name/email (e.g. added
// before profile-snapshotting, or whose profile wasn't readable at add time).
// Persists what it can so every member benefits. Returns the resolved map for
// immediate display. Safe to call on modal open; a no-op when nothing's missing.
export async function backfillWorkspaceMemberProfiles(workspace) {
  const missing = (workspace.members || []).filter((uid) => {
    const p = workspace.memberProfiles?.[uid];
    return !p || (!p.displayName && !p.email);
  });
  if (missing.length === 0) return {};
  const fetched = await fetchUserProfiles(missing);
  const updates = {};
  Object.entries(fetched).forEach(([uid, prof]) => {
    if (prof.displayName || prof.email) updates[`memberProfiles.${uid}`] = prof;
  });
  if (Object.keys(updates).length > 0) {
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { ...updates, updatedAt: serverTimestamp() });
    } catch { /* read-only viewer — display still works from the returned map */ }
  }
  return fetched;
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

// Each workspace doc carries a `memberProfiles` map keyed by uid so any
// member can resolve another member's display name without needing read
// access to /users/{uid} (which is locked down). Each user keeps their own
// slot fresh; nobody can write to anyone else's slot (enforced by rules).
export async function updateMyMemberProfileInWorkspace(workspaceId, profile) {
  if (!workspaceId) return;
  const user = auth.currentUser;
  if (!user?.uid) return;
  const slot = {
    displayName: profile?.displayName || user.displayName || '',
    email:       profile?.email       || user.email       || '',
    photoURL:    profile?.photoURL    || user.photoURL    || '',
    updatedAt:   new Date().toISOString(),
  };
  try {
    await updateDoc(doc(db, 'workspaces', workspaceId), {
      [`memberProfiles.${user.uid}`]: slot,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal — names will just fall back to UID prefixes if this fails.
    console.warn('[memberProfiles] self-update failed:', err);
  }
}

// Shared error handler for collection listeners. A `permission-denied` here
// means the listener outlived the caller's access to that scope — a workspace
// switch, a sign-out mid-flight, or a stale pre-isolation cache the server now
// refuses. In every case we reset the bound state to empty so the UI can never
// keep showing rows the server denies, and we stay quiet for the expected
// permission-denied case (other errors are still surfaced).
function listenerError(label, reset) {
  return (err) => {
    if (err?.code !== 'permission-denied') {
      console.warn(`[subscribe:${label}]`, err?.code || err);
    }
    try { reset(); } catch { /* ignored */ }
  };
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
  }, listenerError('workspaces', () => callback([])));
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

// Repair pass for documents that were written without a workspaceId.
//
// Recurrence instances spawned before BUG-004 was fixed have no workspaceId,
// which means no view can see them — the Board, Calendar and Gantt all
// subscribe by workspace. They are not lost, just orphaned, so adopt them into
// the workspace the user is looking at. Owner-only (the rules let a user
// update their own documents), idempotent, and cheap: one indexed query per
// collection, and nothing to write once it has run.
const ORPHAN_REPAIR_KEY = 'task-monitor.orphanRepair.v1';

export async function repairOrphanedDocuments(userId, workspaceId) {
  if (!userId || !workspaceId) return { repaired: 0, skipped: 'missing ids' };

  const storageKey = `${ORPHAN_REPAIR_KEY}.${userId}.${workspaceId}`;
  try {
    if (localStorage.getItem(storageKey)) return { repaired: 0, skipped: 'already run' };
  } catch { /* private mode — just do the work */ }

  const counts = {};
  let total = 0;
  for (const { ref, name } of [
    { ref: tasksRef,      name: 'tasks' },
    { ref: activitiesRef, name: 'activities' },
  ]) {
    const snap = await getDocs(query(ref, where('userId', '==', userId)));
    const orphans = snap.docs.filter((d) => !d.data().workspaceId);
    counts[name] = orphans.length;
    total += orphans.length;

    let batch = writeBatch(db);
    let n = 0;
    for (const d of orphans) {
      batch.update(d.ref, { workspaceId });
      n++;
      if (n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    if (n % 400 !== 0) await batch.commit();
  }

  try { localStorage.setItem(storageKey, String(Date.now())); } catch { /* ignored */ }
  return { repaired: total, counts };
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
    // An icon per group — see services/icons.js. Only a value from that set is
    // stored, so nothing arbitrary can be rendered from a project document.
    icon: normalizeIcon(project.icon),
    phases,
    // Per-project ACL is retained for fine-grained sharing within a workspace.
    acl:     { [userId]: 'admin' },
    members: [userId],

    // v11: explicit project assignees (the "lead / owner" concept), separate
    // from ACL membership. assignedTo = system users; assignedToExternal =
    // freeform names for people not yet in the system.
    assignedTo:         project.assignedTo         || [],
    assignedToExternal: project.assignedToExternal || [],

    // v12: project segment/department for grouping (e.g., Sales, Finance)
    segment: project.segment || 'Uncategorized',

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
  }, listenerError('projects', () => callback([])));
}

// OBSOLETE — superseded by migrateToWorkspaces(). This used to seed default
// projects from the legacy single-user categories, but it created projects with
// NO workspaceId. Under the workspace-scoped security rules that create is
// always denied (permission-denied), so on first sign-in it threw and flooded
// the console with "[migration] failed". The workspace migration now handles
// onboarding. Kept as a no-op so any lingering import doesn't break.
export function migrateLegacyCategories() {
  return Promise.resolve({ migrated: false, reason: 'obsolete (superseded by workspace model)' });
}

// Subscribe to projects where the current user appears in `members` regardless
// of workspace — i.e. projects that were SHARED with them. Recipient could be
// in a totally different workspace; this is how that shared project shows up
// in their app at all. Caller dedupes against their workspace-scoped list.
export function subscribeToSharedProjects(userId, callback) {
  if (!userId) { callback([]); return () => {}; }
  const q = query(projectsRef, where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => !p.deleted);
    callback(data);
  }, listenerError('sharedProjects', () => callback([])));
}

// Subscribe to all non-deleted tasks across the given projectIds, in chunks of
// 30 (Firestore `in`-query limit). Used so a user who's a project member of a
// SHARED project can see its tasks even when the project lives in a workspace
// they're not part of.
export function subscribeToTasksByProjects(projectIds, callback) {
  if (!projectIds || projectIds.length === 0) { callback([]); return () => {}; }
  const chunks = [];
  for (let i = 0; i < projectIds.length; i += 30) chunks.push(projectIds.slice(i, i + 30));

  const byChunk = {};
  const seenInitial = new Set();
  const fire = () => {
    if (seenInitial.size < chunks.length) return;
    callback(Object.values(byChunk).flat());
  };
  const unsubs = chunks.map((chunk, idx) => {
    const q = query(tasksRef, where('projectId', 'in', chunk));
    return onSnapshot(q, (snap) => {
      byChunk[idx] = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => !t.deleted && !t.archived);
      seenInitial.add(idx);
      fire();
    }, listenerError('tasksByProjects', () => { byChunk[idx] = []; seenInitial.add(idx); fire(); }));
  });
  return () => unsubs.forEach((u) => u && u());
}

// Same shape, for activities under shared projects.
export function subscribeToActivitiesByProjects(projectIds, callback) {
  if (!projectIds || projectIds.length === 0) { callback([]); return () => {}; }
  const chunks = [];
  for (let i = 0; i < projectIds.length; i += 30) chunks.push(projectIds.slice(i, i + 30));

  const byChunk = {};
  const seenInitial = new Set();
  const fire = () => {
    if (seenInitial.size < chunks.length) return;
    callback(Object.values(byChunk).flat());
  };
  const unsubs = chunks.map((chunk, idx) => {
    const q = query(activitiesRef, where('projectId', 'in', chunk));
    return onSnapshot(q, (snap) => {
      byChunk[idx] = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => !a.deleted);
      seenInitial.add(idx);
      fire();
    }, listenerError('activitiesByProjects', () => { byChunk[idx] = []; seenInitial.add(idx); fire(); }));
  });
  return () => unsubs.forEach((u) => u && u());
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

    // v11: free-form "external" assignee names — for people who aren't
    // (yet) in the system. Display-only; doesn't grant access.
    //   [string, ...]
    assignedToExternal: task.assignedToExternal || [],

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

// Fire a browser-level event when a task is completed so any mounted UI (the
// global celebration modal) can react — regardless of which code path marked it
// done (drag-drop, cycle button, editor, activity modal…). No-op outside a DOM.
export function emitTaskDone(task) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('task:done', {
    detail: { title: task?.title || '' },
  }));
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

  if (nextStatus === 'done') emitTaskDone(task);

  if (nextStatus === 'done' && task.recurrence) {
    try { await spawnNextRecurrence(task); }
    catch (err) { console.error('Failed to spawn next recurrence:', err); }
  }
}

// ─── Recurrence ─────────────────────────────────────────────────────────────

async function spawnNextRecurrence(task) {
  const payload = buildNextRecurrenceTask(task);
  if (!payload) return null;   // series has ended

  // Idempotency: if a sibling task with the same recurrenceParentId already
  // exists with these dates, don't create a duplicate.
  const parentId = payload.recurrenceParentId;
  const existing = await getDocs(query(
    tasksRef,
    where('userId', '==', task.userId),
    where('recurrenceParentId', '==', parentId),
    where('deleted', '==', false),
  ));
  const dup = existing.docs.find((d) => {
    const t = d.data();
    return t.plan?.startDate === payload.plan.startDate
        && t.plan?.endDate   === payload.plan.endDate;
  });
  if (dup) return null;

  // Go through addTask rather than writing the document here. addTask is the
  // one place that knows the full task shape; a hand-rolled copy silently
  // loses every field added since it was written — which is exactly how these
  // instances ended up with no workspaceId, invisible to the Board.
  return await addTask(task.userId, payload);
}

/**
 * Materialise the recurring tasks that should exist by now.
 *
 * The on-completion path above still runs — ticking one off still makes the
 * next. This is what keeps a series alive when nobody ticks anything off: it
 * works out what is missing from the tasks already on screen and creates them.
 *
 * Idempotent by construction: `catchUpPlan` skips any occurrence whose due date
 * a sibling in the series already has, so two devices running it at the same
 * moment produce the same (usually empty) list, and a second run right after
 * the first produces nothing.
 *
 * @param {object[]} tasks   the workspace's live tasks
 * @returns {{ seriesId, payload }[]} what was created
 */
export async function materialiseRecurrences(tasks = [], { userId, today } = {}) {
  const plan = catchUpPlan(tasks, today ? { today } : {});
  if (!plan.length) return [];

  const created = [];
  for (const item of plan) {
    try {
      await addTask(item.userId || userId, item.payload);
      created.push(item);
    } catch (err) {
      // One series failing (a permission, a missing workspace) must not stop
      // the others from coming round.
      console.warn('[recurrence] could not create an instance', err);
    }
  }
  return created;
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

// ─── TRASH ──────────────────────────────────────────────────────────────────
// Every delete in this app is a soft delete: the document stays, with
// `deleted: true`. The dialogs have always said so — but nothing listed what
// had been deleted, so "can be restored" meant "ask someone with the Firestore
// console open". These read that flag back.

/** Everything deleted in a workspace, newest first. One listener per kind. */
export function subscribeToDeleted(workspaceId, kind, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const refs = { tasks: tasksRef, projects: projectsRef, minutes: minutesRef, goals: goalsRef };
  const ref = refs[kind];
  if (!ref) { callback([]); return () => {}; }

  // `deleted == true` is a single equality filter, so no composite index is
  // needed; the sort is over a handful of documents.
  const q = query(ref, where('workspaceId', '==', workspaceId), where('deleted', '==', true));
  return onSnapshot(q, (snap) => {
    callback(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0)));
  }, listenerError(`deleted:${kind}`, () => callback([])));
}

const TRASH_COLLECTION = {
  task: 'tasks', project: 'projects', minute: 'minutes', goal: 'goals',
};

/** Put something back. The inverse of every softDelete* in this file. */
export async function restoreDeleted(kind, id) {
  const collectionName = TRASH_COLLECTION[kind];
  if (!collectionName) throw new Error(`Cannot restore a ${kind}.`);
  return updateDoc(doc(db, collectionName, id), {
    deleted: false,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Remove something for good.
 *
 * The ONE place in the app that hard-deletes, and only from Trash, only on an
 * explicit confirmation. Tasks are excluded on purpose: activities reference
 * them by id, and a hard-deleted task would leave an activity log pointing at
 * nothing. A task in Trash stays there.
 */
export const CAN_DELETE_FOREVER = ['project', 'minute', 'goal'];

export async function deleteForever(kind, id) {
  if (!CAN_DELETE_FOREVER.includes(kind)) {
    throw new Error(
      kind === 'task'
        ? 'A task cannot be removed for good — the activity log refers to it. It stays in Trash.'
        : `Cannot permanently remove a ${kind}.`,
    );
  }
  return deleteDoc(doc(db, TRASH_COLLECTION[kind], id));
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
  }, listenerError('tasks', () => callback([])));
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

  const result = await batch.commit();
  // Taking an attachment off in the editor has to remove the bytes too, or the
  // row goes and the file stays for ever.
  await deleteUploads(orphanedPaths(oldActivity.attachments, updates.attachments));
  return result;
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
  const result = await batch.commit();
  // The record is gone; its files go with it, whoever uploaded them.
  await deleteUploads(attachmentPaths(activity));
  return result;
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
  const result = await batch.commit();
  await deleteUploads(attachmentPaths(activities));
  return result;
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
/**
 * One task's activity log.
 *
 * The `workspaceId` clause is NOT redundant with `taskId` — it is what makes
 * the query legal. Rules gate an activity read on workspaceId / owner /
 * project, and rules are not filters: a bare `where('taskId','==',id)` query
 * could match documents in a workspace the caller is not a member of, so
 * Firestore rejects the whole query and the log comes back silently empty.
 * Constraining workspaceId to one the caller belongs to makes every result
 * provably readable.
 *
 * Two equality clauses and no `orderBy`, so this needs no composite index —
 * the sort is client-side, over one task's own (small, bounded) history.
 */
export function subscribeToActivities(workspaceId, taskId, callback) {
  if (!workspaceId || !taskId) { callback([]); return () => {}; }
  const q = query(
    activitiesRef,
    where('workspaceId', '==', workspaceId),
    where('taskId', '==', taskId),
  );
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    callback(data);
  }, listenerError('activities', () => callback([])));
}

// Cross-task activities in a workspace — single where, sort + cap client-side.
// 500 cap matches the previous server-side limit; for workspaces with more
// than 500 activities we'd switch to paginated fetches.
// How many activities a live listener holds at once. Enough for every view in
// the app; small enough that a workspace with 50,000 entries does not download
// all of them to show the last week. Older entries are reached by paging
// (loadMoreActivities) rather than by widening the listener.
export const ACTIVITY_PAGE_SIZE = 200;

/**
 * Newest activities in a workspace. Ordered and limited BY FIRESTORE, not by
 * the client — this used to fetch the whole collection and sort it in the
 * browser on every snapshot.
 *
 * Needs the (workspaceId ASC, date DESC) composite index — see
 * firestore.indexes.json.
 *
 * @param {number} [pageSize]  how many to keep live
 */
export function subscribeToAllActivities(workspaceId, callback, { pageSize = ACTIVITY_PAGE_SIZE } = {}) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(
    activitiesRef,
    where('workspaceId', '==', workspaceId),
    orderBy('date', 'desc'),
    limit(pageSize),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, listenerError('allActivities', () => callback([])));
}

/**
 * One page of older activities, for "Load more". A one-shot read, not a
 * listener: history does not change, and a second live listener per page would
 * put the app right back where it started.
 *
 * @param {string} workspaceId
 * @param {string|null} beforeDate  the `date` of the oldest row on screen
 * @returns {Promise<{ activities: object[], hasMore: boolean }>}
 */
export async function loadMoreActivities(workspaceId, beforeDate, { pageSize = ACTIVITY_PAGE_SIZE } = {}) {
  if (!workspaceId || !beforeDate) return { activities: [], hasMore: false };
  const snap = await getDocs(query(
    activitiesRef,
    where('workspaceId', '==', workspaceId),
    orderBy('date', 'desc'),
    startAfter(beforeDate),
    limit(pageSize + 1),          // one extra tells us whether more exist
  ));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { activities: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

/**
 * Activities since a date — the Dashboard's 30-day window and the Review page.
 * The date bound is applied by Firestore, so a workspace with years of history
 * costs the same as one with a month of it.
 */
export function subscribeToRecentActivities(workspaceId, sinceDate, callback, { pageSize = ACTIVITY_PAGE_SIZE } = {}) {
  if (!workspaceId) { callback([]); return () => {}; }
  const constraints = [where('workspaceId', '==', workspaceId)];
  if (sinceDate) constraints.push(where('date', '>=', sinceDate));
  constraints.push(orderBy('date', 'desc'), limit(pageSize));

  return onSnapshot(query(activitiesRef, ...constraints), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, listenerError('recentActivities', () => callback([])));
}

// Subscribe to activities across multiple workspaces. One listener per
// workspace (Firestore array-contains-any doesn't work on equality fields).
// Calls back with the merged list whenever any workspace's data changes.
// Used by cross-workspace analytics (e.g. Workspace activity pulse).
export function subscribeToActivitiesAcrossWorkspaces(workspaceIds, sinceDate, callback) {
  if (!workspaceIds || workspaceIds.length === 0) {
    callback([]);
    return () => {};
  }
  const byWs = {};   // workspaceId → activities[]
  const seenInitial = new Set();
  const fire = () => {
    // Only fire once all workspaces have produced at least one snapshot.
    if (seenInitial.size < workspaceIds.length) return;
    callback(Object.values(byWs).flat());
  };
  const unsubs = workspaceIds.map((wsId) => {
    const q = query(activitiesRef, where('workspaceId', '==', wsId));
    return onSnapshot(q, (snap) => {
      byWs[wsId] = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => !sinceDate || (a.date || '') >= sinceDate);
      seenInitial.add(wsId);
      fire();
    }, listenerError('activitiesAcrossWorkspaces', () => { byWs[wsId] = []; seenInitial.add(wsId); fire(); }));
  });
  return () => unsubs.forEach((u) => u && u());
}

// Projects across every workspace the user belongs to. One listener per
// workspace, merged. Each project keeps its workspaceId so callers can group /
// label by workspace. Used by Goals, where a deliverable can link projects
// from other workspaces.
export function subscribeToProjectsAcrossWorkspaces(workspaceIds, callback) {
  if (!workspaceIds || workspaceIds.length === 0) { callback([]); return () => {}; }
  const byWs = {};
  const seenInitial = new Set();
  const fire = () => {
    if (seenInitial.size < workspaceIds.length) return;
    callback(Object.values(byWs).flat());
  };
  const unsubs = workspaceIds.map((wsId) => {
    const q = query(projectsRef, where('workspaceId', '==', wsId));
    return onSnapshot(q, (snap) => {
      byWs[wsId] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.deleted);
      seenInitial.add(wsId);
      fire();
    }, listenerError('projectsAcrossWorkspaces', () => { byWs[wsId] = []; seenInitial.add(wsId); fire(); }));
  });
  return () => unsubs.forEach((u) => u && u());
}

// Tasks across every workspace the user belongs to — used to compute project
// completion for cross-workspace deliverable links.
export function subscribeToTasksAcrossWorkspaces(workspaceIds, callback) {
  if (!workspaceIds || workspaceIds.length === 0) { callback([]); return () => {}; }
  const byWs = {};
  const seenInitial = new Set();
  const fire = () => {
    if (seenInitial.size < workspaceIds.length) return;
    callback(Object.values(byWs).flat());
  };
  const unsubs = workspaceIds.map((wsId) => {
    const q = query(tasksRef, where('workspaceId', '==', wsId));
    return onSnapshot(q, (snap) => {
      byWs[wsId] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => !t.deleted && !t.archived);
      seenInitial.add(wsId);
      fire();
    }, listenerError('tasksAcrossWorkspaces', () => { byWs[wsId] = []; seenInitial.add(wsId); fire(); }));
  });
  return () => unsubs.forEach((u) => u && u());
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
  }, listenerError('templates', () => callback([])));
}

// ─── GOALS (strategic plan one-pagers) ──────────────────────────────────────
// A goal mirrors the strategic-plan card: code + title, an Initiative line, a
// KPI, a Change Agenda (FROM→TO pairs), and Deliverables — each deliverable
// carrying its own target date + status so the Deliverables and Target Date
// columns stay row-aligned.

export async function addGoal(userId, goal) {
  if (!goal.workspaceId) throw new Error('addGoal requires goal.workspaceId');
  return await addDoc(goalsRef, {
    userId,
    workspaceId:  goal.workspaceId,
    code:         goal.code || '',
    title:        goal.title || '',
    initiative:   goal.initiative || '',
    kpi:          goal.kpi || '',
    color:        goal.color || '#1e2a52',   // banner color
    bgColor:      goal.bgColor || goal.color || '#1e2a52',  // card background
    changeAgenda: goal.changeAgenda || [],   // [{ id, from, to }]
    deliverables: goal.deliverables || [],   // [{ id, text, targetDate, status, projectIds }]
    order:        goal.order ?? Date.now(),
    archived:     false,
    deleted:      false,
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
  });
}

export async function updateGoal(goalId, updates) {
  return await updateDoc(doc(db, 'goals', goalId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function archiveGoal(goalId, archived = true) {
  return await updateGoal(goalId, { archived });
}

export async function softDeleteGoal(goalId) {
  return await updateGoal(goalId, { deleted: true });
}

export function subscribeToGoals(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(goalsRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((g) => !g.deleted)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)
        || (a.code || '').localeCompare(b.code || ''));
    callback(data);
  }, listenerError('goals', () => callback([])));
}

// ─── MINUTES (meeting minutes) ──────────────────────────────────────────────
// minutes/{id}: { userId, workspaceId, title, date (YYYY-MM-DD), attendees,
//   location, projectId, notes, decisions, actionItems:[{id,text,owner,due,done}],
//   archived, deleted, createdAt, updatedAt }

export async function addMinute(userId, minute) {
  if (!minute.workspaceId) throw new Error('addMinute requires minute.workspaceId');
  return await addDoc(minutesRef, {
    userId,
    workspaceId: minute.workspaceId,
    title:       minute.title || '',
    date:        minute.date || todayLocal(),
    attendees:   minute.attendees || '',
    location:    minute.location || '',
    projectId:   minute.projectId || null,
    notes:       minute.notes || '',
    decisions:   minute.decisions || '',
    actionItems: minute.actionItems || [],   // [{ id, text, owner, due, done }]
    // "The priority" — what the boss keeps emphasizing vs. what he pushed back.
    bossName:       minute.bossName || '',
    bossMentions:   minute.bossMentions || [],   // [{ id, text }]
    bossPushbacks:  minute.bossPushbacks || [],  // [{ id, text }]
    archived:    false,
    deleted:     false,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  });
}

export async function updateMinute(minuteId, updates) {
  return await updateDoc(doc(db, 'minutes', minuteId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function softDeleteMinute(minuteId) {
  return await updateMinute(minuteId, { deleted: true });
}

export function subscribeToMinutes(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(minutesRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => !m.deleted)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')   // newest meeting first
        || (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    callback(data);
  }, listenerError('minutes', () => callback([])));
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

// Upload a file to Firebase Storage under workspaces/{workspaceId}/{scope}/…
// Returns { name, url, type, size, path } shaped to fit our `attachments` array.
// `onProgress(fraction)` is called as the upload progresses.
//
// The workspace is required: a file stored per-uploader is a file only that
// uploader can ever delete, which left orphaned bytes behind every time an
// admin deleted somebody else's activity (IMP-008).
export async function uploadFile({ workspaceId, taskId, scope, file, filename, onProgress }) {
  const path = uploadPath({ workspaceId, taskId, scope, filename: filename || file?.name });
  const safeName = safeFilename(filename || file?.name);

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

/**
 * Remove stored files that nothing references any more.
 *
 * Best effort, and never inside the batch that removes the record: a file that
 * cannot be removed (a legacy `users/…` object somebody else uploaded) must not
 * stop the record from going. Pasted links have no `path` and are never
 * touched.
 */
export async function deleteUploads(paths) {
  await Promise.all((paths || []).map((p) => deleteUpload(p)));
}


// ─── TASK COMMENTS ──────────────────────────────────────────────────────────
// Discussion thread per task, separate from activity log.

// Note: `task` here can be either a task object (preferred — carries workspaceId
// directly) or the raw taskId for back-compat. Callers should pass the task.
/**
 * Add a comment, and tell the people it concerns.
 *
 * `audience` is what the caller already has on screen — the workspace's members
 * and their profiles, plus the author's own name. Without it the comment is
 * still saved; nobody is just told about it.
 *
 * @param {{ members?: string[], memberProfiles?: object, authorName?: string }} audience
 */
export async function addTaskComment(userId, task, body, audience = null) {
  const taskObj = typeof task === 'string' ? null : task;
  const taskId  = typeof task === 'string' ? task  : task?.id;
  if (!taskObj?.workspaceId) throw new Error('addTaskComment requires a task with workspaceId');
  const written = await addDoc(taskCommentsRef, {
    userId,
    workspaceId: taskObj.workspaceId,
    // Denormalize projectId so the security rule can grant project members
    // (recipients of SHARED projects) permission to comment, even when
    // they're not a member of the parent task's workspace.
    projectId:   taskObj.projectId || null,
    taskId,
    body: String(body || ''),
    createdAt: serverTimestamp(),
    deleted: false,
  });

  if (audience) {
    await raiseNotices(noticesForComment({
      body: String(body || ''),
      task: taskObj,
      authorId: userId,
      authorName: audience.authorName,
      members: audience.members || [],
      memberProfiles: audience.memberProfiles || {},
      watchers: audience.watchers || watchersOf(taskObj),
    }));
  }
  return written;
}

/**
 * Tell whoever has just been given this task. Called with the assignee lists
 * from before and after the change; nobody hears about a task they already had,
 * and nobody hears about giving a task to themselves.
 */
export async function notifyAssignment({ task, before = [], after = [], byUserId, byName }) {
  return raiseNotices(noticesForAssignment({ task, before, after, byUserId, byName }));
}

/**
 * Apply a workload-planner move: the patch `moveTaskPlan()` worked out, and the
 * notice the new owner deserves. One function so a drag can never quietly
 * reassign somebody's week without telling them.
 *
 * @param {object} task    the task as it is now
 * @param {object} patch   from services/workload.js `moveTaskPlan`
 * @param {{ byUserId, byName }} by
 */
export async function applyTaskMove(task, patch, { byUserId, byName } = {}) {
  if (!task?.id || !patch || !Object.keys(patch).length) return null;
  const result = await updateTask(task.id, patch);
  if (patch.assignedTo) {
    await notifyAssignment({
      task,
      before: task.assignedTo || [],
      after: patch.assignedTo,
      byUserId,
      byName,
    });
  }
  return result;
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
  }, listenerError('taskComments', () => callback([])));
}

// ─── CHAT (conversations + messages) ────────────────────────────────────────
// Closed-loop messaging scoped to a workspace. Two top-level collections:
//   conversations/{id}: { workspaceId, type:'dm'|'group', name, createdByUserId,
//     members:[uid], memberProfiles:{uid:{displayName,email,photoURL}},
//     lastMessageText, lastMessageSenderId, lastMessageSenderName,
//     lastMessageAt, readBy:{uid:Timestamp}, createdAt, updatedAt }
//   messages/{id}: { conversationId, workspaceId, senderId, senderName, text,
//     createdAt }
// Membership (conversation.members) gates both read and write via rules.

// Conversations the user participates in. Single array-contains filter (auto
// indexed); workspace scoping + sort happen client-side so no composite index
// is needed.
export function subscribeToConversations(workspaceId, userId, callback) {
  if (!workspaceId || !userId) { callback([]); return () => {}; }
  const q = query(conversationsRef, where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.workspaceId === workspaceId && !c.deleted)
      .sort((a, b) => (b.lastMessageAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0)
                    - (a.lastMessageAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0));
    callback(data);
  }, listenerError('conversations', () => callback([])));
}

// Find an existing 1:1 DM between two users in a workspace, or create one.
// `me` / `other` are { uid, displayName, email, photoURL }.
export async function findOrCreateDM(workspaceId, me, other) {
  // Look for an existing dm whose member set is exactly {me, other}.
  const snap = await getDocs(query(conversationsRef, where('members', 'array-contains', me.uid)));
  const existing = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .find((c) => c.workspaceId === workspaceId && c.type === 'dm' && !c.deleted
      && (c.members || []).length === 2 && c.members.includes(other.uid));
  if (existing) return existing.id;

  const profile = (u) => ({ displayName: u.displayName || '', email: u.email || '', photoURL: u.photoURL || '' });
  const ref = await addDoc(conversationsRef, {
    workspaceId,
    type: 'dm',
    name: '',
    createdByUserId: me.uid,
    members: [me.uid, other.uid],
    memberProfiles: { [me.uid]: profile(me), [other.uid]: profile(other) },
    lastMessageText: '',
    lastMessageSenderId: '',
    lastMessageSenderName: '',
    lastMessageAt: serverTimestamp(),
    readBy: { [me.uid]: serverTimestamp() },
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

// Create a group conversation. `members` is an array of { uid, displayName,
// email, photoURL } INCLUDING the creator.
export async function createGroupConversation(workspaceId, me, name, members) {
  const memberProfiles = {};
  members.forEach((u) => {
    memberProfiles[u.uid] = { displayName: u.displayName || '', email: u.email || '', photoURL: u.photoURL || '' };
  });
  const ref = await addDoc(conversationsRef, {
    workspaceId,
    type: 'group',
    name: String(name || '').trim() || 'New group',
    createdByUserId: me.uid,
    members: members.map((u) => u.uid),
    memberProfiles,
    lastMessageText: '',
    lastMessageSenderId: '',
    lastMessageSenderName: '',
    lastMessageAt: serverTimestamp(),
    readBy: { [me.uid]: serverTimestamp() },
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renameConversation(conversationId, name) {
  return await updateDoc(doc(db, 'conversations', conversationId), {
    name: String(name || '').trim() || 'Group',
    updatedAt: serverTimestamp(),
  });
}

// Add members to a conversation. `newMembers` is an array of { uid, displayName,
// email, photoURL }. Skips anyone already in the group.
export async function addConversationMembers(conversation, newMembers) {
  const existing = new Set(conversation.members || []);
  const toAdd = (newMembers || []).filter((u) => u?.uid && !existing.has(u.uid));
  if (toAdd.length === 0) return;
  const updates = {
    members: arrayUnion(...toAdd.map((u) => u.uid)),
    updatedAt: serverTimestamp(),
  };
  toAdd.forEach((u) => {
    updates[`memberProfiles.${u.uid}`] = {
      displayName: u.displayName || '',
      email:       u.email || '',
      photoURL:    u.photoURL || '',
    };
  });
  await updateDoc(doc(db, 'conversations', conversation.id), updates);
}

// Remove a member from a conversation (also used to "leave" by passing your own
// uid). Allowed for any current member by the security rules.
export async function removeConversationMember(conversationId, uid) {
  await updateDoc(doc(db, 'conversations', conversationId), {
    members: arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
}

// Messages for a conversation, oldest→newest. Single equality filter; sort +
// cap client-side (no composite index needed).
export function subscribeToMessages(conversationId, callback) {
  if (!conversationId) { callback([]); return () => {}; }
  const q = query(messagesRef, where('conversationId', '==', conversationId));
  return onSnapshot(q, (snap) => {
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => !m.deleted)
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? Infinity) - (b.createdAt?.toMillis?.() ?? Infinity))
      .slice(-400);
    callback(data);
  }, listenerError('messages', () => callback([])));
}

// Send a message: write the message and update the conversation's denormalized
// last-message preview + the sender's own read marker, atomically.
export async function sendMessage(conversation, sender, text) {
  const body = String(text || '').trim();
  if (!body) return;
  const batch = writeBatch(db);
  const msgRef = doc(messagesRef);
  batch.set(msgRef, {
    conversationId: conversation.id,
    workspaceId:    conversation.workspaceId,
    senderId:       sender.uid,
    senderName:     sender.displayName || sender.email || 'Someone',
    text:           body,
    deleted:        false,
    createdAt:      serverTimestamp(),
  });
  batch.update(doc(db, 'conversations', conversation.id), {
    lastMessageText:       body.slice(0, 140),
    lastMessageSenderId:   sender.uid,
    lastMessageSenderName: sender.displayName || sender.email || 'Someone',
    lastMessageAt:         serverTimestamp(),
    [`readBy.${sender.uid}`]: serverTimestamp(),
    updatedAt:             serverTimestamp(),
  });
  return await batch.commit();
}

// Mark a conversation read up to now for this user (clears the unread badge).
export async function markConversationRead(conversationId, userId) {
  if (!conversationId || !userId) return;
  try {
    await updateDoc(doc(db, 'conversations', conversationId), {
      [`readBy.${userId}`]: serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal: a read marker failing shouldn't break the UI.
    console.warn('markConversationRead failed:', err);
  }
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
    // v12: a saved view remembers the TABLE it was, not just the filters —
    // which columns, in what order, grouped by what. See services/tableViews.js.
    columns:       Array.isArray(view.columns) ? view.columns : null,
    groupBy:       view.groupBy || null,
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
  }, listenerError('savedViews', () => callback([])));
}

// ─── PRESENCE ───────────────────────────────────────────────────────────────
// Lightweight presence: while a user is viewing a task, ping presence/{taskId}/{uid}
// every ~20s. Listeners filter heartbeats older than 60s.
// Doc shape:
//   presence/{compositeId} = { taskId, userId, displayName, photoURL, lastSeen }

export async function pingPresence({ taskId, workspaceId, userId, displayName, photoURL }) {
  if (!workspaceId) return;   // rules scope presence reads to the workspace
  const docId = `${taskId}__${userId}`;
  return setDoc(doc(db, 'presence', docId), {
    taskId,
    workspaceId,
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

export function subscribeToPresence(taskId, workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(
    presenceRef,
    where('workspaceId', '==', workspaceId),
    where('taskId', '==', taskId),
  );
  return onSnapshot(q, (snap) => {
    const now = Date.now();
    const fresh = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => {
        const ts = p.lastSeen?.toMillis?.() ?? 0;
        return now - ts < 60_000;  // 60s freshness window
      });
    callback(fresh);
  }, listenerError('presence', () => callback([])));
}

// ─── AUTOMATIONS ────────────────────────────────────────────────────────────
// "When this happens, do that." Authored as dropdowns in Settings; run by the
// onTaskAutomations function. The vocabularies live in functions/src/automations.js
// so the editor and the runner can never disagree about what a rule means.

const automationsRef = collection(db, 'automations');

export function subscribeToAutomations(workspaceId, callback) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(automationsRef, where('workspaceId', '==', workspaceId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => !r.deleted)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
  }, listenerError('automations', () => callback([])));
}

export async function addAutomation(userId, rule) {
  if (!rule.workspaceId) throw new Error('addAutomation requires a workspaceId');
  return addDoc(automationsRef, {
    userId,
    workspaceId: rule.workspaceId,
    name: String(rule.name || '').trim(),
    trigger: rule.trigger,
    conditions: rule.conditions || [],
    action: rule.action,
    actionValue: rule.actionValue ?? '',
    enabled: rule.enabled !== false,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateAutomation(ruleId, updates) {
  return updateDoc(doc(db, 'automations', ruleId), { ...updates, updatedAt: serverTimestamp() });
}

export async function softDeleteAutomation(ruleId) {
  return updateDoc(doc(db, 'automations', ruleId), { deleted: true, updatedAt: serverTimestamp() });
}

/** What the rules have actually done, newest first. Read-only. */
export function subscribeToAutomationRuns(workspaceId, callback, { max = 50 } = {}) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(
    collection(db, 'automationRuns'),
    where('workspaceId', '==', workspaceId),
    orderBy('at', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, listenerError('automationRuns', () => callback([])));
}

/**
 * The notices raised for the signed-in person — "Tell someone" writes these.
 * Bounded at the server; the composite index is in firestore.indexes.json.
 */
export function subscribeToMyNotifications(userId, callback, { max = 20 } = {}) {
  if (!userId) { callback([]); return () => {}; }
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    orderBy('at', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, listenerError('notifications', () => callback([])));
}

/** Dismiss one notice. `read` is the only field a browser may change. */
export async function markNotificationRead(noticeId) {
  return updateDoc(doc(db, 'notifications', noticeId), { read: true });
}

/** Clear the whole inbox in one go. */
export async function markAllNotificationsRead(notices = []) {
  const unread = notices.filter((n) => n && n.id && !n.read);
  if (!unread.length) return null;
  const batch = writeBatch(db);
  unread.forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }));
  return batch.commit();
}

/**
 * Write the notices somebody just earned.
 *
 * Best effort, and deliberately not inside the batch that saved the comment or
 * the task: a notice that cannot be written (the recipient left the workspace
 * between the comment being typed and sent) must never lose the message itself.
 */
export async function raiseNotices(notices = []) {
  if (!notices.length) return;
  await Promise.all(notices.map((n) => addDoc(collection(db, 'notifications'), {
    ...n,
    at: serverTimestamp(),
  }).catch((err) => console.warn('could not raise a notice', err))));
}

// ─── READ-ONLY SHARE LINKS ──────────────────────────────────────────────────
//
// A link anybody can open, holding a SNAPSHOT of one project. Nothing else in
// the database becomes readable — see services/shareLinks.js for why it is a
// snapshot rather than a window, and firestore.rules for what the world is
// actually allowed to do with it.

const sharedViewsRef = collection(db, 'sharedViews');

/**
 * Publish a link. The token is the document id, so a reader fetches exactly one
 * document by exact id — the rules forbid listing, so nothing is enumerable.
 */
export async function createShareLink({
  userId, userName, workspaceId, project, tasks, kind, expiryDays,
}) {
  const token = newShareToken(cryptoBytes);
  const payload = buildShareLink({
    token, workspaceId, project, tasks, kind, expiryDays,
    createdByUserId: userId, createdByName: userName,
  });
  await setDoc(doc(db, 'sharedViews', token), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return token;
}

/** Take a fresh snapshot: the link keeps working, and starts telling the truth. */
export async function refreshShareLink(token, project, tasks) {
  return updateDoc(doc(db, 'sharedViews', token), {
    snapshot: buildSnapshot(project, tasks),
    projectName: String(project?.name || 'Project'),
    updatedAt: serverTimestamp(),
  });
}

/** Turn a link off. Instant, and enforced in the rules rather than the page. */
export async function revokeShareLink(token) {
  return updateDoc(doc(db, 'sharedViews', token), {
    revoked: true,
    updatedAt: serverTimestamp(),
  });
}

/** Change how long a link lasts without changing what it shows. */
export async function setShareLinkExpiry(token, expiresAt) {
  return updateDoc(doc(db, 'sharedViews', token), {
    expiresAt: expiresAt || null,
    updatedAt: serverTimestamp(),
  });
}

/** Remove one for good. */
export async function deleteShareLink(token) {
  return deleteDoc(doc(db, 'sharedViews', token));
}

/** The links published for one project, for the panel that manages them. */
export function subscribeToShareLinks(projectId, callback) {
  if (!projectId) { callback([]); return () => {}; }
  const q = query(sharedViewsRef, where('projectId', '==', projectId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
  }, listenerError('sharedViews', () => callback([])));
}

/**
 * Open a link. Works with nobody signed in — that is the whole point — and
 * returns null for a link that is missing, revoked or past its date, so the
 * page says the same thing in all three cases rather than leaking which.
 */
export async function getSharedView(token) {
  if (!token) return null;
  const snap = await getDoc(doc(db, 'sharedViews', token));
  if (!snap.exists()) return null;
  const share = { id: snap.id, ...snap.data() };
  return isShareLive(share) ? share : null;
}

// ─── WEBHOOKS ───────────────────────────────────────────────────────────────
//
// Delivery happens in `functions/webhooks.js`: a Firestore trigger signs the
// body with the webhook's secret and POSTs it, then writes the outcome to
// `webhookDeliveries` so Settings can show what actually happened.


/** The recent delivery attempts for a workspace, newest first. Read-only. */
export function subscribeToWebhookDeliveries(workspaceId, callback, { max = 50 } = {}) {
  if (!workspaceId) { callback([]); return () => {}; }
  const q = query(
    collection(db, 'webhookDeliveries'),
    where('workspaceId', '==', workspaceId),
    orderBy('at', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, listenerError('webhookDeliveries', () => callback([])));
}

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
  }, listenerError('webhooks', () => callback([])));
}

// ─── INVITES (v9 multi-user) ────────────────────────────────────────────────
// A shareable link that lets the recipient join a project. The URL is the
// secret. Each invite tracks role + optional expiry + a claims log.

export async function createInvite(userId, { projectId, projectName, role, expiresInDays }) {
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400 * 1000)
    : null;
  return await addDoc(invitesRef, {
    userId,
    projectId,
    projectName: projectName || '',   // denormalized so the recipient (who can't
                                      // yet read the project) can see its name
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
  // Fetch by exact document id. A `where('__name__','==',id)` query is a LIST
  // operation, which would need permission to enumerate the whole invites
  // collection — and enumerable invites means every share link is public.
  // A `get` needs only the id, which is the secret the recipient already has.
  const snap = await getDoc(doc(db, 'invites', inviteId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
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
  }, listenerError('invitesForProject', () => callback([])));
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

  // NOTE: we deliberately do NOT read the project here — the recipient isn't a
  // member yet, so a project read would be denied ("Missing or insufficient
  // permissions"). Instead we add them with field-level transforms that need no
  // prior read: arrayUnion is idempotent (no-op if already a member) and the
  // acl.<uid> dot-path sets their role. The security rule (isClaimingInvite)
  // validates the resulting document via the lastClaimInviteId side channel.
  const batch = writeBatch(db);

  const claim = {
    uid: currentUser.uid,
    displayName: currentUser.displayName || '',
    email: currentUser.email || '',
    claimedAt: new Date(),  // serverTimestamp not allowed inside array
  };
  batch.update(doc(db, 'invites', inviteId), { claims: arrayUnion(claim) });

  batch.update(doc(db, 'projects', invite.projectId), {
    members: arrayUnion(currentUser.uid),
    [`acl.${currentUser.uid}`]: invite.role,
    lastClaimInviteId: inviteId,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return { projectId: invite.projectId, alreadyMember: false };
}
