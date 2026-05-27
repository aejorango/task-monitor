// src/components/AppShell.jsx — sidebar nav + topbar + content area

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTasks, useAllActivities, useProjects, useSavedViews } from '../hooks/useTasks';
import { useActiveWorkspaceId, setActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { useOnline } from '../hooks/useOnline';
import { addSavedView, softDeleteSavedView, auth } from '../services/firebase';
import WorkspaceSwitcher from './WorkspaceSwitcher';

const VIEWS = [
  { id: 'dashboard',      label: 'Dashboard',       icon: '◰' },
  { id: 'projects',       label: 'Projects',         icon: '◉' },
  { id: 'board',          label: 'Board',            icon: '▦' },
  { id: 'calendar',       label: 'Calendar',         icon: '▤' },
  { id: 'gantt',          label: 'Gantt',            icon: '▭' },
  { id: 'table',          label: 'Activity Log',     icon: '☰' },
  { id: 'work-performed', label: 'Work Performed',   icon: '⏱' },
  { id: 'review',         label: 'Review',           icon: '◇' },
  { id: 'analytics',      label: 'Analytics',        icon: '◢' },
  { id: 'how-to-use',     label: 'How to Use',       icon: '?' },
  { id: 'settings',       label: 'Settings',         icon: '⚙' },
];

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs);
  return {
    view: parts[0] || 'dashboard',
    projectFilter: parts[1] || 'all',
    workspaceId:  params.get('ws')     || null,
    tagFilter:    params.get('tag')    || null,
    statusFilter: params.get('status') || null,
    savedViewId:  params.get('saved')  || null,
    onlyMine:     params.get('mine')   === '1',
  };
}

function setHash(next) {
  const params = new URLSearchParams();
  if (next.workspaceId)  params.set('ws',     next.workspaceId);
  if (next.tagFilter)    params.set('tag',    next.tagFilter);
  if (next.statusFilter) params.set('status', next.statusFilter);
  if (next.savedViewId)  params.set('saved',  next.savedViewId);
  if (next.onlyMine)     params.set('mine',   '1');
  const qs = params.toString();
  window.location.hash = `#/${next.view}/${next.projectFilter || 'all'}${qs ? `?${qs}` : ''}`;
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

export default function AppShell({ userId, ready, projects, route, navigate, children, timerWidget, userProfile }) {
  const online = useOnline();
  const current = VIEWS.find((v) => v.id === route.view) || VIEWS[0];
  const activeWs = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // URL ↔ active-workspace binding.
  // 1. If URL has ?ws=<id> and it's different from current state, sync state to URL.
  // 2. If state has an active workspace but URL doesn't, push it into the URL
  //    so the URL is shareable and survives refresh.
  useEffect(() => {
    if (route.workspaceId && route.workspaceId !== activeWs) {
      setActiveWorkspaceId(route.workspaceId);
    }
  }, [route.workspaceId, activeWs]);
  useEffect(() => {
    if (activeWs && route.workspaceId !== activeWs) {
      navigate({ workspaceId: activeWs });
    }
  }, [activeWs]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Close sidebar when navigating on mobile
  const navigateAndClose = (patch) => {
    navigate(patch);
    setSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand sidebar-brand-compact">
          <div className="sidebar-brand-mark">TM</div>
          <span>Task Monitor</span>
          {/* Mobile close button inside sidebar */}
          <button
            className="sidebar-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >✕</button>
        </div>

        <WorkspaceSwitcher
          workspaces={workspaces}
          activeId={activeWs}
          onSwitch={(id) => navigateAndClose({ workspaceId: id, projectFilter: 'all', savedViewId: null, tagFilter: null })}
          onManage={() => navigateAndClose({ view: 'settings', savedViewId: null, tagFilter: null })}
        />

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Views</div>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`sidebar-link ${v.id === route.view && !route.savedViewId ? 'active' : ''}`}
              onClick={() => navigateAndClose({ view: v.id, savedViewId: null, tagFilter: null, statusFilter: null })}
            >
              <span className="sidebar-link-icon">{v.icon}</span>
              {v.label}
            </button>
          ))}

          <SidebarSavedViews route={route} navigate={navigateAndClose} />
        </nav>

        <div className="sidebar-footer">
          <SidebarUserBlock userId={userId} ready={ready} navigate={navigateAndClose} userProfile={userProfile} />
        </div>
      </aside>

      <header className="topbar">
        {/* Hamburger — only visible on mobile via CSS */}
        <button
          className="nav-toggle"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <span className="nav-toggle-icon">
            <span />
            <span />
            <span />
          </span>
        </button>

        <div className="topbar-title">{current.label}</div>
        <ProjectPicker
          projects={projects}
          value={route.projectFilter}
          onChange={(projectFilter) => navigate({ projectFilter })}
        />
        {userId && (
          <button
            className={`chip topbar-chip-mytasks ${route.onlyMine ? 'active' : ''}`}
            onClick={() => navigate({ onlyMine: !route.onlyMine })}
            title="Show only tasks assigned to me"
          >
            👤 <span className="chip-label-text">My tasks</span>
          </button>
        )}
        <SaveViewButton route={route} userId={userId} />
        <div className="topbar-spacer" />
        {!online && (
          <span className="badge badge-soft-warn" title="You're offline. Changes will sync when you reconnect.">
            ⚡ Offline
          </span>
        )}
        {timerWidget}
        <GlobalSearch projects={projects} navigate={navigate} />
      </header>

      <main className="content">{children}</main>

      {/* Mobile bottom tab bar — rendered via CSS display:none on desktop */}
      <BottomNav route={route} navigate={navigate} />
    </div>
  );
}

