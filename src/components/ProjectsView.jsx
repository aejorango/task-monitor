// src/components/ProjectsView.jsx — list, create, edit projects + phases.

import { useState, useEffect, useMemo } from 'react';
import { useProjects, useTasks, useAuth, useTemplates, useAllActivities } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import {
  addProject,
  updateProject,
  archiveProject,
  softDeleteProject,
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
} from '../services/firebase';
import AiTaskGenerator from './AiTaskGenerator';
import { MarkdownEditor } from './Markdown';
import ActivityEditor from './ActivityEditor';
import AssigneePicker from './AssigneePicker';
import WbsModal from './WbsModal';

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#3b82f6'];

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

    // Now add projects to their segments
    projects.forEach((p) => {
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

  if (loading) return <p className="muted">Loading projects…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">Manage projects organized by department or segment.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setManagingSegments(true)}>
            ⚙ Segments
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')} data-tutorial="new-project-btn">
            + New project
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◉</div>
          <p>No projects yet.</p>
          <p className="small">Click <strong>+ New project</strong> to create one.</p>
        </div>
      ) : (
        <div className="segments-container">
          {Object.entries(segments).map(([segmentName, segmentProjects]) => (
            <div key={segmentName} className="segment-group">
              <h2 className="segment-title">{segmentName}</h2>
              <div className="projects-row">
                {segmentProjects.map((p) => {
                  const s = stats(p.id);
                  return (
                    <div key={p.id} className="project-card" style={{ '--project-color': p.color }} onClick={() => setEditing(p)}>
                      <div className="project-card-head">
                        <span className="proj-dot" style={{ background: p.color, width: 14, height: 14 }} />
                        <h3 className="project-name">{p.name}</h3>
                        {p._shared && (
                          <span
                            className="badge badge-soft-info"
                            title="This project lives in a different workspace and was shared with you."
                            style={{ marginLeft: 'auto' }}
                          >Shared</span>
                        )}
                      </div>
                      <p className="project-desc">{p.description || <span className="muted-2">No description</span>}</p>
                      <ProjectAssigneeStrip project={p} />
                      <div className="project-phases">
                        {p.phases?.length > 0 ? p.phases.map((ph) => (
                          <span key={ph.id} className="phase-tag">{ph.name}</span>
                        )) : <span className="muted small">No phases</span>}
                      </div>
                      <div className="project-stats">
                        <span>{s.total} task{s.total === 1 ? '' : 's'}</span>
                        <span>·</span>
                        <span>{s.done} done</span>
                        <span>·</span>
                        <span>{s.activities} activit{s.activities === 1 ? 'y' : 'ies'}</span>
                        {p.archived && (<><span>·</span><span className="badge badge-soft-muted">Archived</span></>)}
                      </div>
                      <div className="project-card-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn btn-sm btn-ghost"
                          title="View Work Breakdown Structure"
                          onClick={() => setWbsFor(p)}
                        >🗂 WBS</button>
                        <button
                          className="btn btn-sm btn-ghost"
                          title="View this project's activity log"
                          onClick={() => setActivityLogFor(p)}
                        >☰ Log</button>
                        <button
                          className="btn btn-sm btn-ghost"
                          title="Generate tasks with AI"
                          onClick={() => setAiFor(p)}
                        >✨ AI</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
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
          onClose={() => setEditing(null)}
        />
      )}

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

  const exportCsv = () => {
    const headers = ['Project', 'Phase', 'Task', 'Activity details', 'Date', 'Completion', 'Output link', 'Bottlenecks', 'Requested by', 'Hours'];
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach((r) => {
      lines.push([
        project.name,
        r._phase,
        r._task,
        r.comment,
        r.date,
        r.completionStatus,
        r._outputs.map((a) => a.url).join(' | '),
        r.bottleneckRemarks,
        r.requestedBy,
        r.hoursSpent || 0,
      ].map(escape).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = project.name.replace(/[^\w.\-]+/g, '_');
    a.download = `${safeName}-activities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1100, width: '95vw' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span className="proj-dot" style={{ background: project.color, width: 14, height: 14 }} />
          <h3 className="modal-title" style={{ margin: 0 }}>{project.name} — Activity log</h3>
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
                        onClick={() => setEditing(r)}
                      >✎</button>
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
          <button className="btn btn-primary" onClick={exportCsv} disabled={rows.length === 0}>
            ⬇ Download CSV
          </button>
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

function ProjectSharing({ project }) {
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

  // Subscribe to existing invites for this project
  const [invites, setInvites] = useState([]);
  useEffect(() => {
    const unsub = subscribeToInvitesForProject(project.id, setInvites);
    return () => unsub();
  }, [project.id]);

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
      setError(err.message || String(err));
    } finally { setBusy(false); }
  };

  const removeMember = async (memberUid) => {
    if (memberUid === ownerId) { alert('Cannot remove the project owner.'); return; }
    if (!confirm('Remove this member from the project?')) return;
    try { await setProjectMember(project.id, memberUid, null); }
    catch (err) { console.error(err); alert(err.message); }
  };

  const changeRole = async (memberUid, nextRole) => {
    if (memberUid === ownerId) return;
    try { await setProjectMember(project.id, memberUid, nextRole); }
    catch (err) { console.error(err); alert(err.message); }
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
      setError(err.message || String(err));
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
    if (!confirm('Revoke this invite link? Anyone who hasn\'t claimed it yet will be unable to join.')) return;
    try { await revokeInvite(inviteId); }
    catch (err) { console.error(err); alert(err.message); }
  };

  const liveInvites = invites.filter((inv) => !inv.revoked);

  return (
    <div className="field" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
      <label className="label">Sharing</label>

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
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeMember(memberUid)}>✕</button>
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

function CustomFieldsEditor({ fields, onChange }) {
  const add = () => onChange([...fields, { id: uid(), name: 'New field', type: 'text', options: [] }]);
  const remove = (id) => onChange(fields.filter((f) => f.id !== id));
  const update = (id, patch) => onChange(fields.map((f) => f.id === id ? { ...f, ...patch } : f));

  return (
    <div className="field" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, marginTop: 12 }}>
      <label className="label">Custom fields</label>
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
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(f.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={add}>+ Add field</button>
    </div>
  );
}

function TemplateCard({ template, onUse, note }) {
  const handleDelete = (e) => {
    e.stopPropagation();
    if (!confirm(`Delete template "${template.name}"?`)) return;
    softDeleteTemplate(template.id);
  };
  return (
    <div className="template-card" onClick={onUse} style={{ cursor: onUse ? 'pointer' : 'default' }}>
      <div className="template-card-head">
        <span className="badge badge-soft-info">{template.kind}</span>
        <strong>{template.name}</strong>
        <button className="btn btn-sm btn-ghost link-danger" onClick={handleDelete} style={{ marginLeft: 'auto' }}>✕</button>
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

function ProjectEditor({ project, userId, workspace, fromTemplate, onClose }) {
  const { projects } = useProjects();
  const workspaceId = workspace?.id;
  const isNew = !project;
  const seed = fromTemplate?.payload;
  const [name, setName]         = useState(project?.name || seed?.name || '');
  const [description, setDescription] = useState(project?.description || seed?.description || '');
  const [color, setColor]       = useState(project?.color || seed?.color || COLORS[0]);
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
  const [saving, setSaving] = useState(false);
  const [newSegmentInput, setNewSegmentInput] = useState('');

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
    if (!name.trim()) { alert('Project name is required.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await addProject(userId, { workspaceId, name: name.trim(), description: description.trim(), color, segment, phases, customFields, assignedTo, assignedToExternal });
      } else {
        await updateProject(project.id, { name: name.trim(), description: description.trim(), color, segment, phases, customFields, assignedTo, assignedToExternal });
      }
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save project. Check console.');
      setSaving(false);
    }
  };

  const addNewSegment = () => {
    if (!newSegmentInput.trim()) return;
    setSegment(newSegmentInput.trim());
    setNewSegmentInput('');
  };

  const remove = async () => {
    if (!confirm(`Delete project "${project.name}"? Tasks will remain but lose their project link.`)) return;
    await softDeleteProject(project.id);
    onClose();
  };

  const archive = async () => {
    await archiveProject(project.id);
    onClose();
  };

  const saveAsTemplate = async () => {
    const tplName = prompt('Template name:', name.trim() || 'New project template');
    if (!tplName) return;
    try {
      await addTemplate(userId, {
        workspaceId,
        name: tplName.trim(),
        kind: 'project',
        payload: projectAsTemplatePayload({ name: name.trim(), description: description.trim(), color, phases }),
      });
      alert(`Saved template "${tplName.trim()}".`);
    } catch (err) {
      console.error(err);
      alert('Could not save template. Check console.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{isNew ? 'New project' : 'Edit project'}</h3>

        {isNew && projectTemplates.length > 0 && (
          <div className="field">
            <label className="label">Start from a saved template</label>
            <select
              className="select"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">— Blank project —</option>
              {projectTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.payload?.phases?.length || 0} phases)
                </option>
              ))}
            </select>
            <p className="muted small" style={{ marginTop: 4 }}>
              Picking a template fills in the name, description, color and phases below — tweak anything before saving.
            </p>
          </div>
        )}

        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BRIDGED Compliance" />
        </div>

        <div className="field">
          <label className="label">Description</label>
          <MarkdownEditor value={description} onChange={setDescription} rows={3} placeholder="What is this project about? Markdown supported." />
        </div>

        <div className="field">
          <label className="label">Color</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: c, border: color === c ? '2px solid var(--c-text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Segment / Department</label>
          <p className="muted small" style={{ marginTop: 0, marginBottom: 6 }}>
            Organize projects by department (Sales, Finance, Engineering, etc.)
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, marginBottom: 6 }}>
            {newSegmentInput ? (
              <>
                <input
                  className="input"
                  value={newSegmentInput}
                  onChange={(e) => setNewSegmentInput(e.target.value)}
                  placeholder="e.g. Sales, Finance, Engineering"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addNewSegment();
                    if (e.key === 'Escape') setNewSegmentInput('');
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={addNewSegment}
                  disabled={!newSegmentInput.trim()}
                >
                  Create
                </button>
              </>
            ) : (
              <>
                <select
                  className="select"
                  value={segment}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setNewSegmentInput('');
                    } else {
                      setSegment(e.target.value);
                    }
                  }}
                >
                  {allSegments.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  <option value="__new__">+ Create new segment…</option>
                </select>
              </>
            )}
          </div>
        </div>

        <div className="field">
          <label className="label">Phases</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {phases.map((p, i) => (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 4 }}>
                <input className="input input-sm" value={p.name} onChange={(e) => updatePhase(p.id, e.target.value)} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => movePhase(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => movePhase(i, 1)} disabled={i === phases.length - 1}>↓</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removePhase(p.id)} disabled={phases.length === 1}>✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={addPhase} style={{ alignSelf: 'flex-start', marginTop: 4 }}>+ Add phase</button>
          </div>
        </div>

        <div className="field">
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
            label="Assigned to (project lead / responsible)"
            helpText="Who owns this project? Click teammates to assign, or type an external name. This doesn't grant edit access — use Sharing below for that."
          />
        </div>

        <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />

        {!isNew && (
          <ProjectSharing project={project} />
        )}

        <div className="modal-actions">
          {!isNew && (
            <>
              <button className="btn btn-danger" onClick={remove} disabled={saving}>Delete</button>
              <button className="btn" onClick={archive} disabled={saving}>Archive</button>
            </>
          )}
          <button className="btn" onClick={saveAsTemplate} disabled={saving || !name.trim()}>Save as template</button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
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
      alert('A segment with this name already exists.');
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
      alert('Could not rename segment. Check console.');
    } finally {
      setSavingSegment(null);
    }
  };

  const deleteSegment = async (seg) => {
    if (seg === 'Uncategorized') {
      alert('Cannot delete the Uncategorized segment.');
      return;
    }
    const count = getSegmentProjects(seg).length;
    if (!confirm(`Delete segment "${seg}"? Its ${count} project${count === 1 ? '' : 's'} will be moved to Uncategorized.`)) {
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
      alert('Could not delete segment. Check console.');
    } finally {
      setSavingSegment(null);
    }
  };

  const addNewSegment = async () => {
    if (!newSegmentName.trim()) return;
    if (wsSegments.some((s) => s.name === newSegmentName.trim())) {
      alert('A segment with this name already exists.');
      return;
    }

    setSavingSegment('__new__');
    try {
      await addSegmentToWorkspace(workspaceId, newSegmentName.trim());
      setNewSegmentName('');
    } catch (err) {
      console.error(err);
      alert('Could not create segment. Check console.');
    } finally {
      setSavingSegment(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Manage Segments</h3>
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
                            title="Rename segment"
                          >
                            ✎
                          </button>
                          <button
                            className="btn btn-sm btn-ghost link-danger"
                            onClick={() => deleteSegment(seg)}
                            disabled={isSaving}
                            title="Delete segment (projects move to Uncategorized)"
                          >
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
