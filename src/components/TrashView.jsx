// src/components/TrashView.jsx — what you deleted, and how to get it back.
//
// Every delete dialog in this app says "this can be restored". Until now
// nothing listed what had been deleted, so restoring meant opening the
// Firestore console. This is the screen those dialogs were promising.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import {
  CAN_DELETE_FOREVER, deleteForever, restoreDeleted, subscribeToDeleted,
} from '../services/firebase';
import { friendlyError } from '../services/access';
import { iconFor } from '../services/icons';
import Icon from './Icon';
import { PageActions, PageSubtitle } from './PageHeader';

const KINDS = [
  { kind: 'task',    collection: 'tasks',    label: 'Tasks',    icon: 'board' },
  { kind: 'project', collection: 'projects', label: 'Projects', icon: 'projects' },
  { kind: 'minute',  collection: 'minutes',  label: 'Minutes',  icon: 'minutes' },
  { kind: 'goal',    collection: 'goals',    label: 'Goals',    icon: 'goals' },
];

const titleOf = (item, kind) =>
  item.title || item.name || (kind === 'minute' ? 'Untitled meeting' : 'Untitled');

function whenDeleted(item) {
  const d = item.updatedAt?.toDate?.();
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TrashView() {
  const workspaceId = useActiveWorkspaceId();
  const [byKind, setByKind] = useState({});
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [confirming, setConfirming] = useState(null);   // `${kind}:${id}`

  useEffect(() => {
    if (!workspaceId) return undefined;
    const unsubs = KINDS.map(({ kind, collection }) =>
      subscribeToDeleted(workspaceId, collection, (items) =>
        setByKind((prev) => ({ ...prev, [kind]: items }))));
    return () => unsubs.forEach((u) => u());
  }, [workspaceId]);

  // With no workspace there is nothing to show — derived rather than cleared
  // from inside the effect, which would cascade a render.
  const total = useMemo(
    () => (workspaceId ? KINDS.reduce((n, { kind }) => n + (byKind[kind]?.length || 0), 0) : 0),
    [byKind, workspaceId],
  );

  const say = useCallback((ok, text) => {
    setNote({ ok, text });
    setTimeout(() => setNote(null), 6000);
  }, []);

  const restore = async (kind, item) => {
    setBusy(`${kind}:${item.id}`);
    try {
      await restoreDeleted(kind, item.id);
      say(true, `“${titleOf(item, kind)}” is back.`);
    } catch (err) {
      console.error(err);
      say(false, friendlyError(err, 'Could not restore that. Try again.'));
    } finally { setBusy(null); }
  };

  const purge = async (kind, item) => {
    setBusy(`${kind}:${item.id}`);
    setConfirming(null);
    try {
      await deleteForever(kind, item.id);
      say(true, `“${titleOf(item, kind)}” has been removed for good.`);
    } catch (err) {
      console.error(err);
      say(false, friendlyError(err, 'Could not remove that.'));
    } finally { setBusy(null); }
  };

  return (
    <>
      <PageSubtitle>Nothing is lost until you say so — restore anything, or remove it for good</PageSubtitle>
      {note && (
        <PageActions>
          <span className={`small ${note.ok ? 'ok-text' : 'link-danger'}`} role="status">{note.text}</span>
        </PageActions>
      )}

      {total === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗑</div>
          <p>Trash is empty.</p>
          <p className="small">Anything you delete shows up here, and can be put back.</p>
        </div>
      ) : (
        KINDS.map(({ kind, label, icon }) => {
          const items = byKind[kind] || [];
          if (items.length === 0) return null;
          return (
            <section key={kind} className="review-section">
              <h2 className="review-h2">
                <Icon name={icon} size={16} /> {label} · {items.length}
              </h2>
              <ul className="dep-list">
                {items.map((item) => {
                  const key = `${kind}:${item.id}`;
                  const isConfirming = confirming === key;
                  return (
                    <li key={item.id} className="dep-item" style={{ gridTemplateColumns: 'auto 1fr auto auto' }}>
                      <span className="proj-icon" style={{ color: item.color || 'var(--c-text-muted)' }} aria-hidden="true">
                        {kind === 'project' ? iconFor(item) : '•'}
                      </span>
                      <span className="dep-title">
                        {titleOf(item, kind)}
                        {whenDeleted(item) && (
                          <span className="muted small" style={{ marginLeft: 8 }}>
                            deleted {whenDeleted(item)}
                          </span>
                        )}
                      </span>

                      <button
                        className="btn btn-sm"
                        onClick={() => restore(kind, item)}
                        disabled={busy === key}
                      >
                        {busy === key ? 'Working…' : '↩ Restore'}
                      </button>

                      {CAN_DELETE_FOREVER.includes(kind) ? (
                        isConfirming ? (
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className="muted small">Remove for good?</span>
                            <button
                              className="btn btn-sm btn-ghost link-danger"
                              onClick={() => purge(kind, item)}
                              disabled={busy === key}
                            >Yes, delete</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm btn-ghost link-danger"
                            onClick={() => setConfirming(key)}
                            disabled={busy === key}
                          >Delete forever</button>
                        )
                      ) : (
                        <span className="muted small" title="The activity log refers to this task by name">
                          Kept — the activity log refers to it
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}