// ─── Save current view ────────────────────────────────────

function SaveViewButton({ route, userId }) {
  const workspaceId = useActiveWorkspaceId();
  const hasFilter = route.projectFilter !== 'all' || route.tagFilter || route.statusFilter;
  if (!userId || !hasFilter) return null;
  // Already loaded as a saved view → hide
  if (route.savedViewId) return null;
  const save = async () => {
    const name = prompt('Save this filter as…', '');
    if (!name) return;
    try {
      await addSavedView(userId, {
        workspaceId,
        name: name.trim(),
        view: route.view,
        projectFilter: route.projectFilter,
        tagFilter:    route.tagFilter,
        statusFilter: route.statusFilter,
      });
    } catch (err) {
      console.error(err);
      alert('Could not save view. Check console.');
    }
  };
  return (
    <button className="btn btn-sm btn-ghost" onClick={save} title="Save the current filter combo as a sidebar shortcut">
      ★ Save view
    </button>
  );
}

// ─── Sidebar: saved views ─────────────────────────────────

function SidebarSavedViews({ route, navigate }) {
  const { views } = useSavedViews();
  if (views.length === 0) return null;
  return (
    <>
      <div className="sidebar-section-label">Saved views</div>
      {views.map((v) => {
        const isActive = route.savedViewId === v.id;
        return (
          <button
            key={v.id}
            className={`sidebar-link saved-view-link ${isActive ? 'active' : ''}`}
            onClick={() => navigate({
              view: v.view,
              projectFilter: v.projectFilter || 'all',
              tagFilter:    v.tagFilter || null,
              statusFilter: v.statusFilter || null,
              savedViewId:  v.id,
            })}
            title={`${v.view}${v.tagFilter ? ` · #${v.tagFilter}` : ''}${v.statusFilter ? ` · ${v.statusFilter}` : ''}`}
          >
            <span className="sidebar-link-icon">{v.icon || '★'}</span>
            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.name}
            </span>
            <span
              className="saved-view-delete"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove saved view "${v.name}"?`)) softDeleteSavedView(v.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  if (confirm(`Remove saved view "${v.name}"?`)) softDeleteSavedView(v.id);
                }
              }}
              title="Remove saved view"
            >✕</span>
          </button>
        );
      })}
    </>
  );
}

// ─── Sidebar user block ───────────────────────────────────

function SidebarUserBlock({ userId, ready, navigate, userProfile }) {
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

  const isSuperadmin = userProfile?.role === 'superadmin';

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
        <div className="sidebar-user-sub">{isSuperadmin ? 'Superadmin' : 'Signed in'}</div>
      </div>
    </button>
  );
}

// ─── Global search ─────────────────────────────────────────

function GlobalSearch({ projects, navigate }) {
  const { tasks, loading: tasksLoading, workspaceId } = useTasks();
  const { activities, loading: actsLoading } = useAllActivities();
  const { byId: projectById } = useProjects();
  const [q, setQ]       = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);

  // ⌘K / Ctrl+K to focus search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
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
    if (!q.trim()) return { tasks: [], activities: [], flat: [] };
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
    // Flat list lets keyboard nav cycle through both groups in display order.
    const flat = [
      ...taskMatches.map((t) => ({ kind: 'task', t })),
      ...activityMatches.map((a) => ({ kind: 'activity', a })),
    ];
    return { tasks: taskMatches, activities: activityMatches, flat };
  }, [q, tasks, activities]);

  // Reset highlight when results change
  useEffect(() => { setHighlight(0); }, [results.flat.length]);

  const goToTask = (t) => {
    // Navigate to the Board with the task's project filtered, then dispatch a
    // global "open task" event. The Board listens for this and opens the
    // TaskEditor for the matching task. This gives users clear visual feedback
    // when they click a search result — previously the page just changed URL
    // and they had to find the task themselves.
    navigate({ view: 'board', projectFilter: t.projectId || 'all' });
    setQ(''); setOpen(false);
    inputRef.current?.blur();
    // Small delay so the Board view has a chance to mount / receive the new
    // projectFilter before we ask it to open the task editor.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('task-monitor:open-task', { detail: { taskId: t.id } }));
    }, 50);
  };
  const activateResult = (item) => {
    if (!item) return;
    if (item.kind === 'task') goToTask(item.t);
    else {
      const t = tasks.find((x) => x.id === item.a.taskId);
      if (t) goToTask(t);
    }
  };

  const onInputKeyDown = (e) => {
    if (results.flat.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter')  { e.preventDefault(); activateResult(results.flat[highlight]); }
  };

  // Diagnostic empty state — instead of a silent "No matches", tell the user
  // why. Common cases: workspace context not yet loaded, or genuinely empty.
  const renderEmptyState = () => {
    if (tasksLoading || actsLoading) {
      return <div className="search-empty"><span className="spinner" /> &nbsp; Loading workspace data…</div>;
    }
    if (!workspaceId) {
      return (
        <div className="search-empty">
          <strong>No workspace selected.</strong>
          <div className="muted small" style={{ marginTop: 4 }}>
            Pick a workspace from the sidebar switcher first.
          </div>
        </div>
      );
    }
    if (tasks.length === 0 && activities.length === 0) {
      return (
        <div className="search-empty">
          <strong>This workspace is empty.</strong>
          <div className="muted small" style={{ marginTop: 4 }}>
            Add a task to start. Search looks across the active workspace only.
          </div>
        </div>
      );
    }
    return (
      <div className="search-empty">
        No matches for "<strong>{q}</strong>" in this workspace.
        <div className="muted small" style={{ marginTop: 4 }}>
          Searches: task titles, descriptions, tags, activity comments, bottleneck notes.
        </div>
      </div>
    );
  };

  const placeholder = workspaceId ? `Search ${tasks.length} task${tasks.length === 1 ? '' : 's'}…  ⌘K` : 'Search…  ⌘K';

  return (
    <div className="search-wrap">
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder={placeholder}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={onInputKeyDown}
      />
      {open && q.trim() && (
        <div className="search-results">
          {results.flat.length === 0 ? renderEmptyState() : (
            <>
              {results.tasks.length > 0 && (
                <>
                  <div className="search-group-label">Tasks · {results.tasks.length}</div>
                  {results.tasks.map((t, i) => {
                    const proj = projectById[t.projectId];
                    return (
                      <button
                        key={t.id}
                        className={`search-result ${highlight === i ? 'highlight' : ''}`}
                        onMouseEnter={() => setHighlight(i)}
                        onMouseDown={() => goToTask(t)}
                      >
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
                  <div className="search-group-label">Activities · {results.activities.length}</div>
                  {results.activities.map((a, i) => {
                    const proj = projectById[a.projectId];
                    const flatIdx = results.tasks.length + i;
                    return (
                      <button
                        key={a.id}
                        className={`search-result ${highlight === flatIdx ? 'highlight' : ''}`}
                        onMouseEnter={() => setHighlight(flatIdx)}
                        onMouseDown={() => {
                          const t = tasks.find((x) => x.id === a.taskId);
                          if (t) goToTask(t);
                        }}
                      >
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bottom nav bar (mobile only) ─────────────────────────

const BOTTOM_TABS = [
  { id: 'dashboard', label: 'Home',     icon: '◰' },
  { id: 'board',     label: 'Board',    icon: '▦' },
  { id: 'projects',  label: 'Projects', icon: '◉' },
  { id: 'table',     label: 'Log',      icon: '☰' },
  { id: 'settings',  label: 'Settings', icon: '⚙' },
];

function BottomNav({ route, navigate }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {BOTTOM_TABS.map((tab) => (
        <button
          key={tab.id}
          className={`bottom-nav-item ${route.view === tab.id ? 'active' : ''}`}
          onClick={() => navigate({ view: tab.id, savedViewId: null, tagFilter: null, statusFilter: null })}
          aria-label={tab.label}
        >
          <span className="bottom-nav-icon">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
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
