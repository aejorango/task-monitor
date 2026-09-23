// src/components/Board.jsx — Kanban with drag-and-drop, rebuilt to the Board
// Explorer (T-0148): the column headers are drawn once at the top and the
// cards below them are split into collapsible bands — one per project, or
// one per phase when the board is filtered to a single project.

import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragOverlay,
} from '@dnd-kit/core';
import { useTasks, useProjects, useActivities, useAllActivities } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { useTimer } from '../hooks/useTimer';
import { auth } from '../services/firebase';
import { taskChips } from '../services/customFields';
import { dueChip } from '../services/dueChip';
import { useToast } from './Toast';
import { ageing, ageingDaysFor, columnState, warnOnDrop } from '../services/wipLimits';
import { PageActions, PageSubtitle } from './PageHeader';
import { AvatarStack } from './Avatar';
import { OPEN_TASK_EVENT } from '../services/openTask';
import { scopeTasks, scopeOf, blockedTaskIds, displayStatus } from '../services/boardScope';
import { isBandOpen, expandAll, collapseAll } from '../services/boardBands';
import { TASK_STATUSES } from '../services/taskStatus';
import {
  setTaskStatus,
  updateTask,
  deleteActivity,
  todayLocal,
} from '../services/firebase';
import TaskForm from './TaskForm';
import TaskEditor from './TaskEditor';
import ActivityLogger from './ActivityLogger';
import ActivityEditor from './ActivityEditor';
import ExportButton from './ExportButton';
import { buildTaskListDocument } from '../services/taskExport';
import { useQuickCreate, newSeed } from '../hooks/useQuickCreate';
import { filterByTag, tagFilterState } from '../services/tagFilter';
import { useDialog } from './Dialog';

// The Board Explorer's four columns. Derived from TASK_STATUSES rather than
// listed again, so a status added to the model appears here and nowhere has
// to be remembered — the mistake NAV_TARGETS, VIEW_NAMES and BOTTOM_TABS all
// made in turn.
const COLUMN_LABEL = { todo: 'To Do', doing: 'In Progress', review: 'In Review', done: 'Done' };
const COLUMNS = TASK_STATUSES.map((id) => ({ id, label: COLUMN_LABEL[id] || id }));

const NO_PHASE_ID = '__nophase__';

