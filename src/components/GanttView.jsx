// src/components/GanttView.jsx — SVG-free Gantt with draggable plan bars.
// Three drag handles per plan bar:
//   - left edge  (resize start)
//   - right edge (resize end)
//   - middle     (move whole bar)

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { todayLocal, updateTask } from '../services/firebase';
import TaskEditor, { newTaskDraft } from './TaskEditor';
import { friendlyError } from '../services/access';
import ExportButton from './ExportButton';
import { buildTaskListDocument } from '../services/taskExport';
import { tagFilterState } from '../services/tagFilter';
import Avatar from './Avatar';
import Icon from './Icon';
import { scopeTasks, scopeOf } from '../services/boardScope';
import { weekDays } from '../services/timesheet';
import { readSettings } from '../hooks/useSettings';
import { useToast } from './Toast';
// The bar geometry and what a drag means live in a pure module, so a task with
// only a due date is a one-day milestone here and in its tests alike (BUG-014).
import {
  effectivePlan, planBar, dragOrigin, dragTo, dragPatch, planLabel, shiftIso,
} from '../services/ganttGeometry';
import { PageActions, PageSubtitle } from './PageHeader';

// The label column, in one place: the ruler pads by it, the arrow overlay is
// offset by it, every row's grid starts with it, and the CSS reads it back as
// `--gc-label-w`. Wider than the mockup's 220 on purpose — a Gantt whose task
// names are all cut off at the same word is a chart you cannot read.
const LABEL_W = 288;

/** ISO week number — what "W26" means. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
}

/**
 * The columns across the top, and how many days each is worth.
 *
 * Widths are `<days>fr`, so a 31-day month is wider than a 30-day one and a
 * part-week at either end is narrower — the bars underneath are positioned as
 * a share of the same total, so a bar's left edge always lands on its date.
 * Equal columns would put them a day or two out at the ends.
 */
function rulerColumns(min, totalDays, mode) {
  const cols = [];
  for (let i = 0; i < totalDays; i += 1) {
    const d = addDays(min, i);
    const key = mode === 'week'
      ? `${d.getFullYear()}-W${isoWeek(d)}`
      : `${d.getFullYear()}-${d.getMonth()}`;
    const last = cols[cols.length - 1];
    if (last && last.key === key) { last.days += 1; continue; }
    cols.push({
      key,
      days: 1,
      label: mode === 'week'
        ? `W${isoWeek(d)}`
        : d.toLocaleString('en', { month: 'short' }),
    });
  }
  return cols;
}

/** The letter each day of the week is printed as, Sunday first. */
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * One cell per day for the second ruler row — S M T W T F S under the weeks.
 *
 * Only worth drawing on a SHORT window: at a quarter the letters are two
 * pixels apart and the row is a grey smear, so the caller asks for it by
 * width rather than this deciding for itself. The cells are `repeat(n, 1fr)`
 * across the same track the week columns share, so a letter sits exactly under
 * the day its bar starts on — which is the whole point of the row.
 */
function dayColumns(min, totalDays, todayIso) {
  const out = [];
  for (let i = 0; i < totalDays; i += 1) {
    const d = addDays(min, i);
    const dow = d.getDay();
    out.push({
      iso: fmtDate(d),
      letter: DAY_LETTERS[dow],
      weekend: dow === 0 || dow === 6,
      today: fmtDate(d) === todayIso,
      // The date itself as the title, so a letter you cannot place is one
      // hover from an answer.
      title: d.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' }),
    });
  }
  return out;
}

/** Above this many days the per-day letters stop being legible. */
const DAY_ROW_MAX = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The one person a Gantt row can show — the first assignee, with a name. */
function ownerOf(task, memberProfiles = {}) {
  const uid = (task.assignedTo || [])[0];
  if (uid) {
    const p = memberProfiles[uid];
    return { id: uid, name: p?.displayName || p?.email || uid, photo: p?.photoURL || null };
  }
  const ext = (task.assignedToExternal || [])[0];
  return ext ? { id: `ext:${ext}`, name: ext, photo: null } : null;
}

