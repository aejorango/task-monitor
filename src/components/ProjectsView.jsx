// src/components/ProjectsView.jsx — list, create, edit projects + phases.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useProjects, useTasks, useAuth, useTemplates, useAllActivities, useGoals } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import {
  addProject,
  updateProject,
  archiveProject,
  duplicateProject,
  undoDuplicateProject,
  softDeleteProject,
  restoreDeleted,
  uid,
  addTemplate,
  softDeleteTemplate,
  projectAsTemplatePayload,
  setProjectMember,
  createInvite,
  revokeInvite,
  subscribeToInvitesForProject,
  auth,
  addSegmentToWorkspace,
  updateSegmentInWorkspace,
  deleteSegmentFromWorkspace,
  todayLocal,
} from '../services/firebase';
import { canAdministerProject, friendlyError } from '../services/access';
import AiTaskGenerator from './AiTaskGenerator';
import { MarkdownEditor } from './Markdown';
import ActivityEditor from './ActivityEditor';
import AssigneePicker from './AssigneePicker';
import WbsModal from './WbsModal';
import ActivityTimeline, { fmtDay } from './ActivityTimeline';
import {
  DEFAULT_AGEING_DAYS, WIP_STATUSES, normalizeLimit, normalizeLimits,
} from '../services/wipLimits';

// The board's own column names, so the editor and the board cannot disagree
// about what "In Progress" is called.
const WIP_LABEL = { todo: 'To Do', doing: 'In Progress', review: 'In Review', done: 'Done' };
import NotebookPicker from './NotebookPicker';
import TemplateGallery from './TemplateGallery';
import ShareLinksPanel from './ShareLinksPanel';
import { useToast } from './Toast';
import { describeDuplicate, duplicateProjectPlan } from '../services/duplicate';
import ProjectAskPanel from './ProjectAskPanel';
import ExportButton from './ExportButton';
import { buildActivityLogDocument, buildWbsDocument } from '../services/activityExport';
import { useQuickCreate, newSeed, useSeededField } from '../hooks/useQuickCreate';
import { GROUP_ICONS, iconFor, normalizeIcon, suggestIcon } from '../services/icons';
import { useDialog } from './Dialog';
import { useModalDialog } from '../hooks/useModalDialog';
import Icon from './Icon';
import { PageActions, PageSubtitle } from './PageHeader';
import { Tile } from './DashboardView';
import { rateProjects, RAG_MEANING } from '../services/portfolio';
import { addDaysISO } from '../services/dueAlerts';
import { activateProps } from '../hooks/useActivate';

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#3b82f6'];

/**
 * The health bands the table groups by, worst first. The words are the
 * mockup's — "At risk", "Needs attention", "On track" — and each is tied to
 * one RAG letter from services/portfolio.js, so the heading somebody reads and
 * the badge on the row beneath it can never mean different things.
 */
