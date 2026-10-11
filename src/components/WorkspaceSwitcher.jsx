// src/components/WorkspaceSwitcher.jsx
// Sidebar top: active workspace name + chevron → dropdown to switch, manage,
// or create a new workspace — or to see ALL workspaces at once. "All" is a
// view, not a workspace: the active one stays chosen, as the home new items
// go to, and the menu says which (services/activeWorkspace.js).

import { useEffect, useRef, useState } from 'react';
import WorkspaceEditor from './WorkspaceEditor';

export default function WorkspaceSwitcher({ workspaces, activeId, onSwitch, onManage, allOn = false, onAll = null }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef(null);
  const active = workspaces.find((w) => w.id === activeId) || workspaces[0];
  const live = workspaces.filter((w) => !w.deleted && !w.archived);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <>
      <div className="ws-switcher" ref={ref}>
        <button className="ws-switcher-trigger" onClick={() => setOpen(!open)} data-tutorial="ws-switcher">
          {allOn ? <AllIcon /> : <WorkspaceIcon workspace={active} />}
          <div className="ws-info">
            <div className="ws-name">{allOn ? 'All workspaces' : (active?.name || 'No workspace')}</div>
            <div className="ws-sub">
              {allOn
                ? `${live.length} workspace${live.length === 1 ? '' : 's'} · new in ${active?.name || '—'}`
                : `${active?.members?.length || 0} member${active?.members?.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <span className="ws-chevron">▾</span>
        </button>

        {open && (
          <div className="ws-menu">
            <div className="ws-menu-section-label">Workspaces</div>
            {onAll && live.length > 1 && (
              <button
                className={`ws-menu-item ws-menu-all ${allOn ? 'active' : ''}`}
                onClick={() => { onAll(); setOpen(false); }}
                aria-pressed={allOn}
              >
                <AllIcon size="sm" />
                <div className="ws-menu-item-text">
                  <div>All workspaces</div>
                  <div className="muted small">See every workspace's tasks together</div>
                </div>
                {allOn && <span className="ws-check">✓</span>}
              </button>
            )}
            {workspaces.map((w) => (
              <button
                key={w.id}
                className={`ws-menu-item ${!allOn && w.id === activeId ? 'active' : ''}`}
                onClick={() => { onSwitch(w.id); setOpen(false); }}
              >
                <WorkspaceIcon workspace={w} size="sm" />
                <div className="ws-menu-item-text">
                  <div>{w.name}</div>
                  <div className="muted small">
                    {w.members?.length || 0} member{w.members?.length === 1 ? '' : 's'}
                    {/* In All, the active workspace is still where new things land. */}
                    {allOn && w.id === activeId && ' · new items go here'}
                  </div>
                </div>
                {!allOn && w.id === activeId && <span className="ws-check">✓</span>}
              </button>
            ))}
            <div className="ws-menu-divider" />
            <button className="ws-menu-item" onClick={() => { setCreating(true); setOpen(false); }}>
              <span className="ws-icon ws-icon-sm ws-icon-empty">+</span>
              <span>Create workspace</span>
            </button>
            <button className="ws-menu-item" onClick={() => { onManage(); setOpen(false); }}>
              <span className="ws-icon ws-icon-sm ws-icon-empty">⚙</span>
              <span>Manage workspaces</span>
            </button>
          </div>
        )}
      </div>

      {creating && (
        <WorkspaceEditor
          workspace={null}
          onClose={(createdId) => {
            setCreating(false);
            if (createdId) onSwitch(createdId);
          }}
        />
      )}
    </>
  );
}

// Renders a workspace's logo image if one is uploaded/linked, otherwise its
// emoji icon on a colored tile. Falls back to the icon tile if the image
// fails to load. Size is 'md' (default) or 'sm'.
export function WorkspaceIcon({ workspace, size = 'md' }) {
  const cls = size === 'sm' ? 'ws-icon ws-icon-sm' : 'ws-icon';
  const [broken, setBroken] = useState(false);
  // Reset broken state if the URL changes (e.g. user re-uploads).
  useEffect(() => { setBroken(false); }, [workspace?.logoUrl]);

  if (workspace?.logoUrl && !broken) {
    return (
      <span className={cls} style={{ background: 'transparent', overflow: 'hidden', padding: 0 }}>
        <img
          src={workspace.logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: workspace?.color || '#4f46e5' }}>
      {workspace?.icon || '◆'}
    </span>
  );
}

/** "All workspaces": the tile is four small squares, one per workspace's worth. */
function AllIcon({ size = 'md' }) {
  return (
    <span className={`ws-icon ws-icon-all${size === 'sm' ? ' ws-icon-sm' : ''}`} aria-hidden="true">
      <span /><span /><span /><span />
    </span>
  );
}
