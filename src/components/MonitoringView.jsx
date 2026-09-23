// src/components/MonitoringView.jsx — Reports → Analytics (T-0144, moved T-0157).
//
// It was Dashboard → Monitoring. In T-0157 the Analytics page's own charts
// were deleted on request and this took its place, so the file name is now a
// step behind the route: `analytics` is the id, `MOVED_VIEWS` in
// services/views.js forwards the old `monitoring` hash here, and the file was
// left where it is rather than renamed so the git history of the numbers
// below stays attached to them.
//
// The Dashboard Explorer's Monitoring tab: four flow metrics with sparklines,
// throughput against blocked, and the alert rules with what is firing now.
//
// Every metric is computed here from tasks and activities, and every one of
// them can be checked by hand:
//   · Cycle time   — days from actual.startDate to actual.endDate, on tasks
//                    that finished in the window. Not an average of guesses.
//   · Throughput   — tasks finished per week.
//   · Blocked rate — share of open tasks with a logged bottleneck.
//   · On-time      — of the dated tasks finished, how many landed by the plan.
//
// The alert rules are the same conditions the Dashboard's Active alerts panel
// uses, listed as rules with their current state, so the two cannot disagree.

import { useMemo, useState } from 'react';
import { useTasks, useAllActivities } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { todayLocal } from '../services/firebase';
import { addDaysISO } from '../services/dueAlerts';
import { PageActions, PageSubtitle } from './PageHeader';
import { Tile } from './DashboardView';

const WEEKLY_CAPACITY_H = 35;
const WEEKS = 8;

