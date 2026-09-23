// src/components/LibraryView.jsx — Reports → Library (T-0144, Report Explorer).
//
// The reports you can produce, in one place: the arrangements you saved
// yourself, and the standing ones this app knows how to build.
//
// The mockup shows a Cadence column — "Mon 08:00", "1st of month" — and a
// Recipients column, and this page does NOT have them. Scheduling a report and
// emailing it needs a backend and SMTP, and both are explicitly out of scope
// (see CLAUDE.md). A card that said "Mon 08:00" would be a promise the app
// cannot keep, which is the same mistake as the approval email. So each card
// says what it covers and gives you Run and Export instead, and the page says
// once, at the bottom, that nothing here sends itself.

import { useMemo } from 'react';
import { useTasks, useProjects, useAllActivities, useSavedViews } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { softDeleteSavedView } from '../services/firebase';
import { buildStatusReport, statusReportFileBase } from '../services/statusReport';
import { buildDigest } from '../services/askAiCore';
import { buildActivityLogDocument } from '../services/activityExport';
import { buildTaskListDocument } from '../services/taskExport';
import { RENDERABLE_VIEWS } from '../services/views';
import { PageActions, PageSubtitle } from './PageHeader';
import ExportButton from './ExportButton';
import Icon from './Icon';
import { useDialog } from './Dialog';
import { useToast } from './Toast';
import { friendlyError } from '../services/access';
import { activateProps } from '../hooks/useActivate';

const VIEW_LABEL = Object.fromEntries(RENDERABLE_VIEWS.map((v) => [v.id, v.label]));

