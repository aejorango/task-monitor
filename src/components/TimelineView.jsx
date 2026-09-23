// src/components/TimelineView.jsx — Projects → Timeline, built to
// `Projects Explorer.dc.html` (T-0153).
//
// One row per PROJECT: its span as a tinted bar filled by completion, a red
// Today line down the whole chart, and a diamond at the end of each phase.
// The Board's Gantt is one row per TASK; this is not that chart zoomed out,
// it is the question "when is each project, against now".
//
// The arithmetic is the pure `services/projectTimeline.js`; this file decides
// only what it looks like.

import { useMemo, useState } from 'react';
import { useTasks, useProjects } from '../hooks/useTasks';
import { todayLocal } from '../services/firebase';
import { rateProjects } from '../services/portfolio';
import { PageActions, PageSubtitle } from './PageHeader';
import {
  UNITS, barOf, pctOf, phaseMarksOf, rulerColumns, spanOfProject, timelineRange,
} from '../services/projectTimeline';

const RAG_TONE = { RED: 'red', AMBER: 'amber', GREEN: 'green', IDLE: 'navy' };

export default function TimelineView({ projectFilter = 'all', navigate }) {
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, loading: projectsLoading } = useProjects();
  const [unit, setUnit] = useState('month');
  const today = todayLocal();

  const rows = useMemo(() => {
    const live = projects.filter((p) => !p.deleted && !p.archived
      && (projectFilter === 'all' || p.id === projectFilter));
    const rated = rateProjects(live, tasks, today);
    return rated.map((h) => {
      const own = tasks.filter((t) => t.projectId === h.project.id && !t.deleted);
      return { health: h, project: h.project, tasks: own, span: spanOfProject(own) };
    });
  }, [projects, tasks, projectFilter, today]);

  const range = useMemo(
    () => timelineRange(rows.map((r) => r.span), today),
    [rows, today],
  );

  if (tasksLoading || projectsLoading) return <p className="muted">Loading the timeline…</p>;

  const columns = rulerColumns(range, unit);
  const todayAt = pctOf(today, range);
  const undated = rows.filter((r) => !r.span).length;

  return (
    <>
      <PageSubtitle>
        {rows.length} project{rows.length === 1 ? '' : 's'}
        {undated > 0 && <> · <strong>{undated}</strong> with no dates yet</>}
      </PageSubtitle>
      <PageActions>
        {/* The mockup's Quarter / Month pair. It changes the RULER, not the
            window: the window is always every project's own extent, because a
            timeline that crops a project is worse than one that is dense. */}
        <span className="seg" role="group" aria-label="Ruler">
          {UNITS.map((u) => (
            <button
              key={u.id}
              className={`seg-btn${unit === u.id ? ' is-on' : ''}`}
              aria-pressed={unit === u.id}
              onClick={() => setUnit(u.id)}
            >{u.label}</button>
          ))}
        </span>
      </PageActions>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▤</div>
          <p>No projects to place on a timeline yet.</p>
          <p className="small">Create one in Projects → Portfolio.</p>
        </div>
      ) : (
        <div className="ptl">
          <div className="ptl-head">
            <span className="bx-h">Timeline</span>
            <span className="bx-note">
              {range ? `${range.start} → ${range.end}` : 'no dates'}
            </span>
          </div>

          {/* the ruler */}
          <div className="ptl-ruler">
            <div className="ptl-gutter" />
            <div className="ptl-cols" style={{ '--ptl-n': columns.length }}>
              {columns.map((c) => <span key={c.key} className="ptl-col">{c.label}</span>)}
            </div>
          </div>

          {rows.map((r, i) => {
            const bar = barOf(r.span, range);
            const tone = RAG_TONE[r.health.rag] || 'navy';
            const colour = r.project.color || 'var(--c-text-3)';
            const marks = phaseMarksOf(r.project, r.tasks, range);
            return (
              <button
                type="button"
                key={r.project.id}
                className={`ptl-row${i % 2 ? ' alt' : ''}`}
                onClick={() => navigate?.({ view: 'projects', projectFilter: r.project.id })}
                title={`${r.project.name} — ${r.span ? `${r.span.start} → ${r.span.end}` : 'no dates'}`}
              >
                <span className="ptl-label">
                  <span className="ptl-dot" style={{ background: colour }} />
                  <span className="ptl-name">{r.project.name}</span>
                </span>
                <span className="ptl-track">
                  {todayAt != null && (
                    <span className="ptl-today" style={{ left: `${todayAt}%` }} aria-hidden="true" />
                  )}
                  {bar ? (
                    <>
                      <span
                        className="ptl-bar"
                        style={{
                          left: `${bar.left}%`,
                          width: `${bar.width}%`,
                          background: `color-mix(in srgb, ${colour} 14%, transparent)`,
                          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${colour} 32%, transparent)`,
                        }}
                      >
                        <span
                          className="ptl-fill"
                          style={{ width: `${r.health.pct ?? 0}%`, background: colour }}
                        />
                        <span className={`ptl-pct tone-ink-${tone}`}>{r.health.pct ?? 0}%</span>
                      </span>
                      {/* A diamond where a phase finishes. The mockup calls it
                          a milestone; this app has no such field, so it marks
                          the last dated task in each phase — a real date. */}
                      {marks.map((m) => (
                        <span
                          key={m.id}
                          className="ptl-mark"
                          style={{ left: `${m.at}%` }}
                          title={`${m.name} ends ${m.date}`}
                        >◆</span>
                      ))}
                    </>
                  ) : (
                    <span className="ptl-nodate">nothing in this project has a date yet</span>
                  )}
                </span>
              </button>
            );
          })}

          <div className="ptl-legend">
            <span><span className="ptl-key-bar" />Planned span, filled by completion</span>
            <span><span className="ptl-key-today" />Today</span>
            <span className="ptl-key-ms">◆ Phase end</span>
          </div>
        </div>
      )}
    </>
  );
}
