// src/components/AppShell.jsx — sidebar nav + topbar + content area

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTasks, useAllActivities, useProjects } from '../hooks/useTasks';
import { auth } from '../services/firebase';

const VIEWS = [
  { id: 'board',    label: 'Board',    icon: '▦' },
  { id: 'table',    label: 'Table',    icon: '☰' },
  { id: 'gantt',    label: 'Gantt',    icon: '▭' },
  { id: 'calendar', label: 'Calendar', icon: '▤' },
  { id: 'review',   label: 'Review',   icon: '◇' },
  { id: 'projects', label: 'Projects', icon: '◉' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
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

export default function AppShell({ userId, ready, projects, route, navigate, children, timerWidget }) {
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
          <SidebarUserBlock userId={userId} ready={ready} navigate={navigate} />
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
        {timerWidget}
        <GlobalSearch projects={projects} navigate={navigate} />
      </header>

      <main className="content">{children}</main>
    </div>
  );
}

// ─── Sidebar user block ───────────────────────────────────

function SidebarUserBlock({ userId, ready, navigate }) {
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    const interval = setInterval(() => {
      const u = auth.currentUser;
      if (u !== user) setUser(u);
    }, 500);
    return () => clearInterval(interval);
  }, [user]);

  if (!ready) return <span className="muted-2">signing in…</span>;
  if (ready && !userId) return <span className="session-pill warn">auth offline</span>;

  const isAnonymous = user?.isAnonymous;
  if (isAnonymous) {
    return (
      <button
        className="sidebar-user-anon"
        onClick={() => navigate({ view: 'settings' })}
        title="Anonymous session — click to sign in with Google"
      >
        <span>Session</span>
        <span className="session-pill">{userId.slice(0, 6)}</span>
      </button>
    );
  }
  return (
    <button
      className="sidebar-user-block"
      onClick={() => navigate({ view: 'settings' })}
      title={user?.email || user?.displayName}
    >
      {user?.photoURL
        ? <img src={user.photoURL} alt="" className="sidebar-user-avatar" />
        : <div className="sidebar-user-avatar fallback">{(user?.displayName || user?.email || '?')[0].toUpperCase()}</div>}
      <div className="sidebar-user-text">
        <div className="sidebar-user-name">{user?.displayName || user?.email}</div>
        <div className="sidebar-user-sub">Signed in</div>
      </div>
    </button>
  );
}

// ─── Global search ─────────────────────────────────────────

function GlobalSearch({ projects, navigate }) {
  const { tasks } = useTasks();
  const { activities } = useAllActivities();
  const { byId: projectById } = useProjects();
  const [q, setQ]       = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  // ⌘K / Ctrl+K to focus search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    if (!q.trim()) return { tasks: [], activities: [] };
    const needle = q.toLowerCase();
    const taskMatches = tasks
      .filter((t) =>
        t.title?.toLowerCase().includes(needle) ||
        t.description?.toLowerCase().includes(needle) ||
        (t.tags || []).some((tg) => tg.toLowerCase().includes(needle))
      )
      .slice(0, 8);
    const activityMatches = activities
      .filter((a) =>
        a.comment?.toLowerCase().includes(needle) ||
        a.bottleneckRemarks?.toLowerCase().includes(needle) ||
        a.taskTitle?.toLowerCase().includes(needle)
      )
      .slice(0, 6);
    return { tasks: taskMatches, activities: activityMatches };
  }, [q, tasks, activities]);

  const goToTask = (t) => {
    navigate({ view: 'board', projectFilter: t.projectId || 'all' });
    setQ(''); setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="search-wrap">
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder="Search tasks & activities…   ⌘K"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q.trim() && (
        <div className="search-results">
          {results.tasks.length === 0 && results.activities.length === 0 && (
            <div className="search-empty">No matches.</div>
          )}
          {results.tasks.length > 0 && (
            <>
              <div className="search-group-label">Tasks</div>
              {results.tasks.map((t) => {
                const proj = projectById[t.projectId];
                return (
                  <button key={t.id} className="search-result" onMouseDown={() => goToTask(t)}>
                    {proj && <span className="proj-dot" style={{ background: proj.color }} />}
                    <span className="search-result-title">{t.title}</span>
                    <span className={`badge badge-soft-${
                      t.status === 'done' ? 'success' :
                      t.status === 'doing' ? 'info' : 'muted'
                    }`}>{t.status}</span>
                  </button>
                );
              })}
            </>
          )}
          {results.activities.length > 0 && (
            <>
              <div className="search-group-label">Activities</div>
              {results.activities.map((a) => {
                const proj = projectById[a.projectId];
                return (
                  <button key={a.id} className="search-result" onMouseDown={() => {
                    const t = tasks.find((x) => x.id === a.taskId);
                    if (t) goToTask(t);
                  }}>
                    {proj && <span className="proj-dot" style={{ background: proj.color }} />}
                    <div className="search-result-multi">
                      <div className="search-result-title">{a.taskTitle}</div>
                      <div className="muted small">{a.date} — {a.comment?.slice(0, 60) || a.bottleneckRemarks?.slice(0, 60)}</div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
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
