// src/components/WbsModal.jsx — Work Breakdown Structure popup for a single
// project: Project → Phase → Task → Subtask tree with progress + CSV export.
// Used from the Projects view and from Goals deliverable pills.

import { useTasks } from '../hooks/useTasks';

export default function WbsModal({ project, tasks: tasksProp, onClose }) {
  const { tasks: wsTasks } = useTasks();
  // Callers may pass tasks explicitly (e.g. Goals links a project from another
  // workspace, whose tasks aren't in the active-workspace useTasks()).
  const tasks = tasksProp || wsTasks;

  // Only live tasks for this project
  const projectTasks = tasks.filter(
    (t) => t.projectId === project.id && !t.deleted && !t.archived
  );

  const phases = [...(project.phases || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Group tasks by phase
  const byPhase = {};
  projectTasks.forEach((t) => {
    const key = t.phaseId || '__unphased__';
    if (!byPhase[key]) byPhase[key] = [];
    byPhase[key].push(t);
  });

  const hasUnphased = (byPhase['__unphased__'] || []).length > 0;
  const allPhaseGroups = [
    ...phases.map((ph) => ({ id: ph.id, name: ph.name })),
    ...(hasUnphased ? [{ id: '__unphased__', name: 'Unphased' }] : []),
  ];

  const totalTasks = projectTasks.length;
  const doneTasks  = projectTasks.filter((t) => t.status === 'done').length;
  const pct        = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const STATUS_ICON  = { todo: '○', doing: '◉', done: '✓', blocked: '✕' };
  const STATUS_CLS   = { todo: 'badge-soft-muted', doing: 'badge-soft-info', done: 'badge-soft-success', blocked: 'badge-soft-danger' };
  const PRIO_CLS     = { high: 'badge-soft-danger', medium: 'badge-soft-warn', low: 'badge-soft-muted' };

  // ── CSV export ──────────────────────────────────────────────────────────
  const exportCsv = () => {
    const escape = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['WBS Code', 'Level', 'Name', 'Status', 'Priority', 'Due Date', 'Subtasks Done', 'Subtasks Total', 'Hours Logged'].join(',')];
    rows.push([`1`, 'Project', project.name, '', '', '', '', '', ''].map(escape).join(','));
    allPhaseGroups.forEach((ph, pi) => {
      const phaseTasks = byPhase[ph.id] || [];
      const pCode = `1.${pi + 1}`;
      rows.push([pCode, 'Phase', ph.name, '', '', '', '', '', ''].map(escape).join(','));
      phaseTasks.forEach((t, ti) => {
        const tCode = `${pCode}.${ti + 1}`;
        const doneS  = (t.subtasks || []).filter((s) => s.done).length;
        const totalS = (t.subtasks || []).length;
        rows.push([tCode, 'Task', t.title, t.status, t.priority || '', t.plan?.endDate || '', doneS, totalS, t.totalHoursLogged || 0].map(escape).join(','));
        (t.subtasks || []).forEach((st, si) => {
          rows.push([`${tCode}.${si + 1}`, 'Subtask', st.text, st.done ? 'done' : 'todo', '', '', '', '', ''].map(escape).join(','));
        });
      });
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w.\-]+/g, '_')}-WBS-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 780, width: '95vw' }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: project.color, flexShrink: 0, display: 'inline-block' }} />
          <h3 className="modal-title" style={{ margin: 0 }}>Work Breakdown Structure</h3>
        </div>
        <p className="modal-sub">
          {project.name} · {totalTasks} task{totalTasks !== 1 ? 's' : ''} · {doneTasks} done · {pct}% complete
        </p>

        {/* ── Overall progress bar ── */}
        <div className="wbs-progress-track">
          <div className="wbs-progress-fill" style={{ width: `${pct}%`, background: project.color }} />
        </div>

        {/* ── WBS tree ── */}
        <div className="wbs-tree" style={{ maxHeight: '60vh', overflowY: 'auto' }}>

          {/* Root node */}
          <div className="wbs-root-row">
            <span className="wbs-code">1</span>
            <span className="wbs-root-dot" style={{ background: project.color }} />
            <span className="wbs-root-label">{project.name}</span>
            <span className="muted small">{doneTasks}/{totalTasks} tasks</span>
          </div>

          {totalTasks === 0 && (
            <div className="wbs-empty">No tasks in this project yet. Add tasks from the Board.</div>
          )}

          {/* Phases */}
          {allPhaseGroups.map((ph, pi) => {
            const phaseTasks = byPhase[ph.id] || [];
            if (phaseTasks.length === 0) return null;
            const pCode    = `1.${pi + 1}`;
            const pDone    = phaseTasks.filter((t) => t.status === 'done').length;
            const pPct     = phaseTasks.length > 0 ? Math.round((pDone / phaseTasks.length) * 100) : 0;

            return (
              <div key={ph.id} className="wbs-phase-group">
                {/* Phase row */}
                <div className="wbs-phase-row">
                  <span className="wbs-code">{pCode}</span>
                  <span className="wbs-phase-icon">◈</span>
                  <span className="wbs-phase-label">{ph.name}</span>
                  <span className="muted small">{pDone}/{phaseTasks.length}</span>
                  <div className="wbs-mini-bar">
                    <div style={{ width: `${pPct}%`, background: project.color }} />
                  </div>
                  <span className="muted small" style={{ minWidth: 30, textAlign: 'right' }}>{pPct}%</span>
                </div>

                {/* Tasks */}
                {phaseTasks.map((task, ti) => {
                  const tCode    = `${pCode}.${ti + 1}`;
                  const doneS    = (task.subtasks || []).filter((s) => s.done).length;
                  const totalS   = (task.subtasks || []).length;
                  const hasSubtasks = totalS > 0;

                  return (
                    <div key={task.id} className="wbs-task-group">
                      {/* Task row */}
                      <div className="wbs-task-row">
                        <span className="wbs-code muted">{tCode}</span>
                        <span className={`wbs-status-icon wbs-status-${task.status}`}>
                          {STATUS_ICON[task.status] || '○'}
                        </span>
                        <span className="wbs-task-title">{task.title}</span>
                        <span className={`badge ${STATUS_CLS[task.status] || 'badge-soft-muted'}`}>
                          {task.status}
                        </span>
                        {task.priority && task.priority !== 'medium' && (
                          <span className={`badge ${PRIO_CLS[task.priority] || 'badge-soft-muted'}`}>
                            {task.priority}
                          </span>
                        )}
                        {task.plan?.endDate && (
                          <span className="muted small">📅 {task.plan.endDate}</span>
                        )}
                        {hasSubtasks && (
                          <span className="muted small">☑ {doneS}/{totalS}</span>
                        )}
                        {(task.totalHoursLogged > 0) && (
                          <span className="muted small">⏱ {task.totalHoursLogged.toFixed(1)}h</span>
                        )}
                      </div>

                      {/* Subtasks */}
                      {hasSubtasks && (
                        <div className="wbs-subtask-list">
                          {task.subtasks.map((st, si) => (
                            <div key={st.id || si} className={`wbs-subtask-row ${st.done ? 'done' : ''}`}>
                              <span className="wbs-code muted">{tCode}.{si + 1}</span>
                              <span className="wbs-subtask-check">{st.done ? '☑' : '☐'}</span>
                              <span className="wbs-subtask-text">{st.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={exportCsv} disabled={totalTasks === 0}>
            ⬇ Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
