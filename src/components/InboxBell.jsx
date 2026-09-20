// src/components/InboxBell.jsx — the topbar inbox.
//
// Mentions, comments on your work, tasks you were just given, and anything an
// automation raised for you. The count is what is unread; opening a row goes to
// the task it is about and marks it read, so the inbox empties by being used
// rather than by being tidied. The list itself is InboxPanel.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInbox } from '../hooks/useInbox';
import { useTasks } from '../hooks/useTasks';
import { goToTask } from '../services/openTask';
import InboxPanel from './InboxPanel';

export default function InboxBell({ navigate }) {
  const { notices, unread, markRead, markAllRead, userId } = useInbox();
  const { tasks } = useTasks();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  const taskById = useMemo(
    () => Object.fromEntries((tasks || []).map((t) => [t.id, t])),
    [tasks],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!userId) return null;

  const openNotice = (notice) => {
    markRead(notice);
    setOpen(false);
    const task = notice.taskId ? taskById[notice.taskId] : null;
    if (task) goToTask(task, navigate);
    else if (notice.taskId) navigate?.({ view: 'board', projectFilter: 'all' });
  };

  const label = unread ? `Inbox — ${unread} unread` : 'Inbox — nothing new';

  return (
    <div className="inbox-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={`topbar-bell ${unread ? 'has-unread' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={label}
        title={label}
      >
        <span aria-hidden="true">📥</span>
        {unread > 0 && <span className="topbar-bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <InboxPanel
          notices={notices}
          unread={unread}
          onOpen={openNotice}
          onMarkAllRead={markAllRead}
          panelRef={panelRef}
        />
      )}
    </div>
  );
}
