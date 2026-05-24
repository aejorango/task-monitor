// src/components/WorkPerformedView.jsx
// Timeline of all logged activities — vertical spine with colored project nodes,
// alternating callout cards, date markers, and daily hour totals.
// Visual reference: git-flow timeline with activity "commits" per project branch.

import { useMemo, useState } from 'react';
import { useAllActivities, useProjects } from '../hooks/useTasks';
import { todayLocal } from '../services/firebase';

function friendlyDate(s) {
  const today = todayLocal();
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (s === today)
    return 'Today';
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

const COMPLETION_COLORS = {
  completed:   { bg: 'var(--c-emerald)',  label: 'Completed' },
  'in-progress': { bg: 'var(--c-doing)',  label: 'In Progress' },
  blocked:     { bg: 'var(--c-danger)',   label: 'Blocked' },
  'not-started': { bg: 'var(--c-todo)',   label: 'Not Started' },
};

export default function WorkPerformedView({ projectFilter }) {
  const { activities, loading } = useAllActivities();
  const { byId: projectById } = useProjects();
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() =>
    (projectFilter === 'all' ? activities : activities.filter(a => a.projectId === projectFilter))
      .filter(a => a.date)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.loggedAt?.seconds || 0) - (a.loggedAt?.seconds || 0)),
    [activities, projectFilter]
  );

  // Group by date
  const byDate = useMemo(() =>
    filtered.reduce((acc, a) => {
      (acc[a.date] = acc[a.date] || []).push(a);
      return acc;
    }, {}),
    [filtered]
  );

  const dates = useMemo(() => Object.keys(byDate).sort((a, b) => b.localeCompare(a)), [byDate]);

  const totalHours = useMemo(() => filtered.reduce((s, a) => s + (a.hoursSpent || 0), 0), [filtered]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--c-text-3)' }}>
        <div className="spinner" />&nbsp; Loading work log…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Work Performed</h1>
            <p className="page-subtitle">Timeline of all logged activities and time spent</p>
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">⏱</div>
          <p>No activities logged yet. Log time on a task to see it here.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Performed</h1>
          <p className="page-subtitle">
            {filtered.length} activit{filtered.length === 1 ? 'y' : 'ies'} · {totalHours.toFixed(1)}h total logged
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="wp-timeline">
        {dates.map((date) => {
          const dayActivities = byDate[date];
          const dayHours = dayActivities.reduce((s, a) => s + (a.hoursSpent || 0), 0);

          return (
            <div key={date} className="wp-day-group">

              {/* Date marker */}
              <div className="wp-date-marker">
                <div className="wp-date-badge">
                  <span className="wp-date-text">{friendlyDate(date)}</span>
                  {dayHours > 0 && (
                    <span className="wp-date-hours">{dayHours.toFixed(1)}h</span>
                  )}
                </div>
                <div className="wp-date-line" />
              </div>

              {/* Activities for this day */}
              <div className="wp-day-activities">
                {dayActivities.map((a, idx) => {
                  const proj    = projectById[a.projectId];
                  const color   = proj?.color || 'var(--c-accent)';
                  const side    = idx % 2 === 0 ? 'left' : 'right';
                  const isOpen  = expandedId === a.id;
                  const compStatus = COMPLETION_COLORS[a.completionStatus];

                  return (
                    <div key={a.id} className={`wp-activity wp-activity-${side}`}>

                      {/* Left callout */}
                      {side === 'left' && (
                        <ActivityCard
                          a={a} proj={proj} color={color} compStatus={compStatus}
                          isOpen={isOpen} onToggle={() => setExpandedId(isOpen ? null : a.id)}
                        />
                      )}

                      {/* Spine node */}
                      <div className="wp-spine">
                        <div className="wp-spine-line" />
                        <div
                          className="wp-node"
                          style={{ background: color, boxShadow: `0 0 0 3px ${color}30` }}
                          title={a.taskTitle}
                        >
                          {a.hoursSpent ? (
                            <span className="wp-node-label">{a.hoursSpent}h</span>
                          ) : (
                            <span className="wp-node-dot" />
                          )}
                        </div>
                        <div className="wp-spine-line" />
                      </div>

                      {/* Right callout */}
                      {side === 'right' && (
                        <ActivityCard
                          a={a} proj={proj} color={color} compStatus={compStatus}
                          isOpen={isOpen} onToggle={() => setExpandedId(isOpen ? null : a.id)}
                        />
                      )}

                      {/* Empty placeholder on the opposite side */}
                      {side === 'left'  && <div className="wp-card-placeholder" />}
                      {side === 'right' && <div className="wp-card-placeholder" style={{ order: -1 }} />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Timeline end cap */}
        <div className="wp-end-cap">
          <div className="wp-end-dot" />
        </div>
      </div>
    </div>
  );
}

function ActivityCard({ a, proj, color, compStatus, isOpen, onToggle }) {
  return (
    <button
      className={`wp-card ${isOpen ? 'open' : ''}`}
      onClick={onToggle}
      style={{ '--proj-color': color }}
    >
      <div className="wp-card-inner">
        <div className="wp-card-header">
          <span className="wp-card-title">{a.taskTitle || '(untitled task)'}</span>
          {a.hoursSpent > 0 && (
            <span className="wp-hours-badge" style={{ background: color + '22', color }}>
              ⏱ {a.hoursSpent}h
            </span>
          )}
        </div>

        {proj && (
          <div className="wp-card-proj">
            <span className="proj-dot" style={{ background: color }} />
            <span>{proj.name}</span>
            {a.phaseId && proj?.phases?.find(p => p.id === a.phaseId) && (
              <span className="phase-tag" style={{ fontSize: 10, padding: '1px 6px' }}>
                {proj.phases.find(p => p.id === a.phaseId).name}
              </span>
            )}
          </div>
        )}

        {a.comment && (
          <p className="wp-card-comment">{a.comment}</p>
        )}

        {isOpen && (
          <div className="wp-card-details">
            {compStatus && (
              <span className="badge" style={{ background: compStatus.bg + '22', color: compStatus.bg, fontSize: 11 }}>
                {compStatus.label}
              </span>
            )}
            {a.statusAtTime && (
              <span className="badge badge-soft-muted">Task: {a.statusAtTime}</span>
            )}
            {a.requestedBy && (
              <div className="wp-card-meta-row">
                <span className="muted small">Requested by:</span>
                <span className="small">{a.requestedBy}</span>
              </div>
            )}
            {a.bottleneckRemarks && (
              <div className="wp-card-bottleneck">
                <span className="badge badge-soft-warn">⚠ Bottleneck</span>
                <p className="wp-card-comment" style={{ marginTop: 4 }}>{a.bottleneckRemarks}</p>
              </div>
            )}
            {a.attachments?.length > 0 && (
              <div className="wp-card-meta-row">
                <span className="muted small">📎 {a.attachments.length} attachment{a.attachments.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        )}

        <div className="wp-card-footer">
          <span className="muted" style={{ fontSize: 11 }}>{a.date}</span>
          <span className="muted" style={{ fontSize: 11 }}>{isOpen ? '▲ less' : '▼ more'}</span>
        </div>
      </div>
    </button>
  );
}
