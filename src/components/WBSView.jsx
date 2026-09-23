// src/components/WBSView.jsx — Board → WBS, rebuilt to `Board Explorer.dc.html`
// (T-0149).
//
// The mockup's Work breakdown is ONE card and three indent levels — project ›
// phase › item — and nothing else. That is the whole page now.
//
// What was here before was a Gantt in a table: a horizontally-scrolling day
// grid with a zoom preset, plan bars, a today line, and six data columns
// (days, start, end, resource, % complete) in front of it, under a
// progress-ring summary band. It duplicated the Gantt tab it sat next to
// while being harder to read than either, so it went in one pass. Where each
// of those facts lives now is written down in CLAUDE.md; nothing was deleted
// without a home.
//
// What survived, because it exists nowhere else:
//   · clicking a row opens that TASK'S EDITOR. It opened a read-only activity
//     table until T-0162 — one modal standing in front of the thing you
//     actually wanted. The log is the editor's Activity tab, and the Export ▾
//     that table carried went with it, so the middle step could go;
//   · the green tick on an item that had activity logged TODAY;
//   · subtasks, as a fourth indent following the same rule;
//   · collapse, per project and per phase.

import { useState, useMemo } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useWorkspaces, useActiveWorkspaceId } from '../hooks/useWorkspace';
import { todayLocal } from '../services/firebase';
import { scopeTasks, scopeOf, blockedTaskIds, displayStatus } from '../services/boardScope';
import TaskEditor, { newTaskDraft } from './TaskEditor';
import { PageActions, PageSubtitle } from './PageHeader';
import Avatar from './Avatar';

