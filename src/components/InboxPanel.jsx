// src/components/InboxPanel.jsx — the list inside the topbar inbox.
//
// Presentational: it is handed the notices and told what to do when one is
// picked. That keeps the bell (which owns the subscription and the open/closed
// state) separate from the list, and lets dev/inbox.html render the list with
// sample notices without a signed-in session.

import { noticeWhen } from '../services/mentions';

const ICON = {
  mention: '@',
  comment: '💬',
  assignment: '📌',
  automation: '⚙',
};
const KIND_LABEL = {
  mention: 'Mentioned you',
  comment: 'New comment',
  assignment: 'Assigned to you',
  automation: 'An automation ran',
};

export default function InboxPanel({ notices = [], unread = 0, onOpen, onMarkAllRead, panelRef }) {
  return (
    <div className="inbox-panel" ref={panelRef}>
      <div className="inbox-head">
        <strong>Inbox</strong>
        <div style={{ flex: 1 }} />
        {unread > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onMarkAllRead}>
            Mark all as read
          </button>
        )}
      </div>

      {notices.length === 0 ? (
        <p className="muted small inbox-empty">
          Nothing here yet. When somebody mentions you with an @, comments on your
          work, or gives you a task, it lands here.
        </p>
      ) : (
        <ul className="inbox-list">
          {notices.map((n) => (
            <li key={n.id} className={`inbox-item ${n.read ? '' : 'is-unread'}`}>
              <button type="button" className="inbox-row" onClick={() => onOpen?.(n)}>
                <span className="inbox-icon" aria-hidden="true">{ICON[n.kind] || '•'}</span>
                <span className="inbox-body">
                  <span className="inbox-kind">{KIND_LABEL[n.kind] || 'Notice'}</span>
                  <span className="inbox-text">{n.text}</span>
                  <span className="muted small">{noticeWhen(n.at)}</span>
                </span>
                {!n.read && <span className="inbox-dot" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
