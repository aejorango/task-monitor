// src/components/TimesheetView.jsx — Reports → Timesheet.
//
// People down the side, days across the top, totals on both edges. The hours
// were always there, one activity at a time; this is the shape somebody can
// actually file, review or pay against.

import { useMemo, useState } from 'react';
import { useAllActivities, useProjects, useTasks } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { useSettings } from '../hooks/useSettings';
import { todayLocal } from '../services/firebase';
import {
  buildTimesheet, buildTimesheetDocument, dayHeading, shiftWeek, timesheetFileBase,
  weekDays, weekLabel,
} from '../services/timesheet';
import ExportButton from './ExportButton';
import { formatHours, formatVariance, totalVariance } from '../services/effort';
import { PageActions, PageSubtitle } from './PageHeader';

export default function TimesheetView({ projectFilter = 'all' }) {
  const { activities, loading } = useAllActivities();
  const { tasks } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { settings } = useSettings();
  const workspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();

  const memberProfiles = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.memberProfiles || {},
    [workspaces, workspaceId],
  );

  const [anchor, setAnchor] = useState(() => todayLocal());
  const [project, setProject] = useState(projectFilter);

  const weekStart = settings.weekStart ?? 1;
  const days = useMemo(() => weekDays(anchor, weekStart), [anchor, weekStart]);

  const sheet = useMemo(
    () => buildTimesheet(activities, {
      days, memberProfiles, projectById, projectFilter: project,
    }),
    [activities, days, memberProfiles, projectById, project],
  );

  // What the week's work was supposed to cost. Per PERSON there is no estimate
  // — estimates live on tasks — so this is a band over the sheet rather than a
  // column in it: inventing a per-person estimate would be a made-up number
  // (T-0137). Scoped to the tasks the filter is showing, and to the tasks
  // actually touched this week, so it answers "this week", not "ever".
  const touched = useMemo(() => {
    const ids = new Set(
      activities
        .filter((a) => days.includes(a.date) && (project === 'all' || a.projectId === project))
        .map((a) => a.taskId),
    );
    return tasks.filter((t) => ids.has(t.id));
  }, [activities, tasks, days, project]);
  const effort = useMemo(() => totalVariance(touched), [touched]);

  const projectName = project === 'all' ? 'All projects' : (projectById[project]?.name || 'Project');
  const isThisWeek = days.includes(todayLocal());

  if (loading) return <p className="muted">Loading hours…</p>;

  return (
    <>
      <PageSubtitle>Hours logged per person, per day{projectName ? ` · ${projectName}` : ''}</PageSubtitle>
      <PageActions>
        <ExportButton
          build={() => buildTimesheetDocument(sheet, { projectName })}
          baseName={timesheetFileBase(days)}
          kind="table"
          className="cmd"
          title="Save this timesheet as a spreadsheet, CSV or PDF"
        />
      </PageActions>

      <div className="ts-toolbar">
        <button className="btn btn-sm" onClick={() => setAnchor((d) => shiftWeek(d, -1, weekStart))}>
          ← Previous week
        </button>
        <strong className="ts-week">{weekLabel(days)}</strong>
        <button className="btn btn-sm" onClick={() => setAnchor((d) => shiftWeek(d, 1, weekStart))}>
          Next week →
        </button>
        {!isThisWeek && (
          <button className="btn btn-sm btn-ghost" onClick={() => setAnchor(todayLocal())}>
            This week
          </button>
        )}

        <span style={{ flex: 1 }} />

        <span className="muted small">Project</span>
        <select className="select select-sm" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {effort.estimated > 0 && (
        <div className={`ts-effort is-${effort.state}`}>
          <span className="ts-effort-label">Against estimate</span>
          <span className="ts-effort-fig">
            <strong>{formatHours(effort.logged)}</strong> logged on {touched.length} task{touched.length === 1 ? '' : 's'}
            {' · '}{formatHours(effort.estimate)} estimated
          </span>
          <span className="ts-effort-var">{formatVariance(effort)}</span>
          {effort.unestimated > 0 && (
            <span className="muted small">
              {effort.unestimated} of them {effort.unestimated === 1 ? 'has' : 'have'} no estimate
            </span>
          )}
        </div>
      )}

      {sheet.rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⏱</div>
          <p>No hours logged this week{project !== 'all' ? ` on ${projectName}` : ''}.</p>
          <p className="small">Log time from a task and it appears here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table ts-table">
            <thead>
              <tr>
                <th>Person</th>
                {days.map((d) => (
                  <th key={d} className={`num ${d === todayLocal() ? 'ts-today' : ''}`}>{dayHeading(d)}</th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr key={row.userId}>
                  <td>{row.name}</td>
                  {days.map((d) => (
                    <td key={d} className={`num ${row.byDay[d] ? '' : 'ts-zero'}`}>
                      {row.byDay[d] ? row.byDay[d] : '—'}
                    </td>
                  ))}
                  <td className="num"><strong>{row.total}</strong></td>
                </tr>
              ))}
              <tr className="ts-totals">
                <td><strong>All</strong></td>
                {days.map((d) => (
                  <td key={d} className="num"><strong>{sheet.dayTotals[d] || '—'}</strong></td>
                ))}
                <td className="num"><strong>{sheet.grandTotal}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {sheet.projectTotals.length > 0 && (
        <section className="review-section" style={{ marginTop: 20 }}>
          <h2 className="review-h2">Where the hours went</h2>
          <ul className="dep-list">
            {sheet.projectTotals.map((p) => (
              <li key={p.id} className="dep-item" style={{ gridTemplateColumns: '1fr auto auto' }}>
                <span className="dep-title">{p.name}</span>
                <span className="muted small">
                  {sheet.grandTotal ? `${Math.round((p.hours / sheet.grandTotal) * 100)}%` : '0%'}
                </span>
                <strong>{p.hours}h</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