export default function Board({ projectFilter, initialTagFilter, initialStatusFilter, route = {} }) {
  const toast = useToast();
  const { tasks, loading, userId } = useTasks();
  const { activities: allActivities } = useAllActivities();
  const { projects, byId: projectById } = useProjects();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;
  const [editingTask, setEditingTask]   = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [loggingTask, setLoggingTask]   = useState(null);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [activeDrag, setActiveDrag]     = useState(null);
  const [groupByPhase, setGroupByPhase] = useState(false);
  const [groupByProject, setGroupByProject] = useState(true);
  const [expandedSegments, setExpandedSegments] = useState({});
  const [tagFilter, setTagFilter] = useState(initialTagFilter || null);

  // Sync local tag filter when URL-level filter changes (e.g. saved view loaded)
  useEffect(() => { setTagFilter(initialTagFilter || null); }, [initialTagFilter]);

  // Open a task editor when the global search dispatches the event.
  // This makes search results feel responsive — clicking a result opens
  // the task instead of just navigating to the project filter.
  useEffect(() => {
    const onOpen = (e) => {
      const id = e.detail?.taskId;
      if (!id) return;
      const t = tasks.find((x) => x.id === id);
      if (t) setEditingTask(t);
    };
    window.addEventListener(OPEN_TASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TASK_EVENT, onOpen);
  }, [tasks]);

  // ⌘K → "New task": put the typed text into the quick-add box and focus it,
  // so the natural-language parsing the palette previewed actually happens.
  const [quickAddSeed, setQuickAddSeed] = useState(null);
  useQuickCreate('task', useCallback((text) => {
    setQuickAddSeed(newSeed(text));
  }, []));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const projectFiltered = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.projectId === projectFilter);

  const tagFiltered = filterByTag(projectFiltered, tagFilter);
  const statusFiltered = initialStatusFilter
    ? tagFiltered.filter((t) => t.status === initialStatusFilter)
    : tagFiltered;
  // The Board hub's shared toolbar — All / Mine / Stuck and the roster — is
  // applied through the one module that defines what those words mean, so the
  // Kanban, the Table and the Timeline cannot disagree about the count.
  const blockedIds = blockedTaskIds(allActivities);
  const filtered = scopeTasks(statusFiltered, {
    scope: scopeOf(route), who: route.who, q: route.q, userId, blockedIds, today: todayLocal(),
  });

  // All tags available across the (project-filtered) tasks, for the chip strip.
  // Shared with the Gantt and the Activity Log, so a saved view means the same
  // thing wherever it points (BUG-018).
  const tagState = tagFilterState(projectFiltered, tagFilter);
  const availableTags = tagState.tags;

  // Export exactly what is on screen — the same filters, the same order.
  const buildTaskExport = () => buildTaskListDocument(filtered, {
    title: 'Task list',
    projectById,
    projects,
    memberProfiles: activeWorkspace?.memberProfiles || {},
    projectName: projectById[projectFilter]?.name || null,
    statusFilter: initialStatusFilter || 'all',
    tagFilter,
  });

  if (loading) return <p className="muted">Loading tasks…</p>;
  if (!userId) return <p className="muted">Signing you in…</p>;

  const selectedProject = projectFilter !== 'all' ? projectById[projectFilter] : null;
  const phases = selectedProject?.phases || [];

  // ── What the board is divided into (T-0148) ──
  //
  // The column headers are drawn ONCE at the top and the cards below them
  // are split into collapsible bands, the way the reference board Ace sent
  // does it. There is no toggle deciding the grouping, because there is only
  // one sensible answer at each scope: across every project a band IS a
  // project, and inside one project a band is a phase. A switch here would
  // be asking the reader to choose between "by project" and "by project"
  // when only one of them can apply.
  const bands = (() => {
    if (selectedProject) {
      const byPhase = phases.map((ph) => ({
        id: ph.id,
        name: ph.name,
        color: selectedProject.color,
        tasks: filtered.filter((t) => t.phaseId === ph.id),
      }));
      const loose = filtered.filter((t) => !t.phaseId || !phases.some((ph) => ph.id === t.phaseId));
      if (loose.length) {
        byPhase.push({ id: NO_PHASE_ID, name: 'No phase', color: selectedProject.color, tasks: loose });
      }
      // A project with no phases at all is one band, not nothing.
      if (byPhase.length === 0) {
        return [{ id: selectedProject.id, name: selectedProject.name, color: selectedProject.color, tasks: filtered }];
      }
      return byPhase.filter((b) => b.tasks.length > 0);
    }
    const byProject = projects
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        color: pr.color,
        tasks: filtered.filter((t) => t.projectId === pr.id),
      }))
      .filter((b) => b.tasks.length > 0);
    const orphans = filtered.filter((t) => !t.projectId || !projectById[t.projectId]);
    if (orphans.length) {
      byProject.push({ id: '__unassigned__', name: 'No project', color: null, tasks: orphans });
    }
    return byProject;
  })();

  // Which bands are open is `services/boardBands.js` — three-valued, because
  // the FIRST band opens by default and "nobody has said" therefore has to be
  // distinguishable from "shut". `toggleBand` reads the same default, so the
  // first click on the open first band closes it instead of doing nothing.
  const bandOpen = (id, index) => isBandOpen(expandedSegments, id, index);
  const toggleBand = (id, index) => setExpandedSegments((prev) => ({
    ...prev,
    [id]: !isBandOpen(prev, id, index),
  }));

  const handleDragStart = (e) => {
    const task = filtered.find((t) => t.id === e.active.id);
    setActiveDrag(task);
  };

  // Whose limits apply. A WIP limit belongs to a project, so it only means
  // something when the board is showing one: across every project at once,
  // "5 / 3" would be comparing a number to a limit it does not belong to.
  const wipProject = projectFilter === 'all' ? null : projectById[projectFilter];

  const handleDragEnd = async (e) => {
    setActiveDrag(null);
    const taskId = e.active.id;
    const overId = e.over?.id;
    if (!overId) return;
    const task = filtered.find((t) => t.id === taskId);
    if (!task) return;

    // Drop target ids are "<status>::band::<bandId>". The band is a project
    // when the board shows every project and a phase when it shows one, so a
    // drop across bands moves the PHASE in the second case and never the
    // project in the first — dragging a card sideways must not silently
    // reassign which project it belongs to.
    const [targetStatus, , bandId] = String(overId).split('::');
    if (!COLUMNS.find((c) => c.id === targetStatus)) return;

    const statusChanged = targetStatus !== task.status;
    const bandIsPhase = !!selectedProject;
    const targetPhase = bandIsPhase
      ? (bandId === NO_PHASE_ID ? null : bandId)
      : undefined;
    const phaseChanged = targetPhase !== undefined && (task.phaseId || null) !== targetPhase;

    if (statusChanged) {
      // The drop always happens. A hard block on a personal board is an
      // annoyance, not a discipline — so this warns and gets out of the way
      // (T-0138).
      const before = filtered.filter((t) => t.status === targetStatus).length;
      const warning = warnOnDrop(wipProject, targetStatus, before, {
        columnLabel: COLUMNS.find((c) => c.id === targetStatus)?.label,
      });
      await setTaskStatus(task, targetStatus);
      if (warning) toast.info(warning);
    }
    if (phaseChanged) {
      await updateTask(task.id, { phaseId: targetPhase });
    }
  };

  // "23 items · 3 projects · 11 done" — what the board is showing, after every
  // filter. Counting `filtered` rather than `tasks` matters: a count that
  // ignores the filter describes a board nobody is looking at.
  const boardCounts = (() => {
    const done = filtered.filter((t) => t.status === 'done').length;
    const projectCount = new Set(filtered.map((t) => t.projectId).filter(Boolean)).size;
    const bits = [`${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`];
    if (projectCount) bits.push(`${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`);
    if (done) bits.push(`${done} done`);
    return bits.join(' · ');
  })();

  return (
    <>
      {/* The subtitle counts what is on screen rather than explaining how to
          drag a card. The instruction was true of every board ever built, and
          it cost a line above the fold on every visit; the tour still teaches
          it to somebody who has never seen one (T-0143). */}
      <PageSubtitle>
        {tagState?.active && (
          <>
            Filtered to <strong>#{tagState.active}</strong> ·{' '}
            <button className="table-link" onClick={() => setTagFilter(null)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
            >show all</button> ·{' '}
          </>
        )}
        {boardCounts}
        {projectFilter !== 'all' && projectById[projectFilter] && (
          <> · filtered to <strong>{projectById[projectFilter].name}</strong></>
        )}
      </PageSubtitle>

      <PageActions>
        <ExportButton
          build={buildTaskExport}
          baseName={projectById[projectFilter]?.name
            ? `${projectById[projectFilter].name}-tasks`
            : 'tasks'}
          kind="table"
          label="Export"
          className="cmd"
          title="Save these tasks as a spreadsheet, PDF or CSV"
        />
      </PageActions>

      {/* The quick-add is no longer a strip standing open on every visit —
          the mockup draws no form on the board. It appears when something
          asks for it: the toolbar's "+ New item", or ⌘K → New task. Removing
          it outright would have stranded both (T-0148). */}
      {quickAddSeed && (
        <div className="bx-quickadd">
          <TaskForm projects={projects} projectFilter={projectFilter} seed={quickAddSeed} status="todo" />
          <button
            className="cmd"
            onClick={() => setQuickAddSeed(null)}
            title="Close the quick-add form"
          >Done</button>
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="bcard kanban">
          {/* Every other Board tab is a titled card; the Kanban was the one
              loose grid on the hub. The band controls live in its head, beside
              the title, the way the WBS's status filter does — they act on
              THIS card, so they belong on it rather than in the page-wide
              commands. */}
          <div className="kanban-head">
            <span className="bx-h">Board</span>
            <span className="bx-note">project › column › item</span>
            <span className="kanban-head-actions">
              <button
                className="cmd"
                onClick={() => setExpandedSegments(expandAll(bands))}
                title="Open every project band"
              >Expand all</button>
              <button
                className="cmd"
                // NOT {}: an empty map means "nobody has said", and the default
                // would reopen the first band the moment it was written.
                onClick={() => setExpandedSegments(collapseAll(bands))}
                title="Fold every project band shut"
              >Collapse all</button>
            </span>
          </div>

        <div className="bx-board" data-tutorial="board-columns">
          {/* The column headers, once, at the top — so what the columns ARE
              is legible before a single band is opened. */}
          <div className="bx-cols" style={{ '--bx-n': COLUMNS.length }}>
            {COLUMNS.map((col) => (
              <ColumnHead
                key={col.id}
                column={col}
                count={filtered.filter((t) => t.status === col.id).length}
                project={wipProject}
              />
            ))}
          </div>

          {bands.map((band, bi) => (
            <Band
              key={band.id}
              band={band}
              open={bandOpen(band.id, bi)}
              onToggle={() => toggleBand(band.id, bi)}
              projectById={projectById}
              expandedTaskId={expandedTaskId}
              setExpandedTaskId={setExpandedTaskId}
              setLoggingTask={setLoggingTask}
              setEditingTask={setEditingTask}
              setEditingActivity={setEditingActivity}
              blockedIds={blockedIds}
            />
          ))}

          {bands.length === 0 && (
            <p className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>
              No tasks match the current filters.
            </p>
          )}
        </div>
        </div>

        <DragOverlay>
          {activeDrag ? <CardBody task={activeDrag} project={projectById[activeDrag.projectId]} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {loggingTask && (
        <ActivityLogger task={loggingTask} userId={userId} onClose={() => setLoggingTask(null)} />
      )}
      {editingTask && (
        <TaskEditor task={editingTask} projects={projects} onClose={() => setEditingTask(null)} />
      )}
      {editingActivity && (
        <ActivityEditor activity={editingActivity} onClose={() => setEditingActivity(null)} />
      )}
    </>
  );
}

// ─── Column head ──────────────────────────────────────────────────────────
//
// Drawn once, above every band. The Board Explorer's head is four things in
// a row: the dot, the name, a plain white count pill and — only where the
// project sets one — a WIP chip pushed to the far right. They used to be a
// single pill reading "4 / 3", which made the count and the policy the same
// number.

function ColumnHead({ column, count, project }) {
  const wip = columnState(project, column.id, count);
  // The fill rail only appears where it can mean something: with a limit it
  // is how full the column is, and with none there is no denominator, so
  // drawing a bar would be inventing one.
  const fill = wip.limit ? Math.min(100, Math.round((wip.count / wip.limit) * 100)) : null;
  return (
    <div>
      <div className={`bx-col-head c-${column.id}`} style={{ background: `var(--c-col-${column.id})` }}>
        <span className="bx-col-dot" style={{ background: `var(--c-st-${column.id === 'todo' ? 'idle' : column.id === 'doing' ? 'doing' : column.id})` }} aria-hidden="true" />
        <span className="bx-col-name">{column.label}</span>
        <span className="bx-col-count" title={`${count} ${count === 1 ? 'item' : 'items'}`}>{count}</span>
        {wip.limit != null && (
          <span
            className={`bx-col-wip${wip.over ? ' over' : wip.at ? ' at' : ''}`}
            title={wip.title}
            aria-label={`${column.label}: ${wip.title}`}
          >WIP {wip.count}/{wip.limit}</span>
        )}
      </div>
      {fill != null && (
        <div className="bx-col-rule" aria-hidden="true">
          <span style={{
            width: `${fill}%`,
            background: wip.over ? 'var(--c-st-stuck)' : wip.at ? 'var(--c-st-doing)' : 'var(--c-st-done)',
          }} />
        </div>
      )}
    </div>
  );
}

// ─── A band: one project (or one phase), collapsible ──────────────────────
//
// Collapsed by default. A collapsed band is not silent about what it holds —
// it prints the same per-column counts the open one would, because folding a
// project away must not hide how much work is in it.

function Band({ band, open, onToggle, projectById, expandedTaskId, setExpandedTaskId, setLoggingTask, setEditingTask, setEditingActivity, blockedIds }) {
  const colour = band.color || 'var(--c-text-2)';
  const counts = COLUMNS
    .map((c) => ({ label: c.label, n: band.tasks.filter((t) => t.status === c.id).length }))
    .filter((c) => c.n > 0);
  return (
    <div className="bx-band">
      <button
        type="button"
        className="bx-band-bar"
        style={{ background: colour }}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="bx-band-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="bx-band-name">{band.name}</span>
        {!open && (
          <span className="bx-band-counts">
            {counts.map((c) => <span key={c.label}>{c.n} {c.label}</span>)}
          </span>
        )}
        <span className="bx-band-total">
          {band.tasks.length} {band.tasks.length === 1 ? 'item' : 'items'}
        </span>
      </button>

      {open && (
        <div className="bx-cols bx-band-body" style={{ '--bx-n': COLUMNS.length }}>
          {COLUMNS.map((col) => (
            <div key={col.id} className={`bx-col-bed c-${col.id}`}>
              <DroppableArea id={`${col.id}::band::${band.id}`}>
                {band.tasks
                  .filter((t) => t.status === col.id)
                  .map((task) => (
                    <DraggableCard
                      key={task.id}
                      task={task}
                      project={projectById[task.projectId] || null}
                      expanded={expandedTaskId === task.id}
                      onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                      onLog={() => setLoggingTask(task)}
                      onEdit={() => setEditingTask(task)}
                      onEditActivity={(a) => setEditingActivity(a)}
                      blockedIds={blockedIds}
                    />
                  ))}
              </DroppableArea>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Droppable area ───────────────────────────────────────────────────────

function DroppableArea({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const count = Array.isArray(children) ? children.filter(Boolean).length : (children ? 1 : 0);
  return (
    <div ref={setNodeRef} className={`bx-band-lane ${isOver ? 'drag-over' : ''}`}>
      {children}
      {count === 0 && <div className="bx-empty-lane">—</div>}
    </div>
  );
}


// ─── Draggable card ────────────────────────────────────────────────────────

function DraggableCard({ task, project, expanded, onToggleExpand, onLog, onEdit, onEditActivity, blockedIds }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ touchAction: 'none' }}>
      <CardBody
        task={task}
        project={project}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onLog={onLog}
        onEdit={onEdit}
        onEditActivity={onEditActivity}
        blockedIds={blockedIds}
        dragging={isDragging}
      />
    </div>
  );
}

// ─── Card body ────────────────────────────────────────────────────────────
//
// Exported so a test can render a real card rather than a stand-in: what the
// card shows about dates is exactly the thing POL-013 was about (T-0123).

export function CardBody({ task, project, expanded, onToggleExpand, onLog, onEdit, onEditActivity, dragging, blockedIds }) {
  const today = todayLocal();
  const { running, state: timerState, start: startTimer } = useTimer();
  // The due date as the card shows it: "Due today", "Due Fri", "Due Oct 12",
  // "3d late" — the rule is in services/dueChip.js. It replaces the bare
  // "Overdue" badge, which said a task was late but never by how much, and it
  // is the only thing on the card that distinguished today from next month.
  const due = dueChip(task, today);
  const isOverdue = Boolean(due?.late);
  // How long this has been in progress. Only a task in Doing ages, and only one
  // that has sat there longer than the project allows earns a badge — a dot on
  // everything says nothing (T-0138).
  // Per-card, from the card's OWN project: threading a board-wide threshold
  // down would be wrong on a board showing several projects at once.
  const age = ageing(task, { today, days: ageingDaysFor(project) });
  const finishedEarly =
    task.status === 'done' && task.actual?.endDate && task.plan?.endDate &&
    task.actual.endDate < task.plan.endDate;
  const finishedLate =
    task.status === 'done' && task.actual?.endDate && task.plan?.endDate &&
    task.actual.endDate > task.plan.endDate;
  const subtaskCount = task.subtasks?.length || 0;
  const subtasksDone = task.subtasks?.filter((s) => s.done).length || 0;
  // The project's own fields — "Client: Acme" — so a field you filled in is
  // visible where the work is, not only inside the editor.
  const customChips = taskChips(task, project);
  const depsCount = task.dependsOn?.length || 0;
  const isRecurring = !!task.recurrence;
  const isTrackingThis = running && timerState?.taskId === task.id;
  const people = useAssignees(task.assignedTo || [], task.assignedToExternal || []);
  // What the card CALLS this task. Past its plan date it reads Stuck whatever
  // column it is in — see displayStatus in services/boardScope.js.
  const shownStatus = displayStatus(task, blockedIds, today);

  // The mockup's card is four rows and no more: title + priority dot; the
  // status chip and whatever is wrong with it; a footer ruled off above it
  // with the owner's face, the due date and whose it is; and a 5px progress
  // bar. Tags were removed from every surface in T-0148 — `?tag=` still
  // filters, and the subtitle still names an applied tag, but the chips no
  // longer spend a row of the card on something the filter already says.
  const prioClass = task.priority === 'high' ? 'p-high' : task.priority === 'low' ? 'p-low' : 'p-med';

  return (
    <div className={`bx-kc ${dragging ? 'dragging' : ''} ${task.status === 'done' ? 'is-done' : ''}`}>
      {/* The project's colour as a rail down the left edge. It says which
          project the card belongs to before any text is read. */}
      <span
        className="bx-kc-rail"
        style={{ background: project?.color || 'var(--c-border-strong)' }}
        aria-hidden="true"
      />
      <div className="bx-kc-top">
        <span className="bx-kc-title">{task.title}</span>
        <span
          className={`bx-kc-prio ${prioClass}`}
          title={`Priority: ${task.priority || 'medium'}`}
          aria-label={`Priority: ${task.priority || 'medium'}`}
        />
      </div>

      {/* Row two: where the work is, then what is wrong with it. The status
          chip is always there; every flag beside it appears only when it has
          something to say. */}
      <div className="bx-kc-chips">
        <span
          className={`bx-st st-${shownStatus.id}`}
          title={shownStatus.stuck ? 'In progress or waiting, and past its plan date' : undefined}
        >{shownStatus.label}</span>
        {age.stale && (
          <span className="bx-flag f-red card-ageing" title={age.title}>{age.days}d idle</span>
        )}
        {finishedEarly && <span className="bx-flag f-green">Done early</span>}
        {finishedLate  && <span className="bx-flag f-amber">Done late</span>}
        {depsCount > 0 && (
          <span className="bx-flag f-navy" title={`${depsCount} dependenc${depsCount === 1 ? 'y' : 'ies'}`}>
            🔗 {depsCount}
          </span>
        )}
        {task.links?.length > 0 && (
          <span className="bx-flag f-navy" title={`${task.links.length} related task${task.links.length === 1 ? '' : 's'}`}>
            ↔ {task.links.length}
          </span>
        )}
        {isRecurring && (
          <span className="bx-flag f-navy" title={`Recurring: ${task.recurrence.rule}`}>🔁 {task.recurrence.rule}</span>
        )}
        {isTrackingThis && <span className="bx-flag f-green" title="Timer running">⏱ tracking</span>}
        {/* The project's own fields keep their chips — they are facts about
            this task that live nowhere else on the board. */}
        {customChips.slice(0, 2).map((chip) => (
          <span key={chip.id} className="field-chip" title={`${chip.label}: ${chip.text}`}>
            <span className="field-chip-label">{chip.label}</span>
            <span className="field-chip-value">{chip.text}</span>
          </span>
        ))}
        {customChips.length > 2 && <span className="bx-flag f-navy">+{customChips.length - 2}</span>}
      </div>

      {/* The footer: who has it, when it is due, and whose it is — a tick
          when it is finished. The due date is the one place a late card says
          so in words. */}
      <div className="bx-kc-foot">
        <AvatarStack people={people} size={22} max={2} />
        {due && (
          <span className={`bx-kc-due${due.late ? ' late' : ''}`} title={due.title}>{due.text}</span>
        )}
        <span className="bx-kc-meta">
          {task.status === 'done'
            ? <span className="tc-tick" title="Finished">✓</span>
            : people[0]?.name || (subtaskCount > 0 ? `${subtasksDone}/${subtaskCount}` : 'Unassigned')}
        </span>
      </div>

      {/* The 5px bar the mockup ends every in-flight card with, in the
          project's colour — drawn only when there is progress to draw,
          because a 0% bar on every card is furniture. */}
      {task.status !== 'done' && (task.progress || 0) > 0 && (
        <div className="bx-kc-prog" aria-hidden="true">
          <span style={{ width: `${Math.min(100, task.progress)}%`, background: project?.color || 'var(--c-accent)' }} />
        </div>
      )}

      {/* The mockup draws no controls; the app has four that have nowhere
          else to live, so they keep their own row rather than crowding the
          footer. A hover-only row would be unreachable on a touch device. */}
      <div className="task-card-actions">
        {!isTrackingThis && (
          <button
            className="btn btn-sm btn-ghost"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); startTimer(task); }}
            title="Start time tracking on this task"
            aria-label={`Start timer on ${task.title}`}
          >▶</button>
        )}
        <button
          className="btn btn-sm btn-ghost"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onLog && onLog(); }}
          aria-label={`Log activity on ${task.title}`}
          title="Record time or a note against this task"
        >+ Log</button>
        <button
          className="btn btn-sm btn-ghost"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(); }}
          aria-expanded={!!expanded}
          aria-label={expanded
            ? `Hide activity history for ${task.title}`
            : `Show activity history for ${task.title}${task.activityCount ? ` (${task.activityCount} entries)` : ''}`}
          title={expanded ? 'Hide what has been logged against this task' : 'Show what has been logged against this task'}
        >
          {expanded ? 'Hide history' : `History${task.activityCount ? ` · ${task.activityCount}` : ''}`}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onEdit && onEdit(); }}
        >Edit</button>
      </div>

      {expanded && <ActivityListInline taskId={task.id} onEditActivity={onEditActivity} />}
    </div>
  );
}

