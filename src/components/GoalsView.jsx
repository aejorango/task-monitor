// src/components/GoalsView.jsx — Dashboard → Goals, rebuilt to
// `Dashboard Explorer.dc.html` (T-0154).
//
// Three cards across: a conic ring carrying the goal's completion, the title,
// its owner and its date, a Target / Now band, the key results as named bars,
// and the projects it touches as chips.
//
// What this replaced: a full-width SP3 one-pager per goal — a coloured banner
// over INITIATIVES, KPI, and three aligned columns (CHANGE AGENDA's FROM→TO
// pairs, numbered DELIVERABLES, TARGET DATE). None of that data was deleted:
// the change agenda and each deliverable's own target date and status are
// still edited in the modal, and **Export ▾** still writes the full one-pager
// out through `buildGoalsDocument` — which is what people actually send.
//
// The arithmetic, and the honesty rule it turns on, is the pure
// `services/goalProgress.js`: a deliverable nobody linked to a project has NO
// percentage rather than 0%.

import { useState, useMemo, useCallback } from 'react';
import { useGoals, useAllWorkspaceProjects, useAllWorkspaceTasks, useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { addGoal, updateGoal, softDeleteGoal, archiveGoal, uid } from '../services/firebase';
import WbsModal from './WbsModal';
import { friendlyError } from '../services/access';
import ExportButton from './ExportButton';
import { buildGoalsDocument } from '../services/exporters';
import { useQuickCreate, newSeed, useSeededField } from '../hooks/useQuickCreate';
import { useToast } from './Toast';
import { useDialog } from './Dialog';
import { useModalDialog } from '../hooks/useModalDialog';
import { PageActions, PageSubtitle } from './PageHeader';
import Avatar from './Avatar';
import { atRiskCount, goalProgress, deliverableProjectIds } from '../services/goalProgress';

const BANNER_COLORS = ['#1e2a52', '#0f3d3e', '#3b2a5a', '#5a2a3b', '#1f3a5f', '#2d2d44', '#14532d', '#7c2d12'];
const BG_COLORS = ['#1e2a52', '#0f3d3e', '#3b2a5a', '#5a2a3b', '#1f3a5f', '#2d2d44', '#14532d', '#7c2d12', '#0b1220', '#3f2d12', '#4a1d3d', '#1a3a34'];

const emptyGoal = () => ({
  code: '',
  title: '',
  initiative: '',
  kpi: '',
  color: BANNER_COLORS[0],
  bgColor: BANNER_COLORS[0],
  changeAgenda: [{ id: uid(), from: '', to: '' }],
  deliverables: [{ id: uid(), text: '', targetDate: '', status: '', projectIds: [] }],
});

// Per-task completion (mirrors the WBS): done → 100, else subtask ratio, else
// manual progress, else a token 50% for "doing".
function taskPct(t) {
  if (t.status === 'done') return 100;
  const subs = t.subtasks || [];
  if (subs.length > 0) return Math.round((subs.filter((s) => s.done).length / subs.length) * 100);
  if (typeof t.progress === 'number' && t.progress > 0) return Math.min(100, Math.round(t.progress));
  return t.status === 'doing' ? 50 : 0;
}

export default function GoalsView() {
  const { goals, loading } = useGoals();
  const { projects } = useAllWorkspaceProjects();   // across every member workspace
  const { tasks } = useAllWorkspaceTasks();
  const { workspaces } = useWorkspaces();
  const [editing, setEditing] = useState(null); // goal object or 'new'

  // ⌘K → "New goal": open the editor with what they typed.
  // ⌘K → "new goal Ship v1" opens the editor with that title in it.
  const [titleSeed, setTitleSeed] = useState(null);
  useQuickCreate('goal', useCallback((text) => {
    setTitleSeed(text ? newSeed(text) : null);
    setEditing('new');
  }, []));
  const [wbsProjectId, setWbsProjectId] = useState(null); // project to show WBS for

  const projectById = useMemo(() => {
    const m = {};
    projects.forEach((p) => { m[p.id] = p; });
    return m;
  }, [projects]);

  const wsNameById = useMemo(() => {
    const m = {};
    workspaces.forEach((w) => { m[w.id] = w.name || 'Workspace'; });
    return m;
  }, [workspaces]);

  // Who owns a goal is its `userId`. Goals span workspaces, so the profiles of
  // every workspace this person is in are merged — a goal in one workspace can
  // be owned by somebody you only share another with.
  const memberProfiles = useMemo(() => {
    const m = {};
    workspaces.forEach((w) => Object.assign(m, w.memberProfiles || {}));
    return m;
  }, [workspaces]);

  // Completion per project: average of its tasks' % complete. Keyed by project
  // id (globally unique), so cross-workspace links resolve too.
  const projectStats = useMemo(() => {
    const m = {};
    projects.forEach((p) => {
      const pts = tasks.filter((t) => t.projectId === p.id);
      const pct = pts.length ? Math.round(pts.reduce((s, t) => s + taskPct(t), 0) / pts.length) : 0;
      m[p.id] = {
        id: p.id, name: p.name, color: p.color, pct, taskCount: pts.length,
        workspaceId: p.workspaceId, workspaceName: wsNameById[p.workspaceId] || 'Workspace',
      };
    });
    return m;
  }, [projects, tasks, wsNameById]);

  // Project options grouped by workspace for the editor picker.
  const projectsByWorkspace = useMemo(() => {
    const groups = {};
    projects.forEach((p) => {
      const wsName = wsNameById[p.workspaceId] || 'Workspace';
      (groups[wsName] = groups[wsName] || []).push(p);
    });
    Object.values(groups).forEach((arr) => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [projects, wsNameById]);

  // "3 goals · 1 at risk" — the mockup's own count line. At risk is the red
  // tone, and a goal nothing in which is measured is NOT red: see
  // services/goalProgress.js.
  const atRisk = useMemo(() => atRiskCount(goals, projectStats), [goals, projectStats]);

  return (
    <>
      <PageSubtitle>
        <strong>{goals.length}</strong> goal{goals.length === 1 ? '' : 's'}
        {atRisk > 0 && <> · {atRisk} at risk</>}
      </PageSubtitle>
      <PageActions>
        <ExportButton
          build={() => buildGoalsDocument(goals, { projectStats, deliverableProjectIds })}
          baseName="goals"
          kind="document"
          className="cmd"
          title="Save these goals as a PDF, Word document or web page"
        />
        <button className="cmd cmd-primary" onClick={() => setEditing('new')}>
          <span className="cmd-icon">+</span>New goal
        </button>
      </PageActions>

      {loading ? (
        <p className="muted">Loading goals…</p>
      ) : goals.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><GoalIcon name="target" size={40} /></div>
          <p>No goals yet.</p>
          <p className="small">Click <strong>+ New goal</strong> to build your first strategic-plan card.</p>
        </div>
      ) : (
        <div className="gl-grid">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              projectStats={projectStats}
              memberProfiles={memberProfiles}
              onEdit={() => setEditing(g)}
              onOpenWbs={setWbsProjectId}
            />
          ))}
        </div>
      )}

      {editing && (
        <GoalEditor
          goal={editing === 'new' ? null : editing}
          projectsByWorkspace={projectsByWorkspace}
          projectStats={projectStats}
          titleSeed={editing === 'new' ? titleSeed : null}
          onClose={() => { setEditing(null); setTitleSeed(null); }}
        />
      )}

      {wbsProjectId && projectById[wbsProjectId] && (
        <WbsModal
          project={projectById[wbsProjectId]}
          tasks={tasks}
          projects={projects}
          onClose={() => setWbsProjectId(null)}
        />
      )}
    </>
  );
}