const HEALTH_BANDS = [
  { key: 'red',   rag: 'RED',   label: 'At risk',         tone: 'red' },
  { key: 'amber', rag: 'AMBER', label: 'Needs attention', tone: 'amber' },
  { key: 'green', rag: 'GREEN', label: 'On track',        tone: 'green' },
  { key: 'idle',  rag: 'IDLE',  label: 'Nothing scheduled', tone: 'navy' },
];
const RAG_LABEL = { RED: 'Red', AMBER: 'Amber', GREEN: 'Green', IDLE: 'Idle' };

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/** "Jun 15" — month-first, matching fmtDay and the board's due chips. */
function shortDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/** A stable colour per person, so the same face is the same colour everywhere. */
function avatarColorFor(uid) {
  const palette = ['#0051BA', '#e2892e', '#7B2D8F', '#1DA449', '#1D7CC7', '#c0392b'];
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

function nameFor(profile, uid) {
  return profile?.displayName || profile?.email || `Member ${String(uid).slice(0, 4)}`;
}

function initialsFor(profile, uid) {
  const parts = String(nameFor(profile, uid)).trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(parts[0] || '?').slice(0, 2).toUpperCase();
}

export default function ProjectsView() {
  const { userId } = useAuth();
  const { projects, loading } = useProjects();
  const { tasks } = useTasks();
  const { activities } = useAllActivities();
  const { templates } = useTemplates();
  const { workspaces } = useWorkspaces();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);
  const projectTemplates = templates.filter((t) => t.kind === 'project');
  const taskTemplates    = templates.filter((t) => t.kind === 'task');
  const [editing, setEditing] = useState(null);          // project or 'new'

  const [galleryOpen, setGalleryOpen] = useState(false);

  // ⌘K → "New project": open the editor with what they typed.
  // ⌘K → "new project Website revamp" shows that name in its hint, so the
  // editor has to open with it already typed (BUG-017).
  const [nameSeed, setNameSeed] = useState(null);
  useQuickCreate('project', useCallback((text) => {
    setNameSeed(text ? newSeed(text) : null);
    setEditing('new');
  }, []));

  // ⌘K → "Duplicate <project>" opens that project's editor, where the Duplicate
  // button says what is about to be copied before anything is written (T-0139).
  useQuickCreate('duplicate-project', useCallback((projectId) => {
    if (projectId) setEditing(projectId);
  }, []));
  const [createFromTemplate, setCreateFromTemplate] = useState(null);
  const [aiFor, setAiFor] = useState(null);              // project to generate tasks for
  const [activityLogFor, setActivityLogFor] = useState(null); // project for activity log modal
  const [wbsFor, setWbsFor] = useState(null);                // project for WBS modal
  const [managingSegments, setManagingSegments] = useState(false);

  const stats = (projectId) => {
    const t = tasks.filter((x) => x.projectId === projectId);
    const a = activities.filter((x) => x.projectId === projectId);
    return {
      total: t.length,
      done:  t.filter((x) => x.status === 'done').length,
      activities: a.length,
    };
  };

  // Group projects by segment (union of workspace segments + project segments for backward compatibility)
  const segments = useMemo(() => {
    const grouped = {};

    // First, add all workspace-defined segments (even if empty)
    const wsSegments = workspace?.segments || [];
    wsSegments.forEach((seg) => {
      grouped[seg.name] = [];
    });

    // Add Uncategorized if not present
    if (!grouped['Uncategorized']) {
      grouped['Uncategorized'] = [];
    }

    // Now add projects to their segments. Archived ones are deliberately left
    // out: they used to sit in the grid behind a small badge, which made a
    // finished project look like a live one at a glance. They get their own
    // section at the foot of the page instead (T-0143, Projects Explorer).
    projects.filter((p) => !p.archived).forEach((p) => {
      const seg = p.segment || 'Uncategorized';
      if (!grouped[seg]) grouped[seg] = [];
      grouped[seg].push(p);
    });

    // Sort segments: Uncategorized last, others alphabetically
    const keys = Object.keys(grouped).sort((a, b) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
    const sorted = {};
    keys.forEach((k) => { sorted[k] = grouped[k]; });
    return sorted;
  }, [projects, workspace?.segments]);

  const archivedProjects = useMemo(
    () => projects.filter((p) => p.archived && !p.deleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [projects],
  );

  // ───── The portfolio table ─────────────────────────────────────────────
  // Segment by default (T-0153): health is a derived judgement that changes
  // week to week, while a segment is what somebody decided this project IS.
  // Opening on the stable grouping means the page looks the same tomorrow.
  const [groupMode, setGroupMode] = useState('segment');  // 'segment' | 'health'
  const [closedGroups, setClosedGroups] = useState({});

  const memberProfiles = workspace?.memberProfiles || {};

  const portfolioRows = useMemo(() => {
    const rated = rateProjects(projects, tasks, todayLocal());
    return rated.map((h) => {
      const own = tasks.filter((t) => t.projectId === h.project.id && !t.deleted);
      // Who is on it: everybody assigned to one of its tasks, most-assigned
      // first, so the avatars are the people you would actually ask about it.
      const load = new Map();
      own.forEach((t) => (t.assignedTo || []).forEach((uid) => load.set(uid, (load.get(uid) || 0) + 1)));
      const people = [...load.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([uid]) => ({ uid, name: nameFor(memberProfiles[uid], uid), initials: initialsFor(memberProfiles[uid], uid) }));
      const hours = activities
        .filter((a) => a.projectId === h.project.id)
        .reduce((n, a) => n + (a.hoursSpent || 0), 0);
      return {
        ...h,
        meta: `${plural(own.length, 'item', 'items')}${h.project.segment ? ` · ${h.project.segment}` : ''}`,
        ragLabel: RAG_LABEL[h.rag],
        team: people.slice(0, 3),
        moreTeam: Math.max(0, people.length - 3),
        timeline: h.start && h.end ? `${shortDate(h.start)} – ${shortDate(h.end)}` : 'no dates',
        hours: hours > 0 ? `${Math.round(hours)}h` : '—',
      };
    });
  }, [projects, tasks, activities, memberProfiles]);

  const portfolioGroups = useMemo(() => {
    if (groupMode === 'segment') {
      const by = new Map();
      portfolioRows.forEach((r) => {
        const key = r.project.segment || 'Uncategorized';
        if (!by.has(key)) by.set(key, []);
        by.get(key).push(r);
      });
      return [...by.entries()]
        .sort((a, b) => (a[0] === 'Uncategorized' ? 1 : b[0] === 'Uncategorized' ? -1 : a[0].localeCompare(b[0])))
        .map(([key, rows]) => ({ key, label: key, tone: 'navy', rows }));
    }
    // Worst band first. A band with nothing in it is left out rather than
    // drawn empty — "At risk (0)" is a heading that makes you look twice.
    return HEALTH_BANDS
      .map((b) => ({ ...b, rows: portfolioRows.filter((r) => r.rag === b.rag) }))
      .filter((b) => b.rows.length > 0);
  }, [portfolioRows, groupMode]);

  // The four tiles above the grid, on exactly the rating services/portfolio.js
  // gives the Dashboard and the Portfolio page — one definition of amber for
  // the whole app, so three screens cannot disagree about the same project.
  const health = useMemo(() => {
    const rated = rateProjects(projects, tasks, todayLocal());
    const archived = projects.filter((p) => p.archived && !p.deleted).length;
    const soon = addDaysISO(todayLocal(), 14);
    return {
      active: rated.length,
      archived,
      red:   rated.filter((r) => r.rag === 'RED').length,
      green: rated.filter((r) => r.rag === 'GREEN').length,
      dueSoon: rated.filter((r) => r.end && r.end >= todayLocal() && r.end <= soon).length,
      // An unrated project counts as 0%, not as "excluded" — a portfolio
      // average that quietly skips the empty projects flatters itself.
      avgPct: rated.length ? Math.round(rated.reduce((n, r) => n + r.pct, 0) / rated.length) : 0,
      worst: rated.find((r) => r.rag === 'RED') || null,
      subtitle: `${rated.length} active${archived ? ` · ${archived} archived` : ''}`,
    };
  }, [projects, tasks]);

  if (loading) return <p className="muted">Loading projects…</p>;

  return (
    <>
      {/* Title, count line and commands live on the page chrome now — the
          same three bands every page wears (T-0143). */}
      <PageSubtitle>{health.subtitle}</PageSubtitle>
      <PageActions>
        <button className="cmd" onClick={() => setManagingSegments(true)}>⚙ Segments</button>
        <button className="cmd" onClick={() => setGalleryOpen(true)}>◈ From a template</button>
        <button className="cmd cmd-primary" onClick={() => setEditing('new')} data-tutorial="new-project-btn">
          <span className="cmd-icon"><Icon name="plus" size={14} /></span>New project
        </button>
      </PageActions>

      {projects.length > 0 && (
        <div className="tiles">
          <Tile tone="navy"  label="Active"    value={health.active}
                sub={health.green ? `${health.green} on track` : 'none rated green yet'} />
          <Tile tone="red"   label="At risk"   value={health.red}
                sub={health.worst ? health.worst.project.name : 'nothing in the red'} />
          <Tile tone="amber" label="Due ≤ 14d" value={health.dueSoon}
                sub={health.dueSoon ? 'ending inside a fortnight' : 'nothing lands this fortnight'} />
          <Tile tone="green" label="Delivered" value={`${health.avgPct}%`} bar={health.avgPct}
                sub="average completion" />
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◉</div>
          <p>No projects yet.</p>
          <p className="small">
            Start from a ready-made process — client project, product launch, audit,
            event, new joiner — or build your own from scratch.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setGalleryOpen(true)}>
              ◈ Start from a template
            </button>
            <button className="btn" onClick={() => setEditing('new')}>
              Start from scratch
            </button>
          </div>
        </div>
      ) : (
        /* The portfolio table, from the Projects Explorer. It replaced a grid
           of cards that could show a name, a bar and three buttons: the table
           shows health, who is on it, the span it has to run in, and how far
           through that span today is — the four things somebody opening this
           page came to compare, side by side, which cards cannot do. */
        <div className="ptable">
          <div className="ptable-bar">
            <button className="pill pill-accent" onClick={() => setEditing('new')}>+ New project</button>
            <button
              className="pill"
              onClick={() => setGroupMode((m) => (m === 'health' ? 'segment' : 'health'))}
              title="Switch between grouping by health and by segment"
            >◫ Group: {groupMode === 'health' ? 'Health' : 'Segment'}</button>
            <button className="pill" onClick={() => setManagingSegments(true)}>⚙ Segments</button>
            <span className="ptable-count">{plural(portfolioRows.length, 'project', 'projects')} shown</span>
          </div>

          <div className="ptable-cols">
            <span>Project</span><span>Health</span><span>Team</span>
            <span>Timeline</span><span>Progress</span><span>Hours</span>
          </div>

          {portfolioGroups.map((g) => (
            <div key={g.key}>
              <div
                className="ptable-group"
                {...activateProps(() => setClosedGroups((c) => ({ ...c, [g.key]: !c[g.key] })))}
                aria-expanded={!closedGroups[g.key]}
              >
                <span className={`ptable-chev${closedGroups[g.key] ? '' : ' open'}`} aria-hidden="true">▸</span>
                <span className={`ptable-group-name tone-ink-${g.tone}`}>{g.label}</span>
                <span className="ptable-group-count">{g.rows.length}</span>
              </div>
              {!closedGroups[g.key] && g.rows.map((r, i) => (
                <div
                  key={r.project.id}
                  className={`ptable-row${i % 2 ? ' alt' : ''}`}
                  {...activateProps(() => setEditing(r.project))}
                >
                  <span className="ptable-rail" style={{ background: r.project.color }} aria-hidden="true" />
                  <span className="ptable-name-cell">
                    <span className="ptable-icon" style={{ background: r.project.color }} aria-hidden="true">
                      {iconFor(r.project) === '◆' && !r.project.icon ? suggestIcon(r.project.id) : iconFor(r.project)}
                    </span>
                    <span className="ptable-name-text">
                      <span className="ptable-name">{r.project.name}</span>
                      <span className="ptable-meta">{r.meta}</span>
                    </span>
                  </span>
                  <span className="ptable-cell">
                    <span className={`ragchip ragchip-${r.rag.toLowerCase()}`} title={RAG_MEANING[r.rag]}>{r.ragLabel}</span>
                  </span>
                  <span className="ptable-cell ptable-team">
                    {r.team.length === 0
                      ? <span className="ptable-none">—</span>
                      : r.team.map((m, k) => (
                          <span
                            key={m.uid}
                            className="ptable-av"
                            style={{ background: avatarColorFor(m.uid), marginLeft: k ? -6 : 0 }}
                            title={m.name}
                          >{m.initials}</span>
                        ))}
                    {r.moreTeam > 0 && <span className="ptable-more">+{r.moreTeam}</span>}
                  </span>
                  <span className="ptable-timeline">{r.timeline}</span>
                  <span className="ptable-cell ptable-prog">
                    <span className="ptable-track">
                      <span className="ptable-fill" style={{ width: `${r.pct}%`, background: r.project.color }} />
                      {/* Where today falls in the project's own span. The gap
                          between this notch and the end of the bar IS the
                          health rating, drawn — see services/portfolio.js. */}
                      {r.elapsed != null && (
                        <span className="ptable-notch" style={{ left: `${r.elapsed}%` }} title={`${r.elapsed}% of the schedule gone`} />
                      )}
                    </span>
                    <span className="ptable-pct">{r.pct}%</span>
                  </span>
                  <span className="ptable-hours">{r.hours}</span>
                </div>
              ))}
            </div>
          ))}

          <div className="ptable-key">
            <span className="ptable-key-item"><span className="ptable-key-notch" />today in the project's span</span>
            <span className="ptable-key-item"><span className="ragchip ragchip-red">Red</span>needs attention now</span>
            <span className="ptable-key-item"><span className="ragchip ragchip-amber">Amber</span>watch it</span>
            <span className="ptable-key-item"><span className="ragchip ragchip-green">Green</span>on track</span>
          </div>
        </div>
      )}

      {/* Archived — finished work, still readable, out of the way. Open it and
          the cards behave exactly as the live ones do, because an archived
          project is not a deleted one: that is what Trash is for. */}
      {archivedProjects.length > 0 && (
        <details className="archive-fold">
          <summary className="archive-fold-head">
            <span className="archive-fold-title">Archived</span>
            <span className="archive-fold-count">{archivedProjects.length}</span>
            <span className="muted small">out of the main grid, still open to read</span>
          </summary>
          <div className="projects-row">
            {archivedProjects.map((p) => {
              const s2 = stats(p.id);
              return (
                <div
                  key={p.id}
                  className="project-card is-archived"
                  style={{ '--project-color': p.color }}
                  onClick={() => setEditing(p)}
                >
                  <div className="project-card-head">
                    <span className="proj-icon" style={{ color: p.color }} aria-hidden="true">
                      {iconFor(p) === '◆' && !p.icon ? suggestIcon(p.id) : iconFor(p)}
                    </span>
                    <h3 className="project-name">{p.name}</h3>
                    <span className="badge badge-soft-muted" style={{ marginLeft: 'auto' }}>Archived</span>
                  </div>
                  <div className="project-stats">
                    <span>{s2.total} task{s2.total === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>{s2.done} done</span>
                    <span>·</span>
                    <span>{s2.activities} activit{s2.activities === 1 ? 'y' : 'ies'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      <section className="review-section" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <h2 className="review-h2" style={{ margin: 0 }}>Templates ({templates.length})</h2>
          <span className="muted small">
            Reusable starting points. Save tasks as templates from the task editor.
          </span>
        </div>
        {templates.length === 0 ? (
          <p className="muted small">No templates yet. In the task editor, click <strong>Save as template</strong> to add one.</p>
        ) : (
          <div className="template-grid">
            {projectTemplates.length > 0 && (
              <>
                <div className="template-section-label">Project templates</div>
                {projectTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    onUse={() => setCreateFromTemplate(tpl)}
                  />
                ))}
              </>
            )}
            {taskTemplates.length > 0 && (
              <>
                <div className="template-section-label">Task templates</div>
                {taskTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    note="Use from the Board → Quick-add → + From template"
                  />
                ))}
              </>
            )}
          </div>
        )}
      </section>

      {editing && (
        <ProjectEditor
          project={editing === 'new' ? null : editing}
          userId={userId}
          workspace={workspace}
          nameSeed={editing === 'new' ? nameSeed : null}
          onClose={() => { setEditing(null); setNameSeed(null); }}
        />
      )}

      {galleryOpen && <TemplateGallery onClose={() => setGalleryOpen(false)} />}

      {createFromTemplate && (
        <ProjectEditor
          project={null}
          userId={userId}
          workspace={workspace}
          fromTemplate={createFromTemplate}
          onClose={() => setCreateFromTemplate(null)}
        />
      )}

      {aiFor && (
        <AiTaskGenerator
          project={aiFor}
          onClose={() => setAiFor(null)}
        />
      )}

      {activityLogFor && (
        <ProjectActivityLogModal
          project={activityLogFor}
          onClose={() => setActivityLogFor(null)}
        />
      )}

      {wbsFor && (
        <WbsModal
          project={wbsFor}
          projects={projects}
          onClose={() => setWbsFor(null)}
        />
      )}

      {managingSegments && (
        <SegmentManager
          projects={projects}
          onClose={() => setManagingSegments(false)}
        />
      )}
    </>
  );
}

// ─── Work Breakdown Structure modal ─────────────────────────────────────────
// Shows the full WBS for a project: Project → Phase → Task → Subtask
// with WBS codes (1.1.1…), status badges, progress bars, and CSV export.
// ─── Project activity log modal ─────────────────────────────────────────────
// Shows all activity entries for a single project in a sortable table.
// Includes CSV download. Read-only — the full Activity Log view (sidebar)
// retains bulk edit / delete / import.
function ProjectActivityLogModal({ project, onClose }) {
  const modal = useModalDialog({ onClose });
  const { activities, loading } = useAllActivities();
  const { tasks } = useTasks();
  const taskById = {};
  tasks.forEach((t) => { taskById[t.id] = t; });

  const [sortBy, setSortBy]   = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [editing, setEditing] = useState(null); // activity being edited

  const rows = activities
    .filter((a) => a.projectId === project.id)
    .map((a) => {
      const liveTask = taskById[a.taskId];
      // Prefer the task's CURRENT phase so re-assigning a task to a new or
      // edited phase is reflected here. The activity's denormalized phaseId
      // is only a snapshot from log-time; fall back to it for tasks that have
      // since moved out of this project or been deleted.
      const phase =
        (liveTask && project.phases?.find((p) => p.id === liveTask.phaseId)) ||
        project.phases?.find((p) => p.id === a.phaseId);
      return {
        ...a,
        _phase: phase?.name || '—',
        _task:  a.taskTitle || liveTask?.title || '—',
        _outputs: a.attachments || [],
      };
    });

  rows.sort((a, b) => {
    const av = a[`_${sortBy}`] ?? a[sortBy] ?? '';
    const bv = b[`_${sortBy}`] ?? b[sortBy] ?? '';
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const sortHandler = (key) => () => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  const columns = [
    { key: 'phase',      label: 'Phase' },
    { key: 'task',       label: 'Task' },
    { key: 'comment',    label: 'Activity details' },
    { key: 'date',       label: 'Date' },
    { key: 'completion', label: 'Completion' },
    { key: 'output',     label: 'Output' },
    { key: 'bottleneck', label: 'Bottlenecks / remarks' },
    { key: 'requestedBy',label: 'Requested by' },
    { key: 'hours',      label: 'Hours' },
  ];

  const totalHours = rows.reduce((sum, r) => sum + (r.hoursSpent || 0), 0);

  const exportProps = {
    build: () => buildActivityLogDocument(rows, {
      projectById: { [project.id]: project },
      taskById,
      projectName: project.name,
      title: `${project.name} — activity log`,
    }),
    baseName: `${project.name}-activities`,
    kind: 'table',
    title: 'Save these entries as a spreadsheet, a PDF or a CSV',
  };

  return (
    <>
    <div className="modal-backdrop" {...modal.backdropProps}>
      <div
        className="modal"
        style={{ maxWidth: 1100, width: '95vw' }} {...modal.dialogProps}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span className="proj-icon" style={{ color: project.color }} aria-hidden="true">
            {iconFor(project) === '◆' && !project.icon ? suggestIcon(project.id) : iconFor(project)}
          </span>
          <h3 className="modal-title" style={{ margin: 0 }} id={modal.titleId}>{project.name} — Activity log</h3>
        </div>
        <p className="modal-sub" style={{ marginBottom: 12 }}>
          {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {totalHours.toFixed(1)}h total. Click a column to sort.
        </p>

        {loading ? (
          <p className="muted">Loading activity log…</p>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">☰</div>
            <p>No activities logged for this project yet.</p>
            <p className="small">Log activities from each task on the Board.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: '60vh', overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={sortBy === c.key ? 'sorted' : ''}
                      onClick={sortHandler(c.key)}
                    >
                      {c.label}
                      <span className="sort-icon">{sortBy === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </th>
                  ))}
                  <th aria-label="actions" style={{ width: 48 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r._phase}</td>
                    <td className="table-cell-wrap"><strong>{r._task}</strong></td>
                    <td className="table-cell-wrap">{r.comment || <span className="muted">—</span>}</td>
                    <td className="mono small">{r.date}</td>
                    <td>
                      {r.completionStatus ? (
                        <span className={`badge badge-soft-${
                          r.completionStatus === 'completed'   ? 'success' :
                          r.completionStatus === 'blocked'     ? 'danger'  :
                          r.completionStatus === 'in-progress' ? 'info'    : 'muted'
                        }`}>{r.completionStatus}</span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      {r._outputs[0] ? (
                        <a className="table-link" href={r._outputs[0].url} target="_blank" rel="noreferrer">
                          📎 {(r._outputs[0].name || 'link').slice(0, 30)}
                          {r._outputs.length > 1 && <span className="muted"> +{r._outputs.length - 1}</span>}
                        </a>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="table-cell-wrap">
                      {r.bottleneckRemarks
                        ? <span style={{ color: 'var(--c-warn)' }}>⚠ {r.bottleneckRemarks}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>{r.requestedBy || <span className="muted">—</span>}</td>
                    <td className="mono small">{(r.hoursSpent || 0).toFixed(1)}h</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Edit this activity entry"
                        onClick={() => setEditing(r)} aria-label="Edit this activity entry">✎</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
          <ExportButton {...exportProps} className="btn btn-primary" disabled={rows.length === 0} label="Export" />
        </div>
      </div>
    </div>

    {/* Activity editor opens on top of this modal */}
    {editing && (
      <ActivityEditor
        activity={editing}
        onClose={() => setEditing(null)}
      />
    )}
    </>
  );
}

function ProjectSharing({ project, bare = false }) {
  const toast = useToast();
  const ask = useDialog();
  // Sharing is an admin control. The rules refuse an invite from anyone who
  // cannot administer the project, so showing the generator to everyone would
  // just hand most people a button that fails. Mirror the rule instead.
  const { userId } = useAuth();
  const { workspaces } = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === project.workspaceId) || null;
  const canShare = canAdministerProject(project, workspace, userId);

  const [uidInput, setUidInput] = useState('');
  const [role, setRole]   = useState('viewer');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  // Invite-link generator state
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteExpires, setInviteExpires] = useState(7);   // days, 0 = never
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [generatedLink, setGeneratedLink] = useState(null); // { id, url }
  const [copyOk, setCopyOk] = useState(false);

  // Subscribe to existing invites for this project. Listing invites needs
  // admin rights (they are share secrets), so don't even open the listener
  // for anyone else — it would only log a permission error.
  const [invites, setInvites] = useState([]);
  useEffect(() => {
    if (!canShare) return undefined;
    const unsub = subscribeToInvitesForProject(project.id, setInvites);
    return () => unsub();
  }, [project.id, canShare]);

  const acl     = project.acl || {};
  const ownerId = project.userId;
  const members = Object.keys(acl);

  const inviteByUid = async () => {
    if (!uidInput.trim()) return;
    setBusy(true); setError(null);
    try {
      await setProjectMember(project.id, uidInput.trim(), role);
      setUidInput('');
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, 'Could not add that person to the project.'));
    } finally { setBusy(false); }
  };

  const removeMember = async (memberUid) => {
    if (memberUid === ownerId) { toast.error('Cannot remove the project owner.'); return; }
    if (!await ask.confirm({ title: 'Remove this member from the project?', confirmLabel: 'Remove', danger: true })) return;
    try { await setProjectMember(project.id, memberUid, null); }
    catch (err) { console.error(err); toast.error(friendlyError(err)); }
  };

  const changeRole = async (memberUid, nextRole) => {
    if (memberUid === ownerId) return;
    try { await setProjectMember(project.id, memberUid, nextRole); }
    catch (err) { console.error(err); toast.error(friendlyError(err)); }
  };

  const createLink = async () => {
    setCreatingInvite(true);
    setError(null);
    try {
      const me = auth.currentUser;
      if (!me) throw new Error('You appear to be signed out. Reload and sign in again.');
      const ref = await createInvite(me.uid, {
        projectId: project.id,
        projectName: project.name,
        role: inviteRole,
        expiresInDays: inviteExpires > 0 ? inviteExpires : null,
      });
      // Compose link based on this app's BASE_URL
      const base = window.location.origin + import.meta.env.BASE_URL;
      const url = `${base}#/invite/${ref.id}`;
      setGeneratedLink({ id: ref.id, url });
    } catch (err) {
      console.error(err);
      setError(friendlyError(err, 'Could not create the invite link.'));
    } finally {
      setCreatingInvite(false);
    }
  };

  const copyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch (err) {
      console.error(err);
    }
  };

  const shareLink = async () => {
    if (!generatedLink) return;
    const shareData = {
      title: `Join "${project.name}" on Task Monitor`,
      text: `You're invited to collaborate on "${project.name}" as ${inviteRole}. Open the link to accept.`,
      url: generatedLink.url,
    };
    // Web Share API: works on mobile + most desktops (Safari/Edge). Falls back
    // to clipboard copy when unavailable or when the user cancels.
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }
      throw new Error('share-unsupported');
    } catch (err) {
      if (err?.name === 'AbortError') return; // user cancelled the share sheet
      // Fall back to clipboard so the link still ends up somewhere usable.
      await copyLink();
    }
  };

  const shareViaEmail = () => {
    if (!generatedLink) return;
    const subject = encodeURIComponent(`Join "${project.name}" on Task Monitor`);
    const body = encodeURIComponent(
      `You're invited to collaborate on "${project.name}" as ${inviteRole}.\n\nOpen this link to accept the invite:\n${generatedLink.url}\n`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const shareViaWhatsApp = () => {
    if (!generatedLink) return;
    const text = encodeURIComponent(
      `You're invited to collaborate on "${project.name}" on Task Monitor: ${generatedLink.url}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const handleRevoke = async (inviteId) => {
    if (!await ask.confirm({ title: 'Revoke this invite link?', message: 'Anyone who hasn\'t claimed it yet will be unable to join.', confirmLabel: 'Revoke', danger: true })) return;
    try { await revokeInvite(inviteId); }
    catch (err) { console.error(err); toast.error(friendlyError(err)); }
  };

  const liveInvites = canShare ? invites.filter((inv) => !inv.revoked) : [];

  // `bare` drops the divider + heading so the project editor can drop this
  // straight into its own titled card.
  const wrapStyle = bare ? undefined : { borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 };

  // Read-only view for people who are on the project but cannot manage it.
  if (!canShare) {
    return (
      <div className="field" style={wrapStyle}>
        {!bare && <label className="label">Sharing</label>}
        <p className="muted small" style={{ marginTop: 0 }}>
          <strong>{members.length}</strong> member{members.length === 1 ? '' : 's'} on this project.
        </p>
        <p className="muted small">
          Only a project admin, the person who created this project, or a workspace
          owner or admin can invite people or change who has access. Ask one of them
          if someone needs to be added.
        </p>
      </div>
    );
  }

  return (
    <div className="field" style={wrapStyle}>
      {!bare && <label className="label">Sharing</label>}

      {/* Current members */}
      <p className="muted small" style={{ marginTop: 0, marginBottom: 6 }}>
        <strong>{members.length}</strong> member{members.length === 1 ? '' : 's'} on this project.
      </p>
      <ul className="dep-list" style={{ marginBottom: 12 }}>
        {members.map((memberUid) => (
          <li key={memberUid} className="dep-item">
            <span className={`badge badge-soft-${memberUid === ownerId ? 'info' : 'muted'}`}>
              {memberUid === ownerId ? 'owner' : acl[memberUid]}
            </span>
            <span className="dep-title mono small">{memberUid.slice(0, 12)}{memberUid.length > 12 ? '…' : ''}</span>
            {memberUid !== ownerId && (
              <>
                <select
                  className="select select-sm"
                  value={acl[memberUid]}
                  onChange={(e) => changeRole(memberUid, e.target.value)}
                  style={{ width: 90 }}
                >
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="admin">admin</option>
                </select>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeMember(memberUid)} aria-label="Remove">✕</button>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Invite link generator */}
      <div style={{ borderTop: '1px dashed var(--c-border)', paddingTop: 10, marginBottom: 12 }}>
        <strong style={{ fontSize: 13 }}>Generate invite link</strong>
        <p className="muted small" style={{ marginTop: 2 }}>
          Anyone with the link can join with the role you pick.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto 1fr', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <span className="muted small">Role</span>
          <select className="select select-sm" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
          <span className="muted small">Expires</span>
          <select className="select select-sm" value={inviteExpires} onChange={(e) => setInviteExpires(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={0}>Never</option>
          </select>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={createLink} disabled={creatingInvite}>
          {creatingInvite ? 'Generating…' : 'Generate link'}
        </button>

        {generatedLink && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input input-sm mono"
                value={generatedLink.url}
                readOnly
                style={{ flex: 1, fontSize: 11 }}
                onClick={(e) => e.target.select()}
              />
              <button type="button" className="btn btn-sm" onClick={copyLink}>
                {copyOk ? '✓ Copied' : '⎘ Copy'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {typeof navigator !== 'undefined' && navigator.share && (
                <button type="button" className="btn btn-sm btn-primary" onClick={shareLink} title="Open device share sheet">
                  ↗ Share…
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={shareViaEmail} title="Share via email">
                ✉ Email
              </button>
              <button type="button" className="btn btn-sm" onClick={shareViaWhatsApp} title="Share via WhatsApp">
                💬 WhatsApp
              </button>
            </div>
          </div>
        )}

        {liveInvites.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p className="muted small" style={{ marginBottom: 4 }}>Active invite links:</p>
            <ul className="dep-list">
              {liveInvites.map((inv) => {
                const expiresMs = inv.expiresAt?.toMillis?.() ?? Date.parse(inv.expiresAt || '');
                const expired = inv.expiresAt && expiresMs < Date.now();
                return (
                  <li key={inv.id} className="dep-item">
                    <span className={`badge badge-soft-${expired ? 'danger' : 'success'}`}>
                      {expired ? 'expired' : inv.role}
                    </span>
                    <span className="dep-title mono small">{inv.id.slice(0, 10)}…</span>
                    <span className="muted small">{(inv.claims || []).length} claim{(inv.claims || []).length === 1 ? '' : 's'}</span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => handleRevoke(inv.id)}>Revoke</button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Power-user: add by UID */}
      <details>
        <summary className="muted small" style={{ cursor: 'pointer' }}>
          Add by Firebase UID (advanced)
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6, marginTop: 6 }}>
          <input
            className="input input-sm"
            value={uidInput}
            onChange={(e) => setUidInput(e.target.value)}
            placeholder="Firebase UID"
          />
          <select className="select select-sm" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
          <button type="button" className="btn btn-sm" onClick={inviteByUid} disabled={busy || !uidInput.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </details>

      {error && <p className="auth-error-msg" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}

function CustomFieldsEditor({ fields, onChange, bare = false }) {
  const add = () => onChange([...fields, { id: uid(), name: 'New field', type: 'text', options: [] }]);
  const remove = (id) => onChange(fields.filter((f) => f.id !== id));
  const update = (id, patch) => onChange(fields.map((f) => f.id === id ? { ...f, ...patch } : f));

  return (
    <div className="field" style={bare ? undefined : { borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
      {!bare && <label className="label">Custom fields</label>}
      <p className="muted small" style={{ marginTop: 0 }}>
        Extra fields that appear on every task in this project. Text, number, date, or select (predefined options).
      </p>

      {fields.length === 0 ? (
        <p className="muted small">No custom fields.</p>
      ) : (
        <ul className="dep-list">
          {fields.map((f) => (
            <li key={f.id} className="dep-item" style={{ gridTemplateColumns: '1fr auto auto auto', gap: 6 }}>
              <input
                className="input input-sm"
                value={f.name}
                onChange={(e) => update(f.id, { name: e.target.value })}
                placeholder="Field name"
              />
              <select className="select select-sm" value={f.type} onChange={(e) => update(f.id, { type: e.target.value })}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Select</option>
              </select>
              {f.type === 'select' && (
                <input
                  className="input input-sm"
                  style={{ minWidth: 160 }}
                  value={(f.options || []).join(', ')}
                  onChange={(e) => update(f.id, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="comma, separated, values"
                />
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(f.id)} aria-label="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={add}>+ Add field</button>
    </div>
  );
}

function TemplateCard({ template, onUse, note }) {
  const ask = useDialog();
  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!await ask.confirm({ title: `Delete template "${template.name}"?`, confirmLabel: 'Delete', danger: true })) return;
    softDeleteTemplate(template.id);
  };
  return (
    <div className="template-card" onClick={onUse} style={{ cursor: onUse ? 'pointer' : 'default' }}>
      <div className="template-card-head">
        <span className="badge badge-soft-info">{template.kind}</span>
        <strong>{template.name}</strong>
        <button className="btn btn-sm btn-ghost link-danger" onClick={handleDelete} style={{ marginLeft: 'auto' }} aria-label="Remove">✕</button>
      </div>
      {template.kind === 'project' && (
        <p className="muted small">
          {template.payload?.phases?.length || 0} phases
        </p>
      )}
      {template.kind === 'task' && (
        <>
          <p className="template-task-title">{template.payload?.title}</p>
          {template.payload?.subtasks?.length > 0 && (
            <span className="muted small">{template.payload.subtasks.length} subtask{template.payload.subtasks.length === 1 ? '' : 's'}</span>
          )}
        </>
      )}
      {note && <p className="muted small" style={{ marginTop: 4 }}>{note}</p>}
    </div>
  );
}

// ─── Project editor ─────────────────────────────────────────────────────────
// Full-bleed editor modal: navy hero header (breadcrumb, inline-editable name,
// live health pills), a scrolling left column (KPIs → structure tree → details
// → goal/template/sharing) and a right-hand project-activity timeline.

// Firestore timestamps arrive as a Timestamp (toDate) or a plain {seconds}.
function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}

function fmtAgo(ts) {
  const d = tsToDate(ts);
  if (!d) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / 1440);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

const ACT_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'work',    label: 'Work logs' },
  { key: 'blocked', label: 'Blocked' },
];

function ProjectEditor({ project, userId, workspace, fromTemplate, nameSeed, onClose }) {
  // The project editor is a full-bleed panel with a breadcrumb hero rather
  // than a heading, so it is labelled directly.
  const modal2 = useModalDialog({ onClose, title: 'Project editor' });
  const ask = useDialog();
  const toast = useToast();
  const { projects } = useProjects();
  const { tasks } = useTasks();
  const { activities: allActivities } = useAllActivities();
  const { goals } = useGoals();
  const workspaceId = workspace?.id;
  const isNew = !project;
  const seed = fromTemplate?.payload;
  const [name, setName]         = useState(project?.name || seed?.name || '');
  const [description, setDescription] = useState(project?.description || seed?.description || '');
  const [color, setColor]       = useState(project?.color || seed?.color || COLORS[0]);
  // An icon makes a project recognisable in a list of eight coloured dots.
  // Falls back to a stable suggestion so an existing project is not blank.
  const [icon, setIcon]         = useState(
    () => normalizeIcon(project?.icon, suggestIcon(project?.id || seed?.name || '')),
  );
  // What the user typed after "new project" in ⌘K.
  useSeededField(nameSeed, setName);
  const [segment, setSegment]   = useState(project?.segment || 'Uncategorized');
  const [phases, setPhases]     = useState(
    project?.phases?.length ? project.phases :
    seed?.phases?.length ? seed.phases.map((p) => ({ id: uid(), name: p.name, order: p.order })) :
    [
      { id: uid(), name: 'Planning',  order: 0 },
      { id: uid(), name: 'Execution', order: 1 },
      { id: uid(), name: 'Review',    order: 2 },
    ]
  );
  const [customFields, setCustomFields] = useState(project?.customFields || []);
  const [assignedTo, setAssignedTo] = useState(project?.assignedTo || []);
  const [assignedToExternal, setAssignedToExternal] = useState(project?.assignedToExternal || []);
  const [knowledge, setKnowledge] = useState(project?.knowledge || null);
  // Work-in-progress limits and the ageing threshold (T-0138). Kept as typed
  // strings so an empty box stays empty rather than snapping to 0.
  const [wipLimits, setWipLimits] = useState(() => {
    const src = project?.wipLimits || {};
    return Object.fromEntries(WIP_STATUSES.map((id) => [
      id, src[id] === null || src[id] === undefined ? '' : String(src[id]),
    ]));
  });
  const [wipAgeingDays, setWipAgeingDays] = useState(
    project?.wipAgeingDays ? String(project.wipAgeingDays) : '',
  );
  const [saving, setSaving] = useState(false);
  const [newSegmentInput, setNewSegmentInput] = useState(null); // null = picker, string = creating
  const [actFilter, setActFilter] = useState('all');
  const [editingActivity, setEditingActivity] = useState(null);

  // Get all segments from workspace + project segments for backward compatibility
  const allSegments = useMemo(() => {
    const segs = new Set();

    // Add workspace-defined segments
    (workspace?.segments || []).forEach((s) => {
      segs.add(s.name);
    });

    // Add Uncategorized
    segs.add('Uncategorized');

    // Add any project segments not in workspace (backward compatibility)
    projects.forEach((p) => {
      if (p.segment) segs.add(p.segment);
    });

    return Array.from(segs).sort((a, b) => {
      if (a === 'Uncategorized') return -1;
      if (b === 'Uncategorized') return 1;
      return a.localeCompare(b);
    });
  }, [workspace?.segments, projects]);

  // Pull workspace members + memberProfiles for the AssigneePicker.
  const { workspaces } = useWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  const memberProfiles = ws?.memberProfiles || {};
  const candidates = useMemo(() => {
    const set = new Set();
    (ws?.members || []).forEach((u) => set.add(u));
    Object.keys(project?.acl || {}).forEach((u) => set.add(u));
    (assignedTo || []).forEach((u) => set.add(u));
    return [...set];
  }, [ws, project, assignedTo]);
  const me = auth.currentUser;
  const fallbackLabels = me?.uid ? { [me.uid]: me.displayName || me.email || `${me.uid.slice(0, 6)}…` } : {};

  // ── Derived health ────────────────────────────────────────────────────────
  // The hero pills, KPI strip and structure bars are all computed from this
  // project's live tasks — a project document itself carries no dates or
  // progress of its own.
  const health = useMemo(() => {
    const today = todayLocal();
    const mine  = project ? tasks.filter((t) => t.projectId === project.id) : [];
    const done  = mine.filter((t) => t.status === 'done');
    const overdue = mine.filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today);
    const starts = mine.map((t) => t.plan?.startDate).filter(Boolean).sort();
    const ends   = mine.map((t) => t.plan?.endDate).filter(Boolean).sort();
    const start  = starts[0] || '';
    const end    = ends[ends.length - 1] || '';

    let schedulePct = null;
    if (start && end) {
      const s = new Date(`${start}T00:00:00`).getTime();
      const e = new Date(`${end}T00:00:00`).getTime();
      const n = new Date(`${today}T00:00:00`).getTime();
      schedulePct = e <= s
        ? (n >= e ? 100 : 0)
        : Math.max(0, Math.min(100, Math.round(((n - s) / (e - s)) * 100)));
    }

    const completePct = mine.length ? Math.round((done.length / mine.length) * 100) : 0;
    const gap = schedulePct === null ? null : schedulePct - completePct;

    let tone = 'green', label = 'GREEN — on track';
    if (!mine.length)                                          { tone = 'muted'; label = 'No tasks yet'; }
    else if (overdue.length > 0 || (gap !== null && gap >= 20)) { tone = 'red';   label = 'RED — at risk'; }
    else if (gap !== null && gap >= 8)                          { tone = 'amber'; label = 'AMBER — watch'; }

    const daysLeft = end
      ? Math.round((new Date(`${end}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
      : null;

    return { tasks: mine, total: mine.length, done: done.length, overdue, start, end, daysLeft, schedulePct, completePct, gap, tone, label };
  }, [tasks, project]);

  // This project's activities, newest first.
  const projectActivities = useMemo(() => {
    if (!project) return [];
    const byTask = {};
    tasks.forEach((t) => { byTask[t.id] = t; });
    return allActivities
      .filter((a) => a.projectId === project.id)
      .map((a) => ({
        ...a,
        _task:  a.taskTitle || byTask[a.taskId]?.title || 'Untitled task',
        _files: a.attachments || [],
      }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [allActivities, tasks, project]);

  const loggedHours  = projectActivities.reduce((s, a) => s + (a.hoursSpent || 0), 0);
  const blockedCount = projectActivities.filter(
    (a) => a.completionStatus === 'blocked' || a.bottleneckRemarks,
  ).length;

  const shownActivities = useMemo(() => {
    if (actFilter === 'work')    return projectActivities.filter((a) => (a.hoursSpent || 0) > 0);
    if (actFilter === 'blocked') return projectActivities.filter((a) => a.completionStatus === 'blocked' || a.bottleneckRemarks);
    return projectActivities;
  }, [projectActivities, actFilter]);

  // Strategic goals whose deliverables link this project.
  const linkedGoals = useMemo(() => {
    if (!project) return [];
    const out = [];
    goals.forEach((g) => {
      (g.deliverables || []).forEach((d, i) => {
        const ids = Array.isArray(d.projectIds) ? d.projectIds : (d.projectId ? [d.projectId] : []);
        if (ids.includes(project.id)) out.push({ goal: g, deliverable: d, index: i });
      });
    });
    return out;
  }, [goals, project]);

  const phaseStats = (phaseId) => {
    const today = todayLocal();
    const t = health.tasks.filter((x) => x.phaseId === phaseId);
    const done = t.filter((x) => x.status === 'done').length;
    const overdue = t.filter((x) => x.status !== 'done' && x.plan?.endDate && x.plan.endDate < today).length;
    return { total: t.length, done, overdue, pct: t.length ? Math.round((done / t.length) * 100) : 0 };
  };

  // Saved project templates — let the user start a new project from one
  // directly inside this modal.
  const { templates } = useTemplates();
  const projectTemplates = useMemo(
    () => templates.filter((t) => t.kind === 'project'),
    [templates],
  );
  const [templateId, setTemplateId] = useState(fromTemplate?.id || '');
  const applyTemplate = (id) => {
    setTemplateId(id);
    const tpl = projectTemplates.find((t) => t.id === id);
    const pl = tpl?.payload;
    if (!pl) return;
    setName(pl.name || '');
    setDescription(pl.description || '');
    setColor(pl.color || COLORS[0]);
    setIcon(normalizeIcon(pl.icon, icon));
    setPhases((pl.phases || []).map((p) => ({ id: uid(), name: p.name, order: p.order })));
  };

  const addPhase = () => setPhases([...phases, { id: uid(), name: 'New phase', order: phases.length }]);
  const updatePhase = (id, name) => setPhases(phases.map((p) => p.id === id ? { ...p, name } : p));
  const removePhase = (id) => setPhases(phases.filter((p) => p.id !== id));
  const movePhase = (idx, dir) => {
    const next = [...phases];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setPhases(next.map((p, i) => ({ ...p, order: i })));
  };

  const save = async () => {
    if (!name.trim()) { toast.error('Project name is required.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await addProject(userId, { workspaceId, name: name.trim(), description: description.trim(), color, icon, segment, phases, customFields, assignedTo, assignedToExternal, knowledge: knowledge || null, wipLimits: normalizeLimits(wipLimits), wipAgeingDays: normalizeLimit(wipAgeingDays) });
      } else {
        await updateProject(project.id, { name: name.trim(), description: description.trim(), color, icon, segment, phases, customFields, assignedTo, assignedToExternal, knowledge: knowledge || null, wipLimits: normalizeLimits(wipLimits), wipAgeingDays: normalizeLimit(wipAgeingDays) });
      }
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not save project. Please try again.'));
      setSaving(false);
    }
  };

  const addNewSegment = () => {
    if (!newSegmentInput?.trim()) return;
    setSegment(newSegmentInput.trim());
    setNewSegmentInput(null);
  };

  const remove = async () => {
    const name = project.name || 'Project';
    try {
      await softDeleteProject(project.id);
      onClose();
      toast.success(
        `“${name}” deleted. Its tasks are still there, without a project.`,
        { undo: () => restoreDeleted('project', project.id) },
      );
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not delete that project.'));
    }
  };

  const archive = async () => {
    await archiveProject(project.id);
    onClose();
  };

  // "Do that again for the next client" — the case templates do not cover,
  // because it is decided after the fact (T-0139). The plan is worked out
  // first so the question can say exactly what is about to happen: how many
  // tasks, how many finished ones are being left behind, and how far the dates
  // move. Twelve documents on a mis-click is a lot to tidy by hand, so it
  // comes with an Undo.
  const duplicate = async () => {
    const preview = duplicateProjectPlan(project, tasks, { startOn: todayLocal() });
    const answer = await ask.confirm({
      title: `Duplicate “${project.name}”?`,
      message: `This creates ${describeDuplicate(preview)}. Nothing is copied from its history — `
             + 'no logged hours, no activity, no progress.',
      confirmLabel: 'Duplicate',
    });
    if (!answer) return;

    setSaving(true);
    try {
      const made = await duplicateProject(userId, project, tasks, { startOn: todayLocal() });
      toast.success(
        `Copied “${project.name}” with ${made.taskIds.length} task${made.taskIds.length === 1 ? '' : 's'}.`,
        { undo: async () => { await undoDuplicateProject(made); toast.info('Copy removed.'); } },
      );
      onClose();
    } catch (err) {
      console.error('[duplicate] project failed:', err);
      toast.error(friendlyError(err, 'Could not duplicate that project. Please try again.'));
      setSaving(false);
    }
  };

  const saveAsTemplate = async () => {
    const tplName = await ask.prompt({ title: 'Template name:', defaultValue: name.trim() || 'New project template' });
    if (!tplName) return;
    try {
      await addTemplate(userId, {
        workspaceId,
        name: tplName.trim(),
        kind: 'project',
        payload: projectAsTemplatePayload({ name: name.trim(), description: description.trim(), color, phases }),
      });
      toast.success(`Saved template "${tplName.trim()}".`);
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not save template. Please try again.'));
    }
  };

  const wsProjectCount = projects.filter((p) => p.workspaceId === workspaceId).length;
  const lastEdited = fmtAgo(project?.updatedAt);

  const kpis = [
    {
      label: 'Complete',
      value: health.total ? `${health.completePct}%` : '—',
      delta: health.total ? `${health.done} of ${health.total} tasks` : 'no tasks yet',
      tone: !health.total ? 'muted' : health.completePct >= 80 ? 'green' : health.completePct >= 40 ? 'amber' : 'red',
    },
    {
      label: 'Schedule used',
      value: health.schedulePct === null ? '—' : `${health.schedulePct}%`,
      delta: health.gap === null ? 'no planned dates'
        : health.gap > 0 ? `${health.gap}-point gap`
        : `${Math.abs(health.gap)} points ahead`,
      tone: health.gap === null ? 'muted' : health.gap >= 20 ? 'red' : health.gap >= 8 ? 'amber' : 'green',
    },
    {
      label: 'Overdue',
      value: String(health.overdue.length),
      delta: (() => {
        if (!health.overdue.length) return 'nothing past due';
        const n = new Set(health.overdue.map((t) => t.phaseId)).size;
        return `across ${n} phase${n === 1 ? '' : 's'}`;
      })(),
      tone: health.overdue.length ? 'red' : 'green',
    },
    {
      label: 'Logged hours',
      value: `${loggedHours.toFixed(1)}h`,
      delta: `${projectActivities.length} session${projectActivities.length === 1 ? '' : 's'}`,
      tone: 'navy',
    },
  ];

  return (
    <>
    <div className="modal-backdrop" {...modal2.backdropProps}>
      <div className="pe-modal" {...modal2.dialogProps}>

        {/* ── Hero header ── */}
        <header className="pe-hero">
          <span className="pe-hero-glow" aria-hidden="true" />
          <div className="pe-hero-inner">
            <div className="pe-crumbs">
              <span className="pe-crumb">
                <span className="pe-crumb-dot" style={{ background: workspace?.color || 'var(--c-purple)' }} />
                {workspace?.name || 'Workspace'}
              </span>
              <span className="pe-crumb-sep">/</span>
              <span className="pe-crumb pe-crumb-accent">Project</span>
            </div>

            <div className="pe-hero-main">
              <div className="pe-hero-id">
                <div className="pe-mode">{isNew ? 'New project' : 'Edit project'}</div>
                <div className="pe-name-row">
                  {/* The mockup leads with a 44px tile in the project's own
                      colour, not a dot: it is what makes one project
                      recognisable in a stack of modals. */}
                  <span className="pe-icon" style={{ background: color }} aria-hidden="true">
                    {(name.trim() || 'P').charAt(0).toUpperCase()}
                  </span>
                  <input
                    className="pe-name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Untitled project"
                    aria-label="Project name"
                    autoFocus={isNew}
                  />
                </div>
                <div className="pe-pills">
                  {!isNew && <span className={`pe-pill pe-pill-${health.tone}`}>● {health.label}</span>}
                  <span className="pe-pill pe-pill-accent">{project?.archived ? 'Archived' : 'Active'}</span>
                  {!isNew && health.total > 0 && (
                    <span className="pe-pill pe-pill-ghost">
                      {health.completePct}% complete
                      {health.schedulePct !== null && ` · ${health.schedulePct}% of schedule used`}
                    </span>
                  )}
                  <span className="pe-hero-meta">
                    {isNew
                      ? 'Not saved yet'
                      : `${health.total} task${health.total === 1 ? '' : 's'} · ${projectActivities.length} activit${projectActivities.length === 1 ? 'y' : 'ies'}`}
                  </span>
                </div>
              </div>
              <button type="button" className="pe-close" onClick={onClose} aria-label="Close">✕</button>
            </div>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="pe-body">

          {/* LEFT — the form */}
          <div className="pe-main">

            <div className="pe-kpis">
              {kpis.map((k) => (
                <div key={k.label} className={`pe-kpi pe-tone-${k.tone}`}>
                  <div className="pe-kpi-label">{k.label}</div>
                  <div className="pe-kpi-value">{k.value}</div>
                  <div className="pe-kpi-delta">{k.delta}</div>
                </div>
              ))}
            </div>

            {/* Structure — workspace → project → editable phases */}
            {/* ── Pace ──
                The mockup's own panel, and the one thing the editor could not
                say before: how far the work has got AGAINST how much of the
                schedule has gone. Two numbers the page already had, put on one
                track so the gap between them is the thing you see. Drawn only
                when there are dates to measure — a notch with no schedule
                behind it is decoration. */}
            {!isNew && health.schedulePct !== null && (
              <section className="pe-card pe-pace">
                <div className="pe-pace-head">
                  <span className="pe-sect-plain">Pace</span>
                  <span className={`pe-gap tone-ink-${
                    health.gap === null ? 'navy' : health.gap >= 20 ? 'red' : health.gap >= 8 ? 'amber' : 'green'
                  }`}>
                    {health.gap === null ? 'no planned dates'
                      : health.gap > 0 ? `${health.gap} pts behind schedule`
                      : `${Math.abs(health.gap)} pts ahead`}
                  </span>
                </div>
                <div className="pe-pace-track">
                  <span
                    className="pe-pace-bar"
                    style={{ width: `${health.completePct}%`, background: color }}
                  />
                  <span
                    className="pe-pace-notch"
                    style={{ left: `${Math.min(100, health.schedulePct)}%` }}
                    title={`${health.schedulePct}% of the planned schedule has passed`}
                  />
                </div>
                <div className="pe-pace-legend">
                  <span>{health.completePct}% complete</span>
                  <span><span className="pe-pace-key" />{health.schedulePct}% of schedule</span>
                </div>
              </section>
            )}

            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">⌗</span>Structure — phases and their tasks</h4>

              <div className="pe-tree-row">
                <span className="pe-kind pe-kind-ws">WS</span>
                <div className="pe-tree-body">
                  <div className="pe-tree-name">{workspace?.name || 'Workspace'}</div>
                  <div className="pe-tree-meta">{(ws?.members || []).length} members · {wsProjectCount} projects</div>
                </div>
              </div>

              <div className="pe-tree-row pe-tree-proj pe-tree-current">
                <span className="pe-kind pe-kind-proj">PROJ</span>
                <div className="pe-tree-body">
                  <div className="pe-tree-name">{name.trim() || 'Untitled project'}</div>
                  <div className="pe-tree-meta">
                    this project · {health.total} task{health.total === 1 ? '' : 's'}
                    {health.start && ` · ${fmtDay(health.start)} – ${fmtDay(health.end)}`}
                  </div>
                </div>
                <div className="pe-bar"><span style={{ width: `${health.completePct}%`, background: color }} /></div>
                <span className="pe-pct">{health.completePct}%</span>
              </div>

              {phases.map((p, i) => {
                const st = phaseStats(p.id);
                return (
                  <div key={p.id} className="pe-tree-row pe-tree-phase">
                    <span className="pe-kind pe-kind-phase">PHASE</span>
                    <div className="pe-tree-body">
                      <input
                        className="pe-phase-input"
                        value={p.name}
                        onChange={(e) => updatePhase(p.id, e.target.value)}
                        placeholder="Phase name"
                        aria-label={`Phase ${i + 1} name`}
                      />
                      <div className="pe-tree-meta">
                        {st.total} task{st.total === 1 ? '' : 's'} · {st.done} done
                        {st.overdue > 0 && ` · ${st.overdue} overdue`}
                      </div>
                    </div>
                    <div className="pe-bar">
                      <span style={{
                        width: `${st.total ? Math.max(st.pct, 2) : 0}%`,
                        background: st.overdue ? 'var(--c-danger)' : st.pct === 100 ? 'var(--c-emerald)' : 'var(--c-accent)',
                      }} />
                    </div>
                    <span className="pe-pct">{st.total ? `${st.pct}%` : '—'}</span>
                    <div className="pe-phase-ctl">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => movePhase(i, -1)} disabled={i === 0} title="Move up" aria-label="Move up">↑</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => movePhase(i, 1)} disabled={i === phases.length - 1} title="Move down" aria-label="Move down">↓</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => removePhase(p.id)} disabled={phases.length === 1} title="Remove phase" aria-label="Remove phase">✕</button>
                    </div>
                  </div>
                );
              })}

              <button type="button" className="btn btn-sm pe-add-phase" onClick={addPhase}>+ Add phase</button>
            </section>

            {/* Details */}
            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">◈</span>Details</h4>

              <div className="pe-grid3">
                <div>
                  <span className="pe-lbl">Workspace</span>
                  <div className="pe-fld">
                    <span className="pe-crumb-dot" style={{ background: workspace?.color || 'var(--c-purple)' }} />
                    {workspace?.name || '—'}
                  </div>
                </div>

                <div>
                  <span className="pe-lbl">Segment / department</span>
                  {newSegmentInput === null ? (
                    <select
                      className="select pe-input"
                      value={segment}
                      onChange={(e) => {
                        if (e.target.value === '__new__') setNewSegmentInput('');
                        else setSegment(e.target.value);
                      }}
                    >
                      {allSegments.map((s) => <option key={s} value={s}>{s}</option>)}
                      <option value="__new__">+ Create new segment…</option>
                    </select>
                  ) : (
                    <div className="pe-newseg">
                      <input
                        className="input pe-input"
                        value={newSegmentInput}
                        onChange={(e) => setNewSegmentInput(e.target.value)}
                        placeholder="e.g. Sales, Finance"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addNewSegment();
                          if (e.key === 'Escape') setNewSegmentInput(null);
                        }}
                      />
                      <button type="button" className="btn btn-sm" onClick={addNewSegment} disabled={!newSegmentInput.trim()}>Add</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewSegmentInput(null)} aria-label="Remove">✕</button>
                    </div>
                  )}
                </div>

                <div>
                  <span className="pe-lbl">Status</span>
                  <div className="pe-fld">
                    <span className="pe-crumb-dot" style={{ background: project?.archived ? 'var(--c-text-muted)' : 'var(--c-accent)' }} />
                    {project?.archived ? 'Archived' : 'Active'}
                  </div>
                </div>

                <div>
                  <span className="pe-lbl">Color</span>
                  <div className="pe-fld pe-swatches">
                    {COLORS.map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setColor(c)}
                        title={c}
                        aria-label={`Color ${c}`}
                        aria-pressed={color === c}
                        className={`pe-swatch${color === c ? ' is-on' : ''}`}
                        style={{ background: c, '--sw': c }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <span className="pe-lbl">Icon</span>
                  <div className="pe-fld pe-icons">
                    {GROUP_ICONS.map((g) => (
                      <button
                        type="button"
                        key={g}
                        onClick={() => setIcon(g)}
                        aria-label={`Icon ${g}`}
                        aria-pressed={icon === g}
                        className={`pe-icon-btn${icon === g ? ' is-on' : ''}`}
                        style={{ color }}
                      >{g}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="pe-lbl">Plan start</span>
                  <div className="pe-fld">{fmtDay(health.start)}</div>
                </div>

                <div>
                  <span className="pe-lbl">Plan end</span>
                  <div className={`pe-fld${health.daysLeft !== null && health.daysLeft < 0 ? ' pe-fld-danger' : ''}`}>
                    {fmtDay(health.end)}
                    {health.daysLeft !== null && (
                      <span className="pe-fld-note">
                        · {health.daysLeft < 0 ? `${Math.abs(health.daysLeft)} days over` : `${health.daysLeft} days left`}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="pe-lbl">Logged hours</span>
                  <div className="pe-fld pe-fld-strong">
                    {loggedHours.toFixed(1)}h
                    <span className="pe-fld-note">· {projectActivities.length} sessions</span>
                  </div>
                </div>

                <div>
                  <span className="pe-lbl">Tasks</span>
                  <div className="pe-fld">{health.done} done / {health.total} total</div>
                </div>

                <div>
                  <span className="pe-lbl">Last edited</span>
                  <div className="pe-fld">{lastEdited || '—'}</div>
                </div>
              </div>

              <div className="pe-block">
                <span className="pe-lbl">Description</span>
                <MarkdownEditor value={description} onChange={setDescription} rows={3} placeholder="What is this project about? Markdown supported." />
              </div>

              <div className="pe-block">
                <AssigneePicker
                  candidates={candidates}
                  memberProfiles={memberProfiles}
                  assignedTo={assignedTo}
                  assignedToExternal={assignedToExternal}
                  onChange={({ assignedTo: a, assignedToExternal: e }) => {
                    setAssignedTo(a);
                    setAssignedToExternal(e);
                  }}
                  fallbackLabels={fallbackLabels}
                  label="Team — project lead / responsible"
                  helpText="Who owns this project? Click teammates to assign, or type an external name. This doesn't grant edit access — use Members & invites for that."
                />
              </div>
            </section>

            {/* Linked goal + template */}
            <div className="pe-card-row">
              <section className="pe-card">
                <h4 className="pe-sect"><span className="pe-sect-mark">◎</span>Linked goal</h4>
                {linkedGoals.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>
                    Not linked to a strategic goal. Link this project from a goal’s deliverable in the Goals view.
                  </p>
                ) : linkedGoals.map(({ goal, deliverable, index }) => (
                  <div key={`${goal.id}-${deliverable.id || index}`} className="pe-goal">
                    <div className="pe-goal-title">{goal.code ? `${goal.code} — ` : ''}{goal.title || 'Untitled goal'}</div>
                    <div className="pe-goal-meta">
                      {goal.kpi ? `KPI: ${goal.kpi} · ` : ''}
                      deliverable {index + 1} of {(goal.deliverables || []).length}
                    </div>
                    {deliverable.text && <div className="pe-goal-deliv">{deliverable.text}</div>}
                    <div className="pe-goal-bar">
                      <span style={{ width: `${health.completePct}%`, background: goal.color || 'var(--c-accent)' }} />
                    </div>
                  </div>
                ))}
              </section>

              <section className="pe-card">
                <h4 className="pe-sect"><span className="pe-sect-mark">⎘</span>Template</h4>
                {isNew && projectTemplates.length > 0 && (
                  <div className="pe-block" style={{ marginTop: 0 }}>
                    <span className="pe-lbl">Start from a saved template</span>
                    <select className="select pe-input" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                      <option value="">— Blank project —</option>
                      {projectTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} ({t.payload?.phases?.length || 0} phases)</option>
                      ))}
                    </select>
                    <p className="muted small" style={{ marginTop: 4 }}>
                      Picking a template fills in name, description, color and phases — tweak anything before saving.
                    </p>
                  </div>
                )}
                {fromTemplate && (
                  <div className="pe-from-tpl"><span className="pe-from-tag">FROM</span>{fromTemplate.name}</div>
                )}
                <button type="button" className="btn btn-sm" onClick={saveAsTemplate} disabled={saving || !name.trim()} style={{ marginTop: 8 }}>
                  Save as template
                </button>
                {isNew && (
                  <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
                    Members and invite links become available once the project is saved.
                  </p>
                )}
              </section>
            </div>

            {!isNew && (
              <section className="pe-card">
                <h4 className="pe-sect"><span className="pe-sect-mark">⇄</span>Members &amp; invites</h4>
                <ProjectSharing project={project} bare />
              </section>
            )}

            {!isNew && (
              <section className="pe-card">
                <h4 className="pe-sect"><span className="pe-sect-mark">⇱</span>Share with a client</h4>
                <ShareLinksPanel project={project} tasks={tasks} />
              </section>
            )}

            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">▦</span>Board limits</h4>
              <p className="muted small" style={{ margin: '0 0 10px' }}>
                How many tasks each column of this project’s board should hold at once.
                Going over is a warning, never a block — leave a box empty for no limit.
              </p>
              <div className="pe-wip-row">
                {WIP_STATUSES.map((id) => (
                  <div key={id} className="field">
                    <label className="label" htmlFor={`pe-wip-${id}`}>{WIP_LABEL[id]}</label>
                    <input
                      id={`pe-wip-${id}`}
                      type="number" min="1" max="999"
                      className="input input-sm"
                      value={wipLimits[id]}
                      placeholder="No limit"
                      onChange={(e) => setWipLimits((w) => ({ ...w, [id]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="field">
                  <label className="label" htmlFor="pe-wip-age">Flag after</label>
                  <input
                    id="pe-wip-age"
                    type="number" min="1" max="365"
                    className="input input-sm"
                    value={wipAgeingDays}
                    placeholder={String(DEFAULT_AGEING_DAYS)}
                    onChange={(e) => setWipAgeingDays(e.target.value)}
                  />
                  <span className="muted small">days in progress</span>
                </div>
              </div>
            </section>

            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">▤</span>Custom fields</h4>
              <CustomFieldsEditor fields={customFields} onChange={setCustomFields} bare />
            </section>

            {!isNew && (
              <section className="pe-card">
                <h4 className="pe-sect"><span className="pe-sect-mark">✦</span>Ask about this project</h4>
                <ProjectAskPanel
                  project={project}
                  workspace={workspace}
                  tasks={tasks}
                  activities={allActivities}
                  memberProfiles={workspace?.memberProfiles || {}}
                  userId={userId}
                />
              </section>
            )}

            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">◇</span>Knowledge base</h4>
              <NotebookPicker
                label="NotebookLM notebook"
                value={knowledge?.notebookId || null}
                title={knowledge?.notebookTitle}
                onChange={(notebookId, notebookTitle) => setKnowledge(
                  notebookId ? { notebookId, notebookTitle, setAt: new Date().toISOString() } : null,
                )}
                inheritLabel={workspace?.knowledge?.notebookId
                  ? `Inherit from workspace (${workspace.knowledge.notebookTitle || workspace.knowledge.notebookId})`
                  : 'Inherit from workspace (none set)'}
                hint="AI answers and task prompts for this project are grounded in this notebook's sources."
              />
            </section>
          </div>

          {/* RIGHT — project activity timeline */}
          <aside className="pe-side">
            <div className="pe-side-head">
              <div className="pe-side-title">
                <span>Project activity</span>
                <span className="pe-side-count">{shownActivities.length} entries</span>
              </div>

              <div className="pe-side-stats">
                <div className="pe-sstat pe-tone-navy">
                  <div className="pe-kpi-label">Logged</div>
                  <div className="pe-sstat-value">{loggedHours.toFixed(1)}h</div>
                </div>
                <div className="pe-sstat pe-tone-amber">
                  <div className="pe-kpi-label">Sessions</div>
                  <div className="pe-sstat-value">{projectActivities.length}</div>
                </div>
                <div className="pe-sstat pe-tone-red">
                  <div className="pe-kpi-label">Blocked</div>
                  <div className="pe-sstat-value">{blockedCount}</div>
                </div>
              </div>

              <div className="pe-side-filters">
                {ACT_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`pe-chip${actFilter === f.key ? ' is-on' : ''}`}
                    onClick={() => setActFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pe-side-scroll">
              {isNew ? (
                <div className="pe-side-empty">
                  <div className="pe-side-empty-icon">◷</div>
                  <p>No activity yet.</p>
                  <p className="small">Save the project, add tasks, and every logged hour lands here.</p>
                </div>
              ) : shownActivities.length === 0 ? (
                <div className="pe-side-empty">
                  <div className="pe-side-empty-icon">☰</div>
                  <p>{projectActivities.length === 0 ? 'No activities logged yet.' : 'Nothing matches this filter.'}</p>
                  {projectActivities.length === 0 && <p className="small">Log activities from each task on the Board.</p>}
                </div>
              ) : (
                <ActivityTimeline
                  activities={shownActivities}
                  onSelect={setEditingActivity}
                  renderEntryMeta={(a) => (
                    <div className="pe-act-task">
                      <span className="pe-act-task-dot" style={{ background: color }} />
                      {a._task}
                    </div>
                  )}
                />
              )}
            </div>
          </aside>
        </div>

        {/* ── Footer ── */}
        <footer className="pe-foot">
          {!isNew && (
            <>
              <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={saving}>Delete project</button>
              <button type="button" className="btn btn-sm" onClick={archive} disabled={saving}>Archive</button>
              <button
                type="button" className="btn btn-sm" onClick={duplicate} disabled={saving}
                title={`Make another project like “${project.name}”, with its open tasks`}
              >Duplicate</button>
            </>
          )}
          {lastEdited && <span className="pe-foot-note">Last edited {lastEdited}</span>}
          <div className="pe-foot-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : isNew ? 'Create project' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>

    {editingActivity && (
      <ActivityEditor activity={editingActivity} onClose={() => setEditingActivity(null)} />
    )}
    </>
  );
}

// Compact strip showing project assignees on the project card. Pulls
// display names from the active workspace's memberProfiles map for system
// users, and renders external names verbatim.
function ProjectAssigneeStrip({ project }) {
  const activeWsId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const ws = workspaces.find((w) => w.id === activeWsId);
  const memberProfiles = ws?.memberProfiles || {};
  const me = auth.currentUser;
  const uids = project.assignedTo || [];
  const ext  = project.assignedToExternal || [];
  if (uids.length === 0 && ext.length === 0) return null;
  const labelFor = (uid) => {
    const p = memberProfiles[uid];
    if (p?.displayName) return p.displayName;
    if (p?.email) return p.email;
    if (uid === me?.uid) return me.displayName || me.email || `${uid.slice(0, 6)}…`;
    return `${uid.slice(0, 6)}…`;
  };
  return (
    <div className="project-assignees" title="Assigned to">
      <span className="muted small">👤</span>
      {uids.slice(0, 4).map((uid) => (
        <span key={uid} className="project-assignee-chip" title={uid}>
          {labelFor(uid)}
        </span>
      ))}
      {ext.slice(0, 4).map((name) => (
        <span key={name} className="project-assignee-chip external" title="External (not in system)">
          ✎ {name}
        </span>
      ))}
      {(uids.length + ext.length) > 8 && (
        <span className="muted small">+{(uids.length + ext.length) - 8} more</span>
      )}
    </div>
  );
}

function SegmentManager({ projects, onClose }) {
  const modal3 = useModalDialog({ onClose });
  const toast = useToast();
  const ask = useDialog();
  const workspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const wsSegments = workspace?.segments || [];

  const [editingSegment, setEditingSegment] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [newSegmentName, setNewSegmentName] = useState('');
  const [savingSegment, setSavingSegment] = useState(null);

  const getSegmentProjects = (seg) => projects.filter((p) => (p.segment || 'Uncategorized') === seg);
  const getSegmentId = (seg) => wsSegments.find((s) => s.name === seg)?.id;

  const startEdit = (seg) => {
    setEditingSegment(seg);
    setEditingName(seg);
  };

  const saveSegmentName = async () => {
    if (!editingName.trim() || editingName === editingSegment) {
      setEditingSegment(null);
      return;
    }
    if (wsSegments.some((s) => s.name === editingName.trim() && s.name !== editingSegment)) {
      toast.error('A segment with this name already exists.');
      return;
    }

    setSavingSegment(editingSegment);
    try {
      const segId = getSegmentId(editingSegment);
      if (segId) {
        await updateSegmentInWorkspace(workspaceId, segId, editingName.trim());
      }
      setEditingSegment(null);
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not rename segment. Please try again.'));
    } finally {
      setSavingSegment(null);
    }
  };

  const deleteSegment = async (seg) => {
    if (seg === 'Uncategorized') {
      toast.error('Cannot delete the Uncategorized segment.');
      return;
    }
    const count = getSegmentProjects(seg).length;
    if (!await ask.confirm({ title: `Delete segment "${seg}"? Its ${count} project${count === 1 ? '' : 's'} will be moved to Uncategorized.`, confirmLabel: 'Delete', danger: true })) {
      return;
    }

    setSavingSegment(seg);
    try {
      const segId = getSegmentId(seg);
      if (segId) {
        await deleteSegmentFromWorkspace(workspaceId, segId);
      }
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not delete segment. Please try again.'));
    } finally {
      setSavingSegment(null);
    }
  };

  const addNewSegment = async () => {
    if (!newSegmentName.trim()) return;
    if (wsSegments.some((s) => s.name === newSegmentName.trim())) {
      toast.error('A segment with this name already exists.');
      return;
    }

    setSavingSegment('__new__');
    try {
      await addSegmentToWorkspace(workspaceId, newSegmentName.trim());
      setNewSegmentName('');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not create segment. Please try again.'));
    } finally {
      setSavingSegment(null);
    }
  };

  return (
    <div className="modal-backdrop" {...modal3.backdropProps}>
      <div className="modal" {...modal3.dialogProps}>
        <h3 className="modal-title" id={modal3.titleId}>Manage Segments</h3>
        <p className="modal-sub">
          Create, rename, or delete project segments/departments. Move projects between segments by editing them.
        </p>

        <div className="field">
          <label className="label">Create new segment</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
            <input
              className="input"
              value={newSegmentName}
              onChange={(e) => setNewSegmentName(e.target.value)}
              placeholder="e.g. Marketing, Operations"
              onKeyDown={(e) => e.key === 'Enter' && addNewSegment()}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={addNewSegment}
              disabled={!newSegmentName.trim() || savingSegment === '__new__'}
            >
              {savingSegment === '__new__' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>

        {wsSegments.length === 0 && projects.filter((p) => !p.segment || p.segment === 'Uncategorized').length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p>No segments yet.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Display workspace-defined segments first */}
            {wsSegments.map((wsSegment) => {
              const seg = wsSegment.name;
              const count = getSegmentProjects(seg).length;
              const isEditing = editingSegment === seg;
              const isSaving = savingSegment === seg;

              return (
                <div key={wsSegment.id} style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                        <input
                          className="input input-sm"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveSegmentName();
                            if (e.key === 'Escape') setEditingSegment(null);
                          }}
                          autoFocus
                        />
                        <button
                          className="btn btn-sm"
                          onClick={saveSegmentName}
                          disabled={isSaving}
                        >
                          {isSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setEditingSegment(null)}
                          disabled={isSaving}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <strong>{seg}</strong>
                          <span className="badge badge-soft-muted" style={{ marginLeft: 8 }}>{count} project{count === 1 ? '' : 's'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => startEdit(seg)}
                            title="Rename segment" aria-label="Rename segment">
                            ✎
                          </button>
                          <button
                            className="btn btn-sm btn-ghost link-danger"
                            onClick={() => deleteSegment(seg)}
                            disabled={isSaving}
                            title="Delete segment (projects move to Uncategorized)" aria-label="Delete segment (projects move to Uncategorized)">
                            ✕
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {getSegmentProjects(seg).map((p) => (
                        <span
                          key={p.id}
                          className="badge badge-soft-info"
                          style={{ paddingRight: 8 }}
                        >
                          <span className="proj-dot" style={{ background: p.color, width: 10, height: 10, borderRadius: '50%', marginRight: 4 }} />
                          {p.name}
                        </span>
                      ))}
                      {count === 0 && <span className="muted small">(no projects)</span>}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Display Uncategorized if there are projects in it */}
            {getSegmentProjects('Uncategorized').length > 0 && (
              <div style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                  <div>
                    <strong>Uncategorized</strong>
                    <span className="badge badge-soft-muted" style={{ marginLeft: 8 }}>{getSegmentProjects('Uncategorized').length} project{getSegmentProjects('Uncategorized').length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {getSegmentProjects('Uncategorized').map((p) => (
                    <span
                      key={p.id}
                      className="badge badge-soft-info"
                      style={{ paddingRight: 8 }}
                    >
                      <span className="proj-dot" style={{ background: p.color, width: 10, height: 10, borderRadius: '50%', marginRight: 4 }} />
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