function ActivityListInline({ taskId, onEditActivity }) {
  const ask = useDialog();
  const { activities, loading } = useActivities(taskId);
  if (loading) return <p className="muted small">Loading log…</p>;
  if (activities.length === 0)
    return <p className="muted small" style={{ marginTop: 8 }}>No activity logged yet.</p>;
  return (
    <ul className="activity-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
      {activities.map((a) => (
        <li key={a.id} className="activity-item">
          <div className="activity-item-head">
            <strong className="mono small">{a.date}</strong>
            <span className="muted small">{a.hoursSpent || 0}h</span>
            {a.completionStatus && (
              <span className={`badge badge-soft-${
                a.completionStatus === 'completed' ? 'success' :
                a.completionStatus === 'blocked'   ? 'danger'  :
                a.completionStatus === 'in-progress' ? 'info'  : 'muted'
              }`}>{a.completionStatus}</span>
            )}
            <button
              className="link-danger"
              title="Edit entry"
              style={{ color: 'var(--c-text-3)', marginLeft: 'auto' }}
              onClick={() => onEditActivity && onEditActivity(a)} aria-label="Edit entry">✎</button>
            <button
              className="link-danger"
              title="Delete entry"
              onClick={async () => { if (await ask.confirm({ title: 'Delete this log entry?', confirmLabel: 'Delete', danger: true })) deleteActivity(a); }}
            >✕</button>
          </div>
          {a.comment && <p className="activity-comment">{a.comment}</p>}
          {a.bottleneckRemarks && (
            <p className="activity-comment" style={{ color: 'var(--c-warn)', marginTop: 4 }}>
              ⚠ {a.bottleneckRemarks}
            </p>
          )}
          {a.requestedBy && (
            <p className="muted small" style={{ marginTop: 4 }}>
              Requested by: {a.requestedBy}
            </p>
          )}
          {a.attachments?.length > 0 && (
            <ul className="attachments">
              {a.attachments.map((att, i) => (
                <li key={i}>
                  <a href={att.url} target="_blank" rel="noreferrer">📎 {att.name || att.url}</a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

// Inline assignee badges for the task card. Shows up to two readable names
// (system users' displayNames via memberProfiles, plus external freeform
// names), then collapses the rest into a "+N" pill.
// Who has this card, as the Board Explorer draws them: a coloured circle with
// an initial, and the name once in the footer's right-hand slot. Not a
// "👤 Diana" pill — the mockup's card has room for four facts and a pill
// spends the whole row on one of them.
//
// A hook rather than a component because the footer needs the NAMES too, at
// the other end of the row: one lookup, two places.
function useAssignees(assignedTo = [], assignedToExternal = []) {
  const activeWsId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const ws = workspaces.find((w) => w.id === activeWsId);
  const memberProfiles = ws?.memberProfiles || {};
  const me = auth.currentUser;

  const labelFor = (uid) => {
    const p = memberProfiles[uid];
    if (p?.displayName) return p.displayName;
    if (p?.email) return p.email;
    if (uid === me?.uid) return me.displayName || me.email || `${uid.slice(0, 6)}…`;
    return `${uid.slice(0, 6)}…`;
  };

  return [
    ...assignedTo.map((uid) => ({
      id: uid, name: labelFor(uid), photo: memberProfiles[uid]?.photoURL || null,
    })),
    // Somebody who is not in the system still gets a face; it is just not
    // linked to an account, so the title says so rather than implying one.
    ...assignedToExternal.map((name) => ({
      id: `ext:${name}`, name, photo: null, external: true,
    })),
  ];
}
