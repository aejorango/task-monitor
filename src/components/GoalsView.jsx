// src/components/GoalsView.jsx — Strategic-plan "Goals". Each goal renders as a
// one-pager card matching the SP3 template: title banner, INITIATIVES, KPI, and
// three aligned columns — CHANGE AGENDA (FROM→TO pairs), DELIVERABLES (numbered),
// and TARGET DATE (target + status per deliverable). Create / edit / delete via
// a modal editor.

import { useState } from 'react';
import { useGoals } from '../hooks/useTasks';
import { useActiveWorkspaceId } from '../hooks/useWorkspace';
import { useAuth } from '../hooks/useTasks';
import { addGoal, updateGoal, softDeleteGoal, archiveGoal, uid } from '../services/firebase';

const BANNER_COLORS = ['#1e2a52', '#0f3d3e', '#3b2a5a', '#5a2a3b', '#1f3a5f', '#2d2d44', '#14532d', '#7c2d12'];

const emptyGoal = () => ({
  code: '',
  title: '',
  initiative: '',
  kpi: '',
  color: BANNER_COLORS[0],
  changeAgenda: [{ id: uid(), from: '', to: '' }],
  deliverables: [{ id: uid(), text: '', targetDate: '', status: '' }],
});

export default function GoalsView() {
  const { goals, loading } = useGoals();
  const [editing, setEditing] = useState(null); // goal object or 'new'

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
          <div className="empty-state-icon">◎</div>
          <p>No goals yet.</p>
          <p className="small">Click <strong>+ New goal</strong> to build your first strategic-plan card.</p>
        </div>
      ) : (
        <div className="goals-list">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} />
          ))}
        </div>
      )}

      {editing && (
        <GoalEditor
          goal={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ─── Display card (matches the SP3 template) ────────────────────────────────

function GoalCard({ goal, onEdit }) {
  const agenda = goal.changeAgenda || [];
  const deliverables = goal.deliverables || [];

  return (
    <div className="goal-card">
      <div className="goal-banner" style={{ background: goal.color || '#1e2a52' }}>
        <h2 className="goal-banner-title">
          {goal.code ? `${goal.code}: ` : ''}{goal.title || 'Untitled goal'}
        </h2>
        <button className="goal-edit-btn" onClick={onEdit} title="Edit goal">✎ Edit</button>
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

          {/* Deliverables: numbered */}
          <div className="goal-panel goal-col">
            {deliverables.length === 0 ? <span className="goal-muted">—</span> : deliverables.map((d, i) => (
              <div key={d.id || i} className="goal-deliv">
                {i > 0 && <div className="goal-divider" />}
                <div className="goal-deliv-row">
                  <span className="goal-deliv-num">{i + 1}.</span>
                  <span className="goal-deliv-text">{d.text || <span className="goal-muted">—</span>}</span>
                </div>
              </div>
            ))}
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

function GoalEditor({ goal, onClose }) {
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
          deliverables: (goal.deliverables?.length ? goal.deliverables : [{ id: uid(), text: '', targetDate: '', status: '' }])
            .map((d) => ({ id: d.id || uid(), text: d.text || '', targetDate: d.targetDate || '', status: d.status || '' })),
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
  const addDeliv = () => set({ deliverables: [...form.deliverables, { id: uid(), text: '', targetDate: '', status: '' }] });
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
      deliverables: form.deliverables.filter((d) => d.text.trim() || d.targetDate.trim() || d.status.trim()),
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
                <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => delAgenda(a.id)}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={addAgenda}>+ Add change</button>
          </div>

          {/* Deliverables */}
          <div className="field">
            <label className="label">Deliverables (with target date &amp; status)</label>
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
                </div>
                <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => delDeliv(d.id)}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={addDeliv}>+ Add deliverable</button>
          </div>
        </div>

        <div className="modal-actions">
          {goal && (
            <button className="btn btn-sm btn-ghost goal-del" onClick={remove} disabled={saving}>
              🗑 Delete
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

function GoalIcon({ name }) {
  const common = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, style: { flexShrink: 0 },
  };
  switch (name) {
    case 'initiatives':
      return (<svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="m9 15 2 2 3-4" /></svg>);
    case 'kpi':
      return (<svg {...common}><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 14l4-3.5" /><circle cx="12" cy="14" r="1.3" fill="currentColor" stroke="none" /></svg>);
    case 'change':
      return (<svg {...common}><rect x="3" y="3" width="9" height="9" rx="1.5" /><rect x="12" y="12" width="9" height="9" rx="1.5" /><path d="M16 7h4v4M8 17H4v-4" /></svg>);
    case 'deliver':
      return (<svg {...common}><path d="M3 7h11v8H3z" /><path d="M14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /></svg>);
    case 'calendar':
      return (<svg {...common}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
    default:
      return null;
  }
}
