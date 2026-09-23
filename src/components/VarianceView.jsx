// src/components/VarianceView.jsx — Reports → Variance (T-0144, Report Explorer).
//
// One diverging bar per task: estimate on the left of the centre line, overrun
// on the right. Worst first.
//
// The arithmetic is `services/effort.js` and nothing else, so this page, the
// Summary tab's "By project" table and the task table's Variance column can
// never disagree. In particular a task nobody estimated is NOT a task that was
// estimated at zero — it is excluded, and the count of excluded ones is said
// out loud underneath, because a variance chart drawn over half the work while
// claiming to cover all of it is worse than no chart.

import { useMemo, useState } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { estimateOf, loggedOf, variance, formatHours, totalVariance } from '../services/effort';
import { PageActions, PageSubtitle } from './PageHeader';
import ExportButton from './ExportButton';
import { heading, paragraph, table } from '../services/exporters';

const SCOPES = [
  { id: 'over',  label: 'Over plan' },
  { id: 'under', label: 'Under plan' },
  { id: 'all',   label: 'Everything' },
];

export default function VarianceView({ projectFilter = 'all' }) {
  const { tasks, loading } = useTasks();
  const { byId: projectById } = useProjects();
  const [scope, setScope] = useState('all');

  const scoped = useMemo(
    () => tasks.filter((t) => !t.deleted && !t.archived
      && (projectFilter === 'all' || t.projectId === projectFilter)),
    [tasks, projectFilter],
  );

  const { rows, unestimated, totals } = useMemo(() => {
    const estimated = scoped.filter((t) => estimateOf(t) !== null);
    const all = estimated
      .map((t) => {
        const v = variance(t);
        return {
          task: t,
          delta: v.delta,
          state: v.state,
          project: projectById[t.projectId] || null,
          detail: `${formatHours(loggedOf(t))} / ${formatHours(estimateOf(t))}`,
        };
      })
      // Worst first, in both directions: a task 40h over and a task 40h under
      // are both worth a conversation, and sorting by signed delta would bury
      // one of them at the bottom.
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const picked = scope === 'all' ? all : all.filter((r) => r.state === scope);
    return {
      rows: picked.slice(0, 25),
      unestimated: scoped.length - estimated.length,
      totals: totalVariance(scoped),
    };
  }, [scoped, projectById, scope]);

  // Both arms are measured against the SAME widest bar, so a 40h overrun and a
  // 40h saving are the same length. Scaling each side to its own maximum would
  // make a small saving look like a large one.
  const widest = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));

  const buildExport = () => ({
    title: 'Plan vs actual',
    blocks: [
      heading('Plan vs actual', 1),
      paragraph(`${rows.length} estimated task${rows.length === 1 ? '' : 's'}`
        + (unestimated ? ` · ${unestimated} not estimated and excluded` : '')),
      table(
        ['Task', 'Project', 'Estimate', 'Logged', 'Variance'],
        rows.map((r) => [
          r.task.title,
          r.project?.name || '—',
          formatHours(estimateOf(r.task)),
          formatHours(loggedOf(r.task)),
          `${r.delta > 0 ? '+' : ''}${formatHours(r.delta)}`,
        ]),
      ),
    ],
  });

  if (loading) return <p className="muted">Loading variance…</p>;

  return (
    <>
      <PageSubtitle>
        {totals.estimated} estimated · {formatHours(totals.estimate)} planned against {formatHours(totals.logged)} logged
      </PageSubtitle>
      <PageActions>
        <ExportButton build={buildExport} baseName="variance" kind="table" className="cmd"
          title="Save this as a spreadsheet, CSV or PDF" />
      </PageActions>

      <div className="period-bar">
        {SCOPES.map((sc) => (
          <button
            key={sc.id}
            className={`pill${scope === sc.id ? ' active' : ''}`}
            aria-pressed={scope === sc.id}
            onClick={() => setScope(sc.id)}
          >{sc.label}</button>
        ))}
        <span className="period-note">
          {totals.state === 'none'
            ? 'nothing estimated yet'
            : `${totals.delta > 0 ? '+' : ''}${formatHours(totals.delta)} ${totals.delta > 0 ? 'over' : 'under'} plan overall`}
        </span>
      </div>

      <section className="dcard">
        <div className="dcard-head">
          <h2 className="dcard-title">Plan vs. actual</h2>
          {totals.state !== 'none' && (
            <span className={`vchip vchip-${totals.delta > 0 ? 'red' : totals.delta < 0 ? 'green' : 'navy'}`}>
              {totals.delta > 0 ? '+' : ''}{formatHours(totals.delta)} {totals.delta > 0 ? 'over' : 'under'} plan
            </span>
          )}
        </div>
        <p className="dcard-sub">Variance per item, worst first.</p>

        {rows.length === 0 ? (
          <p className="db-empty">
            {unestimated > 0
              ? 'Nothing here has an estimate yet. Set one on a task and it appears.'
              : 'No tasks match this filter.'}
          </p>
        ) : (
          <div className="var-list">
            {rows.map((r) => {
              const over = r.delta > 0;
              const w = (Math.abs(r.delta) / widest) * 48;   // 48% of half the track
              return (
                <div key={r.task.id} className="var-row">
                  <span className="var-title" title={r.project ? `${r.task.title} · ${r.project.name}` : r.task.title}>
                    {r.task.title}
                  </span>
                  <span className="var-track">
                    <span className="var-zero" aria-hidden="true" />
                    <span
                      className={`var-bar ${over ? 'over' : 'under'}`}
                      style={{ left: over ? '50%' : `${50 - w}%`, width: `${w}%` }}
                    />
                  </span>
                  <span className={`vchip vchip-${over ? 'red' : r.delta < 0 ? 'green' : 'navy'} var-val`}>
                    {over ? '+' : ''}{formatHours(r.delta)}
                  </span>
                  <span className="var-detail">{r.detail}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="var-key">
          <span className="ptable-key-item tone-ink-red"><span className="var-swatch over" />Over plan</span>
          <span className="ptable-key-item tone-ink-green"><span className="var-swatch under" />Under plan</span>
          <span className="ptable-key-item"><span className="ptable-key-notch" />On plan</span>
          {unestimated > 0 && (
            <span className="var-caveat">
              {unestimated} task{unestimated === 1 ? '' : 's'} not estimated — excluded, not counted as zero
            </span>
          )}
        </div>
      </section>
    </>
  );
}
