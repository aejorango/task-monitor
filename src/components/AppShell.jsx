// src/components/AppShell.jsx — icon rail + page chrome + content area

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTasks, useAllActivities, useProjects, useSavedViews } from '../hooks/useTasks';
import { useActiveWorkspaceId, setActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { useOnline } from '../hooks/useOnline';
import { addSavedView, softDeleteSavedView, auth, onAuthChange, todayLocal } from '../services/firebase';
import { blockedTaskIds, isStuck } from '../services/boardScope';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import Icon from './Icon';
import TaskDoneCelebration from './TaskDoneCelebration';
import { goToTask as openTask } from '../services/openTask';
import { versionLine } from '../services/appVersion';
import TutorialGuide from './TutorialGuide';
import { friendlyError } from '../services/access';
import { RENDERABLE_VIEWS, isKnownView, HUBS, hubForView, hubLanding, resolveView } from '../services/views';
import PageHeader from './PageHeader';
import BoardToolbar from './BoardToolbar';
import FindItem from './FindItem';
import { activateProps } from '../hooks/useActivate';
import { buildCommands, buildDuplicateCommands, commandsFirst, CREATE_VIEW, recentCommands, rememberRecent } from '../services/commandPalette';
import { requestQuickCreate } from '../hooks/useQuickCreate';
import { useToast } from './Toast';
import { useDialog } from './Dialog';

// The rail reads the one view registry (services/views.js), which the ⌘K
// palette reads too — so a page cannot exist in one and not the other.
//
// The rail itself holds six hubs, not twenty-three pages. Which hub owns which
// page, and the tab strip that follows from it, is HUBS in services/views.js —
// the sidebar's old hand-kept NAV_GROUPS lived here and is gone, because a
// second list of the app's pages is exactly what BUG-029 was.

const RAIL_NARROW_KEY = 'task-monitor.rail.narrow.v1';

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs);
  return {
    // `resolveView` forwards a page that MOVED. The Monitoring panels are the
    // Analytics page now, so an old #/monitoring link lands on them instead of
    // on Not Found — the content did not go away, only its address did.
    view: resolveView(parts[0] || 'dashboard'),
    projectFilter: parts[1] || 'all',
    workspaceId:  params.get('ws')     || null,
    tagFilter:    params.get('tag')    || null,
    statusFilter: params.get('status') || null,
    savedViewId:  params.get('saved')  || null,
    onlyMine:     params.get('mine')   === '1',
    stuckOnly:    params.get('stuck')  === '1',
    who:          params.get('who')    || null,   // one member's work only
    q:            params.get('q')      || null,   // the tab strip's "Find item" box
    // Which task the Item page is showing. Distinct from `task` below, which
    // is a ONE-SHOT ("open this editor now") and is deliberately dropped by
    // setHash; `item` is where you are, so it has to survive a navigation.
    itemId:       params.get('item')   || null,
    openTaskId:   params.get('task')   || null,   // one-shot: open this task's editor
  };
}

