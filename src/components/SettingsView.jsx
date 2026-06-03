// src/components/SettingsView.jsx — per-device preferences + data export.

import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useProjects, useTasks, useAllActivities, useAuth, useWebhooks } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import {
  addWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  addCompany,
  updateCompany,
  softDeleteCompany,
  setUserCompany,
  subscribeToCompany,
} from '../services/firebase';
import { useAllCompanies } from '../hooks/useCompany';
import WorkspaceEditor from './WorkspaceEditor';
import { WorkspaceIcon } from './WorkspaceSwitcher';
import {
  addWebhook,
  updateWebhook,
  softDeleteWebhook,
} from '../services/firebase';
import {
  auth,
  signOutUser,
  subscribeToAllUsers,
  approveUser,
  rejectUser,
  setUserRole,
  SUPERADMIN_EMAILS,
} from '../services/firebase';
import { useUserProfile } from '../hooks/useUserProfile';
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
  const { profile } = useUserProfile(userId);
  const [notifPerm, setNotifPerm] = useState(getNotificationPermission());
  const [anthroKey, setAnthroKey]     = useState(getAnthropicKey());
  const [anthroModel, setAnthroModel] = useState(getAnthropicModel());
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
  const currentUser = auth.currentUser;
  const displayName = currentUser?.displayName || currentUser?.email || 'Signed out';
  const photoURL = currentUser?.photoURL;
  const isSuperadmin = profile?.role === 'superadmin' && profile?.status === 'approved';

  // Keep permission state fresh
  useEffect(() => {
    const id = setInterval(() => setNotifPerm(getNotificationPermission()), 1500);
    return () => clearInterval(id);
  }, []);

  const handleSignOut = async () => {
    if (!confirm('Sign out of Task Monitor?')) return;
    await signOutUser();
  };

  // Send a test notification. This both diagnoses each failure mode
  // explicitly and surfaces a confirmation toast so the user knows the
  // click was handled even if the OS suppresses the actual notification
  // (a common macOS Chrome scenario).
  const handleTestNotification = async () => {
    const log = [];
    const tellUser = (msg) => alert(msg + '\n\n— Diagnostic trail —\n' + log.join('\n'));

    if (typeof Notification === 'undefined') {
      tellUser('This browser does not support the Notifications API.');
      return;
    }
    log.push(`Initial permission: ${Notification.permission}`);

    // Step 1: ensure permission
    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
        log.push(`After requestPermission: ${perm}`);
      } catch (e) {
        log.push(`requestPermission threw: ${e.message || e}`);
      }
    }
    setNotifPerm(perm);

    if (perm === 'denied') {
      tellUser('Notifications are blocked. Re-enable them in the browser\'s site settings (click the lock icon next to the URL → Site settings → Notifications → Allow).');
      return;
    }
    if (perm !== 'granted') {
      tellUser('Notification permission was not granted.');
      return;
    }

    // Step 2: ensure a service worker is registered. Try .ready, then
    // fall back to .getRegistration(), then to a fresh registration call.
    let reg = null;
    if ('serviceWorker' in navigator) {
      try {
        reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, rej) => setTimeout(() => rej(new Error('SW ready timed out')), 2500)),
        ]);
        log.push(`SW ready: scope=${reg?.scope || '?'}`);
      } catch (e) {
        log.push(`SW ready failed: ${e.message}`);
        try {
          reg = await navigator.serviceWorker.getRegistration();
          log.push(`getRegistration: ${reg ? 'found' : 'null'}`);
        } catch (e2) {
          log.push(`getRegistration threw: ${e2.message}`);
        }
        if (!reg) {
          try {
            const swUrl   = `${import.meta.env.BASE_URL}sw.js`;
            const swScope = import.meta.env.BASE_URL;
            reg = await navigator.serviceWorker.register(swUrl, { scope: swScope });
            log.push(`Registered SW on demand at ${reg.scope}`);
          } catch (e3) {
            log.push(`On-demand register failed: ${e3.message}`);
          }
        }
      }
    } else {
      log.push('Service workers unavailable in this browser.');
    }

    // Step 3: dispatch
    const title   = '✓ Task Monitor — test notification';
    const options = {
      body: 'If you see this banner, notifications are working.',
      tag: `test-${Date.now()}`,        // unique tag avoids being coalesced
      icon: `${import.meta.env.BASE_URL}blueinnov_logo.webp`,
      requireInteraction: false,
      silent: false,
    };

    let sent = false;
    if (reg && typeof reg.showNotification === 'function') {
      try {
        await reg.showNotification(title, options);
        log.push('reg.showNotification() resolved');
        sent = true;
      } catch (e) {
        log.push(`reg.showNotification threw: ${e.message}`);
      }
    }
    if (!sent) {
      try {
        const n = new Notification(title, options);
        n.onerror = (ev) => log.push(`Notification onerror: ${ev?.message || ''}`);
        log.push('new Notification() constructed');
        sent = true;
      } catch (e) {
        log.push(`new Notification threw: ${e.message}`);
      }
    }

    if (sent) {
      // Always surface a visible "Sent" message — on macOS, system Focus /
      // DND settings often suppress the actual banner without surfacing an
      // error, so the user thinks the button did nothing.
      tellUser(
        'Test notification dispatched.\n\n' +
        'If you didn\'t see it, your OS is probably suppressing it:\n' +
        '• macOS: System Settings → Notifications → find Chrome (or your browser) → set "Allow notifications" and "Banner" style.\n' +
        '• Check Focus / Do Not Disturb is off.\n' +
        '• Some browsers only show notifications when the app is in the background.'
      );
    } else {
      tellUser('Could not dispatch the notification — see diagnostic trail above.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Per-device preferences. Stored in local storage.</p>
        </div>
      </div>

      <WorkspacesSection currentUser={currentUser} />

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
            <div className="account-name">
              {displayName}
              {profile?.role === 'superadmin' && (
                <span className="badge badge-soft-info" style={{ marginLeft: 8 }}>superadmin</span>
              )}
            </div>
            <div className="muted small">{currentUser?.email || 'Signed in.'}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleSignOut}>Sign out</button>
          </div>
        </div>

        {userId && (
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label">Your Account ID</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input input-sm mono"
                value={userId}
                readOnly
                onFocus={(e) => e.target.select()}
                style={{ flex: 1 }}
              />
              <CopyButton value={userId} />
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              Share this ID with a workspace owner so they can add you as a member.
            </p>
          </div>
        )}

        <p className="muted small" style={{ marginTop: 8 }}>
          Your data syncs across any device where you sign in with this Google account.
        </p>
      </section>

      {isSuperadmin && <CompaniesManagementSection currentUid={userId} />}
      {isSuperadmin && <UserManagementSection currentUid={userId} />}

      {!isSuperadmin && <MyCompanyAiStatus profile={profile} />}

      {isSuperadmin && (
        <section className="review-section">
          <h2 className="review-h2">AI — superadmin fallback</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Personal, browser-only key used <strong>only when no company key is
            available</strong> (e.g. you haven't assigned yourself to a company yet).
            All other users' AI calls are billed to their assigned company's key.
            Need a key? Contact <a className="table-link" href="mailto:hello@blueinnovation.ph">hello@blueinnovation.ph</a>.
          </p>
          <div className="field">
            <label className="label">AI API key</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={aiKeyVisible ? 'text' : 'password'}
                className="input"
                value={anthroKey}
                onChange={(e) => setAnthroKey(e.target.value)}
                placeholder="Paste API key…"
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
              placeholder="Leave blank for default"
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              Leave blank to use the default model. Override only if instructed.
            </p>
          </div>
        </section>
      )}

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
          Your data is stored in Firebase Firestore (project <span className="mono">task-monitor-cbaf2</span>)
          and synced to your Google account, so it appears on every device you sign in from.
        </p>
      </section>
    </>
  );
}

