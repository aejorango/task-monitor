// src/components/AutomationsSection.jsx — Settings → Automations.
//
// "When a task is completed and its project is SBLAF rollout, tell someone."
// The whole rule is dropdowns; nothing here asks anybody to type JSON, a field
// name, or an id. The sentence under the form is the rule read back, so you can
// check what you built before saving it.
//
// The vocabularies and the validation come from functions/src/automations.js —
// the same module the runner uses, so the editor and the rule can never mean
// two different things.

import { useEffect, useMemo, useState } from 'react';
import { useProjects } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import {
  addAutomation, updateAutomation, softDeleteAutomation,
  subscribeToAutomations, subscribeToAutomationRuns, subscribeToWebhooks,
} from '../services/firebase';
import {
  ACTIONS, CONDITION_FIELDS, OPERATORS, TRIGGERS, describeRule, validateRule,
} from '../../functions/src/automations.js';
import { memberLabel } from '../services/invites';
import { friendlyError } from '../services/access';
import { useModalDialog } from '../hooks/useModalDialog';
import { useToast } from './Toast';
import { useDialog } from './Dialog';

const blankRule = (workspaceId) => ({
  workspaceId,
  name: '',
  trigger: 'task.completed',
  conditions: [],
  action: 'notify',
  actionValue: '',
  enabled: true,
});

// Three rules people actually ask for, one click away. Each still opens the
// editor, so nothing is created behind anybody's back and every part of it can
// be changed before it is saved.
const STARTERS = [
  {
    label: 'Open a follow-up when something is finished',
    rule: (ws) => ({
      ...blankRule(ws),
      name: 'Follow up on finished work',
      trigger: 'task.completed',
      action: 'follow_up',
      actionValue: '',
    }),
  },
  {
    label: 'Tell someone when a task falls behind',
    rule: (ws) => ({
      ...blankRule(ws),
      name: 'Chase overdue work',
      trigger: 'task.overdue',
      action: 'notify',
      actionValue: '',
    }),
  },
  {
    label: 'Raise the priority of anything tagged urgent',
    rule: (ws) => ({
      ...blankRule(ws),
      name: 'Urgent means high priority',
      trigger: 'task.created',
      conditions: [{ field: 'tag', operator: 'contains', value: 'urgent' }],
      action: 'set_priority',
      actionValue: 'high',
    }),
  },
];