// ─── Display card (matches the SP3 template) ────────────────────────────────

function GoalCard({ goal, projectStats = {}, onEdit, onOpenWbs, memberProfiles = {} }) {
  const g = goalProgress(goal, projectStats);
  const owner = memberProfiles[goal.userId];

  return (
    <div className={`gl-card tone-${g.tone}`}>
      {/* The head: a conic ring carrying the goal's own completion, its name,
          its owner and the date it is due by. The ring is a gradient rather
          than an SVG because it is one value — an arc library for a single
          number is a dependency you maintain for ever. */}
      <div className="gl-head">
        <span
          className="gl-ring"
          style={{ '--gl-deg': `${(g.pct ?? 0) * 3.6}deg` }}
          role="img"
          aria-label={g.pct == null ? 'Nothing measured yet' : `${g.pct}% complete`}
        >
          <span className="gl-ring-in">{g.pct == null ? '—' : `${g.pct}%`}</span>
        </span>
        <div className="gl-id">
          <button type="button" className="gl-name" onClick={onEdit} title="Edit this goal">
            {goal.title || 'Untitled goal'}
          </button>
          {/* The title has always been the edit control, which nobody could be
              expected to guess. The button says so. */}
          <button type="button" className="gl-edit" onClick={onEdit} aria-label={`Edit ${goal.title || 'this goal'}`}>
            ✎ Edit
          </button>
          <div className="gl-who">
            {owner
              ? <Avatar id={goal.userId} name={owner.displayName || owner.email} photo={owner.photoURL} size={24} />
              : <Avatar id={goal.userId || goal.id} name={goal.code || 'Goal'} size={24} />}
            <span className="gl-due">{g.due || 'no date'}</span>
          </div>
        </div>
      </div>

      {/* Target is what the goal is AIMING at — the KPI somebody wrote down.
          Now is what is true today. The mockup prints a measured value there;
          this app has no "current reading" field, so Now is the count of
          deliverables actually finished, which is a real number rather than a
          plausible one. */}
      <div className="gl-band">
        <div className="gl-band-cell">
          <div className="gl-lbl">Target</div>
          <div className="gl-target">{goal.kpi || '—'}</div>
        </div>
        <div className="gl-band-cell gl-band-now">
          <div className="gl-lbl">Now</div>
          <div className="gl-now">{g.total ? `${g.done}/${g.total}` : '—'}</div>
        </div>
      </div>

      <div className="gl-lbl gl-krs-lbl">Key results</div>
      {g.deliverables.length === 0 ? (
        <p className="gl-empty">Nothing listed yet — open the goal to add a deliverable.</p>
      ) : (
        <div className="gl-krs">
          {g.deliverables.map((d, i) => (
            <div key={d.id || i}>
              <div className="gl-kr-top">
                <span className="gl-kr-name" title={d.text || 'Untitled'}>{d.text || 'Untitled'}</span>
                <span className={`gl-kr-pct tone-ink-${d.tone}`}>
                  {d.pct == null ? '—' : `${d.pct}%`}
                </span>
              </div>
              {/* No bar where there is no number. A 0%-wide track reads as
                  "started, got nowhere" for something nobody has wired up. */}
              <div className="gl-kr-track">
                {d.pct != null && (
                  <span className={`gl-kr-bar tone-fill-${d.tone}`} style={{ width: `${d.pct}%` }} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {g.unmeasured > 0 && (
        <p className="gl-unmeasured">
          {g.unmeasured} of {g.total} not linked to a project, so {g.unmeasured === 1 ? 'it is' : 'they are'} not
          in the ring.
        </p>
      )}

      {/* The project chips under the card were hidden on request. The link
          between a goal and its projects is not lost — it is still what the
          ring is computed from, it is still edited in the goal editor, and
          the unmeasured line above still says when some of it is unlinked. */}
    </div>
  );
}

function GoalEditor({ goal, projectsByWorkspace = [], projectStats = {}, titleSeed, onClose }) {
  const modal = useModalDialog({ onClose });
  const toast = useToast();
  const ask = useDialog();
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [form, setForm] = useState(() =>
    goal
      ? {
          code: goal.code || '',
          title: goal.title || '',
          initiative: goal.initiative || '',
          kpi: goal.kpi || '',
          color: goal.color || BANNER_COLORS[0],
          bgColor: goal.bgColor || goal.color || BANNER_COLORS[0],
          changeAgenda: (goal.changeAgenda?.length ? goal.changeAgenda : [{ id: uid(), from: '', to: '' }])
            .map((a) => ({ id: a.id || uid(), from: a.from || '', to: a.to || '' })),
          deliverables: (goal.deliverables?.length ? goal.deliverables : [{ id: uid(), text: '', targetDate: '', status: '', projectIds: [] }])
            .map((d) => ({ id: d.id || uid(), text: d.text || '', targetDate: d.targetDate || '', status: d.status || '', projectIds: deliverableProjectIds(d) })),
        }
      : emptyGoal()
  );
  const [saving, setSaving] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // What the user typed after "new goal" in ⌘K.
  useSeededField(titleSeed, (text) => setForm((f) => ({ ...f, title: text })));

  // Change-agenda row helpers
  const addAgenda = () => set({ changeAgenda: [...form.changeAgenda, { id: uid(), from: '', to: '' }] });
  const setAgenda = (id, patch) =>
    set({ changeAgenda: form.changeAgenda.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const delAgenda = (id) =>
    set({ changeAgenda: form.changeAgenda.filter((a) => a.id !== id) });

  // Deliverable row helpers
  const addDeliv = () => set({ deliverables: [...form.deliverables, { id: uid(), text: '', targetDate: '', status: '', projectIds: [] }] });
  const setDeliv = (id, patch) =>
    set({ deliverables: form.deliverables.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const delDeliv = (id) =>
    set({ deliverables: form.deliverables.filter((d) => d.id !== id) });
  const addProjectToDeliv = (id, projectId) => {
    if (!projectId) return;
    setForm((f) => ({
      ...f,
      deliverables: f.deliverables.map((d) =>
        d.id === id && !d.projectIds.includes(projectId)
          ? { ...d, projectIds: [...d.projectIds, projectId] }
          : d),
    }));
  };
  const removeProjectFromDeliv = (id, projectId) =>
    setForm((f) => ({
      ...f,
      deliverables: f.deliverables.map((d) =>
        d.id === id ? { ...d, projectIds: d.projectIds.filter((p) => p !== projectId) } : d),
    }));

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    // Drop empty rows so the card stays clean.
    const payload = {
      ...form,
      title: form.title.trim(),
      code: form.code.trim(),
      changeAgenda: form.changeAgenda.filter((a) => a.from.trim() || a.to.trim()),
      deliverables: form.deliverables
        .filter((d) => d.text.trim() || d.targetDate.trim() || d.status.trim() || d.projectIds.length)
        .map((d) => ({ ...d, projectIds: d.projectIds })),
    };
    try {
      if (goal) await updateGoal(goal.id, payload);
      else await addGoal(userId, { ...payload, workspaceId });
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not save goal. Please try again.'));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!goal) return;
    if (!await ask.confirm({ title: `Delete goal "${goal.code ? goal.code + ': ' : ''}${goal.title}"?`, confirmLabel: 'Delete', danger: true })) return;
    setSaving(true);
    try { await softDeleteGoal(goal.id); onClose(); }
    catch (err) { console.error(err); toast.error(friendlyError(err, 'Could not delete. Please try again.')); setSaving(false); }
  };

  return (
    <div className="modal-backdrop" {...modal.backdropProps}>
      <div className="modal" style={{ maxWidth: 760, width: '95vw' }} {...modal.dialogProps}>
        <h3 className="modal-title" id={modal.titleId}>{goal ? 'Edit goal' : 'New goal'}</h3>
        <p className="modal-sub">Build a strategic-plan one-pager.</p>

        <div className="modal-scroll" style={{ maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
          <div className="field-row">
            <div className="field" style={{ maxWidth: 140 }}>
              <label className="label">Code</label>
              <input className="input" value={form.code} placeholder="SP3"
                onChange={(e) => set({ code: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Title</label>
              <input className="input" value={form.title} placeholder="Enabling Data Driven Decisions" autoFocus
                onChange={(e) => set({ title: e.target.value })} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="label">Banner color</label>
              <div className="goal-swatches">
                {BANNER_COLORS.map((c) => (
                  <button key={c} type="button"
                    className={`goal-swatch ${form.color === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => set({ color: c })}
                    aria-label={`Banner color ${c}`} />
                ))}
                <label className="goal-swatch goal-swatch-custom" title="Custom banner color" style={{ background: form.color }}>
                  <input type="color" value={form.color} onChange={(e) => set({ color: e.target.value })} />
                </label>
              </div>
            </div>
            <div className="field">
              <label className="label">Card background</label>
              <div className="goal-swatches">
                {BG_COLORS.map((c) => (
                  <button key={c} type="button"
                    className={`goal-swatch ${form.bgColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => set({ bgColor: c })}
                    aria-label={`Background color ${c}`} />
                ))}
                <label className="goal-swatch goal-swatch-custom" title="Custom background color" style={{ background: form.bgColor }}>
                  <input type="color" value={form.bgColor} onChange={(e) => set({ bgColor: e.target.value })} />
                </label>
              </div>
            </div>
          </div>

          <div className="field">
            <label className="label">Initiatives</label>
            <textarea className="input" rows={2} value={form.initiative}
              placeholder="SP3.1  Enhancement of Data Governance to improve data sharing"
              onChange={(e) => set({ initiative: e.target.value })} />
          </div>

          <div className="field">
            <label className="label">KPI</label>
            <textarea className="input" rows={2} value={form.kpi}
              placeholder="5% reduction in Processing Time per use case…"
              onChange={(e) => set({ kpi: e.target.value })} />
          </div>

          {/* Change agenda */}
          <div className="field">
            <label className="label">Change agenda (FROM → TO)</label>
            {form.changeAgenda.map((a, i) => (
              <div key={a.id} className="goal-edit-row">
                <span className="goal-edit-num">{i + 1}</span>
                <div className="goal-edit-fields">
                  <input className="input input-sm" value={a.from} placeholder="FROM — current state"
                    onChange={(e) => setAgenda(a.id, { from: e.target.value })} />
                  <input className="input input-sm" value={a.to} placeholder="TO — desired state"
                    onChange={(e) => setAgenda(a.id, { to: e.target.value })} />
                </div>
                <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => delAgenda(a.id)}>
                  <GoalIcon name="x" size={14} />
                </button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={addAgenda}>+ Add change</button>
          </div>

          {/* Deliverables */}
          <div className="field">
            <label className="label">Deliverables (target date, status &amp; one or more projects)</label>
            {form.deliverables.map((d, i) => (
              <div key={d.id} className="goal-edit-row">
                <span className="goal-edit-num">{i + 1}</span>
                <div className="goal-edit-fields">
                  <input className="input input-sm" value={d.text} placeholder="Deliverable"
                    onChange={(e) => setDeliv(d.id, { text: e.target.value })} />
                  <div className="field-row" style={{ gap: 8, margin: 0 }}>
                    <input className="input input-sm" value={d.targetDate} placeholder="Target: 31 March 2024"
                      onChange={(e) => setDeliv(d.id, { targetDate: e.target.value })} />
                    <input className="input input-sm" value={d.status} placeholder="Status: completed as scheduled"
                      onChange={(e) => setDeliv(d.id, { status: e.target.value })} />
                  </div>

                  {/* Linked-project chips */}
                  {d.projectIds.length > 0 && (
                    <div className="goal-proj-chips">
                      {d.projectIds.map((pid) => {
                        const proj = projectStats[pid];
                        return (
                          <span key={pid} className="goal-proj-chip">
                            <span className="goal-proj-chip-dot" style={{ background: proj?.color || '#888' }} />
                            {proj ? `${proj.name} · ${proj.workspaceName}` : 'Unknown project'}
                            <button type="button" className="goal-proj-chip-x" title="Remove project"
                              onClick={() => removeProjectFromDeliv(d.id, pid)}>
                              <GoalIcon name="x" size={11} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Add-project picker (grouped by workspace) */}
                  <select className="select select-sm" value=""
                    title="Add a project (any workspace) — its completion shows as a progress pill"
                    onChange={(e) => { addProjectToDeliv(d.id, e.target.value); e.target.value = ''; }}>
                    <option value="">+ Add project…</option>
                    {projectsByWorkspace.map(([wsName, projs]) => (
                      <optgroup key={wsName} label={wsName}>
                        {projs.map((p) => (
                          <option key={p.id} value={p.id} disabled={d.projectIds.includes(p.id)}>
                            {p.name}{d.projectIds.includes(p.id) ? ' ✓' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <button className="btn btn-sm btn-ghost" title="Remove deliverable" onClick={() => delDeliv(d.id)}>
                  <GoalIcon name="x" size={14} />
                </button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={addDeliv}>+ Add deliverable</button>
          </div>
        </div>

        <div className="modal-actions">
          {goal && (
            <button className="btn btn-sm btn-ghost goal-del" onClick={remove} disabled={saving}>
              <GoalIcon name="trash" size={14} /> Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : goal ? 'Save changes' : 'Create goal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline icons for the yellow chips (match the template motifs) ──────────

function GoalIcon({ name, size = 18 }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, style: { flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' },
  };
  switch (name) {
    // Clipboard with a check — initiatives
    case 'initiatives':
      return (<svg {...common}><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></svg>);
    // Speedometer / gauge — KPI
    case 'kpi':
      return (<svg {...common}><path d="M4 19a8 8 0 1 1 16 0" /><path d="M12 19l5-5" /><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" /></svg>);
    // Swap arrows — change agenda
    case 'change':
      return (<svg {...common}><path d="M16 3l4 4-4 4" /><path d="M20 7H8a4 4 0 0 0-4 4" /><path d="M8 21l-4-4 4-4" /><path d="M4 17h12a4 4 0 0 0 4-4" /></svg>);
    // Delivery truck — deliverables
    case 'deliver':
      return (<svg {...common}><path d="M2 6.5A1.5 1.5 0 0 1 3.5 5H14a1 1 0 0 1 1 1v9H3.5A1.5 1.5 0 0 1 2 13.5z" /><path d="M15 8h3.4a1 1 0 0 1 .9.55L21 12v3h-6z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>);
    // Calendar — target date
    case 'calendar':
      return (<svg {...common}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
    // Target / bullseye — goals empty state
    case 'target':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>);
    // Pencil — edit
    case 'pencil':
      return (<svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);
    // Trash — delete
    case 'trash':
      return (<svg {...common}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>);
    // X — remove row
    case 'x':
      return (<svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>);
    default:
      return null;
  }
}
