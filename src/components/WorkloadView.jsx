// src/components/WorkloadView.jsx — Board → Workload, rebuilt to
// `Board Explorer.dc.html` (T-0150).
//
// The mockup's Workload is ONE panel: a person per row, a bar segmented by
// project, a notch where the weekly cap falls, and the hours at the end.
// That is the whole page now.
//
// What was here before was a people × six-weeks grid with drag-to-rebalance
// underneath this panel — drag a task to another week to move its deadline,
// or onto another person to hand it over. It was removed on request, with
// both halves of what it did still reachable:
//
//   · move WHEN         → Calendar (drag between days) and My Week
//   · move WHO          → the Table's bulk bar, or the task editor
//
// `services/workload.js` still exports the grid's arithmetic
// (`buildWorkload`, `planningWeeks`, `moveTaskPlan`, `describeCell`…) and its
// tests still run, but nothing renders them any more. They were left in place
// rather than deleted because the grid is one component away from coming
// back; `moveTaskToDay` from the same module IS still live, behind the
// Calendar and My Week.
//
// The arithmetic and the meaning of a load level stay in the pure module.

import { useMemo } from 'react';
import { useProjects, useTasks, useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { memberLabel } from '../services/invites';
import { todayLocal } from '../services/recurrence';
import { DEFAULT_CAPACITY_HOURS, HOURS_PER_TASK, taskHours } from '../services/workload';
import { scopeTasks, scopeOf } from '../services/boardScope';
import { PageActions, PageSubtitle } from './PageHeader';
import Avatar from './Avatar';

export default function WorkloadView({ projectFilter = 'all', route = {}, navigate }) {
  const { tasks, loading } = useTasks();
  const { byId: projectById } = useProjects();
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const members = useMemo(() => workspace?.members || [], [workspace]);
  const memberProfiles = useMemo(() => workspace?.memberProfiles || {}, [workspace]);

  const visible = useMemo(
    () => scopeTasks(
      projectFilter === 'all' ? tasks : tasks.filter((t) => t.projectId === projectFilter),
      { scope: scopeOf(route), who: route.who, q: route.q, userId, today: todayLocal() },
    ),
    [tasks, projectFilter, route.onlyMine, route.stuckOnly, route.who, route.q, userId],
  );

  // One bar per person, segmented by project, against a real cap.
  //
  // The hours are ESTIMATES of open work — every open task, dated or not,
  // because a task nobody has scheduled is still on somebody's plate. Where a
  // task has no estimate the module's fallback is used and the row says how
  // many were counted that way: a full bar the reader believes is measured,
  // when half of it was assumed, is this page's oldest trap.
  const load = useMemo(() => {
    const open = visible.filter((t) => t.status !== 'done');
    const people = members.map((uid) => {
      const own = open.filter((t) => (t.assignedTo || []).includes(uid));
      const byProject = {};
      let guessed = 0;
      own.forEach((t) => {
        if (t.estimateHours == null) guessed += 1;
        const key = t.projectId || 'none';
        byProject[key] = (byProject[key] || 0) + taskHours(t);
      });
      const hours = Object.values(byProject).reduce((n, h) => n + h, 0);
      return {
        uid,
        name: memberLabel(uid, memberProfiles, { selfUid: userId }),
        open: own.length,
        done: visible.filter((t) => t.status === 'done' && (t.assignedTo || []).includes(uid)).length,
        hours,
        guessed,
        segs: Object.entries(byProject)
          .map(([pid, h]) => ({ pid, h, color: projectById[pid]?.color || 'var(--c-text-muted)' }))
          .sort((a, b) => b.h - a.h),
      };
    }).filter((p) => p.open > 0);
    // The track runs to the widest bar or to the cap plus a quarter, whichever
    // is larger, so the cap notch always sits inside the track and an
    // over-capacity bar still has somewhere to overflow into.
    const widest = Math.max(DEFAULT_CAPACITY_HOURS * 1.25, ...people.map((p) => p.hours));
    return {
      people: people.sort((a, b) => b.hours - a.hours),
      widest,
      capPct: (DEFAULT_CAPACITY_HOURS / widest) * 100,
    };
  }, [visible, members, memberProfiles, projectById, userId]);

  if (loading) return <p className="muted">Loading the plan…</p>;

  const projectIds = [...new Set(load.people.flatMap((p) => p.segs.map((sg) => sg.pid)))].slice(0, 6);
  const totalOpen = load.people.reduce((n, p) => n + p.open, 0);
  const over = load.people.filter((p) => p.hours > DEFAULT_CAPACITY_HOURS).length;

  return (
    <>
      <PageSubtitle>
        {load.people.length} {load.people.length === 1 ? 'person' : 'people'} ·{' '}
        {totalOpen} open item{totalOpen === 1 ? '' : 's'}
        {over > 0 && <> · <strong>{over}</strong> over the {DEFAULT_CAPACITY_HOURS}h cap</>}
      </PageSubtitle>
      <PageActions>
        {/* The mockup draws no controls here. Clearing the member filter is
            the one thing this page needs a way out of, and only when it is
            actually applied. */}
        {route.who && (
          <button className="cmd" onClick={() => navigate?.({ who: null })}>
            Show everybody
          </button>
        )}
      </PageActions>

      {load.people.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▤</div>
          <p>Nobody is carrying open work in this view.</p>
          <p className="small">
            Assign a task to someone — the bar here is built from what they have open,
            whether or not it has a date.
          </p>
        </div>
      ) : (
        <section className="wl-card">
          <div className="wl-head">
            <span className="wl-title">Workload</span>
            <span className="wl-cap">cap {DEFAULT_CAPACITY_HOURS}h</span>
          </div>

          <div className="wl-rows">
            {load.people.map((p) => {
              const tone = p.hours > DEFAULT_CAPACITY_HOURS ? 'red'
                : p.hours >= DEFAULT_CAPACITY_HOURS * 0.8 ? 'amber' : 'green';
              const isOn = route.who === p.uid;
              return (
                <button
                  type="button"
                  key={p.uid}
                  className={`wl-row${isOn ? ' is-on' : ''}`}
                  aria-pressed={isOn}
                  title={`${p.name} — ${Math.round(p.hours)}h across ${p.segs.length} project${p.segs.length === 1 ? '' : 's'}. Show only their work.`}
                  onClick={() => navigate?.({ who: isOn ? null : p.uid })}
                >
                  <Avatar id={p.uid} name={p.name} photo={memberProfiles[p.uid]?.photoURL} size={30} />
                  <span className="wl-name">
                    <span className="wl-person">{p.name}</span>
                    <span className="wl-count">{p.open} open · {p.done} done</span>
                  </span>
                  <span className="wl-track">
                    {p.segs.map((sg) => (
                      <span
                        key={sg.pid}
                        className="wl-seg"
                        style={{ width: `${(sg.h / load.widest) * 100}%`, background: sg.color }}
                        title={`${projectById[sg.pid]?.name || 'No project'}: ${Math.round(sg.h)}h`}
                      />
                    ))}
                    <span className="wl-notch" style={{ left: `${load.capPct}%` }} aria-hidden="true" />
                  </span>
                  {/* The mockup's 104px name column truncates, and "N
                      assumed" is the one thing on this row that must never be
                      the bit that gets cut — it is what stops a measured-
                      looking bar from being believed. So it sits outside that
                      column, as its own chip. */}
                  <span className="wl-assumed-slot">
                    {p.guessed > 0 && (
                      <span
                        className="wl-assumed"
                        title={`${p.guessed} of these ${p.open} have no estimate and were counted at ${HOURS_PER_TASK}h each`}
                      >{p.guessed} assumed</span>
                    )}
                  </span>
                  <span className={`wl-hours tone-ink-${tone}`}>{Math.round(p.hours)}h</span>
                </button>
              );
            })}
          </div>

          <div className="wl-legend">
            {projectIds.map((pid) => (
              <span key={pid} className="wl-leg">
                <span className="wl-leg-dot" style={{ background: projectById[pid]?.color || 'var(--c-text-muted)' }} />
                {projectById[pid]?.name || 'No project'}
              </span>
            ))}
            <span className="wl-leg"><span className="wl-leg-line" />{DEFAULT_CAPACITY_HOURS}h cap</span>
          </div>

          {/* Not in the mockup, and not optional: the bars are part guesswork
              and the reader has to be told which part. */}
          <p className="wl-note">
            Open work only, in estimated hours. A task with no estimate is
            counted at {HOURS_PER_TASK}h — each row says how many of those there
            were, because a full bar built out of assumptions is worse than no bar.
          </p>
        </section>
      )}
    </>
  );
}
