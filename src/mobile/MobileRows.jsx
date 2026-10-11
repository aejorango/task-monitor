// src/mobile/MobileRows.jsx — the two ways the mobile app draws a task:
// the dense ROW (Home's "Needs you", every Tasks group) and the railed CARD
// (the Week view, a project's task list). One of each, so the glyph, the
// colours and the date read the same on every screen.

import { useMobile, Face, StatusPill } from './mobileUi';
import { activateProps } from '../hooks/useActivate';
import {
  M_STATUS, mobileStatus, bucketOf, hoursLabel, ownerOf, shortDate,
} from '../services/mobileModel';

export function TaskRow({ task, mode = 'due' }) {
  const m = useMobile();
  const st = mobileStatus(task, m.blockedIds, m.today);
  const b = bucketOf(task, m.today);
  const selecting = m.tv.selecting && m.tab === 'board';
  const sel = m.tv.sel.includes(task.id);
  const owner = ownerOf(task);
  const project = m.projectById[task.projectId];
  const toggleSel = () => m.patchTv((s) => ({ sel: s.sel.includes(task.id) ? s.sel.filter((x) => x !== task.id) : [...s.sel, task.id] }));
  const meta = `${mode === 'project' ? (owner ? (owner.uid ? m.firstOf(owner.uid) : owner.name) : 'Unassigned') : (project?.name || 'No project')} · ${hoursLabel(task)}`;

  return (
    <div
      className={`m-row${selecting && sel ? ' is-sel' : ''}`}
      {...activateProps(() => (selecting ? toggleSel() : m.openTask(task.id)))}
    >
      {selecting ? (
        <button type="button" className={`m-row-check${sel ? ' is-on' : ''}`}
          aria-label={sel ? 'Deselect' : 'Select'} aria-pressed={sel}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); toggleSel(); }}>{sel ? '✓' : ''}</button>
      ) : (
        <button type="button" className={`m-row-glyph m-tone-${M_STATUS[st].tone}`}
          aria-label={task.status === 'done' ? 'Reopen' : 'Mark done'}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); m.quickDone(task); }}>{M_STATUS[st].glyph}</button>
      )}
      <span className="m-row-main">
        <span className={`m-row-title${task.status === 'done' ? ' is-done' : ''}`}>{task.title || 'Untitled task'}</span>
        <span className="m-row-meta">
          <span className="m-dot" style={{ background: mode === 'project' ? 'var(--m-faint)' : (project?.color || 'var(--m-faint)') }} />
          {meta}
        </span>
      </span>
      {mode !== 'owner' && (owner ? <Face uid={owner.uid} name={owner.name || ''} size={22} /> : <span className="m-row-noav" />)}
      <span className={`m-row-due is-${b}`}>{b === 'done' ? '' : shortDate(task.plan?.endDate, m.today)}</span>
    </div>
  );
}

export function TaskCard({ task, sub = 'project' }) {
  const m = useMobile();
  const st = mobileStatus(task, m.blockedIds, m.today);
  const owner = ownerOf(task);
  const project = m.projectById[task.projectId];
  return (
    <button type="button" className="m-card-row" onClick={() => m.openTask(task.id)}>
      <span className={`m-rail m-rail-${st}`} />
      <span className="m-card-main">
        <span className="m-card-title">{task.title || 'Untitled task'}</span>
        <span className="m-card-meta">
          <StatusPill status={st} />
          {sub === 'due' ? (task.plan?.endDate ? shortDate(task.plan.endDate, m.today) : 'No due date') : (project?.name || 'No project')}
        </span>
      </span>
      {owner ? <Face uid={owner.uid} name={owner.name || ''} size={28} /> : <span className="m-row-noav is-28" />}
    </button>
  );
}