function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function diffDays(a, b) {
  return Math.round((b - a) / DAY_MS);
}
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Preset period helpers. Each returns { from, to } as YYYY-MM-DD strings.
function presetThisMonth() {
  const now = parseDate(todayLocal());
  return {
    from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to:   fmtDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}
function presetThisQuarter() {
  const now = parseDate(todayLocal());
  const q = Math.floor(now.getMonth() / 3);
  return {
    from: fmtDate(new Date(now.getFullYear(), q * 3, 1)),
    to:   fmtDate(new Date(now.getFullYear(), q * 3 + 3, 0)),
  };
}
function presetNext30() {
  const now = parseDate(todayLocal());
  return { from: fmtDate(now), to: fmtDate(addDays(now, 30)) };
}
/**
 * This week — Monday to Sunday, or Sunday to Saturday.
 *
 * Which, is the reader's own week-start preference, and it is read through
 * `weekDays` rather than worked out here: the Timesheet and My Week already
 * ask that function what a week is, and a third answer on the Gantt would mean
 * "this week" started on a different day depending on which page you asked.
 * `readSettings()` is the non-hook reader, so this stays a plain function like
 * its three neighbours.
 */
function presetThisWeek() {
  const days = weekDays(todayLocal(), readSettings().weekStart ?? 1);
  if (!days.length) return { from: '', to: '' };
  return { from: days[0], to: days[days.length - 1] };
}
/**
 * The period switch's settings, in the order the switch draws them.
 *
 * One list: the switch renders it, and `periodOf` reads the current dates
 * back through it to decide which segment is lit. A second copy in the
 * component is how a control comes to highlight nothing after a reload.
 *
 * "This week" sits first among the dated ones because it is the shortest
 * window — the switch reads left to right from narrow to wide, and All is the
 * escape at the head.
 */
const PERIODS = [
  { id: 'all',     label: 'All',          icon: 'layers',   range: () => ({ from: '', to: '' }) },
  { id: 'week',    label: 'This week',    icon: 'calendar', range: () => presetThisWeek() },
  { id: 'month',   label: 'This month',   icon: 'calendar', range: () => presetThisMonth() },
  { id: 'quarter', label: 'This quarter', icon: 'dashboard',     range: () => presetThisQuarter() },
  { id: 'next30',  label: 'Next 30 days', icon: 'clock',    range: () => presetNext30() },
];

/** Which segment the current from/to is — or null for a hand-picked window. */
function periodOf(from, to) {
  if (!from && !to) return 'all';
  const hit = PERIODS.find((p) => {
    if (p.id === 'all') return false;
    const r = p.range();
    return r.from === from && r.to === to;
  });
  return hit ? hit.id : null;
}

export default function GanttView({ projectFilter, initialTagFilter, route = {} }) {
  const { tasks, loading, userId } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const memberProfiles = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId)?.memberProfiles || {},
    [workspaces, activeWorkspaceId],
  );
  // The track column's width, measured — the chart has no fixed pixels-per-day
  // any more, so the whole geometry is derived from this one number.
  //
  // A CALLBACK ref, not `useRef` + an effect. The effect version ran once on
  // mount, and on mount this component is still loading its tasks and has
  // returned the spinner — so the ruler did not exist, the ref was null, the
  // observer was never attached and `trackW` stayed 0 for ever. dayWidth is
  // then 0 and every bar is skipped: a chart of empty rows, with nothing in
  // the console to say why. A callback ref fires when the node arrives,
  // whenever that is.
  const [trackW, setTrackW] = useState(0);
  const roRef = useRef(null);
  const trackRef = useCallback((el) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    setTrackW(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    roRef.current = new ResizeObserver(([entry]) => {
      setTrackW(Math.round(entry.contentRect.width));
    });
    roRef.current.observe(el);
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);
  // A saved view stores the tag it was filtered by, and the router hands it
  // over here. Local state so the chip can be cleared, re-synced when the route
  // changes — the same shape the Board uses (BUG-018).
  const [tagFilter, setTagFilter] = useState(initialTagFilter || null);
  useEffect(() => { setTagFilter(initialTagFilter || null); }, [initialTagFilter]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  // Date-period filter. Both optional; either bound may be set independently.
  // It opens on THIS WEEK rather than All: a chart of every dated task back to
  // the start of the project is a wall, and the window you almost always want
  // first is the one you are in. `presetThisWeek` reads the week-start
  // preference through `weekDays`, so the Gantt, the Timesheet and My Week
  // cannot disagree about which day a week starts on.
  const [periodFrom, setPeriodFrom] = useState(() => presetThisWeek().from);
  const [periodTo, setPeriodTo]     = useState(() => presetThisWeek().to);

  const periodActive = !!(periodFrom || periodTo);

  const allRows = useMemo(() => {
    // Earliest date on a task (plan or actual start, then ends as fallback)
    const earliestOf = (t) => {
      const candidates = [t.plan?.startDate, t.actual?.startDate, t.plan?.endDate, t.actual?.endDate]
        .filter(Boolean)
        .sort();
      return candidates[0] || '9999-12-31';
    };
    // A task's full date span [first, last] as YYYY-MM-DD strings (or null).
    const spanOf = (t) => {
      const all = [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]
        .filter(Boolean)
        .sort();
      if (all.length === 0) return null;
      return { first: all[0], last: all[all.length - 1] };
    };
    // Does the task overlap the selected [periodFrom, periodTo] window?
    const inPeriod = (t) => {
      if (!periodActive) return true;
      const span = spanOf(t);
      if (!span) return false;
      if (periodFrom && span.last  < periodFrom) return false; // ends before window
      if (periodTo   && span.first > periodTo)   return false; // starts after window
      return true;
    };

    // The Board hub's toolbar applies here too — one definition of Mine and
    // Stuck for all eight tabs (services/boardScope.js).
    return scopeTasks(tasks, { scope: scopeOf(route), who: route.who, q: route.q, userId, today: todayLocal() })
      .filter((t) => projectFilter === 'all' || t.projectId === projectFilter)
      .filter((t) => t.plan?.startDate || t.plan?.endDate || t.actual?.startDate || t.actual?.endDate)
      .filter(inPeriod)
      .sort((a, b) => {
        // 1. Group by project (alphabetical by project name; null project last)
        const aProj = projectById[a.projectId]?.name || '￿';
        const bProj = projectById[b.projectId]?.name || '￿';
        if (aProj !== bProj) return aProj.localeCompare(bProj);
        // 2. Within a project, earliest start first
        return earliestOf(a).localeCompare(earliestOf(b));
      });
  }, [tasks, projectFilter, projectById, periodActive, periodFrom, periodTo, route.onlyMine, route.stuckOnly, route.who, route.q, userId]);

  // The chip strip offers the tags on the rows this page would otherwise show,
  // and `rows` becomes the tag-filtered set. `missing` covers a saved view
  // pointing at a tag nothing here carries: the chip still shows, so the filter
  // is visible and clearable rather than an unexplained empty chart.
  const tagState = tagFilterState(allRows, tagFilter);
  const rows = tagState.filtered;

  // What the header's Export button hands over: the scheduled tasks currently
  // on the chart, with the same project filter and period window applied.
  const exportProps = {
    build: () => buildTaskListDocument(rows, {
      title: 'Timeline',
      projectById,
      projects,
      memberProfiles,
      projectName: projectById[projectFilter]?.name || null,
    }),
    baseName: projectById[projectFilter]?.name
      ? `${projectById[projectFilter].name}-timeline`
      : 'timeline',
    kind: 'table',
    title: 'Save these scheduled tasks as a spreadsheet, CSV or PDF',
  };

  const range = useMemo(() => {
    // When a period is set, the timeline window is pinned to it (each bound
    // independently). Otherwise it auto-fits the visible tasks, starting one
    // week before today so recent context is visible.
    const today = parseDate(todayLocal());

    if (periodActive) {
      // Explicit bounds win. For any unset bound, fall back to the extent of
      // the visible tasks, then to a sensible default.
      let min = periodFrom ? parseDate(periodFrom) : null;
      let max = periodTo   ? parseDate(periodTo)   : null;
      if (!min || !max) {
        let taskMin = null;
        let taskMax = null;
        rows.forEach((t) => {
          [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]
            .map(parseDate).filter(Boolean)
            .forEach((d) => {
              if (!taskMin || d < taskMin) taskMin = d;
              if (!taskMax || d > taskMax) taskMax = d;
            });
        });
        if (!min) min = taskMin || (max ? addDays(max, -30) : addDays(today, -7));
        if (!max) max = taskMax || (min ? addDays(min, 30)  : addDays(today, 30));
      }
      if (max < min) max = min;
      return { min, max, total: diffDays(min, max) + 1 };
    }

    let min = addDays(today, -7);
    let max = today;
    rows.forEach((t) => {
      const dates = [t.plan?.startDate, t.plan?.endDate, t.actual?.startDate, t.actual?.endDate]
        .map(parseDate).filter(Boolean);
      dates.forEach((d) => {
        if (d < min) min = d;
        if (d > max) max = d;
      });
    });
    // Pad the trailing edge so future tasks have a little headroom; the
    // leading edge already sits a week before today.
    max = addDays(max, 3);
    return { min, max, total: diffDays(min, max) + 1 };
  }, [rows, periodActive, periodFrom, periodTo]);

  const today = parseDate(todayLocal());

  if (loading) return <p className="muted">Loading Gantt…</p>;

  if (rows.length === 0) {
    return (
      <>
        <PageHeader onNewTask={() => setQuickAddOpen(true)} exportProps={exportProps}
        tagState={tagState} onClearTag={() => setTagFilter(null)} />
        {/* The switch stays: an empty chart is usually a window that is too
            narrow, and the control that widens it has to be on the page that
            emptied. */}
        <div className="bcard gantt-card" style={{ '--gc-label-w': `${LABEL_W}px` }}>
          <div className="gantt-card-head">
            <span className="gantt-card-title">Gantt</span>
            <PeriodSwitch
              from={periodFrom} to={periodTo}
              setFrom={setPeriodFrom} setTo={setPeriodTo}
            />
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">▭</div>
          {periodActive ? (
            <>
              <p>No tasks fall within the selected period.</p>
              <p className="small">
                Widen the date range or{' '}
                <button
                  className="table-link"
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
                  onClick={() => { setPeriodFrom(''); setPeriodTo(''); }}
                >clear the filter</button>.
              </p>
            </>
          ) : (
            <>
              <p>No tasks with plan or actual dates yet.</p>
              <p className="small">Click <strong>+ New task</strong> above, or add plan start/end dates to existing tasks.</p>
            </>
          )}
        </div>
        {quickAddOpen && (
          <TaskEditor
            task={newTaskDraft({ workspaceId: activeWorkspaceId, projectId: projectFilter })}
            projects={projects}
            onClose={() => setQuickAddOpen(false)}
          />
        )}
      </>
    );
  }

  // The chart fills the card. The mockup has no horizontal scroll, so there is
  // no fixed pixels-per-day: the track column is measured and the day width
  // falls out of it. Everything downstream — bars, the today line, the
  // dependency arrows, the drag arithmetic — keeps working in pixels off that
  // one number, so nothing had to learn percentages.
  const dayWidth = trackW > 0 ? trackW / range.total : 0;
  const ROW_H = 44;            // CSS .gc-row height — the mockup's own

  const GROUP_H = 38;          // CSS .gc-group height

  // Segmented by project. `rows` is already sorted project-first, so a band
  // goes in wherever the project changes. Each band carries the project's own
  // span, which is the one number a reader wants from a group header — when
  // this project starts and when it is meant to be done.
  const layout = [];
  let y = 0;
  let lastProject = '\u0000';
  rows.forEach((t) => {
    const key = t.projectId || '__none__';
    if (key !== lastProject) {
      lastProject = key;
      const own = rows.filter((r) => (r.projectId || '__none__') === key);
      const starts = own.map((r) => r.plan?.startDate || r.plan?.endDate).filter(Boolean).sort();
      const ends   = own.map((r) => r.plan?.endDate || r.plan?.startDate).filter(Boolean).sort();
      layout.push({
        kind: 'group',
        top: y,
        height: GROUP_H,
        projectId: t.projectId || null,
        count: own.length,
        from: starts[0] || null,
        to: ends[ends.length - 1] || null,
      });
      y += GROUP_H;
    }
    layout.push({ kind: 'task', task: t, top: y, height: ROW_H });
    y += ROW_H;
  });
  const bodyHeight = y;

  // Index rows for arrow Y computation.
  const taskRowByTaskId = new Map();
  layout.forEach((entry) => {
    if (entry.kind === 'task') taskRowByTaskId.set(entry.task.id, entry);
  });

  // Dependency arrows: from the end of the dependency's plan bar to the start
  // of this one. The SVG is laid over the track column only, so coordinates
  // are in the track's own space and need no label offset.
  const arrows = [];
  rows.forEach((t) => {
    const depIds = t.dependsOn || [];
    const myPlanStart = parseDate(t.plan?.startDate);
    if (!myPlanStart) return;
    const myEntry = taskRowByTaskId.get(t.id);
    if (!myEntry) return;
    const toX = Math.round(diffDays(range.min, myPlanStart) * dayWidth);
    const toY = Math.round(myEntry.top + myEntry.height / 2);

    depIds.forEach((depId) => {
      const depEntry = taskRowByTaskId.get(depId);
      if (!depEntry) return;
      const depPlanEnd = parseDate(depEntry.task.plan?.endDate);
      if (!depPlanEnd) return;
      const fromX = Math.round((diffDays(range.min, depPlanEnd) + 1) * dayWidth);
      const fromY = Math.round(depEntry.top + depEntry.height / 2);
      arrows.push({ id: `${depId}->${t.id}`, fromX, fromY, toX, toY });
    });
  });

  // Weeks while the window is short enough for them to be readable, months
  // beyond that. Ten weeks of columns is about where the labels stop fitting.
  const ruler = rulerColumns(range.min, range.total, range.total <= 77 ? 'week' : 'month');
  const rulerCols = ruler.map((c) => `${c.days}fr`).join(' ');
  // The day letters under the week numbers, on a window short enough for them
  // to be read — This week, This month and Next 30 days all qualify; a quarter
  // does not. Asked for so a reader can tell WHICH day a bar ends on without
  // counting across from the week label.
  const days = range.total <= DAY_ROW_MAX
    ? dayColumns(range.min, range.total, todayLocal())
    : null;
  // Where today sits across the track, as a share — the mockup's 2px red line.
  const todayPct = ((diffDays(range.min, today) + 0.5) / range.total) * 100;
  const todayVisible = todayPct >= 0 && todayPct <= 100;

  return (
    <>
      <PageHeader onNewTask={() => setQuickAddOpen(true)} exportProps={exportProps}
        tagState={tagState} onClearTag={() => setTagFilter(null)} />
      {/* The Board Explorer's chart, panel for panel: a titled head with the
          ruler granularity on the right, a week/month ruler over a 220px
          label column, 44px rows, and a legend band at the foot. */}
      <div className="bcard gantt-card" style={{ '--gc-label-w': `${LABEL_W}px` }}>
        <div className="gantt-card-head">
          <span className="gantt-card-title">Gantt</span>
          {/* The period is what the chart is OF, so it belongs on the chart
              rather than in a filter bar above it. It replaced the ruler
              granularity, which is now worked out from the window itself —
              nobody needs to be asked whether eight weeks should be drawn in
              weeks. */}
          <PeriodSwitch
            from={periodFrom} to={periodTo}
            setFrom={setPeriodFrom} setTo={setPeriodTo}
          />
        </div>

        {/* Both ruler rows in one sticky block: a chart you have to scroll is
            a chart whose dates you cannot see, so the header stays at the top
            of the page while the rows go past it. */}
        <div className="gc-rulers">
          <div className="gc-ruler">
            <span className="gc-ruler-pad" />
            <span className="gc-ruler-cols" ref={trackRef} style={{ gridTemplateColumns: rulerCols }}>
              {ruler.map((c) => <span key={c.key} className="gc-col">{c.label}</span>)}
            </span>
          </div>
          {days && (
            <div className="gc-ruler gc-ruler-days">
              <span className="gc-ruler-pad" />
              <span className="gc-ruler-cols" style={{ gridTemplateColumns: `repeat(${range.total}, 1fr)` }}>
                {days.map((d) => (
                  <span
                    key={d.iso}
                    className={`gc-day${d.weekend ? ' is-weekend' : ''}${d.today ? ' is-today' : ''}`}
                    title={d.title}
                  >{d.letter}</span>
                ))}
              </span>
            </div>
          )}
        </div>

        <div className="gc-body">
          {layout.map((entry, i) => {
            if (entry.kind === 'group') {
              const proj = projectById[entry.projectId];
              return (
                <div key={`g-${entry.projectId || 'none'}-${i}`} className="gc-group">
                  <span className="gc-group-name">
                    <span className="gc-dot" style={{ background: proj?.color || 'var(--c-text-muted)' }} />
                    {proj?.name || 'No project'}
                    <span className="gc-group-count">{entry.count}</span>
                  </span>
                  <span className="gc-group-span">
                    {entry.from && entry.to ? `${entry.from} → ${entry.to}` : 'no dates'}
                  </span>
                </div>
              );
            }
            return (
              <GanttRow
                key={entry.task.id}
                task={entry.task}
                project={projectById[entry.task.projectId]}
                range={range}
                dayWidth={dayWidth}
                trackWidth={trackW}
                today={today}
                alt={i % 2 === 1}
                todayPct={todayVisible ? todayPct : null}
                memberProfiles={memberProfiles}
                onClick={() => setEditingTask(entry.task)}
              />
            );
          })}

          {/* Dependency arrows, laid over the track column only. Drawn last so
              they sit above the bars, and never over the label column. */}
          {arrows.length > 0 && dayWidth > 0 && (
            <svg
              className="gantt-arrows"
              width={trackW}
              height={bodyHeight}
              style={{ position: 'absolute', top: 0, left: LABEL_W, pointerEvents: 'none' }}
              aria-hidden="true"
            >
              <defs>
                <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-text-3)" />
                </marker>
              </defs>
              {arrows.map((a) => {
                const gap = 4;
                const endX = a.toX - gap;
                const midX = (a.fromX + endX) / 2;
                return (
                  <path
                    key={a.id}
                    d={`M ${a.fromX} ${a.fromY} L ${midX} ${a.fromY} L ${midX} ${a.toY} L ${endX} ${a.toY}`}
                    fill="none" stroke="var(--c-text-3)" strokeWidth="1.5"
                    strokeDasharray="3 3" markerEnd="url(#dep-arrow)"
                  />
                );
              })}
            </svg>
          )}
        </div>

      {/* The mockup's three, and only three. What a drag does is said once
          already, in the line under the title — repeating it here is the
          wall of legend the Explorer deliberately does not have. */}
      <div className="gantt-legend">
        <span className="gl"><span className="gl-line" />Today</span>
        <span className="gl gl-late">▲ Past due</span>
        <span className="gl"><span className="gl-swatch" style={{ background: 'var(--c-done)' }} />Complete</span>
      </div>
      </div>

      {/* "New task" opens the EDITOR, not a four-field dialog in front of it.
          Creating a task and editing one are the same screen now, so a new
          task can carry an estimate, an owner, a dependency and a tag on the
          way in rather than needing a second pass. */}
      {quickAddOpen && (
        <TaskEditor
          task={newTaskDraft({ workspaceId: activeWorkspaceId, projectId: projectFilter })}
          projects={projects}
          onClose={() => setQuickAddOpen(false)}
        />
      )}

      {/* Clicking a task opens the EDITOR, not the read-only activity list.
          One click, one destination — the activity log is that editor's
          Activity tab now, so the list is not lost, it just stopped being
          a second modal in front of the thing you actually wanted. */}
      {editingTask && (
        <TaskEditor
          task={editingTask}
          projects={projects}
          onClose={() => setEditingTask(null)}
        />
      )}
    </>
  );
}