export default function LibraryView({ navigate }) {
  const { tasks, loading: tLoading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities } = useAllActivities();
  const { views, loading: vLoading } = useSavedViews();
  const { workspaces } = useWorkspaces();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);
  const ask = useDialog();
  const toast = useToast();

  const taskById = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, t])),
    [tasks],
  );

  // The standing reports. Each one is a `build()` the export module already
  // knows how to render into any of the seven formats — this page is a shelf,
  // not a second export path.
  const standing = useMemo(() => [
    {
      id: 'status',
      icon: '▤',
      name: 'Delivery status report',
      what: 'Where every project stands, what is overdue, what is blocked',
      covers: `${projects.length} project${projects.length === 1 ? '' : 's'} · ${tasks.length} tasks`,
      kind: 'document',
      baseName: statusReportFileBase(workspace?.name),
      build: () => buildStatusReport(
        buildDigest({
          tasks, projects, activities, workspaces,
          memberProfiles: workspace?.memberProfiles || {},
          activeWorkspaceId: activeWsId,
        }),
        {
          workspaceName: workspace?.name,
          periodLabel: new Date().toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' }),
        },
      ),
      go: 'review',
    },
    {
      id: 'tasks',
      icon: '◈',
      name: 'Task list',
      what: 'Every open and closed task with dates, owner and estimate',
      covers: `${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
      kind: 'table',
      baseName: 'tasks',
      build: () => buildTaskListDocument(tasks, { projectById, title: 'Task list' }),
      go: 'tasks-table',
    },
    {
      id: 'activity',
      icon: '☰',
      name: 'Activity log',
      what: 'Every logged entry with hours, status and remarks',
      covers: `${activities.length} entr${activities.length === 1 ? 'y' : 'ies'}`,
      kind: 'table',
      baseName: 'activity-log',
      build: () => buildActivityLogDocument(activities, { projectById, taskById }),
      go: 'table',
    },
  ], [tasks, projects, activities, workspaces, workspace, activeWsId, projectById, taskById]);

  const openSaved = (v) => navigate?.({
    view: v.view,
    projectFilter: v.projectFilter || 'all',
    tagFilter: v.tagFilter || null,
    statusFilter: v.statusFilter || null,
    savedViewId: v.id,
  });

  const removeSaved = async (v) => {
    if (!await ask.confirm({
      title: `Remove "${v.name}" from the library?`,
      message: 'The report itself is not deleted — only this saved arrangement of it.',
      confirmLabel: 'Remove',
      danger: true,
    })) return;
    try {
      await softDeleteSavedView(v.id);
      toast.success(`Removed "${v.name}".`);
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not remove that saved report. Please try again.'));
    }
  };

  if (tLoading || vLoading) return <p className="muted">Loading the library…</p>;

  return (
    <>
      <PageSubtitle>
        {standing.length} standing · {views.length} saved by you
      </PageSubtitle>
      <PageActions>
        <button className="cmd cmd-primary" onClick={() => navigate?.({ view: 'tasks-table' })}>
          <span className="cmd-icon"><Icon name="plus" size={14} /></span>Build a report
        </button>
      </PageActions>

      <div className="lib-label">Standing reports</div>
      <div className="lib-grid">
        {standing.map((r) => (
          <div key={r.id} className="lib-card lib-card-green">
            <div className="lib-head">
              <span className="lib-icon lib-icon-green" aria-hidden="true">{r.icon}</span>
              <span className="lib-name">{r.name}</span>
              <span className="vchip vchip-green">Ready</span>
            </div>
            <p className="lib-what">{r.what}</p>
            <div className="lib-meta">
              <div>
                <div className="lib-meta-label">Covers</div>
                <div className="lib-meta-value">{r.covers}</div>
              </div>
              <div>
                <div className="lib-meta-label">Formats</div>
                <div className="lib-meta-value">{r.kind === 'table' ? 'Excel · CSV · PDF' : 'Word · PDF · Web'}</div>
              </div>
            </div>
            <div className="lib-foot">
              <span className="lib-last">Built when you ask for it</span>
              <span className="lib-actions">
                <button className="lib-btn" onClick={() => navigate?.({ view: r.go })}>Open</button>
                <ExportButton
                  build={r.build}
                  baseName={r.baseName}
                  kind={r.kind}
                  label="Export"
                  className="lib-btn"
                  title={`Save ${r.name} as a file`}
                />
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="lib-label">Saved by you</div>
      {views.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">★</div>
          <p>No saved reports yet.</p>
          <p className="small">
            Arrange the Task table how you want it — columns, grouping, sorting — then
            press <strong>Save as view</strong>. It appears here and in the topbar menu.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate?.({ view: 'tasks-table' })}>
            Open the Task table
          </button>
        </div>
      ) : (
        <div className="lib-grid">
          {views.map((v) => {
            const filters = [
              v.projectFilter && v.projectFilter !== 'all' ? projectById[v.projectFilter]?.name : null,
              v.tagFilter ? `#${v.tagFilter}` : null,
              v.statusFilter || null,
            ].filter(Boolean);
            return (
              <div key={v.id} className="lib-card lib-card-amber">
                <div className="lib-head">
                  <span className="lib-icon lib-icon-amber" aria-hidden="true">{v.icon || '★'}</span>
                  <span className="lib-name">{v.name}</span>
                  <span className="vchip vchip-navy">Saved</span>
                </div>
                <p className="lib-what">
                  {VIEW_LABEL[v.view] || v.view}
                  {v.columns?.length ? ` · ${v.columns.length} columns` : ''}
                  {v.groupBy && v.groupBy !== 'none' ? ` · grouped by ${v.groupBy}` : ''}
                </p>
                <div className="lib-meta">
                  <div>
                    <div className="lib-meta-label">Page</div>
                    <div className="lib-meta-value">{VIEW_LABEL[v.view] || v.view}</div>
                  </div>
                  <div>
                    <div className="lib-meta-label">Filters</div>
                    <div className="lib-meta-value">{filters.length ? filters.join(' · ') : 'none'}</div>
                  </div>
                </div>
                <div className="lib-foot">
                  <span className="lib-last">Yours · on this workspace</span>
                  <span className="lib-actions">
                    <button className="lib-btn" onClick={() => openSaved(v)}>Run</button>
                    <span
                      className="lib-btn lib-btn-danger"
                      {...activateProps(() => removeSaved(v), { label: `Remove saved report ${v.name}` })}
                    >Remove</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="lib-note">
        Nothing here sends itself. Task Monitor has no mail server, so a report
        arrives when somebody opens it or exports it — there is no schedule and
        no recipient list to fill in.
      </p>
    </>
  );
}