/** Whole days between two YYYY-MM-DD strings, or null. */
function daysBetween(a, b) {
  if (!a || !b) return null;
  const [ay, am, ad] = String(a).split('-').map(Number);
  const [by, bm, bd] = String(b).split('-').map(Number);
  if (!ay || !by) return null;
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

/** A tiny line, drawn from the series itself — no library, no axis. */
function Spark({ points, tone }) {
  if (!points || points.length < 2) return null;
  const w = 120, h = 28;
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * (h - 4) - 2}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className={`spark spark-${tone}`} aria-hidden="true">
      <polyline points={d} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MonitoringView({ projectFilter = 'all' }) {
  const { tasks, loading: tLoading } = useTasks();
  const { activities, loading: aLoading } = useAllActivities();
  const { workspaces } = useWorkspaces();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);
  const [showQuiet, setShowQuiet] = useState(true);

  const today = todayLocal();
  const scoped = useMemo(
    () => tasks.filter((t) => !t.deleted && !t.archived
      && (projectFilter === 'all' || t.projectId === projectFilter)),
    [tasks, projectFilter],
  );

  // Eight week-buckets, oldest first — the series behind every sparkline.
  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, i) => {
    const end = addDaysISO(today, -7 * (WEEKS - 1 - i));
    return { from: addDaysISO(end, -6), to: end };
  }), [today]);

  const metrics = useMemo(() => {
    const blockedIds = new Set(
      activities.filter((a) => a.bottleneckRemarks?.trim()).map((a) => a.taskId),
    );
    const finishedIn = ({ from, to }) => scoped.filter((t) => t.status === 'done'
      && t.actual?.endDate && t.actual.endDate >= from && t.actual.endDate <= to);

    const cycleSeries = weeks.map((w) => {
      const spans = finishedIn(w)
        .map((t) => daysBetween(t.actual.startDate, t.actual.endDate))
        .filter((n) => n != null && n >= 0);
      return spans.length ? +(spans.reduce((a, b) => a + b, 0) / spans.length).toFixed(1) : 0;
    });
    const throughputSeries = weeks.map((w) => finishedIn(w).length);
    const open = scoped.filter((t) => t.status !== 'done');
    const blockedNow = open.filter((t) => blockedIds.has(t.id)).length;
    const blockedSeries = weeks.map((w) => {
      const openThen = scoped.filter((t) => !t.actual?.endDate || t.actual.endDate > w.to);
      const b = openThen.filter((t) => blockedIds.has(t.id)).length;
      return openThen.length ? Math.round((b / openThen.length) * 100) : 0;
    });
    const onTimeSeries = weeks.map((w) => {
      const dated = finishedIn(w).filter((t) => t.plan?.endDate);
      if (!dated.length) return 0;
      return Math.round((dated.filter((t) => t.actual.endDate <= t.plan.endDate).length / dated.length) * 100);
    });

    const last = (arr) => arr[arr.length - 1];
    const prev = (arr) => arr[arr.length - 2] ?? last(arr);
    const delta = (arr, unit, lowerIsBetter) => {
      const d = +(last(arr) - prev(arr)).toFixed(1);
      if (!d) return null;
      return `${d > 0 ? '+' : ''}${d}${unit}`;
      // The sign is the fact; whether it is good news is what the tone says.
      void lowerIsBetter;
    };

    return {
      blockedNow,
      open: open.length,
      cards: [
        {
          key: 'cycle', tone: 'navy', label: 'Cycle time',
          value: `${last(cycleSeries)}d`, delta: delta(cycleSeries, 'd', true),
          series: cycleSeries, sub: 'start to finish, tasks closed this week',
        },
        {
          key: 'throughput', tone: 'green', label: 'Throughput',
          value: last(throughputSeries), delta: delta(throughputSeries, ''),
          series: throughputSeries, sub: 'tasks finished this week',
        },
        {
          key: 'blocked', tone: 'red', label: 'Blocked rate',
          value: `${last(blockedSeries)}%`, delta: delta(blockedSeries, '%', true),
          series: blockedSeries, sub: `${blockedNow} of ${open.length} open tasks`,
        },
        {
          key: 'ontime', tone: 'amber', label: 'On-time',
          value: `${last(onTimeSeries)}%`, delta: delta(onTimeSeries, '%'),
          series: onTimeSeries, sub: 'finished by their plan date',
        },
      ],
      throughputSeries,
      blockedSeries,
    };
  }, [scoped, activities, weeks]);

  // The rules. Each one carries the count it is firing on right now, computed
  // from the same data as the Dashboard's alerts panel.
  const rules = useMemo(() => {
    const blockedIds = new Set(activities.filter((a) => a.bottleneckRemarks?.trim()).map((a) => a.taskId));
    const open = scoped.filter((t) => t.status !== 'done');
    const veryLate = open.filter((t) => t.plan?.endDate && (daysBetween(t.plan.endDate, today) ?? 0) > 3).length;
    const blocked = open.filter((t) => blockedIds.has(t.id)).length;

    const since = addDaysISO(today, -6);
    const hoursBy = {};
    activities.filter((a) => (a.date || '') >= since)
      .forEach((a) => { if (a.userId) hoursBy[a.userId] = (hoursBy[a.userId] || 0) + (a.hoursSpent || 0); });
    const overCap = Object.values(hoursBy).filter((h) => h > WEEKLY_CAPACITY_H).length;

    const idle = open.filter((t) => t.status === 'doing' && t.actual?.startDate
      && (daysBetween(t.actual.startDate, today) ?? 0) > 7).length;

    return [
      { sev: 'Sev 1', name: 'Task overdue beyond 3 days', cond: 'due date + 3d < today', n: veryLate },
      { sev: 'Sev 2', name: 'Task blocked',               cond: 'a bottleneck is logged against it', n: blocked },
      { sev: 'Sev 3', name: 'Member over capacity',       cond: `hours logged this week > ${WEEKLY_CAPACITY_H}h`, n: overCap },
      { sev: 'Sev 4', name: 'Item idle in progress',      cond: 'in progress for more than 7 days', n: idle },
    ].map((r) => ({
      ...r,
      tone: r.n === 0 ? 'green' : r.sev === 'Sev 1' || r.sev === 'Sev 2' ? 'red' : 'amber',
      state: r.n === 0 ? 'quiet' : `${r.n} firing`,
    }));
  }, [scoped, activities, today]);

  const shown = showQuiet ? rules : rules.filter((r) => r.n > 0);
  const firing = rules.filter((r) => r.n > 0).length;
  const peak = Math.max(1, ...metrics.throughputSeries);

  if (tLoading || aLoading) return <p className="muted">Loading monitoring…</p>;

  return (
    <>
      <PageSubtitle>
        {workspace?.name || 'This workspace'} · last {WEEKS} weeks ·{' '}
        {firing === 0 ? 'no rules firing' : `${firing} rule${firing === 1 ? '' : 's'} firing`}
      </PageSubtitle>
      <PageActions>
        <button
          className={`cmd${showQuiet ? '' : ' is-on'}`}
          aria-pressed={!showQuiet}
          onClick={() => setShowQuiet((v) => !v)}
        >{showQuiet ? 'Only what is firing' : 'Show every rule'}</button>
      </PageActions>

      <div className="tiles">
        {metrics.cards.map((c) => (
          <div key={c.key} className={`tile tile-${c.tone}`}>
            <div className="tile-head">
              <span className="tile-dot" />
              <span className="tile-label">{c.label}</span>
            </div>
            <div className="tile-value-row">
              <span className="tile-value">{c.value}</span>
              {c.delta && <span className="tile-delta">{c.delta}</span>}
            </div>
            <div className="tile-spark"><Spark points={c.series} tone={c.tone} /></div>
            <div className="tile-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="rep-split">
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Throughput vs. blocked</h2>
            <span className="rep-total">{WEEKS} weeks</span>
          </div>
          <p className="dcard-sub">
            Bars are tasks finished that week; the line is the share of open work that was blocked.
          </p>
          <div className="mon-chart">
            {metrics.throughputSeries.map((n, i) => (
              <div key={weeks[i].to} className="mon-col" title={`${weeks[i].from} – ${weeks[i].to}: ${n} finished, ${metrics.blockedSeries[i]}% blocked`}>
                <div className="mon-bar-wrap">
                  <span className="mon-bar" style={{ height: `${(n / peak) * 100}%` }} />
                  <span className="mon-dot" style={{ bottom: `${metrics.blockedSeries[i]}%` }} />
                </div>
                <div className="mon-label">{weeks[i].to.slice(5)}</div>
              </div>
            ))}
          </div>
          <div className="stack-legend">
            <span className="stack-legend-item"><span className="stack-swatch" style={{ background: 'var(--c-emerald)' }} />Finished</span>
            <span className="stack-legend-item"><span className="stack-swatch" style={{ background: 'var(--c-danger)', borderRadius: '50%' }} />Blocked rate</span>
          </div>
        </section>

        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Alert rules</h2>
            <span className={`alert-count${firing ? '' : ' quiet'}`}>{firing}</span>
          </div>
          <p className="dcard-sub">The conditions the Dashboard raises alerts on.</p>
          {shown.length === 0 ? (
            <p className="db-empty">Nothing is firing.</p>
          ) : (
            <div className="rule-list">
              {shown.map((r) => (
                <div key={r.sev} className={`rule rule-${r.tone}`}>
                  <span className={`alert-sev tone-${r.tone === 'green' ? 'navy' : r.tone}`}>{r.sev}</span>
                  <span className="rule-body">
                    <span className="rule-name">{r.name}</span>
                    <span className="rule-cond">{r.cond}</span>
                  </span>
                  <span className={`vchip vchip-${r.tone === 'green' ? 'green' : r.tone}`}>{r.state}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