// ─── Individual row with draggable plan bar ────────────────────────────────

// Exported for tests/ui/ganttMilestone.test.mjs and dev/gantt.html, which render
// one row on its own — no Firestore, no sign-in, no whole timeline.
export function GanttRow({
  task, project, range, dayWidth, today, onClick,
  alt = false, todayPct = null, trackWidth = 0, memberProfiles = {},
  // How a committed drag is saved. Defaults to the real write; dev/gantt.html
  // passes its own so the row can be driven with no Firestore behind it.
  onSavePlan = updateTask,
}) {
  const toast = useToast();
  const planEnd   = parseDate(task.plan?.endDate);

  // Drag state, in two halves on purpose (T-0134 / IMP-012).
  //
  // `drag` is what the BAR is drawn from, so it has to be state — every
  // pointermove moves the bar. `dragRef` is the same thing as a mutable value,
  // and it is what the window listeners read.
  //
  // Before this, the listener effect depended on `drag`, and every pointermove
  // replaced it with a new object: React tore down and re-added both window
  // listeners dozens of times a second, on the one interaction in the app that
  // has to hold 60fps — and the write at pointerup came from whichever closure
  // happened to be installed at that instant, over a possibly stale `task`.
  const [drag, setDrag] = useState(null);  // { mode, startX, origin, startDay, endDay }
  const dragRef = useRef(null);
  const setBothDrag = (next) => { dragRef.current = next; setDrag(next); };

  // The task as it is NOW, for the pointerup that commits. Read through a ref
  // so the listeners never need re-installing when the task changes underneath
  // a drag (a teammate's edit, a counter bump). Assigned in an effect, not
  // during render — the same shape useRecurrenceCatchUp uses.
  const taskRef = useRef(task);
  useEffect(() => { taskRef.current = task; }, [task]);

  const trackRef = useRef(null);

  // The span the chart draws. A task with only a due date is a one-day
  // milestone on that date, not a blank track — which is what BUG-014 was.
  const rangeMin = fmtDate(range.min);
  const span = drag
    ? { startDate: shiftIso(rangeMin, drag.startDay), endDate: shiftIso(rangeMin, drag.endDay), isMilestone: drag.startDay === drag.endDay, derived: null }
    : effectivePlan(task);
  const bar = span ? planBar(task, { rangeMin, dayWidth, span }) : null;
  const planLeft  = bar ? bar.left  : null;
  const planWidth = bar ? bar.width : null;
  const isMilestone = !drag && span?.isMilestone;

  const isOverdue = task.status !== 'done' && planEnd && planEnd < today;

  // ── Drag handlers ────────────────────────────────────────────────────────
  // Keyed on the MODE, not on the drag: the mode is fixed for the whole
  // gesture, so this runs once when a drag starts and once when it ends. The
  // handlers read live geometry from `dragRef`.
  //
  // The listeners are on `window` rather than the bar, deliberately — a release
  // outside the bar has to end the drag, or the gesture sticks.
  const dragMode = drag?.mode || null;
  useEffect(() => {
    if (!dragMode) return undefined;

    const onMove = (e) => {
      const live = dragRef.current;
      if (!live) return;
      const dDays = Math.round((e.clientX - live.startX) / dayWidth);
      setBothDrag({ ...live, ...dragTo(live.mode, live.origin, dDays) });
    };
    const onUp = async () => {
      const live = dragRef.current;
      const current = taskRef.current;
      setBothDrag(null);
      if (!live) return;
      const patch = dragPatch(current, rangeMin, { startDay: live.startDay, endDay: live.endDay });
      if (!patch) return;   // nothing moved — no write
      try {
        await onSavePlan(current.id, patch);
      } catch (err) {
        console.error('Could not save plan dates:', err);
        toast.error(friendlyError(err, 'Could not save plan dates. Please try again.'));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
    // `toast` and `setBothDrag` are stable for the life of the row; adding them
    // would put this back to re-installing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragMode, dayWidth, rangeMin, onSavePlan]);

  const startDrag = (e, mode) => {
    // A milestone has an origin now — both ends on its one date — which is what
    // lets a left-edge drag give a due-only task the start date it never had.
    const origin = dragOrigin(task, rangeMin);
    if (!origin) return;
    e.preventDefault();
    e.stopPropagation();
    setBothDrag({ mode, startX: e.clientX, origin, startDay: origin.startDay, endDay: origin.endDay });
  };

  const owner = ownerOf(task, memberProfiles);

  // Clicking the row's label area opens the activities modal. Bar drags are
  // not affected because drag handlers stopPropagation on the bar elements.
  const handleLabelClick = (e) => {
    // Only fire on direct label clicks, not on bubbling from interactive children.
    if (!onClick) return;
    e.stopPropagation();
    onClick();
  };

  // How far into the plan the work has actually got. The mockup fills the
  // track from the left in the project's colour and leaves the rest as a
  // tinted outline — one bar, not two stacked ones.
  const donePct = task.status === 'done' ? 100 : Math.min(100, Math.max(0, task.progress || 0));
  const color = project?.color || 'var(--c-doing)';

  // Clamp the bar to the window it is drawn in. A period filter moves the
  // range's start forward, so a task that began before it has a NEGATIVE
  // left — and an absolutely-positioned bar with a negative left is painted
  // straight over the task names in the column to its left. Clamping keeps it
  // inside the track and squares off the edge it was cut at, so a bar running
  // out of the window reads as continuing rather than as starting there.
  // The drag is unaffected: `dragOrigin` works from the task's real dates.
  const trackPx = trackWidth > 0 ? trackWidth : null;
  let drawLeft = planLeft;
  let drawWidth = planWidth;
  let cutStart = false;
  let cutEnd = false;
  if (drawLeft != null && drawWidth != null) {
    if (drawLeft < 0) { drawWidth += drawLeft; drawLeft = 0; cutStart = true; }
    if (trackPx != null && drawLeft + drawWidth > trackPx) {
      drawWidth = trackPx - drawLeft;
      cutEnd = true;
    }
    if (drawWidth <= 0) { drawLeft = null; drawWidth = null; }
  }

  return (
    <div className={`gc-row${alt ? ' alt' : ''}`}>
      <div className="gc-label" onClick={handleLabelClick}>
        <span className="gc-dot" style={{ background: color }} />
        <span className="gc-name" title={task.title}>{task.title}</span>
        {owner && <Avatar id={owner.id} name={owner.name} photo={owner.photo} size={20} />}
      </div>

      <div ref={trackRef} className="gc-track" style={{ userSelect: drag ? 'none' : 'auto' }}>
        {todayPct != null && (
          <span className="gc-today" style={{ left: `${todayPct}%` }} aria-hidden="true" />
        )}

        {drawLeft != null && drawWidth != null && dayWidth > 0 && (
          <div
            className={`gc-bar${isMilestone ? ' is-milestone' : ''}${cutStart ? ' cut-start' : ''}${cutEnd ? ' cut-end' : ''}`}
            style={{
              left: drawLeft,
              width: drawWidth,   // a floor is `min-width` in CSS, in one place
              // The tinted bed and its outline, in the project's own colour.
              background: `color-mix(in srgb, ${color} 15%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)`,
              cursor: drag?.mode === 'move' ? 'grabbing' : 'grab',
            }}
            onPointerDown={(e) => startDrag(e, 'move')}
            title={planLabel(span)}
            aria-label={`${task.title} — ${planLabel(span)}`}
          >
            <div className="gc-handle gc-handle-l" onPointerDown={(e) => startDrag(e, 'resize-left')} />
            <span
              className="gc-fill"
              style={{
                width: `${donePct}%`,
                background: task.status === 'done' ? 'var(--c-done)' : color,
              }}
            />
            <div className="gc-handle gc-handle-r" onPointerDown={(e) => startDrag(e, 'resize-right')} />
          </div>
        )}

        {/* The mockup's past-due marker: a small red triangle at the end of
            an open bar whose date has gone. It says WHERE the overrun is, on
            a chart where a late bar otherwise looks like any other. */}
        {isOverdue && drawLeft != null && drawWidth != null && !cutEnd && (
          <span
            className="gc-late"
            style={{ left: drawLeft + drawWidth }}
            title={`Past due — planned to finish ${task.plan?.endDate}`}
          >▲</span>
        )}
      </div>
    </div>
  );
}

function PageHeader({ onNewTask, exportProps, tagState, onClearTag }) {
  return (
    <>
      {/* The chip strip is gone from this page, so a tag that came in on a
          saved view is said HERE instead. It is still applied — dropping the
          strip and the filter both would make the same saved view mean two
          different things on the Board and on the chart (BUG-018). */}
      <PageSubtitle>
        {tagState?.active && (
          <>
            Filtered to <strong>#{tagState.active}</strong> ·{' '}
            <button className="table-link" onClick={onClearTag}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
            >show all</button> ·{' '}
          </>
        )}
        Plan against actual · drag a plan bar to move or resize it
      </PageSubtitle>
      <PageActions>
        {exportProps && <ExportButton {...exportProps} className="cmd" />}
        {onNewTask && (
          <button className="cmd cmd-primary" onClick={onNewTask}>
            <span className="cmd-icon">+</span>New task
          </button>
        )}
      </PageActions>
    </>
  );
}

// Date-period filter bar. Lets the user pin the Gantt window to a specific
// period (presets or custom from/to). Tasks that don't overlap the window are
// hidden, and the timeline is clamped to the chosen bounds.
/**
 * The period switch — the chart's own control, in its head.
 *
 * It replaced a five-chip filter bar above the chart. The four settings are
 * `PERIODS`, and which one is lit is read back off the dates, so a window
 * that came from a link or a reload still highlights correctly. A window
 * somebody picked by hand lights nothing and says "Custom" rather than
 * pretending to be one of the four.
 */
export function PeriodSwitch({ from, to, setFrom, setTo }) {
  const period = periodOf(from, to);
  return (
    <span className="seg" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          className={`seg-btn${period === p.id ? ' is-on' : ''}`}
          aria-pressed={period === p.id}
          onClick={() => { const r = p.range(); setFrom(r.from); setTo(r.to); }}
        >
          <Icon name={p.icon} size={14} />
          <span className="seg-label">{p.label}</span>
        </button>
      ))}
      {period === null && (
        <span className="seg-btn is-on" title={`${from || '…'} → ${to || '…'}`}>
          <Icon name="calendar" size={14} />
          <span className="seg-label">Custom</span>
        </span>
      )}
    </span>
  );
}

