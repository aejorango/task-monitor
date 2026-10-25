// src/components/WorkloadView.jsx — Board → Workload: one WEEK, planned
// against actual, per person.
//
// It used to be a single bar per person of every open task's remaining
// estimate, dated or not, against a 40h cap — a number with no week behind it,
// which nobody could check (asked to be rebuilt, T-0161). Now the page is
// about the week you pick:
//
//   · a week bar      — ← Previous week · the week · Next week → · This week
//   · four tiles      — Planned, Actual (logged), Capacity, Planned vs capacity
//   · a row per person — a PLAN bar (segmented by project) and an ACTUAL bar on
//                        one scale, the cap notch through both, the gap between
//                        them in words; click a row for the task-by-task working
//   · how it is worked out — always on the page, because a chart people are
//                        asked to trust has to show its arithmetic
//
// The arithmetic is `weekWorkload` in services/workload.js (pure, tested). The
// older grid helpers there (`buildWorkload`, `planningWeeks`, `moveTaskPlan`,
// `describeCell`…) and their tests are kept, but
// nothing renders them any more; `moveTaskToDay` from the same module IS still
// live, behind the Calendar and My Week. Moving WHEN is the Calendar and My Week; moving WHO is the task
// editor.

import { useMemo, useState } from 'react';
import { useProjects, useTasks, useAuth, useAllActivities } from '../hooks/useTasks';
import { useViewWorkspace } from '../hooks/useWorkspace';
import { useSettings } from '../hooks/useSettings';
import { todayLocal } from '../services/recurrence';
import { DEFAULT_CAPACITY_HOURS, HOURS_PER_TASK, UNASSIGNED, weekWorkload } from '../services/workload';
import { weekDays, weekLabel, shiftWeek } from '../services/timesheet';
import { scopeTasks, scopeOf, blockedTaskIds } from '../services/boardScope';
import { PageActions, PageSubtitle } from './PageHeader';
import { Tile } from './DashboardView';
import TaskEditor from './TaskEditor';
import Avatar from './Avatar';

const CAP = DEFAULT_CAPACITY_HOURS;
const fmt = (n) => `${Math.round((Number(n) || 0) * 10) / 10}h`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' });

// "+3h over plan", "4h under plan", "on plan" — the gap, in words.
function gapOf(p) {
  if (!p.planned && !p.actual) return { state: 'none', text: '' };
  if (!p.planned) return { state: 'unplanned', text: `${fmt(p.actual)} unplanned` };
  if (Math.abs(p.variance) < 0.5) return { state: 'on', text: 'on plan' };
  return p.variance > 0
    ? { state: 'over', text: `+${fmt(p.variance)} over plan` }
    : { state: 'under', text: `${fmt(-p.variance)} under plan` };
}

// One task's share, as the sum a reader can redo in their head.
function mathOf(i) {
  const parts = [i.estimated ? `${fmt(i.estimate)} estimate` : `${fmt(i.estimate)} assumed (no estimate)`];
  if (i.daysTotal > 1) parts.push(`× ${i.daysIn} of ${i.daysTotal} workdays`);
  if (i.sharedBy > 1) parts.push(`÷ ${i.sharedBy} people`);
  return parts.join(' ');
}