function parseDate(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function fmtDate(d) {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
}

function taskStart(t) { return t.plan?.startDate || t.actual?.startDate || null; }

/** "Jul 18" — the mockup's date form, month first to match `fmtDay`. */
function shortDate(iso) {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : null;
}

const PRIO_LABEL = { high: 'High', medium: 'Med', low: 'Low' };
const PRIO_CLASS = { high: 'p-high', medium: 'p-med', low: 'p-low' };

/**
 * The project's colour as TEXT.
 *
 * The mockup carries a lookup for this — brand orange `#e2892e` prints as
 * `#8a5410` and green `#137a36` as `#0f5f2a` — because a 13.5px name in the
 * raw brand colour is a smudge on a cream band. `color-mix` toward the theme's
 * own text colour does the same job for ANY project colour a user picks, and
 * it flips correctly in dark mode, which a hard-coded pair cannot.
 */
function inkOf(color) {
  return color ? `color-mix(in srgb, ${color} 62%, var(--c-text))` : 'var(--c-text)';
}

const STATUS_FILTERS = [
  { id: 'all',   label: 'All' },
  { id: 'todo',  label: 'To do' },
  { id: 'doing', label: 'Ongoing' },
  { id: 'done',  label: 'Done' },
];

export default function WBSView({ projectFilter, route = {} }) {
  const { tasks, loading: tasksLoading, userId } = useTasks();
  const { projects, loading: projectsLoading } = useProjects();
  const { activities } = useAllActivities();
  const blockedIds = useMemo(() => blockedTaskIds(activities), [activities]);
  const { workspaces } = useWorkspaces();
  const activeWs = useActiveWorkspaceId();

  // Tasks with an activity logged TODAY. A green tick beside one is the only
  // "this is moving" signal in the app, so it survived the rebuild.
  const activeTodayIds = useMemo(() => {
    const t = todayLocal();
    const s = new Set();
    activities.forEach((a) => { if (a.date === t && a.taskId) s.add(a.taskId); });
    return s;
  }, [activities]);

  const [collapsed, setCollapsed] = useState(() => new Set());
  // Clicking a row opens THAT TASK'S editor. It used to open a read-only
  // activity table over it, which is one modal in front of the thing you
  // actually wanted — the log is the editor's own Activity tab, Export and
  // all, so nothing was lost by taking the middle step out.
  const [editingTask, setEditingTask] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const memberProfiles = workspaces.find((w) => w.id === activeWs)?.memberProfiles || {};

  const resourceOf = (t) =>
    t.requestedBy?.trim()
    || memberProfiles[t.userId]?.displayName
    || memberProfiles[t.userId]?.email
    || null;

  // ── Build the tree: project → phase groups → tasks ───────────────────────
  const statusActive = statusFilter !== 'all';
  const tree = useMemo(() => {
    const sortTasks = (arr) =>
      [...arr].sort((a, b) => (taskStart(a) || '9999').localeCompare(taskStart(b) || '9999'));

    // The Board hub's toolbar first — All · Mine · Stuck, the roster and the
    // find box — then this page's own status filter on top of it.
    let scopedTasks = scopeTasks(tasks, {
      scope: scopeOf(route), who: route.who, q: route.q, userId, today: todayLocal(),
    });
    if (statusActive) scopedTasks = scopedTasks.filter((t) => t.status === statusFilter);

    const visible = projects.filter((p) => projectFilter === 'all' || p.id === projectFilter);
    let blocks = visible.map((p) => {
      const pTasks = scopedTasks.filter((t) => t.projectId === p.id);
      const phases = [...(p.phases || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const byPhase = {};
      pTasks.forEach((t) => {
        const key = t.phaseId && phases.some((ph) => ph.id === t.phaseId) ? t.phaseId : '__unphased__';
        (byPhase[key] = byPhase[key] || []).push(t);
      });
      let groups = [
        ...phases.map((ph) => ({ id: ph.id, name: ph.name, phase: ph, tasks: sortTasks(byPhase[ph.id] || []) })),
        ...((byPhase['__unphased__'] || []).length > 0
          ? [{ id: '__unphased__', name: 'Unphased', phase: null, tasks: sortTasks(byPhase['__unphased__']) }]
          : []),
      ];
      if (statusActive) groups = groups.filter((g) => g.tasks.length > 0);
      return { project: p, tasks: pTasks, groups };
    });
    if (statusActive) blocks = blocks.filter((b) => b.tasks.length > 0);

    // Orphan bucket: tasks with no project, or whose project is archived,
    // deleted, or otherwise not in the visible list. Without this they would
    // silently disappear from the WBS.
    if (projectFilter === 'all') {
      const knownIds = new Set(projects.map((p) => p.id));
      const orphans = scopedTasks.filter((t) => !t.projectId || !knownIds.has(t.projectId));
      if (orphans.length > 0) {
        blocks.push({
          project: { id: '__none__', name: 'Unassigned / no project', color: '#94a3b8', phases: [] },
          tasks: orphans,
          groups: [{ id: '__unphased__', name: 'Unphased', phase: null, tasks: sortTasks(orphans) }],
          isOrphan: true,
        });
      }
    }
    return blocks;
  }, [projects, tasks, projectFilter, statusFilter, statusActive,
      route.onlyMine, route.stuckOnly, route.who, route.q, userId]);

  const allTreeTasks = useMemo(() => tree.flatMap((b) => b.tasks), [tree]);
  const totalPhases = useMemo(
    () => tree.reduce((s, b) => s + b.groups.filter((g) => g.phase).length, 0),
    [tree]
  );
  const today = parseDate(todayLocal());

  const toggle = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (tasksLoading || projectsLoading) {
    return <p className="muted">Loading WBS…</p>;
  }

  return (
    <>
      <PageSubtitle>
        {allTreeTasks.length} item{allTreeTasks.length === 1 ? '' : 's'} ·{' '}
        {totalPhases} phase{totalPhases === 1 ? '' : 's'} ·{' '}
        {tree.length} project{tree.length === 1 ? '' : 's'} · click a row for its activity log
      </PageSubtitle>
      <PageActions>
        <button className="cmd cmd-primary" onClick={() => setQuickAddOpen(true)}>
          <span className="cmd-icon">+</span>New task
        </button>
      </PageActions>

      {tree.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▦</div>
          {statusActive ? (
            <>
              <p>No tasks are {STATUS_FILTERS.find((s) => s.id === statusFilter)?.label.toLowerCase()}.</p>
              <p className="small">Set the status filter back to <strong>All</strong> to see the full breakdown.</p>
            </>
          ) : (
            <p>No projects yet. Create one in the Projects view.</p>
          )}
        </div>
      ) : (
        <div className="wbs">
          <div className="wbs-head">
            <span className="bx-h">Work breakdown</span>
            {/* The status filter sits at the right-hand end of the card head
                (asked for directly): it filters THIS card, so it belongs on
                it rather than up in the page commands. */}
            <span className="seg wbs-head-seg" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`seg-btn${statusFilter === f.id ? ' is-on' : ''}`}
                  aria-pressed={statusFilter === f.id}
                  onClick={() => setStatusFilter(f.id)}
                >{f.label}</button>
              ))}
            </span>
          </div>

          {tree.map(({ project, tasks: pTasks, groups, isOrphan }) => {
            const pKey = `p:${project.id}`;
            const pOpen = !collapsed.has(pKey);
            return (
              <div key={project.id}>
                <button
                  type="button"
                  className="wbs-proj"
                  aria-expanded={pOpen}
                  onClick={() => toggle(pKey)}
                >
                  <span className="wbs-chev" aria-hidden="true">{pOpen ? '▾' : '▸'}</span>
                  <span className="wbs-badge" style={{ background: project.color }}>WBS</span>
                  <span className="wbs-proj-name" style={{ color: inkOf(project.color) }}>
                    {project.name}
                  </span>
                  <span className="wbs-count">
                    {pTasks.length} item{pTasks.length === 1 ? '' : 's'}
                  </span>
                </button>

                {pOpen && groups.length === 0 && (
                  <div className="wbs-empty">Nothing in this project yet.</div>
                )}

                {pOpen && groups.map((g, gi) => {
                  const gKey = `ph:${project.id}:${g.id}`;
                  const gOpen = !collapsed.has(gKey);
                  return (
                    <div key={gKey}>
                      <button
                        type="button"
                        className="wbs-phase"
                        aria-expanded={gOpen}
                        onClick={() => toggle(gKey)}
                      >
                        <span className="wbs-chev" aria-hidden="true">{gOpen ? '▾' : '▸'}</span>
                        <span
                          className="wbs-pcode"
                          style={{
                            color: inkOf(project.color),
                            background: `color-mix(in srgb, ${project.color || 'var(--c-text-3)'} 16%, transparent)`,
                          }}
                        >{gi + 1}</span>
                        <span className="wbs-pname">{g.name}</span>
                        <span className="wbs-pcount">
                          {g.tasks.length} item{g.tasks.length === 1 ? '' : 's'}
                        </span>
                      </button>

                      {gOpen && g.tasks.map((t, ti) => (
                        <WbsItem
                          key={t.id}
                          code={`${gi + 1}.${ti + 1}`}
                          task={t}
                          project={isOrphan ? null : project}
                          blockedIds={blockedIds}
                          today={today}
                          resourceOf={resourceOf}
                          activeToday={activeTodayIds.has(t.id)}
                          onOpen={() => setEditingTask(t)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {editingTask && (
        <TaskEditor
          task={editingTask}
          projects={projects}
          onClose={() => setEditingTask(null)}
        />
      )}

      {/* "New task" opens the same editor on a task that does not exist yet,
          so creating one and editing one are one screen. */}
      {quickAddOpen && (
        <TaskEditor
          task={newTaskDraft({ workspaceId: activeWs, projectId: projectFilter })}
          projects={projects}
          onClose={() => setQuickAddOpen(false)}
        />
      )}
    </>
  );
}

// ─── One item, and its checklist ──────────────────────────────────────────
//
// The mockup's row is four things: the `1.2` code, the title, the status chip
// and the owner's face. Two app facts join them, both of which would be lost
// otherwise: the today-tick and the subtask count.

function WbsItem({ code, task: t, project, blockedIds, today, resourceOf, activeToday, onOpen }) {
  const subs = t.subtasks || [];
  const done = t.status === 'done';
  // Past its plan date it reads Stuck, whatever status it carries — the same
  // rule the board and the table use (services/boardScope.js).
  const shownStatus = displayStatus(t, blockedIds, fmtDate(today));
  const owner = resourceOf(t);
  const prio = t.priority || 'medium';
  const start = shortDate(t.plan?.startDate);
  const end = shortDate(t.plan?.endDate);
  // The end date goes red once it has passed, the same rule the board card
  // and the table use — a plan window that has run out says so here too.
  const late = !done && t.plan?.endDate && t.plan.endDate < fmtDate(today);
  const planTitle = t.plan?.startDate || t.plan?.endDate
    ? `Planned ${t.plan?.startDate || 'no start'} → ${t.plan?.endDate || 'no end'}`
    : 'No planned dates on this item';

  return (
    <>
      <button
        type="button"
        className="wbs-item"
        onClick={onOpen}
        title={`${t.title} — open this task`}
      >
        <span className="wbs-icode">{code}</span>
        <span className={`wbs-ititle${done ? ' is-done' : ''}`}>{t.title}</span>
        {activeToday && (
          <span className="wbs-today" title="Activity logged today — this task is moving" aria-label="Active today">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        )}
        {subs.length > 0 && (
          <span className="wbs-subcount">{subs.filter((s) => s.done).length}/{subs.length}</span>
        )}

        {/* The planned window, and the priority. Both sit in FIXED-width
            slots: the title is the only thing that flexes, so every chip
            below it lines up into a column. A chip that moves row to row is
            a column you cannot scan — the same mistake the Workload's cap
            notch made (T-0150). */}
        <span className="wbs-dates" title={planTitle}>
          {start || end ? (
            <>
              <span>{start || '—'}</span>
              <span className="wbs-arrow" aria-hidden="true">→</span>
              <span className={late ? 'late' : undefined}>{end || '—'}</span>
            </>
          ) : (
            <span className="wbs-nodate">no dates</span>
          )}
        </span>
        <span className="wbs-status-slot">
          <span className={`bx-st st-${shownStatus.id}`}>{shownStatus.label}</span>
        </span>
        {/* A face alone is a guess unless you already know the team; the
            name is the thing being asked for. The circle stays as the
            recognisable part, with the name beside it. */}
        <span className="wbs-owner">
          {owner
            ? <>
                <Avatar name={owner} id={t.assignedTo?.[0] || t.userId} size={20} />
                <span className="wbs-owner-name">{owner}</span>
              </>
            : <span className="wbs-owner-name is-none">Unassigned</span>}
        </span>
      </button>

      {subs.map((s, si) => (
        <div key={s.id} className="wbs-sub">
          <span className="wbs-icode">{code}.{si + 1}</span>
          <span className={`wbs-box${s.done ? ' on' : ''}`} aria-hidden="true">{s.done ? '✓' : ''}</span>
          <span className={`wbs-stitle${s.done ? ' is-done' : ''}`}>{s.text}</span>
        </div>
      ))}
    </>
  );
}