function setHash(next) {
  const params = new URLSearchParams();
  if (next.workspaceId)  params.set('ws',     next.workspaceId);
  if (next.tagFilter)    params.set('tag',    next.tagFilter);
  if (next.statusFilter) params.set('status', next.statusFilter);
  if (next.savedViewId)  params.set('saved',  next.savedViewId);
  if (next.onlyMine)     params.set('mine',   '1');
  if (next.stuckOnly)    params.set('stuck',  '1');
  if (next.who)          params.set('who',    next.who);
  if (next.q)            params.set('q',      next.q);
  if (next.itemId)       params.set('item',   next.itemId);
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

export { RENDERABLE_VIEWS, isKnownView };

/**
 * "2 stuck" in the breadcrumb, the Board Explorer's one red number.
 *
 * It is the hub's own definition — `isStuck` — so it can never disagree with
 * the Stuck pill below it, and it is a separate component so the listeners it
 * needs are mounted only while a Board page is on screen. Both caches are
 * shared, so on the Kanban this costs nothing at all.
 */
function StuckChip() {
  const { tasks } = useTasks();
  const { activities } = useAllActivities();
  const today = todayLocal();
  const n = useMemo(() => {
    const blocked = blockedTaskIds(activities);
    return tasks.filter((t) => !t.deleted && !t.archived && isStuck(t, blocked, today)).length;
  }, [tasks, activities, today]);
  if (n === 0) return null;
  return (
    <span className="crumb-chip stuck" title="Blocked, or open and past its plan date">
      <span className="crumb-dot" />{n} stuck
    </span>
  );
}

export default function AppShell({ userId, ready, projects, route, navigate, children, timerWidget, userProfile }) {
  const online = useOnline();
  // A neutral fallback, not the registry's first entry. The list's order is cosmetic, so falling
  // back to its first entry painted "Ask AI" over whatever was really on screen
  // — an unrecognised hash, an invite, a saved view pointing at a removed page
  // (BUG-025). The app's own name claims nothing.
  const current = RENDERABLE_VIEWS.find((v) => v.id === route.view)
    || { id: route.view, label: 'Task Monitor' };
  const activeWs = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Collapsing the rail to icons is a per-device choice, so it survives a
  // reload rather than snapping back open every morning. A phone ignores it —
  // there the rail is a drawer and always shows its labels.
  const [railNarrow, setRailNarrow] = useState(() => {
    try { return localStorage.getItem(RAIL_NARROW_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(RAIL_NARROW_KEY, railNarrow ? '1' : '0'); } catch { /* private window */ }
  }, [railNarrow]);
  // Which of the six rail icons is lit, and what the breadcrumb calls the
  // workspace you are in. Both are derived — neither is a second piece of state
  // that could disagree with the route.
  const activeHub = hubForView(route.view);
  const activeWorkspace = workspaces.find((w) => w.id === activeWs) || null;
  // Stable, so FindItem's debounce effect is not torn down on every render of
  // the shell. `navigate` is a fresh arrow each render (useRoute builds it
  // from the current route), so it goes in a ref the handler reads when it
  // fires — the same rule as useModalDialog's deps, for the same reason.
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const findItem = useCallback((q) => navRef.current({ q }), []);

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
    <div className={`app-shell${railNarrow ? ' rail-narrow' : ''}`}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`rail${sidebarOpen ? ' open' : ''}`} aria-label="Sections">
        {/* The TM tile and the wordmark were removed on request. The row
            stays: it is what holds the collapse control, and the rail has no
            other home for it. */}
        <div className="rail-brand-row">
          <button
            className="rail-collapse"
            onClick={() => setRailNarrow((n) => !n)}
            aria-pressed={railNarrow}
            aria-label={railNarrow ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
            title={railNarrow ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
          >{railNarrow ? '»' : '«'}</button>
        </div>

        {/* The workspace is WHERE you are, so it sits with the sections
            rather than in the command bar. Its sidebar styling — light ink on
            navy — is the one it was drawn for. */}
        <div className="rail-ws">
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeId={activeWs}
            onSwitch={(id) => navigateAndClose({ workspaceId: id, projectFilter: 'all', savedViewId: null, tagFilter: null })}
            onManage={() => navigateAndClose({ view: 'workspaces', savedViewId: null, tagFilter: null })}
          />
        </div>

        <div className="rail-label">Sections</div>
        <nav className="rail-nav">
          {HUBS.map((h) => {
            const isActive = activeHub?.id === h.id && !route.savedViewId;
            return (
              <button
                key={h.id}
                className={`rail-btn${isActive ? ' active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={h.label}
                data-tutorial={h.id === 'projects' ? 'nav-projects' : `nav-${h.id}`}
                onClick={() => navigateAndClose({
                  view: hubLanding(h.id), savedViewId: null, tagFilter: null, statusFilter: null,
                })}
              >
                <Icon name={h.icon} size={18} />
                <span className="rail-btn-label">{h.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="rail-foot">
          <SidebarUserBlock userId={userId} ready={ready} navigate={navigateAndClose} userProfile={userProfile} />
        </div>
      </aside>


      {/* The chrome starts here now: the bar above it held nothing but the
          things that moved to the rail, the crumb strip and Settings, so the
          row went with them rather than sitting empty. What it still had to
          carry — the mobile menu button, the saved views, Save as view and a
          running timer — the header takes as slots. */}
      <PageHeader
        route={route}
        navigate={navigate}
        onToggleMenu={() => setSidebarOpen((o) => !o)}
        tools={<>
          {timerWidget}
          <SavedViewsMenu route={route} navigate={navigate} />
          <SaveViewButton route={route} userId={userId} />
        </>}
        search={activeHub?.id === 'board'
          ? <FindItem value={route.q || ''} onChange={findItem} />
          : null}
        /* The project filter decides what every page below is ABOUT, which is
           what a breadcrumb is for — so it sits in the middle of the crumb
           strip rather than among the commands. */
        projectPicker={(
          <div data-tutorial="project-picker">
            <ProjectPicker
              projects={projects}
              value={route.projectFilter}
              onChange={(projectFilter) => navigate({ projectFilter })}
            />
          </div>
        )}
        pageLabel={current.label}
        pageIcon={current.icon}
        workspaceName={activeWorkspace?.name}
        status={<>
          {/* The Board Explorer's crumb strip carries the one number worth
              interrupting for, then the connection as a single mono word.
              "Sync healthy" was three syllables saying what "live" says. */}
          {activeHub?.id === 'board' && <StuckChip />}
          <span className={`crumb-live${online ? '' : ' is-off'}`} title={online
            ? 'Connected — changes save as you make them'
            : "You're offline. Changes will sync when you reconnect."}
          >{online ? 'live' : 'offline'}</span>
        </>}
      />

      {/* The Board Explorer's toolbar sits above the tab content on every
          Board page, so it is drawn here once rather than inside each of the
          eight pages. `hubForView` decides — not a list of view ids. */}
      {activeHub?.id === 'board' && (
        <BoardToolbar route={route} navigate={navigate} />
      )}

      {/* No box, but ⌘K still opens it: the palette is an overlay. */}
      <GlobalSearch projects={projects} navigate={navigate} />

      <main className="content">{children}</main>

      {/* The tour navigates between pages and highlights elements on them,
          so it stays mounted app-wide — but its launcher is Settings →
          Tutorial now, and it starts on an event. */}
      <TutorialGuide route={route} navigate={navigate} showLauncher={false} />

      {/* Mobile bottom tab bar — rendered via CSS display:none on desktop */}
      <BottomNav route={route} navigate={navigate} />

      {/* Global confetti celebration when any task is marked done */}
      <TaskDoneCelebration />
    </div>
  );
}

// ─── Rail: the six hubs ───────────────────────────────────────────────────
// There is nothing to build here any more. The rail maps over HUBS directly
// (services/views.js) and a tab strip inside the page shows the rest, so the
// old SidebarNavGroup — a second, hand-kept list of which pages belong together
// — has no job left.

// ─── Save current view ────────────────────────────────────

function SaveViewButton({ route, userId }) {
  const toast = useToast();
  const ask = useDialog();
  const workspaceId = useActiveWorkspaceId();
  const hasFilter = route.projectFilter !== 'all' || route.tagFilter || route.statusFilter;
  if (!userId || !hasFilter) return null;
  // Already loaded as a saved view → hide
  if (route.savedViewId) return null;
  const save = async () => {
    const name = await ask.prompt({ title: 'Save this filter as…', defaultValue: '' });
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
      toast.error(friendlyError(err, 'Could not save view. Please try again.'));
    }
  };
  return (
    <button className="btn btn-sm btn-ghost" onClick={save} title="Save the current filter combo so you can come back to it">
      ★ Save view
    </button>
  );
}

// ─── Saved views ──────────────────────────────────────────
// These used to be a labelled list at the bottom of the sidebar. A 64px rail
// has no room for names, and a saved filter nobody can see is a saved filter
// nobody uses — so they are a menu in the title block, one click from anywhere.
// The button hides itself entirely when there is nothing saved, rather than
// offering an empty menu.

function SavedViewsMenu({ route, navigate }) {
  const ask = useDialog();
  const { views: allViews } = useSavedViews();
  // A saved view can outlive the page it points at — Table, Flow and Item
  // were deleted in T-0152 and their saved views are still in Firestore.
  // Opening one would land on Not Found, which reads as a bug rather than as
  // "that page is gone", so they are simply not offered. The documents are
  // left alone: deleting somebody's saved view because we removed a page is
  // not ours to do.
  const views = allViews.filter((v) => isKnownView(v.view));
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (views.length === 0) return null;
  const activeView = views.find((v) => v.id === route.savedViewId);

  return (
    <div className="saved-views" ref={boxRef}>
      <button
        className={`chip saved-views-btn${activeView ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Your saved filters"
      >
        <Icon name="star" size={14} />
        <span className="chip-label-text">{activeView ? activeView.name : 'Saved views'}</span>
      </button>
      {open && (
        <div className="saved-views-menu" role="menu">
          {views.map((v) => {
            const isActive = route.savedViewId === v.id;
            return (
              <div key={v.id} className={`saved-views-row${isActive ? ' active' : ''}`}>
                <button
                  className="saved-views-go"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    navigate({
                      view: v.view,
                      projectFilter: v.projectFilter || 'all',
                      tagFilter:    v.tagFilter || null,
                      statusFilter: v.statusFilter || null,
                      savedViewId:  v.id,
                    });
                  }}
                  title={`${v.view}${v.tagFilter ? ` · #${v.tagFilter}` : ''}${v.statusFilter ? ` · ${v.statusFilter}` : ''}`}
                >
                  <span className="saved-views-icon">{v.icon || <Icon name="star" size={14} />}</span>
                  <span className="saved-views-name">{v.name}</span>
                </button>
                {/* The confirm was written out twice, once per input — the click
                    path and the key path could drift apart. One helper, one path. */}
                <span
                  className="saved-view-delete"
                  {...activateProps(async (e) => {
                    e.stopPropagation();
                    if (await ask.confirm({ title: `Remove saved view "${v.name}"?`, confirmLabel: 'Remove', danger: true })) softDeleteSavedView(v.id);
                  }, { label: `Remove saved view ${v.name}` })}
                  title="Remove saved view"
                >✕</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar user block ───────────────────────────────────

function SidebarUserBlock({ userId, ready, navigate, userProfile }) {
  // Subscribe, don't poll. The previous 500 ms interval re-rendered the whole
  // sidebar twice a second forever, and could not even see what it was looking
  // for: Firebase mutates `auth.currentUser` in place, so an identity check
  // never fires on a profile change — only on sign-in and sign-out, which is
  // exactly what onAuthChange reports.
  const [user, setUser] = useState(auth.currentUser);
  useEffect(() => onAuthChange(setUser), []);

  if (!ready) return <span className="muted-2">signing in…</span>;
  if (ready && !userId) return <span className="session-pill warn">auth offline</span>;

  const isSuperadmin = userProfile?.role === 'superadmin';
  // The Firestore profile is the live copy — it updates when the user edits
  // their name or photo, which the auth object does not.
  const displayName = userProfile?.displayName || user?.displayName || user?.email || '';
  const photoURL    = userProfile?.photoURL    || user?.photoURL    || '';
  const email       = userProfile?.email       || user?.email       || '';

  return (
    <button
      className="sidebar-user-block"
      onClick={() => navigate({ view: 'settings' })}
      title={`${email || displayName} · Task Monitor ${versionLine()}`}
    >
      {photoURL
        ? <img src={photoURL} alt="" className="sidebar-user-avatar" />
        : <div className="sidebar-user-avatar fallback">{(displayName || '?')[0].toUpperCase()}</div>}
      <div className="sidebar-user-text">
        <div className="sidebar-user-name">{displayName}</div>
        <div className="sidebar-user-sub">
          {isSuperadmin ? 'Superadmin' : 'Signed in'}
          {' · '}
          <span className="sidebar-version">{versionLine().split(' · ')[0]}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Command palette rows ──────────────────────────────────
// "New project", "Log an activity", "Go to Gantt" — the things ⌘K can DO. What
// to offer is decided by services/commandPalette.js; this only renders it.

function CommandGroup({ commands, offset, highlight, setHighlight, onRun, label = 'Actions' }) {
  if (!commands.length) return null;
  return (
    <>
      <div className="search-group-label">{label} · {commands.length}</div>
      {commands.map((c, i) => {
        const flatIdx = offset + i;
        return (
          <button
            key={c.id}
            className={`search-result ${highlight === flatIdx ? 'highlight' : ''}`}
            onMouseEnter={() => setHighlight(flatIdx)}
            onMouseDown={() => onRun(c)}
          >
            <span className="search-result-icon"><Icon name={c.icon} size={15} /></span>
            <div className="search-result-multi">
              <div className="search-result-title">{c.label}</div>
              {c.hint && <div className="muted small">{c.hint}</div>}
            </div>
          </button>
        );
      })}
    </>
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

  // ⌘K / Ctrl+K opens the palette. There is no always-open box in the header
  // any more, so the input does not exist until `open` is true — hence the
  // frame's wait before focusing it. Focusing first and opening second
  // focuses nothing.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
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
    // An empty box used to show nothing at all. What somebody nearly always
    // wants is what they were just looking at.
    if (!q.trim()) {
      const recents = recentCommands();
      return {
        tasks: [], activities: [], commands: recents, lead: true, recents: true,
        flat: recents.map((c) => ({ kind: 'command', c })),
      };
    }
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
    // ⌘K is also where things get MADE. "new project X", "log hours", or just
    // "gantt" — see services/commandPalette.js.
    // "duplicate board pack" needs a target, so it is built from what exists
    // rather than from what was typed (T-0139).
    const commands = [...buildDuplicateCommands(q, { tasks, projects }), ...buildCommands(q)];
    // Flat list lets keyboard nav cycle through every group in display order.
    const lead = commandsFirst(q);
    const flat = lead
      ? [
        ...commands.map((c) => ({ kind: 'command', c })),
        ...taskMatches.map((t) => ({ kind: 'task', t })),
        ...activityMatches.map((a) => ({ kind: 'activity', a })),
      ]
      : [
        ...taskMatches.map((t) => ({ kind: 'task', t })),
        ...activityMatches.map((a) => ({ kind: 'activity', a })),
        ...commands.map((c) => ({ kind: 'command', c })),
      ];
    return { tasks: taskMatches, activities: activityMatches, commands, lead, recents: false, flat };
  }, [q, tasks, activities]);

  // Reset highlight when results change
  useEffect(() => { setHighlight(0); }, [results.flat.length]);

  const goToTask = (t) => {
    rememberRecent({ kind: 'task', id: t.id, label: t.title || 'Task', projectId: t.projectId || null });
    // services/openTask.js navigates to the Board with this task's project
    // filtered and then asks the Board to open its editor — the same two steps
    // the inbox uses, so a search result and a notice behave identically.
    setQ(''); setOpen(false);
    inputRef.current?.blur();
    openTask(t, navigate);
  };
  // Where each "New …" goes. Every one of these lands on the page that owns
  // that thing, with the create flow already open — the point of the palette is
  // that you never have to know which page that is.
  const runCommand = (cmd) => {
    setQ(''); setOpen(false);
    inputRef.current?.blur();
    if (cmd.kind === 'navigate') { navigate({ view: cmd.payload.view }); return; }

    // A duplicate OPENS the thing so the user can see what is about to be
    // copied and confirm it there — copying twelve documents straight from a
    // search box, with no preview, is not a thing a palette should do.
    if (cmd.kind === 'duplicate') {
      if (cmd.entity === 'task') {
        const t = tasks.find((x) => x.id === cmd.payload.id);
        if (t) goToTask(t);
        return;
      }
      navigate({ view: 'projects' });
      setTimeout(() => requestQuickCreate('duplicate-project', cmd.payload.id), 60);
      return;
    }

    if (cmd.kind === 'recent') {
      const { entity, payload } = cmd;
      if (entity === 'task') {
        const t = tasks.find((x) => x.id === payload.id);
        if (t) { goToTask(t); return; }
      }
      navigate({
        view: entity === 'project' ? 'board' : 'board',
        projectFilter: entity === 'project' ? payload.id : (payload.projectId || 'all'),
      });
      return;
    }

    const text = cmd.payload?.text || '';
    // CREATE_VIEW lives beside CREATE_ORDER, so the command list and its
    // destinations cannot drift apart.
    navigate({ view: CREATE_VIEW[cmd.entity] || 'board' });
    // The destination listens for this and opens its own create flow with the
    // text already filled in. A delay so the view has mounted first.
    setTimeout(() => requestQuickCreate(cmd.entity, text), 60);
  };

  const activateResult = (item) => {
    if (!item) return;
    if (item.kind === 'command') runCommand(item.c);
    else if (item.kind === 'task') goToTask(item.t);
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

  // With commands leading, every other group shifts down by that many rows.
  const taskOffset = results.lead ? results.commands.length : 0;

  const placeholder = workspaceId
    ? 'Search, or type “new task…”'
    : 'Search or create…';

  // Closed, it renders nothing at all: the box came off the header, and a
  // hidden input left in the DOM is a thing screen readers and Tab still
  // find. ⌘K mounts it.
  if (!open) return null;

  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
      <div className="palette-backdrop" onMouseDown={() => setOpen(false)} />
      <div className="search-wrap">
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        autoFocus
        placeholder={placeholder}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={onInputKeyDown}
      />
      {open && (q.trim() || results.flat.length > 0) && (
        <div className="search-results">
          {results.flat.length === 0 ? renderEmptyState() : (
            <>
              {results.lead && <CommandGroup
                label={results.recents ? 'Recently opened' : 'Actions'}
                commands={results.commands}
                offset={0}
                highlight={highlight}
                setHighlight={setHighlight}
                onRun={runCommand}
              />}
              {results.tasks.length > 0 && (
                <>
                  <div className="search-group-label">Tasks · {results.tasks.length}</div>
                  {results.tasks.map((t, i) => {
                    const proj = projectById[t.projectId];
                    const flatIdx = taskOffset + i;
                    return (
                      <button
                        key={t.id}
                        className={`search-result ${highlight === flatIdx ? 'highlight' : ''}`}
                        onMouseEnter={() => setHighlight(flatIdx)}
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
                    const flatIdx = taskOffset + results.tasks.length + i;
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
              {!results.lead && <CommandGroup
                commands={results.commands}
                offset={taskOffset + results.tasks.length + results.activities.length}
                highlight={highlight}
                setHighlight={setHighlight}
                onRun={runCommand}
              />}
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

// ─── Bottom nav bar (mobile only) ─────────────────────────

// The phone's bottom bar is the rail, lying down. It was a hand-kept list of
// five destinations that had already gone its own way — "Log" pointed at the
// Activity Log while the sidebar's Reports group held seven pages, and Messages
// was not on it at all. It is the six hubs now, so the two navigations cannot
// disagree about where the app goes, and the one lit is the hub you are IN:
// on Calendar, the Board icon lights, because that is where Calendar lives.
function BottomNav({ route, navigate }) {
  const activeHub = hubForView(route.view);
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {HUBS.map((hub) => (
        <button
          key={hub.id}
          className={`bottom-nav-item ${activeHub?.id === hub.id ? 'active' : ''}`}
          aria-current={activeHub?.id === hub.id ? 'page' : undefined}
          onClick={() => navigate({
            view: hubLanding(hub.id), savedViewId: null, tagFilter: null, statusFilter: null,
          })}
          aria-label={hub.label}
        >
          <span className="bottom-nav-icon"><Icon name={hub.icon} size={22} /></span>
          <span>{hub.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ProjectPicker({ projects, value, onChange }) {
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

  // Sort projects alphabetically by name for the dropdown.
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })),
    [projects],
  );

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
          {sortedProjects.map((p) => (
            <button
              key={p.id}
              className={`dropdown-item ${value === p.id ? 'selected' : ''}`}
              onClick={() => { onChange(p.id); setOpen(false); }}
            >
              <span className="proj-dot" style={{ background: p.color }} />
              {p.name}
              {p._shared && (
                <span
                  className="badge badge-soft-info"
                  style={{ marginLeft: 'auto', fontSize: '10px' }}
                  title="Shared project from another workspace"
                >Shared</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
