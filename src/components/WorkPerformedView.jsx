// src/components/WorkPerformedView.jsx
// Swimlane flowchart — each lane is a project, each node is an activity.
// Columns: Date stub | Project A | Project B | …
// Rows:    sticky lane headers → full-width date bars → per-lane activity cells.

import { Fragment, useMemo, useState } from 'react';
import { useAllActivities, useProjects, useAuth } from '../hooks/useTasks';
import { todayLocal } from '../services/firebase';

/* ── helpers ─────────────────────────────────────────────── */
function friendlyDate(s) {
  const today = todayLocal();
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (s === today) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });
}

const COMPLETION_COLORS = {
  completed:     { bg: 'var(--c-emerald)', label: 'Completed' },
  'in-progress': { bg: 'var(--c-doing)',   label: 'In Progress' },
  blocked:       { bg: 'var(--c-danger)',  label: 'Blocked' },
  'not-started': { bg: 'var(--c-todo)',    label: 'Not Started' },
};

/* ── main component ─────────────────────────────────────── */
export default function WorkPerformedView({ projectFilter }) {
  const { activities, loading } = useAllActivities();
  const { byId: projectById }   = useProjects();
  const { userId }              = useAuth();

  const [expandedId,   setExpandedId]   = useState(null);
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [userFilter,   setUserFilter]   = useState('all');
  const [phaseFilter,  setPhaseFilter]  = useState('all');   // 'all' | 'none' | phaseId
  const [titleFilter,  setTitleFilter]  = useState('');

  /* unique users in the full unfiltered set */
  const uniqueUsers = useMemo(
    () => [...new Set(activities.map(a => a.userId).filter(Boolean))],
    [activities],
  );

  /* phase options:
   *   - projectFilter === 'all'  → list every phase across every project, prefixed
   *                                with the project name so duplicate phase names
   *                                stay distinguishable.
   *   - projectFilter === <pid>  → that project's phases only.
   *   - 'No phase' option is appended when at least one activity in the visible
   *     scope has no phaseId, so users can isolate unassigned activity. */
  const phaseOptions = useMemo(() => {
    const inScope = projectFilter === 'all'
      ? activities
      : activities.filter(a => a.projectId === projectFilter);
    const seen = new Set();
    const out  = [];
    let hasUnphased = false;
    for (const a of inScope) {
      if (!a.phaseId) { hasUnphased = true; continue; }
      if (seen.has(a.phaseId)) continue;
      const proj  = projectById[a.projectId];
      const phase = proj?.phases?.find(p => p.id === a.phaseId);
      if (!phase) continue;
      seen.add(a.phaseId);
      out.push({
        id:    a.phaseId,
        label: projectFilter === 'all' ? `${proj.name} · ${phase.name}` : phase.name,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    if (hasUnphased) out.push({ id: 'none', label: '(No phase)' });
    return out;
  }, [activities, projectFilter, projectById]);

  /* reset the phase filter if the currently-selected phase no longer exists
   * in the current project scope (e.g. user switched projects) */
  if (phaseFilter !== 'all' && phaseFilter !== 'none'
      && phaseOptions.length > 0
      && !phaseOptions.some(o => o.id === phaseFilter)) {
    // setState inside render is safe here — React will queue it and re-render once
    setPhaseFilter('all');
  }

  /* apply all filters + sort */
  const filtered = useMemo(() => {
    let arr = activities.filter(a => a.date);
    if (projectFilter !== 'all') arr = arr.filter(a => a.projectId === projectFilter);
    if (dateFrom) arr = arr.filter(a => a.date >= dateFrom);
    if (dateTo)   arr = arr.filter(a => a.date <= dateTo);
    if (userFilter !== 'all') arr = arr.filter(a => a.userId === userFilter);
    if (phaseFilter === 'none') arr = arr.filter(a => !a.phaseId);
    else if (phaseFilter !== 'all') arr = arr.filter(a => a.phaseId === phaseFilter);
    if (titleFilter.trim()) {
      const needle = titleFilter.trim().toLowerCase();
      arr = arr.filter(a => (a.taskTitle || '').toLowerCase().includes(needle));
    }
    return arr.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.loggedAt?.seconds || 0) - (a.loggedAt?.seconds || 0),
    );
  }, [activities, projectFilter, dateFrom, dateTo, userFilter, phaseFilter, titleFilter]);

  /* lane order: projects that appear in filtered, in order of first appearance */
  const laneIds = useMemo(() => {
    const seen = [];
    for (const a of filtered) {
      if (a.projectId && !seen.includes(a.projectId)) seen.push(a.projectId);
    }
    return seen;
  }, [filtered]);

  /* group by date */
  const byDate = useMemo(
    () => filtered.reduce((acc, a) => { (acc[a.date] = acc[a.date] || []).push(a); return acc; }, {}),
    [filtered],
  );
  const dates = useMemo(() => Object.keys(byDate).sort((a, b) => b.localeCompare(a)), [byDate]);

  /* matrix[date][projectId] = activities[] */
  const matrix = useMemo(
    () => dates.reduce((acc, date) => {
      acc[date] = byDate[date].reduce((m, a) => {
        (m[a.projectId] = m[a.projectId] || []).push(a);
        return m;
      }, {});
      return acc;
    }, {}),
    [dates, byDate],
  );

  const totalHours = useMemo(
    () => filtered.reduce((s, a) => s + (a.hoursSpent || 0), 0),
    [filtered],
  );

  const hasFilters = dateFrom || dateTo || userFilter !== 'all'
                  || phaseFilter !== 'all' || titleFilter.trim() !== '';
  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setUserFilter('all');
    setPhaseFilter('all');
    setTitleFilter('');
  };

  /* ── render ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--c-text-3)' }}>
        <div className="spinner" />&nbsp; Loading work log…
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Performed</h1>
          <p className="page-subtitle">
            {filtered.length} activit{filtered.length === 1 ? 'y' : 'ies'}
            {totalHours > 0 && ` · ${totalHours.toFixed(1)}h total`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="wp-filters">
        <div className="wp-filter-group">
          <label>From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="wp-filter-group">
          <label>To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {phaseOptions.length > 0 && (
          <div className="wp-filter-group">
            <label>Phase</label>
            <select value={phaseFilter} onChange={e => setPhaseFilter(e.target.value)}>
              <option value="all">All phases</option>
              {phaseOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="wp-filter-group">
          <label>Task title</label>
          <input
            type="search"
            value={titleFilter}
            onChange={e => setTitleFilter(e.target.value)}
            placeholder="Search title…"
          />
        </div>
        {uniqueUsers.length > 1 && (
          <div className="wp-filter-group">
            <label>Member</label>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)}>
              <option value="all">All members</option>
              {uniqueUsers.map(uid => (
                <option key={uid} value={uid}>
                  {uid === userId ? '👤 Me' : `User ${uid.slice(0, 6)}…`}
                </option>
              ))}
            </select>
          </div>
        )}
        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>✕ Clear</button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⏱</div>
          <p>{hasFilters ? 'No activities match your filters.' : 'No activities logged yet. Log time on a task to see it here.'}</p>
        </div>
      ) : (
        /* Swimlane */
        <div className="wp-swimlane-scroll">
          <div
            className="wp-swimlane"
            style={{ gridTemplateColumns: `140px repeat(${laneIds.length}, 200px)` }}
          >
            {/* ── Lane headers row ── */}
            <div className="wp-sl-corner">
              <span className="wp-sl-corner-label">Date</span>
            </div>

            {laneIds.map(pid => {
              const proj      = projectById[pid];
              const color     = proj?.color || 'var(--c-accent)';
              const laneHours = filtered
                .filter(a => a.projectId === pid)
                .reduce((s, a) => s + (a.hoursSpent || 0), 0);

              return (
                <div
                  key={pid}
                  className="wp-sl-lane-header"
                  style={{ '--lane-color': color }}
                >
                  <div className="wp-sl-lane-dot" style={{ background: color }} />
                  <div className="wp-sl-lane-info">
                    <span className="wp-sl-lane-name">{proj?.name || 'Unknown Project'}</span>
                    {laneHours > 0 && (
                      <span className="wp-sl-lane-hours" style={{ color }}>{laneHours.toFixed(1)}h</span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* ── Date rows ── */}
            {dates.map(date => {
              const dayActivities = byDate[date];
              const dayHours      = dayActivities.reduce((s, a) => s + (a.hoursSpent || 0), 0);
              const dateMatrix    = matrix[date] || {};

              return (
                <Fragment key={date}>
                  {/* Full-width date separator bar */}
                  <div
                    className="wp-sl-date-bar"
                    style={{ gridColumn: `1 / ${laneIds.length + 2}` }}
                  >
                    <span className="wp-sl-date-text">{friendlyDate(date)}</span>
                    {dayHours > 0 && (
                      <span className="wp-sl-date-hours">{dayHours.toFixed(1)}h</span>
                    )}
                  </div>

                  {/* Date label cell (sticky left) */}
                  <div className="wp-sl-date-cell">
                    <span className="wp-sl-date-stub">{date.slice(5)}</span>
                  </div>

                  {/* Lane cells for this date */}
                  {laneIds.map(pid => {
                    const proj           = projectById[pid];
                    const color          = proj?.color || 'var(--c-accent)';
                    const cellActivities = dateMatrix[pid] || [];

                    return (
                      <div key={pid} className="wp-sl-lane-cell">
                        <div className="wp-sl-track" />
                        {cellActivities.length > 0
                          ? cellActivities.map(a => {
                              const compStatus = COMPLETION_COLORS[a.completionStatus];
                              const isOpen     = expandedId === a.id;
                              return (
                                <ActivityNode
                                  key={a.id}
                                  a={a}
                                  proj={proj}
                                  color={color}
                                  compStatus={compStatus}
                                  isOpen={isOpen}
                                  onToggle={() => setExpandedId(isOpen ? null : a.id)}
                                />
                              );
                            })
                          : <div className="wp-sl-empty-cell" />
                        }
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ActivityNode ────────────────────────────────────────── */
function ActivityNode({ a, proj, color, compStatus, isOpen, onToggle }) {
  return (
    <button
      className={`wp-node-card${isOpen ? ' open' : ''}`}
      style={{ '--node-color': color }}
      onClick={onToggle}
    >
      <div className="wp-node-header">
        <span className="wp-node-title">{a.taskTitle || '(untitled task)'}</span>
        {a.hoursSpent > 0 && (
          <span className="wp-node-badge" style={{ background: color + '22', color }}>
            ⏱ {a.hoursSpent}h
          </span>
        )}
      </div>

      {a.comment && <p className="wp-node-comment">{a.comment}</p>}

      {isOpen && (
        <div className="wp-node-details">
          {a.phaseId && proj?.phases?.find(p => p.id === a.phaseId) && (
            <span className="phase-tag" style={{ fontSize: 10, padding: '1px 6px' }}>
              {proj.phases.find(p => p.id === a.phaseId).name}
            </span>
          )}
          {compStatus && (
            <span
              className="badge"
              style={{ background: compStatus.bg + '22', color: compStatus.bg, fontSize: 11 }}
            >
              {compStatus.label}
            </span>
          )}
          {a.statusAtTime && (
            <span className="badge badge-soft-muted">Task: {a.statusAtTime}</span>
          )}
          {a.requestedBy && (
            <div className="wp-node-meta">
              <span className="muted small">Requested by:</span>
              <span className="small">{a.requestedBy}</span>
            </div>
          )}
          {a.bottleneckRemarks && (
            <div className="wp-card-bottleneck">
              <span className="badge badge-soft-warn">⚠ Bottleneck</span>
              <p className="wp-node-comment" style={{ marginTop: 4 }}>{a.bottleneckRemarks}</p>
            </div>
          )}
          {a.attachments?.length > 0 && (
            <div className="wp-node-meta">
              <span className="muted small">
                📎 {a.attachments.length} attachment{a.attachments.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="wp-node-footer">
        <span className="muted" style={{ fontSize: 10 }}>{a.date}</span>
        <span className="muted" style={{ fontSize: 10 }}>{isOpen ? '▲' : '▼'}</span>
      </div>
    </button>
  );
}
