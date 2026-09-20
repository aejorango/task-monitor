// src/components/ShareLinksPanel.jsx — project editor → "Share with a client".
//
// Publishing part of your work to anyone holding a URL is the most consequential
// button in the app, so this panel is deliberately blunt about it: it says what
// will be visible and what will not BEFORE the link exists, shows every live
// link with when it dies, and puts "Turn off" next to each one.

import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import {
  createShareLink, deleteShareLink, refreshShareLink, revokeShareLink,
  subscribeToShareLinks,
} from '../services/firebase';
import { friendlyError } from '../services/access';
import { memberLabel } from '../services/invites';
import {
  DEFAULT_EXPIRY_DAYS, EXPIRY_CHOICES, SHARE_KINDS,
  describeShare, isShareLive, shareStatus, shareUrl,
} from '../services/shareLinks';
import { useToast } from './Toast';
import { useDialog } from './Dialog';

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);
const base = () => (globalThis.__VITE_ENV__?.BASE_URL ?? import.meta.env?.BASE_URL ?? '/');

export default function ShareLinksPanel({ project, tasks = [] }) {
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const toast = useToast();
  const ask = useDialog();

  const workspace = workspaces.find((w) => w.id === (project?.workspaceId || workspaceId));
  const role = workspace?.acl?.[userId];
  const canShare = role === 'owner' || role === 'admin';

  const [links, setLinks] = useState([]);
  const [kind, setKind] = useState('gantt');
  const [expiryDays, setExpiryDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeToShareLinks(project?.id, setLinks), [project?.id]);

  const live = links.filter((l) => isShareLive(l));

  if (!project?.id) {
    return <p className="muted small">Save the project first, then you can share it.</p>;
  }

  if (!canShare) {
    return (
      <p className="muted small">
        A workspace owner or admin can publish a read-only link to this project.
        {live.length > 0 && ` There ${live.length === 1 ? 'is' : 'are'} ${live.length} live right now.`}
      </p>
    );
  }

  const publish = async () => {
    const preview = describeShare({
      kind, projectName: project.name,
      snapshot: { tasks: tasks.filter((t) => t.projectId === project.id && !t.deleted && !t.archived) },
    });
    const yes = await ask.confirm({
      title: 'Publish a read-only link?',
      message: preview,
      confirmLabel: 'Publish the link',
    });
    if (!yes) return;

    setBusy(true);
    try {
      const token = await createShareLink({
        userId,
        userName: memberLabel(userId, workspace?.memberProfiles || {}),
        workspaceId: project.workspaceId || workspaceId,
        project,
        tasks,
        kind,
        expiryDays,
      });
      await copy(shareUrl(token, { origin: origin(), base: base() }));
      toast.success('Link published and copied. Anyone with it can see this snapshot.');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not publish that link.'));
    } finally { setBusy(false); }
  };

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); }
    catch { /* a browser that refuses the clipboard still shows the URL below */ }
  };

  const copyExisting = async (link) => {
    const url = shareUrl(link.id, { origin: origin(), base: base() });
    await copy(url);
    toast.success('Link copied.');
  };

  const refresh = async (link) => {
    try {
      await refreshShareLink(link.id, project, tasks);
      toast.success('The link now shows where the project stands today.');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not refresh that link.'));
    }
  };

  const turnOff = async (link) => {
    const yes = await ask.confirm({
      title: 'Turn this link off?',
      message: 'Anyone who has it will stop being able to open it, straight away. This cannot be undone — publish a new link if you change your mind.',
      confirmLabel: 'Turn it off',
      danger: true,
    });
    if (!yes) return;
    try {
      await revokeShareLink(link.id);
      toast.success('Link turned off.');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not turn that link off.'));
    }
  };

  const remove = async (link) => {
    const yes = await ask.confirm({
      title: 'Delete this link for good?',
      message: 'It is already switched off. Deleting it removes the record of it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try { await deleteShareLink(link.id); toast.success('Link deleted.'); }
    catch (err) { console.error(err); toast.error(friendlyError(err, 'Could not delete that link.')); }
  };

  return (
    <div className="share-panel">
      <p className="muted small" style={{ marginTop: 0 }}>
        Give a client or a contractor a page they can open without an account. They
        see the tasks, where each one stands and when it is due — <strong>not</strong>{' '}
        comments, attachments, hours, or who is working on what — and they cannot
        change anything.
      </p>

      <div className="share-new">
        <label className="label" htmlFor="share-kind">Show them</label>
        <select id="share-kind" className="select select-sm" value={kind}
          onChange={(e) => setKind(e.target.value)}>
          {SHARE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>

        <label className="label" htmlFor="share-expiry">For</label>
        <select id="share-expiry" className="select select-sm" value={expiryDays}
          onChange={(e) => setExpiryDays(Number(e.target.value))}>
          {EXPIRY_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <button className="btn btn-primary btn-sm" onClick={publish} disabled={busy}>
          {busy ? 'Publishing…' : 'Publish a link'}
        </button>
      </div>

      {links.length === 0 ? (
        <p className="muted small">No links published for this project.</p>
      ) : (
        <ul className="dep-list share-list">
          {links.map((link) => {
            const status = shareStatus(link);
            const url = shareUrl(link.id, { origin: origin(), base: base() });
            return (
              <li key={link.id} className="dep-item share-item">
                <span className={`badge badge-soft-${status.live ? 'success' : 'muted'}`}>
                  {status.live ? 'live' : 'off'}
                </span>
                <span className="dep-title">
                  <strong>{SHARE_KINDS.find((k) => k.value === link.kind)?.value === 'board' ? 'Board' : 'Timeline'}</strong>
                  <span className="muted small"> · {status.text}</span>
                  <span className="mono small share-url">{url}</span>
                </span>
                {status.live ? (
                  <>
                    <button className="btn btn-sm btn-ghost" onClick={() => copyExisting(link)}>Copy</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => refresh(link)}
                      title="Show what the project looks like today">Refresh</button>
                    <button className="btn btn-sm btn-ghost link-danger" onClick={() => turnOff(link)}>
                      Turn off
                    </button>
                  </>
                ) : (
                  <button className="btn btn-sm btn-ghost link-danger" onClick={() => remove(link)}>
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {live.length > 0 && (
        <p className="muted small">
          A link shows the project as it was when you published or last refreshed it —
          it does not keep up on its own.
        </p>
      )}
    </div>
  );
}
