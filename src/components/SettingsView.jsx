// src/components/SettingsView.jsx — per-device preferences + data export.

import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useProjects, useTasks, useAllActivities, useAuth } from '../hooks/useTasks';
import {
  auth,
  signInWithGoogle,
  signOutUser,
} from '../services/firebase';
import {
  getNotificationPermission,
  requestNotificationPermission,
} from '../hooks/useNotifications';

export default function SettingsView() {
  const { settings, update, reset } = useSettings();
  const { projects } = useProjects();
  const { tasks } = useTasks();
  const { activities } = useAllActivities();
  const { userId } = useAuth();
  const [notifPerm, setNotifPerm] = useState(getNotificationPermission());
  const currentUser = auth.currentUser;
  const isAnonymous = !!currentUser?.isAnonymous;
  const displayName = currentUser?.displayName || currentUser?.email || (isAnonymous ? 'Anonymous' : 'Signed out');
  const photoURL = currentUser?.photoURL;

  // Keep permission state fresh
  useEffect(() => {
    const id = setInterval(() => setNotifPerm(getNotificationPermission()), 1500);
    return () => clearInterval(id);
  }, []);

  const handleSignIn = async () => {
    try { await signInWithGoogle(); }
    catch (err) {
      console.error(err);
      alert(`Sign-in failed: ${err.message || err.code || err}`);
    }
  };

  const handleSignOut = async () => {
    if (!confirm('Sign out? You’ll be put back in anonymous mode (new device session).')) return;
    await signOutUser();
  };

  const handleTestNotification = async () => {
    const p = await requestNotificationPermission();
    setNotifPerm(p);
    if (p === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        const title = '✓ Notifications enabled';
        const body  = 'You’ll be pinged when a task becomes overdue.';
        if (reg && reg.showNotification) reg.showNotification(title, { body });
        else if (typeof Notification !== 'undefined') new Notification(title, { body });
      } catch (e) { console.error(e); }
    } else if (p === 'denied') {
      alert('Notifications were blocked. Re-enable them in your browser’s site settings.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Per-device preferences. Stored in local storage (anonymous auth is also per-device).</p>
        </div>
      </div>

      <section className="review-section">
        <h2 className="review-h2">Account</h2>
        <div className="account-row">
          {photoURL ? (
            <img src={photoURL} alt="" className="account-avatar" />
          ) : (
            <div className="account-avatar fallback">
              {(displayName[0] || '?').toUpperCase()}
            </div>
          )}
          <div className="account-info">
            <div className="account-name">{displayName}</div>
            <div className="muted small">
              {isAnonymous
                ? 'Anonymous session. Data lives on this device only.'
                : currentUser?.email || 'Signed in.'}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {isAnonymous ? (
              <button className="btn btn-primary" onClick={handleSignIn}>
                Sign in with Google
              </button>
            ) : (
              <button className="btn" onClick={handleSignOut}>Sign out</button>
            )}
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          {isAnonymous
            ? 'Signing in with Google links this anonymous session to your Google account, so the same data appears on all your devices.'
            : 'Your data syncs across any device where you sign in with this Google account.'}
        </p>
      </section>

      <section className="review-section">
        <h2 className="review-h2">Notifications</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge badge-soft-${notifPerm === 'granted' ? 'success' : notifPerm === 'denied' ? 'danger' : 'muted'}`}>
            {notifPerm === 'granted' ? 'enabled' : notifPerm === 'denied' ? 'blocked' : notifPerm === 'unsupported' ? 'unsupported' : 'not set'}
          </span>
          {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
            <button className="btn" onClick={handleTestNotification}>Enable notifications</button>
          )}
          {notifPerm === 'granted' && (
            <button className="btn" onClick={handleTestNotification}>Send test notification</button>
          )}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          You’ll be pinged when a task with a plan-end date becomes overdue. Scanned on app load and every 5 min.
        </p>
      </section>

      <section className="review-section">
        <h2 className="review-h2">Appearance</h2>
        <div className="field">
          <label className="label">Theme</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['system', 'light', 'dark'].map((t) => (
              <button
                key={t}
                className={`chip ${settings.theme === t ? 'active' : ''}`}
                onClick={() => update({ theme: t })}
                style={{ textTransform: 'capitalize' }}
              >{t}</button>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            <strong>System</strong> follows your OS setting via <code>prefers-color-scheme</code>.
          </p>
        </div>
      </section>

      <section className="review-section">
        <h2 className="review-h2">Defaults</h2>

        <div className="field-row">
          <div className="field">
            <label className="label">Default project for quick-add</label>
            <select
              className="select"
              value={settings.defaultProject || ''}
              onChange={(e) => update({ defaultProject: e.target.value || null })}
            >
              <option value="">— First available —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Week starts on</label>
            <select
              className="select"
              value={settings.weekStart}
              onChange={(e) => update({ weekStart: Number(e.target.value) })}
            >
              <option value={0}>Sunday</option>
              <option value={1}>Monday</option>
            </select>
          </div>
        </div>
      </section>

      <section className="review-section">
        <h2 className="review-h2">Your data on this device</h2>
        <p className="muted small">
          Anonymous session <span className="mono">{userId}</span>. {projects.length} projects,
          {' '}{tasks.length} active tasks, {activities.length} activity entries.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => exportData({ projects, tasks, activities }, userId)}
          >Export JSON</button>
          <button
            className="btn"
            onClick={() => {
              if (confirm('Reset all settings to defaults? (This does not delete your data.)')) reset();
            }}
          >Reset settings</button>
        </div>
      </section>

      <section className="review-section">
        <h2 className="review-h2">About this device</h2>
        <p className="muted small">
          Your data is stored in Firebase Firestore (project <span className="mono">task-monitor-cbaf2</span>),
          isolated to your anonymous session. Different browsers, devices, or clearing site data create separate identities.
          To share data across devices, upgrade to Google sign-in.
        </p>
      </section>
    </>
  );
}

function exportData(data, userId) {
  const payload = {
    exportedAt: new Date().toISOString(),
    userId,
    ...data,
  };
  // Strip Firestore Timestamp internals to readable ISO strings
  const replacer = (k, v) => {
    if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
    return v;
  };
  const blob = new Blob([JSON.stringify(payload, replacer, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-monitor-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
