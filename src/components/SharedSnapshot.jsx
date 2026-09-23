// src/components/SharedSnapshot.jsx — the read-only project page itself.
//
// Presentational: handed one share document, it renders the board or the
// timeline it holds. Split from SharedViewPage (which does the fetching) so
// dev/shared.html can render it with a sample snapshot, and so the page a
// stranger sees has no data-fetching in it at all.

import { useMemo } from 'react';
import { buildBars, shareStatus } from '../services/shareLinks';

const STATUS_LABEL = { todo: 'To do', doing: 'In progress', review: 'In review', done: 'Done' };
const STATUS_ORDER = ['todo', 'doing', 'review', 'done'];
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

const DAY = 86400000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());

export default function SharedSnapshot({ share }) {
  const snapshot = share.snapshot || {};
  const status = shareStatus(share);

  return (
    <div className="shared-page">
      <header className="shared-head">
        <div>
          <p className="muted small" style={{ margin: 0 }}>Shared with you · read only</p>
          <h1 className="shared-title">{snapshot.projectName || share.projectName}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {snapshot.counts?.total ?? 0} task{(snapshot.counts?.total ?? 0) === 1 ? '' : 's'}
            {' · '}{snapshot.counts?.done ?? 0} finished
            {(snapshot.counts?.overdue ?? 0) > 0 && ` · ${snapshot.counts.overdue} overdue`}
          </p>
        </div>
        <div className="shared-asof muted small">
          <div>As it was on {niceDate(snapshot.generatedAt)}</div>
          {share.createdByName && <div>Shared by {share.createdByName}</div>}
          <div>{status.text}</div>
        </div>
      </header>

      {(snapshot.tasks || []).length === 0 ? (
        <p className="muted">There is nothing on this project yet.</p>
      ) : share.kind === 'board' ? (
        <SharedBoard tasks={snapshot.tasks} />
      ) : (
        <SharedTimeline tasks={snapshot.tasks} />
      )}

      <footer className="shared-foot muted small">
        This is a snapshot of one project, shared with you as a read-only page.
        It does not show comments, attachments, hours or who is working on what,
        and nothing here can be changed.
      </footer>
    </div>
  );
}
function niceDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return 'an earlier date';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function SharedBoard({ tasks }) {
  const columns = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    tasks: tasks.filter((t) => (t.status || 'todo') === status),
  }));

  return (
    <div className="shared-board">
      {columns.map((col) => (
        <section key={col.status} className="shared-column">
          <h2 className="shared-column-head">
            {col.label} <span className="muted small">{col.tasks.length}</span>
          </h2>
          {col.tasks.length === 0 ? (
            <p className="muted small">Nothing here.</p>
          ) : (
            <ul className="shared-card-list">
              {col.tasks.map((task) => (
                <li key={task.id} className="shared-card">
                  <span className="shared-card-title">{task.title}</span>
                  <span className="muted small shared-card-meta">
                    {task.phase && <span>{task.phase}</span>}
                    {task.endDate && (
                      <span className={isLate(task) ? 'shared-late' : ''}>
                        Due {task.endDate}
                      </span>
                    )}
                    <span>{PRIORITY_LABEL[task.priority] || task.priority}</span>
                  </span>
                  {task.status !== 'done' && task.progress > 0 && (
                    <span className="shared-progress" aria-label={`${task.progress}% done`}>
                      <span className="shared-progress-fill" style={{ width: `${task.progress}%` }} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

const isLate = (task) => task.status !== 'done' && task.endDate && task.endDate < todayIso();

function SharedTimeline({ tasks }) {
  const { start, span, rows } = useMemo(() => buildBars(tasks), [tasks]);

  return (
    <div className="shared-timeline">
      <p className="muted small">
        {niceDate(new Date(start).toISOString())} to {niceDate(new Date(start + span * DAY).toISOString())}
      </p>
      <ul className="shared-bar-list">
        {rows.map((row) => (
          <li key={row.task.id} className="shared-bar-row">
            <span className="shared-bar-label">
              {row.task.title}
              {row.task.phase && <span className="muted small"> · {row.task.phase}</span>}
            </span>
            <span className="shared-bar-track">
              {row.width === null ? (
                <span className="muted small shared-bar-none">No dates yet</span>
              ) : (
                <span
                  className={`shared-bar ${row.task.status === 'done' ? 'is-done' : ''} ${isLate(row.task) ? 'is-late' : ''}`}
                  style={{ left: `${row.left}%`, width: `${row.width}%` }}
                  title={`${row.task.startDate || '?'} → ${row.task.endDate || '?'} · ${STATUS_LABEL[row.task.status] || row.task.status}`}
                />
              )}
            </span>
            <span className="muted small shared-bar-when">
              {row.task.endDate ? `Due ${row.task.endDate}` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