// Small copy-to-clipboard button with transient "Copied" feedback.
function CopyButton({ value, label = '⎘ Copy' }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch (err) {
      console.error('clipboard copy failed', err);
    }
  };
  return (
    <button type="button" className="btn btn-sm" onClick={copy} style={{ whiteSpace: 'nowrap' }}>
      {ok ? '✓ Copied' : label}
    </button>
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
  const workspaceId = useActiveWorkspaceId();
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
      if (isNew) await addWebhook(userId, { workspaceId, name, url, secret, events, enabled });
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

// ─── Workspaces section ─────────────────────────────────────────────────────

function WorkspacesSection({ currentUser }) {
  const { workspaces } = useWorkspaces();
  const activeId = useActiveWorkspaceId();
  const active = workspaces.find((w) => w.id === activeId);
  const [editing, setEditing] = useState(null);   // workspace or 'new'
  const [showMembers, setShowMembers] = useState(false);

  const isOwner = active?.acl?.[currentUser?.uid] === 'owner';
  const isAdmin = isOwner || active?.acl?.[currentUser?.uid] === 'admin';

  return (
    <section className="review-section">
      <h2 className="review-h2">Workspaces</h2>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <p className="muted small" style={{ margin: 0 }}>
            You belong to <strong>{workspaces.length}</strong> workspace{workspaces.length === 1 ? '' : 's'}.
            {active && <> Currently active: <strong>{active.name}</strong>.</>}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New workspace</button>
      </div>

      {workspaces.length > 0 && (
        <div className="ws-list">
          {workspaces.map((w) => {
            const isActive = w.id === activeId;
            const myRole = w.acl?.[currentUser?.uid] || 'member';
            return (
              <div key={w.id} className={`ws-list-item ${isActive ? 'active' : ''}`}>
                <WorkspaceIcon workspace={w} size="sm" />
                <div className="ws-list-info">
                  <div className="ws-list-name">{w.name}</div>
                  <div className="muted small">
                    {w.members?.length || 0} member{w.members?.length === 1 ? '' : 's'} · your role: <strong>{myRole}</strong>
                  </div>
                  {w.description && <div className="muted small" style={{ marginTop: 2 }}>{w.description}</div>}
                </div>
                <div className="ws-list-actions">
                  {!isActive && (
                    <button className="btn btn-sm" onClick={() => setActiveWorkspaceId(w.id)}>Switch to</button>
                  )}
                  <button className="btn btn-sm" onClick={() => setEditing(w)}>Edit</button>
                  <button className="btn btn-sm" onClick={() => setShowMembers(w)}>Members</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <WorkspaceEditor
          workspace={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {showMembers && (
        <WorkspaceMembersModal
          workspace={showMembers}
          currentUid={currentUser?.uid}
          isAdmin={showMembers.acl?.[currentUser?.uid] === 'owner' || showMembers.acl?.[currentUser?.uid] === 'admin'}
          onClose={() => setShowMembers(false)}
        />
      )}
    </section>
  );
}

function WorkspaceMembersModal({ workspace, currentUid, isAdmin, onClose }) {
  const [newUid, setNewUid] = useState('');
  const [newRole, setNewRole] = useState('editor');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!newUid.trim()) return;
    setBusy(true);
    try { await addWorkspaceMember(workspace, newUid.trim(), newRole); setNewUid(''); }
    catch (err) { console.error(err); alert('Could not add member: ' + (err.message || '')); }
    finally { setBusy(false); }
  };
  const remove = async (uid) => {
    const prof = workspace.memberProfiles?.[uid];
    const who = prof?.displayName || prof?.email || uid;
    if (!confirm(`Remove member ${who}?`)) return;
    setBusy(true);
    try { await removeWorkspaceMember(workspace, uid); }
    catch (err) { console.error(err); alert('Could not remove member: ' + (err.message || '')); }
    finally { setBusy(false); }
  };
  const changeRole = async (uid, role) => {
    setBusy(true);
    try { await updateWorkspaceMemberRole(workspace, uid, role); }
    catch (err) { console.error(err); alert('Could not change role: ' + (err.message || '')); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <h3 className="modal-title">{workspace.name} — members</h3>
        <p className="modal-sub">
          Members can see and edit everything in this workspace. Owners can add/remove members and change roles. Ask a member for their Account ID (Settings → Account) and add them below.
        </p>

        <div className="ws-members-list">
          {(workspace.members || []).map((uid) => {
            const role = workspace.acl?.[uid] || 'editor';
            const isMe = uid === currentUid;
            const prof = workspace.memberProfiles?.[uid];
            const primary = prof?.displayName || prof?.email || `${uid.slice(0, 8)}…`;
            const secondary = prof?.displayName ? prof?.email : null;
            return (
              <div key={uid} className="ws-member-row">
                {prof?.photoURL ? (
                  <img src={prof.photoURL} alt="" className="account-avatar" style={{ width: 28, height: 28 }} />
                ) : (
                  <span className="account-avatar fallback" style={{ width: 28, height: 28, fontSize: 12 }}>
                    {(primary[0] || '?').toUpperCase()}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {primary}{isMe && <span className="muted"> (you)</span>}
                  </div>
                  {secondary && (
                    <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {secondary}
                    </div>
                  )}
                  <div className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {uid}
                  </div>
                </div>
                {isAdmin && role !== 'owner' ? (
                  <select
                    className="select select-sm"
                    value={role}
                    onChange={(e) => changeRole(uid, e.target.value)}
                    disabled={busy}
                  >
                    <option value="admin">admin</option>
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                ) : (
                  <span className="badge badge-soft-muted">{role}</span>
                )}
                {isAdmin && role !== 'owner' && (
                  <button className="btn btn-sm btn-ghost link-danger" onClick={() => remove(uid)} disabled={busy}>✕</button>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label">Add member by Account ID</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input input-sm mono"
                value={newUid}
                onChange={(e) => setNewUid(e.target.value)}
                placeholder="Account ID"
                style={{ flex: 1 }}
              />
              <select className="select select-sm" value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ width: 110 }}>
                <option value="admin">admin</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button className="btn btn-sm" onClick={add} disabled={busy || !newUid.trim()}>Add</button>
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              The user must have signed in at least once. They can copy their Account ID from their <em>Settings → Account</em> page. Their name and email will appear here once they next open the app.
            </p>
          </div>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── User Management (superadmin only) ──────────────────────────────────────

function UserManagementSection({ currentUid }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');  // 'pending' | 'approved' | 'rejected' | 'all'
  const [busyUid, setBusyUid] = useState(null);
  // Companies are needed for the per-user "Company" dropdown. Superadmin
  // only — and this section already only renders for superadmins.
  const { companies } = useAllCompanies(true);

  const handleAssignCompany = async (uid, companyId) => {
    setBusyUid(uid);
    try { await setUserCompany(uid, companyId || null); }
    catch (err) { alert('Failed to assign company: ' + (err.message || err)); }
    finally { setBusyUid(null); }
  };

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToAllUsers((list) => {
      setUsers(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = users.filter((u) => filter === 'all' ? true : u.status === filter);
  const counts = {
    pending:  users.filter((u) => u.status === 'pending').length,
    approved: users.filter((u) => u.status === 'approved').length,
    rejected: users.filter((u) => u.status === 'rejected').length,
  };

  const handleApprove = async (uid) => {
    setBusyUid(uid);
    try { await approveUser(uid, currentUid); }
    catch (err) { alert('Failed to approve: ' + (err.message || err)); }
    finally { setBusyUid(null); }
  };
  const handleReject = async (uid) => {
    if (!confirm('Reject this user? They will be blocked from accessing the app.')) return;
    setBusyUid(uid);
    try { await rejectUser(uid, currentUid); }
    catch (err) { alert('Failed to reject: ' + (err.message || err)); }
    finally { setBusyUid(null); }
  };
  const handleToggleRole = async (uid, currentRole) => {
    const nextRole = currentRole === 'superadmin' ? 'user' : 'superadmin';
    if (!confirm(`Change role to "${nextRole}"?`)) return;
    setBusyUid(uid);
    try { await setUserRole(uid, nextRole); }
    catch (err) { alert('Failed to change role: ' + (err.message || err)); }
    finally { setBusyUid(null); }
  };

  return (
    <section className="review-section">
      <h2 className="review-h2">User Management</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Approve or reject sign-in requests. Superadmin emails
        ({SUPERADMIN_EMAILS.join(', ')}) are auto-approved on first sign-in.
      </p>

      <div className="field" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { id: 'pending',  label: `Pending (${counts.pending})` },
          { id: 'approved', label: `Approved (${counts.approved})` },
          { id: 'rejected', label: `Rejected (${counts.rejected})` },
          { id: 'all',      label: `All (${users.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`btn btn-sm ${filter === tab.id ? 'btn-primary' : ''}`}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted small">Loading users…</p>
      ) : filtered.length === 0 ? (
        <p className="muted small">
          {filter === 'pending' ? 'No pending requests.' : `No ${filter} users.`}
        </p>
      ) : (
        <div className="user-mgmt-list">
          {filtered.map((u) => (
            <div key={u.id} className="user-mgmt-row">
              {u.photoURL ? (
                <img src={u.photoURL} alt="" className="um-avatar" />
              ) : (
                <div className="um-avatar fallback">
                  {(u.displayName || u.email || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="um-info">
                <div className="um-name">
                  {u.displayName || '(no name)'}
                  {u.role === 'superadmin' && (
                    <span className="badge badge-soft-info" style={{ marginLeft: 6 }}>superadmin</span>
                  )}
                </div>
                <div className="um-email">{u.email}</div>
                {u.status === 'approved' && (() => {
                  const assignedCompany = companies.find((c) => c.id === u.companyId);
                  const aiBlocked = !u.companyId || !(assignedCompany?.anthropicApiKey || '').trim();
                  const aiBlockedReason = !u.companyId
                    ? 'Unassigned — AI disabled for this user.'
                    : `Company "${assignedCompany?.name}" has no AI key — AI disabled for this user.`;
                  return (
                    <div className="um-company-row">
                      <label className="small muted" style={{ marginRight: 6 }}>Company:</label>
                      <select
                        className="select select-sm"
                        value={u.companyId || ''}
                        disabled={busyUid === u.id}
                        onChange={(e) => handleAssignCompany(u.id, e.target.value)}
                        title="Assign this user to a company (their AI calls bill to that company's API key)"
                      >
                        <option value="">— Unassigned —</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.anthropicApiKey ? '' : ' (no key)'}
                          </option>
                        ))}
                      </select>
                      {u.role !== 'superadmin' && aiBlocked && (
                        <span className="badge badge-soft-warn" title={aiBlockedReason}>
                          AI off
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <span
                className={`badge badge-soft-${
                  u.status === 'approved' ? 'success'
                    : u.status === 'rejected' ? 'danger'
                    : 'warn'
                }`}
              >
                {u.status}
              </span>
              <div className="um-actions">
                {u.status === 'pending' && (
                  <>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleApprove(u.id)}
                      disabled={busyUid === u.id}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-sm btn-ghost link-danger"
                      onClick={() => handleReject(u.id)}
                      disabled={busyUid === u.id}
                    >
                      Reject
                    </button>
                  </>
                )}
                {u.status === 'approved' && u.id !== currentUid && (
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleToggleRole(u.id, u.role)}
                      disabled={busyUid === u.id}
                      title={u.role === 'superadmin' ? 'Demote to user' : 'Promote to superadmin'}
                    >
                      {u.role === 'superadmin' ? '↓ Demote' : '↑ Make admin'}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost link-danger"
                      onClick={() => handleReject(u.id)}
                      disabled={busyUid === u.id}
                    >
                      Revoke
                    </button>
                  </>
                )}
                {u.status === 'rejected' && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleApprove(u.id)}
                    disabled={busyUid === u.id}
                  >
                    Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Companies management (superadmin only) ─────────────────────────────────
// One row per company. Inline-editable name + Anthropic API key + model.
// Save commits to Firestore. Soft-delete (archives) on Delete.

function CompaniesManagementSection() {
  const { companies, loading } = useAllCompanies(true);
  const { userId } = useAuth();
  const [creatingName, setCreatingName] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const name = creatingName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await addCompany(userId, { name });
      setCreatingName('');
    } catch (err) {
      alert('Failed to create company: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="review-section">
      <h2 className="review-h2">Companies</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Each company has its own AI API key. Users you assign to a
        company use that company's key for all AI features — so you can
        budget AI token spend per company. Need a key? Contact{' '}
        <a className="table-link" href="mailto:hello@blueinnovation.ph">hello@blueinnovation.ph</a>.
      </p>

      <div className="company-create-row">
        <input
          type="text"
          className="input"
          value={creatingName}
          onChange={(e) => setCreatingName(e.target.value)}
          placeholder="New company name…"
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={busy || !creatingName.trim()}
        >
          + Create company
        </button>
      </div>

      {loading ? (
        <p className="muted small" style={{ marginTop: 12 }}>Loading companies…</p>
      ) : companies.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          No companies yet. Create one above, then assign users to it from User Management.
        </p>
      ) : (
        <div className="company-list">
          {companies.map((c) => <CompanyRow key={c.id} company={c} />)}
        </div>
      )}
    </section>
  );
}

function CompanyRow({ company }) {
  const [name, setName]     = useState(company.name || '');
  const [apiKey, setApiKey] = useState(company.anthropicApiKey || '');
  const [model, setModel]   = useState(company.anthropicModel  || 'claude-sonnet-4-5-20250929');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // Resync local editable state with the prop when Firestore pushes an
  // external change to this company doc. This is the controlled-input sync
  // pattern — necessary because the same admin's *other* device could edit
  // the same row concurrently. Linter flags setState-in-effect but it's
  // intentional and self-contained here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(company.name || ''); }, [company.name]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setApiKey(company.anthropicApiKey || ''); }, [company.anthropicApiKey]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setModel(company.anthropicModel || 'claude-sonnet-4-5-20250929'); }, [company.anthropicModel]);

  const dirty =
    name.trim() !== (company.name || '') ||
    apiKey.trim() !== (company.anthropicApiKey || '') ||
    model.trim() !== (company.anthropicModel || 'claude-sonnet-4-5-20250929');

  const save = async () => {
    if (!name.trim()) { alert('Company name cannot be empty.'); return; }
    setBusy(true);
    try {
      await updateCompany(company.id, {
        name: name.trim(),
        anthropicApiKey: apiKey,
        anthropicModel:  model || 'claude-sonnet-4-5-20250929',
      });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err) {
      alert('Failed to save: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete company "${company.name}"? Users assigned to it will fall back to unassigned. This is a soft delete.`)) return;
    setBusy(true);
    try { await softDeleteCompany(company.id); }
    catch (err) { alert('Failed to delete: ' + (err.message || err)); }
    finally { setBusy(false); }
  };

  const keyStatus = (company.anthropicApiKey || '').trim()
    ? <span className="badge badge-soft-success">key set</span>
    : <span className="badge badge-soft-warn">no key</span>;

  return (
    <div className="company-row">
      <div className="company-row-head">
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Company name"
        />
        {keyStatus}
        <div style={{ flex: 1 }} />
        {savedAt && <span className="badge badge-soft-success">✓ Saved</span>}
        <button className="btn btn-sm" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-sm btn-ghost link-danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>

      <div className="company-row-fields">
        <div className="field">
          <label className="label">AI API key</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showKey ? 'text' : 'password'}
              className="input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste API key…"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn btn-sm" onClick={() => setShowKey(!showKey)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>
            Stored in Firestore; readable only by superadmins and members of this company.
          </p>
        </div>

        <div className="field">
          <label className="label">Model <span className="muted small">(optional)</span></label>
          <input
            type="text"
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Leave blank for default"
          />
          <p className="muted small" style={{ marginTop: 4 }}>
            Leave blank to use the default model. Override only if instructed.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Non-admin AI status card ───────────────────────────────────────────────
// Replaces the AI section for regular users. Tells them, plainly, whose
// budget they're using and what to do if AI features fail.

function MyCompanyAiStatus({ profile }) {
  const companyId = profile?.companyId || null;
  // Read from the companies list to show the name. Non-superadmin can read
  // exactly their own company via the security rule (isMyCompany). We use
  // the single-doc subscription via subscribeToCompany.
  const [rawCompany, setCompany] = useState(null);
  // Derive: if no companyId, force null so stale data never leaks through
  // (avoids a synchronous setState in the effect body).
  const company = companyId ? rawCompany : null;

  useEffect(() => {
    if (!companyId) return;
    const unsub = subscribeToCompany(companyId, setCompany);
    return () => unsub();
  }, [companyId]);

  if (!companyId) {
    return (
      <section className="review-section">
        <h2 className="review-h2">AI access</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          The AI feature is not available on your end. To enable it, contact
          your company admin or reach out to{' '}
          <a className="table-link" href="mailto:hello@blueinnovation.ph">hello@blueinnovation.ph</a>.
        </p>
      </section>
    );
  }

  const hasKey = !!(company?.anthropicApiKey || '').trim();
  return (
    <section className="review-section">
      <h2 className="review-h2">AI access</h2>
      {hasKey ? (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Your AI usage is provided by <strong>{company?.name || 'your company'}</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge badge-soft-success">AI enabled</span>
          </div>
        </>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            The AI feature is not available on your end. To enable it, contact
            your company admin or reach out to{' '}
            <a className="table-link" href="mailto:hello@blueinnovation.ph">hello@blueinnovation.ph</a>.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge badge-soft-warn">AI not available</span>
          </div>
        </>
      )}
    </section>
  );
}
