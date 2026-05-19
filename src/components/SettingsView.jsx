// src/components/SettingsView.jsx — per-device preferences + data export.

import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useProjects, useTasks, useAllActivities, useAuth, useWebhooks } from '../hooks/useTasks';
import {
  addWebhook,
  updateWebhook,
  softDeleteWebhook,
} from '../services/firebase';
import {
  auth,
  signInWithGoogle,
  switchToGoogle,
  signOutUser,
} from '../services/firebase';
import {
  getNotificationPermission,
  requestNotificationPermission,
} from '../hooks/useNotifications';
import {
  getApiKey as getAnthropicKey,
  setApiKey as setAnthropicKey,
  getModel as getAnthropicModel,
  setModel as setAnthropicModel,
} from '../services/anthropic';

export default function SettingsView() {
  const { settings, update, reset } = useSettings();
  const { projects } = useProjects();
  const { tasks } = useTasks();
  const { activities } = useAllActivities();
  const { userId } = useAuth();
  const [notifPerm, setNotifPerm] = useState(getNotificationPermission());
  const [signInError, setSignInError] = useState(null);  // { code, message } or null
  const [signingIn, setSigningIn] = useState(false);
  const [anthroKey, setAnthroKey]     = useState(getAnthropicKey());
  const [anthroModel, setAnthroModel] = useState(getAnthropicModel());
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
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
    setSignInError(null);
    setSigningIn(true);
    const result = await signInWithGoogle();
    setSigningIn(false);
    if (!result.ok) {
      // Don't alert for the most common, harmless case (user closed popup)
      if (result.code !== 'popup-closed') {
        setSignInError({ code: result.code, message: result.message });
      }
    }
  };

  const handleSwitchAccount = async () => {
    setSignInError(null);
    setSigningIn(true);
    const result = await switchToGoogle();
    setSigningIn(false);
    if (!result.ok) {
      setSignInError({ code: result.code, message: result.message || 'Sign-in failed.' });
    }
  };

  const handleSignOut = async () => {
    if (!confirm('Sign out? You’ll be put back in anonymous mode (new device session).')) return;
    setSignInError(null);
    await signOutUser();
  };

  const handleTestNotification = async () => {
    const p = await requestNotificationPermission();
    setNotifPerm(p);

    if (p === 'denied') {
      alert('Notifications were blocked. Re-enable them in your browser’s site settings (click the lock icon next to the URL).');
      return;
    }
    if (p !== 'granted') {
      alert('Notification permission was not granted.');
      return;
    }

    try {
      // Wait for the service worker to be active. .ready awaits activation;
      // .getRegistration() can return undefined if called too early.
      let reg = null;
      if ('serviceWorker' in navigator) {
        try {
          reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, rej) => setTimeout(() => rej(new Error('SW timeout')), 3000)),
          ]);
        } catch (e) {
          console.warn('Service worker not ready:', e.message);
        }
      }

      const title   = '✓ Task Monitor notifications enabled';
      const options = {
        body: 'You’ll be pinged when a task becomes overdue.',
        tag: 'test-notification',
        icon: `${import.meta.env.BASE_URL}favicon.svg`,
        badge: `${import.meta.env.BASE_URL}favicon.svg`,
      };

      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
      } else if (typeof Notification !== 'undefined') {
        // Fallback to non-SW notification (only works while page is open)
        new Notification(title, options);
      } else {
        throw new Error('Notifications API is not available in this browser.');
      }
    } catch (e) {
      console.error('Could not show notification:', e);
      alert(`Could not show notification: ${e.message || e}\n\nThis can happen if the browser is blocking notifications at the OS level (macOS: System Settings → Notifications → Chrome).`);
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
              <button className="btn btn-primary" onClick={handleSignIn} disabled={signingIn}>
                {signingIn ? 'Signing in…' : 'Sign in with Google'}
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

        {signInError && (
          <div className="auth-error">
            <div className="auth-error-head">
              <span className="badge badge-soft-danger">Sign-in error</span>
              <span className="mono small">{signInError.code}</span>
              <button
                type="button"
                className="link-danger"
                onClick={() => setSignInError(null)}
                style={{ marginLeft: 'auto' }}
              >✕</button>
            </div>
            <p className="auth-error-msg">{signInError.message}</p>
            {signInError.code === 'account-already-exists' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={handleSwitchAccount} disabled={signingIn}>
                  {signingIn ? 'Switching…' : 'Switch to this account'}
                </button>
                <span className="muted small" style={{ alignSelf: 'center' }}>
                  Tip: export your anonymous data first (button below) if you want a backup.
                </span>
              </div>
            )}
            {signInError.code === 'popup-blocked' && (
              <p className="muted small" style={{ marginTop: 6 }}>
                In Chrome: click the popup-blocked icon in the URL bar → Always allow popups from this site.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="review-section">
        <h2 className="review-h2">AI (Anthropic API)</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Used by the ✨ <strong>Generate tasks from description</strong> feature on each project.
          Get a key at <a className="table-link" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          Stored only in this browser.
        </p>
        <div className="field">
          <label className="label">Anthropic API key</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={aiKeyVisible ? 'text' : 'password'}
              className="input"
              value={anthroKey}
              onChange={(e) => setAnthroKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
            />
            <button type="button" className="btn btn-sm" onClick={() => setAiKeyVisible(!aiKeyVisible)}>
              {aiKeyVisible ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setAnthropicKey(anthroKey.trim());
                setAnthropicModel(anthroModel.trim() || 'claude-sonnet-4-5-20250929');
                alert(anthroKey.trim() ? 'API key saved.' : 'API key cleared.');
              }}
            >Save</button>
          </div>
        </div>
        <div className="field">
          <label className="label">Model</label>
          <input
            type="text"
            className="input"
            value={anthroModel}
            onChange={(e) => setAnthroModel(e.target.value)}
            placeholder="claude-sonnet-4-5-20250929"
          />
          <p className="muted small" style={{ marginTop: 4 }}>
            Default: <span className="mono">claude-sonnet-4-5-20250929</span>. Change if you want a different Claude model.
          </p>
        </div>
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

      <WebhooksSection userId={userId} />

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

const EVENT_OPTIONS = [
  { value: 'task.created',   label: 'Task created' },
  { value: 'task.updated',   label: 'Task updated' },
  { value: 'task.completed', label: 'Task completed' },
  { value: 'task.deleted',   label: 'Task deleted' },
  { value: 'activity.logged',label: 'Activity logged' },
];

function WebhooksSection({ userId }) {
  const { hooks } = useWebhooks();
  const [editing, setEditing] = useState(null);

  return (
    <section className="review-section">
      <h2 className="review-h2">Webhooks</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        POST a JSON payload to a URL when something changes. The HTTP delivery
        requires a Cloud Function (see <strong>FEATURE_ROADMAP.md</strong> → Tier 4);
        the storage + UI here are ready.
      </p>

      {hooks.length === 0 ? (
        <p className="muted small">No webhooks configured.</p>
      ) : (
        <ul className="dep-list">
          {hooks.map((h) => (
            <li key={h.id} className="dep-item" style={{ gridTemplateColumns: 'auto 1fr auto auto auto' }}>
              <span className={`badge badge-soft-${h.enabled ? 'success' : 'muted'}`}>
                {h.enabled ? 'on' : 'off'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{h.name || '(unnamed)'}</strong>
                <span className="muted small" style={{ marginLeft: 8 }}>{h.url}</span>
              </span>
              <span className="muted small">{(h.events || []).length} events</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(h)}>Edit</button>
              <button className="btn btn-sm btn-ghost link-danger" onClick={() => {
                if (confirm('Delete this webhook?')) softDeleteWebhook(h.id);
              }}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setEditing('new')}>
        + New webhook
      </button>

      {editing && (
        <WebhookEditor
          hook={editing === 'new' ? null : editing}
          userId={userId}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function WebhookEditor({ hook, userId, onClose }) {
  const isNew = !hook;
  const [name, setName]   = useState(hook?.name || '');
  const [url, setUrl]     = useState(hook?.url || '');
  const [secret, setSecret] = useState(hook?.secret || '');
  const [events, setEvents] = useState(hook?.events || ['task.created', 'task.completed']);
  const [enabled, setEnabled] = useState(hook?.enabled !== false);
  const [busy, setBusy] = useState(false);

  const toggleEvent = (ev) => {
    setEvents(events.includes(ev) ? events.filter((e) => e !== ev) : [...events, ev]);
  };

  const save = async () => {
    if (!url.trim()) { alert('URL is required.'); return; }
    setBusy(true);
    try {
      if (isNew) await addWebhook(userId, { name, url, secret, events, enabled });
      else       await updateWebhook(hook.id, { name, url, secret, events, enabled });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save webhook. Check console.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <h3 className="modal-title">{isNew ? 'New webhook' : 'Edit webhook'}</h3>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Slack #project-updates" />
        </div>
        <div className="field">
          <label className="label">URL</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" />
        </div>
        <div className="field">
          <label className="label">Secret (optional)</label>
          <input className="input" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="HMAC signing secret" />
        </div>
        <div className="field">
          <label className="label">Events</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EVENT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`chip ${events.includes(o.value) ? 'active' : ''}`}
                onClick={() => toggleEvent(o.value)}
              >{o.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ accentColor: 'var(--c-accent)' }} />
            <span>Enabled</span>
          </label>
        </div>
        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !url.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