export default function WorkloadView({ projectFilter = 'all', route = {}, navigate }) {
  const { tasks, loading } = useTasks();
  const { activities, hasMore, loadMore, loadingMore } = useAllActivities();
  const blockedIds = useMemo(() => blockedTaskIds(activities), [activities]);
  const { projects, byId: projectById } = useProjects();
  const { userId } = useAuth();
  const { settings } = useSettings();
  const weekStart = settings?.weekStart ?? 1;

  const workspace = useViewWorkspace();
  const members = useMemo(() => workspace?.members || [], [workspace]);
  const memberProfiles = useMemo(() => workspace?.memberProfiles || {}, [workspace]);

  // The week being looked at. It starts on this week; the bar moves it.
  const today = todayLocal();
  const [anchor, setAnchor] = useState(today);
  const days = useMemo(() => weekDays(anchor, weekStart), [anchor, weekStart]);
  const isThisWeek = days.includes(today);
  const [openRow, setOpenRow] = useState(null);
  const [editing, setEditing] = useState(null);

  // The Board toolbar's filters, as every Board tab applies them.
  const visible = useMemo(
    () => scopeTasks(
      projectFilter === 'all' ? tasks : tasks.filter((t) => t.projectId === projectFilter),
      { scope: scopeOf(route), who: route.who, q: route.q, status: route.statusFilter, userId, blockedIds, today },
    ),
    [tasks, projectFilter, route.statusFilter, route.onlyMine, route.stuckOnly, route.who, route.q, userId, blockedIds, today],
  );

  const week = useMemo(
    () => weekWorkload(visible, activities, { days, members, memberProfiles, selfUid: userId }),
    [visible, activities, days, members, memberProfiles, userId],
  );

  // One scale for both bars and every row, so a plan and an actual can be
  // compared by eye; the cap notch always sits inside the track.
  const widest = Math.max(CAP * 1.25, ...week.rows.flatMap((p) => [p.planned, p.actual]));
  const capPct = (CAP / widest) * 100;

  // The activity listener holds the newest page; a week older than that page
  // would read short without saying so. Say so, and offer the rest.
  const oldestLoaded = activities.length ? activities[activities.length - 1]?.date : null;
  const logsShort = hasMore && oldestLoaded && days[0] <= oldestLoaded;

  if (loading) return <p className="muted">Loading the plan…</p>;

  const t = week.totals;
  const loadPct = t.capacity ? Math.round((t.planned / t.capacity) * 100) : null;
  const projectIds = [...new Set(week.rows.flatMap((p) => p.segs.map((sg) => sg.pid)))].slice(0, 8);

  return (
    <>
      <PageSubtitle>
        {weekLabel(days)}{isThisWeek ? ' (this week)' : ''} · {plural(week.rows.filter((p) => p.uid !== UNASSIGNED).length, 'person', 'people')} with work
        {' · '}{fmt(t.planned)} planned · {fmt(t.actual)} logged
      </PageSubtitle>
      <PageActions>
        {route.who && (
          <button className="cmd" onClick={() => navigate?.({ who: null })}>Show everybody</button>
        )}
      </PageActions>

      {/* The week decides what every number below means, so it leads the page. */}
      <div className="ts-toolbar wl-weekbar">
        <button className="btn btn-sm" onClick={() => { setAnchor((d) => shiftWeek(d, -1, weekStart)); setOpenRow(null); }}>
          ← Previous week
        </button>
        <strong className="ts-week">{weekLabel(days)}</strong>
        <button className="btn btn-sm" onClick={() => { setAnchor((d) => shiftWeek(d, 1, weekStart)); setOpenRow(null); }}>
          Next week →
        </button>
        {!isThisWeek && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setAnchor(today); setOpenRow(null); }}>This week</button>
        )}
      </div>

      {logsShort && (
        <div className="wl-gap" role="status">
          Only time logged since <strong>{shortDate(oldestLoaded)}</strong> is loaded, so this week&rsquo;s actual hours may read short.
          <button className="cmd" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older logs'}</button>
        </div>
      )}

      <div className="tiles">
        <Tile tone="navy" label="Planned" value={fmt(t.planned)}
          sub={t.unassigned ? `+ ${fmt(t.unassigned)} not assigned to anyone` : 'from the estimates of tasks in this week'} />
        <Tile tone="teal" label="Actual (logged)" value={fmt(t.actual)}
          sub={t.planned ? `${Math.round((t.actual / t.planned) * 100)}% of what was planned` : 'nothing planned to compare with'} />
        <Tile tone="green" label="Capacity" value={t.capacity ? fmt(t.capacity) : '—'}
          sub={t.people ? `${plural(t.people, 'person', 'people')} × ${CAP}h` : 'nobody in this workspace'} />
        <Tile tone={loadPct == null ? 'navy' : loadPct > 100 ? 'red' : loadPct >= 80 ? 'amber' : 'green'}
          label="Planned vs capacity" value={loadPct == null ? '—' : `${loadPct}%`} bar={loadPct ?? 0}
          sub={t.over ? `${plural(t.over, 'person', 'people')} planned past ${CAP}h` : `nobody planned past ${CAP}h`} />
      </div>

      {week.rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▤</div>
          <p>Nothing is planned or logged in {weekLabel(days)}.</p>
          <p className="small">
            A task counts toward a week when its plan dates fall in it — give tasks dates on the Calendar
            or the Gantt, and an estimate in the task editor, and they appear here.
          </p>
        </div>
      ) : (
        <section className="wl-card">
          <div className="wl-head">
            <span className="wl-title">Workload · {weekLabel(days)}</span>
            <span className="wl-cap">cap {CAP}h a person</span>
          </div>

          <div className="wl-rows">
            {week.rows.map((p) => {
              const tone = p.planned > CAP ? 'red' : p.planned >= CAP * 0.8 ? 'amber' : 'green';
              const gap = gapOf(p);
              const isOpen = openRow === p.uid;
              const firstName = String(p.name).split(/[\s@]/)[0];
              return (
                <div key={p.uid} className={`wl-row${isOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="wl-row-head"
                    aria-expanded={isOpen}
                    title={`${p.name} — ${fmt(p.planned)} planned, ${fmt(p.actual)} logged in ${weekLabel(days)}. Show how it adds up.`}
                    onClick={() => setOpenRow(isOpen ? null : p.uid)}
                  >
                    <Avatar id={p.uid} name={p.name} photo={memberProfiles[p.uid]?.photoURL} size={30} />
                    <span className="wl-name">
                      <span className="wl-person">{p.name}</span>
                      <span className="wl-count">{plural(p.items.length, 'task')} · {plural(p.logs.length, 'logged', 'logged')}</span>
                    </span>
                    <span className="wl-bars">
                      <span className="wl-bar-row">
                        <span className="wl-bar-lbl">Plan</span>
                        <span className="wl-track">
                          {p.segs.map((sg) => (
                            <span key={sg.pid} className="wl-seg"
                              style={{ width: `${(sg.h / widest) * 100}%`, background: projectById[sg.pid]?.color || 'var(--c-text-muted)' }}
                              title={`${projectById[sg.pid]?.name || 'No project'}: ${fmt(sg.h)} planned`} />
                          ))}
                          <span className="wl-notch" style={{ left: `${capPct}%` }} aria-hidden="true" />
                        </span>
                        <span className={`wl-hours tone-ink-${tone}`}>{fmt(p.planned)}</span>
                      </span>
                      <span className="wl-bar-row">
                        <span className="wl-bar-lbl">Actual</span>
                        <span className="wl-track is-actual">
                          <span className="wl-actual" style={{ width: `${(p.actual / widest) * 100}%` }} />
                          <span className="wl-notch" style={{ left: `${capPct}%` }} aria-hidden="true" />
                        </span>
                        <span className="wl-hours">{fmt(p.actual)}</span>
                      </span>
                    </span>
                    {/* A fixed-width slot whether or not it has anything in it,
                        so the tracks — and the cap notch — line up row to row. */}
                    <span className="wl-assumed-slot">
                      {p.assumed > 0 && (
                        <span className="wl-assumed"
                          title={`${p.assumed} of these tasks have no estimate and were counted at ${HOURS_PER_TASK}h each`}>
                          {p.assumed} assumed
                        </span>
                      )}
                    </span>
                    <span className={`wl-gap-chip is-${gap.state}`}>{gap.text}</span>
                    <span className="wl-chev" aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
                  </button>

                  {isOpen && (
                    <div className="wl-why">
                      <div className="wl-why-col">
                        <div className="wl-why-head">Planned this week <strong>{fmt(p.planned)}</strong></div>
                        {p.items.length ? (
                          <ul className="wl-why-list">
                            {p.items.map((i) => (
                              <li key={i.task.id}>
                                <button type="button" className="wl-why-task" onClick={() => setEditing(i.task)}>
                                  <span className="wl-why-dot" style={{ background: projectById[i.task.projectId]?.color || 'var(--c-text-muted)' }} />
                                  {i.task.title || 'Untitled task'}
                                </button>
                                <span className={`wl-why-math${i.estimated ? '' : ' is-assumed'}`}>{mathOf(i)}</span>
                                <span className="wl-why-h">{fmt(i.hours)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="wl-why-empty">Nothing of theirs is planned in this week.</p>}
                      </div>
                      <div className="wl-why-col">
                        <div className="wl-why-head">Logged this week <strong>{fmt(p.actual)}</strong></div>
                        {p.logs.length ? (
                          <ul className="wl-why-list">
                            {p.logs.map((l) => (
                              <li key={l.task.id}>
                                <button type="button" className="wl-why-task" onClick={() => setEditing(l.task)}>
                                  <span className="wl-why-dot" style={{ background: projectById[l.task.projectId]?.color || 'var(--c-text-muted)' }} />
                                  {l.task.title || 'Untitled task'}
                                </button>
                                <span className="wl-why-math">{plural(l.entries, 'entry', 'entries')}</span>
                                <span className="wl-why-h">{fmt(l.hours)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="wl-why-empty">No time logged in this week.</p>}
                      </div>
                      {(p.undated > 0 || p.uid !== UNASSIGNED) && (
                        <div className="wl-why-foot">
                          {p.undated > 0 && (
                            <span>
                              {plural(p.undated, 'open task')} of theirs {p.undated === 1 ? 'has' : 'have'} no dates, so{' '}
                              {p.undated === 1 ? 'it belongs' : 'they belong'} to no week and {p.undated === 1 ? 'is' : 'are'} not counted.
                            </span>
                          )}
                          {p.uid !== UNASSIGNED && (
                            <button type="button" className="cmd" onClick={() => navigate?.({ who: p.uid })}>
                              Show only {firstName}&rsquo;s work
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {week.idle.length > 0 && (
            <p className="wl-idle">
              Nothing planned or logged this week: {week.idle.map((p) => p.name).join(', ')}.
            </p>
          )}

          <div className="wl-legend">
            {projectIds.map((pid) => (
              <span key={pid} className="wl-leg">
                <span className="wl-leg-dot" style={{ background: projectById[pid]?.color || 'var(--c-text-muted)' }} />
                {projectById[pid]?.name || 'No project'}
              </span>
            ))}
            <span className="wl-leg"><span className="wl-leg-dot wl-leg-actual" />Actual (logged)</span>
            <span className="wl-leg"><span className="wl-leg-line" />{CAP}h cap</span>
          </div>
        </section>
      )}

      {/* The working, always on the page: a chart people are asked to trust
          has to show how it was worked out. */}
      <section className="wl-how" aria-label="How these numbers are worked out">
        <div className="wl-how-title">How these numbers are worked out</div>
        <dl className="wl-how-list">
          <dt>Planned</dt>
          <dd>
            Every task whose plan touches this week, finished or not. Its estimate is spread evenly over the
            weekdays (Mon–Fri) from its start to its due date, and this week takes the share of those days that
            fall inside it — a 20h task planned across two weeks puts 10h in each. A task with only a due date
            counts in full on that day. A task shared by several people is split evenly between them. A task
            with no estimate is counted at {HOURS_PER_TASK}h and marked <em>assumed</em>, because a full bar
            built out of assumptions is worse than no bar.
          </dd>
          <dt>Actual</dt>
          <dd>The hours logged with a date in this week (Log time on a task), counted for the person who logged them.</dd>
          <dt>Capacity</dt>
          <dd>{CAP}h per person per week. Holidays and leave are not known to the app, so they are not taken off.</dd>
          <dt>Not counted</dt>
          <dd>Tasks with no dates belong to no week; each person&rsquo;s breakdown says how many of theirs there are.</dd>
        </dl>
      </section>

      {editing && <TaskEditor task={editing} projects={projects} onClose={() => setEditing(null)} />}
    </>
  );
}
