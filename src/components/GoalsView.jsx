// src/components/GoalsView.jsx — Strategic-plan "Goals". Each goal renders as a
// one-pager card matching the SP3 template: title banner, INITIATIVES, KPI, and
// three aligned columns — CHANGE AGENDA (FROM→TO pairs), DELIVERABLES (numbered),
// and TARGET DATE (target + status per deliverable). Create / edit / delete via
// a modal editor.

import { useState, useMemo } from 'react';
import { useGoals, useProjects, useTasks, useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import { addGoal, updateGoal, softDeleteGoal, archiveGoal, uid } from '../services/firebase';

const BANNER_COLORS = ['#1e2a52', '#0f3d3e', '#3b2a5a', '#5a2a3b', '#1f3a5f', '#2d2d44', '#14532d', '#7c2d12'];

const emptyGoal = () => ({
  code: '',
  title: '',
  initiative: '',
  kpi: '',
  color: BANNER_COLORS[0],
  changeAgenda: [{ id: uid(), from: '', to: '' }],
  deliverables: [{ id: uid(), text: '', targetDate: '', status: '', projectId: '' }],
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
  const { projects } = useProjects();
  const { tasks } = useTasks();
  const [editing, setEditing] = useState(null); // goal object or 'new'

  // Completion per project: average of its tasks' % complete.
  const projectStats = useMemo(() => {
    const m = {};
    projects.forEach((p) => {
      const pts = tasks.filter((t) => t.projectId === p.id);
      const pct = pts.length ? Math.round(pts.reduce((s, t) => s + taskPct(t), 0) / pts.length) : 0;
      m[p.id] = { id: p.id, name: p.name, color: p.color, pct, taskCount: pts.length };
    });
    return m;
  }, [projects, tasks]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Goals</h1>
          <p className="page-subtitle">
            Strategic-plan one-pagers — initiatives, KPI, change agenda, deliverables and target dates.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + New goal
          </button>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading goals…</p>
      ) : goals.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><GoalIcon name="target" size={40} /></div>
          <p>No goals yet.</p>
          <p className="small">Click <strong>+ New goal</strong> to build your first strategic-plan card.</p>
        </div>
      ) : (
        <div className="goals-list">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} projectStats={projectStats} onEdit={() => setEditing(g)} />
          ))}
        </div>
      )}

      {editing && (
        <GoalEditor
          goal={editing === 'new' ? null : editing}
          projects={projects}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ─── Display card (matches the SP3 template) ────────────────────────────────

function GoalCard({ goal, projectStats = {}, onEdit }) {
  const agenda = goal.changeAgenda || [];
  const deliverables = goal.deliverables || [];

  return (
    <div className="goal-card">
      <div className="goal-banner" style={{ background: goal.color || '#1e2a52' }}>
        <h2 className="goal-banner-title">
          {goal.code ? `${goal.code}: ` : ''}{goal.title || 'Untitled goal'}
        </h2>
        <button className="goal-edit-btn" onClick={onEdit} title="Edit goal">
          <GoalIcon name="pencil" size={14} /> Edit
        </button>
      </div>

      <div className="goal-body" style={{ background: goal.color || '#1e2a52' }}>
        {/* INITIATIVES */}
        <div className="goal-srow">
          <div className="goal-chip"><GoalIcon name="initiatives" /> INITIATIVES</div>
          <div className="goal-panel">{goal.initiative || <span className="goal-muted">—</span>}</div>
        </div>

        {/* KPI */}
        <div className="goal-srow">
          <div className="goal-chip"><GoalIcon name="kpi" /> KPI</div>
          <div className="goal-panel">{goal.kpi || <span className="goal-muted">—</span>}</div>
        </div>

        {/* Three-column headers */}
        <div className="goal-cols-head">
          <div className="goal-chip goal-chip-head"><GoalIcon name="change" /> CHANGE AGENDA</div>
          <div className="goal-chip goal-chip-head"><GoalIcon name="deliver" /> DELIVERABLES</div>
          <div className="goal-chip goal-chip-head"><GoalIcon name="calendar" /> TARGET DATE</div>
        </div>

        {/* Three-column bodies */}
        <div className="goal-cols-body">
          {/* Change agenda: FROM → TO pairs */}
          <div className="goal-panel goal-col">
            {agenda.length === 0 ? <span className="goal-muted">—</span> : agenda.map((a, i) => (
              <div key={a.id || i} className="goal-fromto">
                {i > 0 && <div className="goal-divider" />}
                <div className="goal-ft-label">FROM</div>
                <div className="goal-ft-text">{a.from || <span className="goal-muted">—</span>}</div>
                <div className="goal-ft-label" style={{ marginTop: 8 }}>TO</div>
                <div className="goal-ft-text">{a.to || <span className="goal-muted">—</span>}</div>
              </div>
            ))}
          </div>

          {/* Deliverables: numbered, with a per-project progress pill */}
          <div className="goal-panel goal-col">
            {deliverables.length === 0 ? <span className="goal-muted">—</span> : deliverables.map((d, i) => {
              const proj = d.projectId ? projectStats[d.projectId] : null;
              return (
                <div key={d.id || i} className="goal-deliv">
                  {i > 0 && <div className="goal-divider" />}
                  <div className="goal-deliv-row">
                    <span className="goal-deliv-num">{i + 1}.</span>
                    <span className="goal-deliv-text">{d.text || <span className="goal-muted">—</span>}</span>
                  </div>
                  {proj && (
                    <div
                      className="goal-deliv-pill"
                      title={`${proj.name} — ${proj.pct}% complete (${proj.taskCount} task${proj.taskCount === 1 ? '' : 's'})`}
                    >
                      <div className="goal-deliv-pill-fill" style={{ width: `${proj.pct}%`, background: proj.color }} />
                      <span className="goal-deliv-pill-label">{proj.name}</span>
                      <span className="goal-deliv-pill-pct">{proj.pct}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Target date + status, aligned to each deliverable */}
          <div className="goal-panel goal-col">
            {deliverables.length === 0 ? <span className="goal-muted">—</span> : deliverables.map((d, i) => (
              <div key={d.id || i} className="goal-target">
                {i > 0 && <div className="goal-divider" />}
                <div className="goal-target-text">
                  {d.targetDate || d.status ? (
                    <>
                      {d.targetDate && <><strong>Target:</strong> {d.targetDate}<br /></>}
                      {d.status && <><strong>Status:</strong> {d.status}</>}
                    </>
                  ) : <span className="goal-muted">—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Editor modal ───────────────────────────────────────────────────────────

function GoalEditor({ goal, projects = [], onClose }) {
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
          changeAgenda: (goal.changeAgenda?.length ? goal.changeAgenda : [{ id: uid(), from: '', to: '' }])
            .map((a) => ({ id: a.id || uid(), from: a.from || '', to: a.to || '' })),
          deliverables: (goal.deliverables?.length ? goal.deliverables : [{ id: uid(), text: '', targetDate: '', status: '', projectId: '' }])
            .map((d) => ({ id: d.id || uid(), text: d.text || '', targetDate: d.targetDate || '', status: d.status || '', projectId: d.projectId || '' })),
        }
      : emptyGoal()
  );
  const [saving, setSaving] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Change-agenda row helpers
  const addAgenda = () => set({ changeAgenda: [...form.changeAgenda, { id: uid(), from: '', to: '' }] });
  const setAgenda = (id, patch) =>
    set({ changeAgenda: form.changeAgenda.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const delAgenda = (id) =>
    set({ changeAgenda: form.changeAgenda.filter((a) => a.id !== id) });

  // Deliverable row helpers
  const addDeliv = () => set({ deliverables: [...form.deliverables, { id: uid(), text: '', targetDate: '', status: '', projectId: '' }] });
  const setDeliv = (id, patch) =>
    set({ deliverables: form.deliverables.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const delDeliv = (id) =>
    set({ deliverables: form.deliverables.filter((d) => d.id !== id) });

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    // Drop empty rows so the card stays clean.
    const payload = {
      ...form,
      title: form.title.trim(),
      code: form.code.trim(),
      changeAgenda: form.changeAgenda.filter((a) => a.from.trim() || a.to.trim()),
      deliverables: form.deliverables.filter((d) => d.text.trim() || d.targetDate.trim() || d.status.trim() || d.projectId),
    };
    try {
      if (goal) await updateGoal(goal.id, payload);
      else await addGoal(userId, { ...payload, workspaceId });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save goal. Check console.');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!goal) return;
    if (!confirm(`Delete goal "${goal.code ? goal.code + ': ' : ''}${goal.title}"?`)) return;
    setSaving(true);
    try { await softDeleteGoal(goal.id); onClose(); }
    catch (err) { console.error(err); alert('Could not delete. Check console.'); setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, width: '95vw' }}>
        <h3 className="modal-title">{goal ? 'Edit goal' : 'New goal'}</h3>
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

          <div className="field">
            <label className="label">Banner color</label>
            <div className="goal-swatches">
              {BANNER_COLORS.map((c) => (
                <button key={c} type="button"
                  className={`goal-swatch ${form.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => set({ color: c })}
                  aria-label={`Color ${c}`} />
              ))}
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
            <label className="label">Deliverables (with target date, status &amp; project)</label>
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
                  <select className="select select-sm" value={d.projectId || ''}
                    title="Link a project — its completion shows as a progress pill on the card"
                    onChange={(e) => setDeliv(d.id, { projectId: e.target.value })}>
                    <option value="">— Link a project (optional) —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => delDeliv(d.id)}>
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