export default function AutomationsSection({ userId, isAdmin = false }) {
  const workspaceId = useActiveWorkspaceId();
  const { projects } = useProjects();
  const { workspaces } = useWorkspaces();
  const toast = useToast();
  const ask = useDialog();

  const [rules, setRules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showRuns, setShowRuns] = useState(false);
  const [busy, setBusy] = useState(false);

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const memberProfiles = useMemo(() => workspace?.memberProfiles || {}, [workspace]);
  const members = useMemo(() => workspace?.members || [], [workspace]);

  // Each of these hands back an empty list (and no listener) without a
  // workspace, so there is nothing to reset here.
  useEffect(() => subscribeToAutomations(workspaceId, setRules), [workspaceId]);
  useEffect(() => subscribeToWebhooks(workspaceId, setWebhooks), [workspaceId]);

  // A closed panel must not hold a listener.
  useEffect(() => {
    if (!showRuns || !workspaceId) return undefined;
    return subscribeToAutomationRuns(workspaceId, setRuns);
  }, [showRuns, workspaceId]);

  // Turns any id in a rule into the name a person recognises.
  const nameFor = useMemo(() => (id) => (
    projects.find((p) => p.id === id)?.name
    || (members.includes(id) ? memberLabel(id, memberProfiles) : null)
    || projects.flatMap((p) => p.phases || []).find((ph) => ph.id === id)?.name
    || webhooks.find((h) => h.id === id)?.name
    || id
  ), [projects, members, memberProfiles, webhooks]);

  const save = async (rule) => {
    const problem = validateRule(rule);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      if (rule.id) {
        const { id, ...fields } = rule;
        await updateAutomation(id, fields);
      } else {
        await addAutomation(userId, rule);
      }
      setEditing(null);
      toast.success(rule.id ? 'Rule saved.' : 'Rule created. It runs from now on.');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not save that rule.'));
    } finally { setBusy(false); }
  };

  const remove = async (rule) => {
    if (!await ask.confirm({
      title: `Delete “${rule.name}”?`,
      message: 'It stops running straight away. Anything it already did stays done.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    try {
      await softDeleteAutomation(rule.id);
      toast.success('Rule deleted.');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not delete that rule.'));
    }
  };

  const toggle = async (rule) => {
    try { await updateAutomation(rule.id, { enabled: !rule.enabled }); }
    catch (err) { console.error(err); toast.error(friendlyError(err, 'Could not change that rule.')); }
  };

  return (
    <section id="settings-automations" className="review-section htu-section">
      <h2 className="review-h2">Automations</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Make the app do something for you when something happens — tell a person,
        assign a task, add a tag, or open a follow-up. No typing: every part of a
        rule is a choice. Anyone a rule tells finds it in their inbox, at the top
        of the screen.
      </p>

      {!workspaceId ? (
        <p className="muted small">Pick a workspace first — rules belong to one.</p>
      ) : rules.length === 0 ? (
        <p className="muted small">
          No automations yet. {isAdmin
            ? 'Start with one of these, or build your own.'
            : 'An owner or an admin of this workspace can add one.'}
        </p>
      ) : (
        <ul className="dep-list">
          {rules.map((rule) => (
            <li key={rule.id} className="dep-item" style={{ gridTemplateColumns: 'auto 1fr auto auto auto' }}>
              <span className={`badge badge-soft-${rule.enabled ? 'success' : 'muted'}`}>
                {rule.enabled ? 'on' : 'off'}
              </span>
              <span className="dep-title">
                <strong>{rule.name}</strong>
                <span className="muted small" style={{ display: 'block' }}>
                  {describeRule(rule, { nameFor })}
                </span>
              </span>
              {isAdmin && (
                <>
                  <button className="btn btn-sm btn-ghost" onClick={() => toggle(rule)}>
                    {rule.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(rule)}>Edit</button>
                  <button
                    className="btn btn-sm btn-ghost link-danger"
                    onClick={() => remove(rule)}
                    aria-label={`Delete ${rule.name}`}
                  >✕</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && workspaceId && rules.length === 0 && (
        <ul className="au-starters">
          {STARTERS.map((s) => (
            <li key={s.label}>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s.rule(workspaceId))}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {isAdmin && workspaceId && (
          <button className="btn btn-sm" onClick={() => setEditing(blankRule(workspaceId))}>
            + New automation
          </button>
        )}
        {rules.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => setShowRuns((v) => !v)}>
            {showRuns ? 'Hide what they did' : 'What they did'}
          </button>
        )}
      </div>

      {showRuns && (
        <div style={{ marginTop: 12 }}>
          {runs.length === 0 ? (
            <p className="muted small">Nothing yet. A rule runs the next time its trigger happens.</p>
          ) : (
            <>
              <ul className="dep-list">
                {runs.map((run) => (
                  <li key={run.id} className="dep-item" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                    <span className={`badge badge-soft-${run.outcome === 'done' ? 'success' : 'muted'}`}>
                      {run.outcome === 'done' ? 'ran' : 'skipped'}
                    </span>
                    <span className="dep-title">
                      <strong>{run.ruleName}</strong>
                      {run.taskTitle && <span className="muted"> — {run.taskTitle}</span>}
                      <span className="muted small" style={{ display: 'block' }}>{run.message}</span>
                    </span>
                    <span className="muted small">
                      {run.at?.toDate ? run.at.toDate().toLocaleString() : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted small">The last 50 runs. Kept for 30 days.</p>
            </>
          )}
        </div>
      )}

      {editing && (
        <AutomationEditor
          rule={editing}
          projects={projects}
          members={members}
          memberProfiles={memberProfiles}
          webhooks={webhooks}
          nameFor={nameFor}
          busy={busy}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

// Exported for dev/automations.html, which renders it with sample data so the
// form can be checked without a signed-in Firestore session.
export function AutomationEditor({
  rule, projects, members, memberProfiles, webhooks, nameFor, busy, onSave, onClose,
}) {
  const [draft, setDraft] = useState(rule);
  const modal = useModalDialog({ onClose: busy ? undefined : onClose });
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const action = ACTIONS.find((a) => a.value === draft.action);
  const problem = validateRule(draft);

  const valueControl = (need, value, onChange, options, label) => {
    if (need === 'member') {
      return (
        <select className="select select-sm" value={value} onChange={onChange} aria-label={label}>
          <option value="">— choose a person —</option>
          {members.map((uid) => (
            <option key={uid} value={uid}>{memberLabel(uid, memberProfiles)}</option>
          ))}
        </select>
      );
    }
    if (need === 'project') {
      return (
        <select className="select select-sm" value={value} onChange={onChange} aria-label={label}>
          <option value="">— choose a project —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      );
    }
    if (need === 'phase') {
      return (
        <select className="select select-sm" value={value} onChange={onChange} aria-label={label}>
          <option value="">— choose a phase —</option>
          {projects.flatMap((p) => (p.phases || []).map((ph) => (
            <option key={ph.id} value={ph.id}>{p.name} → {ph.name}</option>
          )))}
        </select>
      );
    }
    if (need === 'webhook') {
      return (
        <select className="select select-sm" value={value} onChange={onChange} aria-label={label}>
          <option value="">— choose a connection —</option>
          {webhooks.map((h) => <option key={h.id} value={h.id}>{h.name || h.url}</option>)}
        </select>
      );
    }
    if (need === 'choice') {
      return (
        <select className="select select-sm" value={value} onChange={onChange} aria-label={label}>
          <option value="">— choose —</option>
          {(options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input className="input input-sm" value={value} onChange={onChange} aria-label={label}
        placeholder={need === 'text' ? 'Type it here' : ''} />
    );
  };

  const setCondition = (i, patch) => set({
    conditions: draft.conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)),
  });

  return (
    <div className="modal-backdrop" {...modal.backdropProps}>
      <div className="modal modal-wide" {...modal.dialogProps} style={{ maxWidth: 720 }}>
        <h3 className="modal-title" id={modal.titleId}>
          {rule.id ? 'Edit automation' : 'New automation'}
        </h3>

        <div className="field">
          <label className="label" htmlFor="au-name">What shall we call it?</label>
          <input
            id="au-name"
            className="input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Tell me when a report is finished"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="au-trigger">When this happens</label>
          <select id="au-trigger" className="select" value={draft.trigger}
            onChange={(e) => set({ trigger: e.target.value })}>
            {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="field">
          <span className="label">Only when</span>
          {draft.conditions.length === 0 && (
            <p className="muted small" style={{ marginTop: 0 }}>Always — add a condition to narrow it down.</p>
          )}
          {draft.conditions.map((c, i) => {
            const field = CONDITION_FIELDS.find((f) => f.value === c.field);
            const op = OPERATORS.find((o) => o.value === c.operator);
            return (
              <div key={i} className="au-condition">
                <select className="select select-sm" value={c.field || ''} aria-label="What to check"
                  onChange={(e) => setCondition(i, { field: e.target.value, value: '' })}>
                  <option value="">— choose —</option>
                  {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select className="select select-sm" value={c.operator || 'is'} aria-label="How to compare it"
                  onChange={(e) => setCondition(i, { operator: e.target.value })}>
                  {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {!op?.noValue && valueControl(
                  field?.type || 'text',
                  c.value || '',
                  (e) => setCondition(i, { value: e.target.value }),
                  field?.options,
                  'What it should be',
                )}
                <button
                  type="button" className="btn btn-sm btn-ghost link-danger"
                  aria-label="Remove this condition"
                  onClick={() => set({ conditions: draft.conditions.filter((_, k) => k !== i) })}
                >✕</button>
              </div>
            );
          })}
          <button
            type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 6 }}
            onClick={() => set({ conditions: [...draft.conditions, { field: 'project', operator: 'is', value: '' }] })}
          >+ Add a condition</button>
        </div>

        <div className="field">
          <span className="label">Then</span>
          <div className="au-condition">
            <select className="select select-sm" value={draft.action} aria-label="What to do"
              onChange={(e) => set({ action: e.target.value, actionValue: '' })}>
              {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            {valueControl(action?.needs, draft.actionValue || '',
              (e) => set({ actionValue: e.target.value }), action?.options, 'What to use')}
          </div>
          {draft.action === 'webhook' && webhooks.length === 0 && (
            <p className="muted small">
              You have not set up a connection yet — add one under Webhooks, just above.
            </p>
          )}
        </div>

        <p className="au-preview">
          <strong>In other words:</strong> {describeRule(draft, { nameFor })}
        </p>

        {problem && <p className="auth-error-msg">{problem}</p>}

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(draft)} disabled={busy || !!problem}>
            {busy ? 'Saving…' : rule.id ? 'Save changes' : 'Create it'}
          </button>
        </div>
      </div>
    </div>
  );
}
