// src/components/WorkspaceSwitcher.jsx
// Sidebar top: active workspace name + chevron → dropdown to switch, manage,
// or create a new workspace.

import { useEffect, useRef, useState } from 'react';
import WorkspaceEditor from './WorkspaceEditor';

export default function WorkspaceSwitcher({ workspaces, activeId, onSwitch, onManage }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef(null);
  const active = workspaces.find((w) => w.id === activeId) || workspaces[0];

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <>
      <div className="ws-switcher" ref={ref}>
        <button className="ws-switcher-trigger" onClick={() => setOpen(!open)}>
          <WorkspaceIcon workspace={active} />
          <div className="ws-info">
            <div className="ws-name">{active?.name || 'No workspace'}</div>
            <div className="ws-sub">{active?.members?.length || 0} member{active?.members?.length === 1 ? '' : 's'}</div>
          </div>
          <span className="ws-chevron">▾</span>
        </button>

        {open && (
          <div className="ws-menu">
            <div className="ws-menu-section-label">Workspaces</div>
            {workspaces.map((w) => (
              <button
                key={w.id}
                className={`ws-menu-item ${w.id === activeId ? 'active' : ''}`}
                onClick={() => { onSwitch(w.id); setOpen(false); }}
              >
                <WorkspaceIcon workspace={w} size="sm" />
                <div className="ws-menu-item-text">
                  <div>{w.name}</div>
                  <div className="muted small">{w.members?.length || 0} member{w.members?.length === 1 ? '' : 's'}</div>
                </div>
                {w.id === activeId && <span className="ws-check">✓</span>}
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

// Renders a workspace's logo image if one is uploaded, otherwise its emoji
// icon on a colored tile. Size is 'md' (default) or 'sm'.
export function WorkspaceIcon({ workspace, size = 'md' }) {
  const cls = size === 'sm' ? 'ws-icon ws-icon-sm' : 'ws-icon';
  if (workspace?.logoUrl) {
    return (
      <span className={cls} style={{ background: 'transparent', overflow: 'hidden', padding: 0 }}>
        <img
          src={workspace.logoUrl}
          alt=""
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
