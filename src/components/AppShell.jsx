// src/components/AppShell.jsx — sidebar nav + topbar + content area

import { useState, useEffect, useRef } from 'react';

const VIEWS = [
  { id: 'board',    label: 'Board',    icon: '▦' },
  { id: 'table',    label: 'Table',    icon: '☰' },
  { id: 'gantt',    label: 'Gantt',    icon: '▭' },
  { id: 'projects', label: 'Projects', icon: '◉' },
];

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  return {
    view: parts[0] || 'board',
    projectFilter: parts[1] || 'all',
  };
}

function setHash({ view, projectFilter }) {
  window.location.hash = `#/${view}/${projectFilter || 'all'}`;
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const navigate = (patch) => setHash({ ...route, ...patch });
  return { route, navigate };
}

export default function AppShell({ userId, ready, projects, route, navigate, children }) {
  const current = VIEWS.find((v) => v.id === route.view) || VIEWS[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">TM</div>
          <span>Task Monitor</span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Views</div>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`sidebar-link ${v.id === route.view ? 'active' : ''}`}
              onClick={() => navigate({ view: v.id })}
            >
              <span className="sidebar-link-icon">{v.icon}</span>
              {v.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {ready && userId && (
            <>
              <span>Session</span>
              <span className="session-pill">{userId.slice(0, 6)}</span>
            </>
          )}
          {ready && !userId && (
            <span className="session-pill warn">auth offline</span>
          )}
          {!ready && <span className="muted-2">signing in…</span>}
        </div>
      </aside>

      <header className="topbar">
        <div className="topbar-title">{current.label}</div>
        <ProjectPicker
          projects={projects}
          value={route.projectFilter}
          onChange={(projectFilter) => navigate({ projectFilter })}
        />
        <div className="topbar-spacer" />
      </header>

      <main className="content">{children}</main>
    </div>
  );
}

function ProjectPicker({ projects, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selected = value === 'all'
    ? { name: 'All projects', color: '#a1a1aa' }
    : projects.find((p) => p.id === value);

  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen(!open)}>
        {selected ? (
          <>
            <span className="proj-dot" style={{ background: selected.color }} />
            {selected.name}
          </>
        ) : 'Select project'}
        <span style={{ opacity: 0.5 }}>▾</span>
      </button>
      {open && (
        <div className="dropdown-menu">
          <button
            className={`dropdown-item ${value === 'all' ? 'selected' : ''}`}
            onClick={() => { onChange('all'); setOpen(false); }}
          >
            <span className="proj-dot" style={{ background: '#a1a1aa' }} />
            All projects
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`dropdown-item ${value === p.id ? 'selected' : ''}`}
              onClick={() => { onChange(p.id); setOpen(false); }}
            >
              <span className="proj-dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
