// src/components/InboxView.jsx — Messages → Inbox.
//
// Mentions, comments, assignments and whatever an automation raised. It was
// a bell in the top bar; the bar was cleared, and a notice with nowhere to
// land is a feature that quietly stops existing — `mentions.js` would still
// be writing notices nobody could read.
//
// So it is a page in the Messages hub, which is where somebody talking to you
// already lives. The list itself is the same `InboxPanel` the bell used, and
// `useInbox` is the same single listener, so nothing was duplicated to move it.

import { useMemo } from 'react';
import { useInbox } from '../hooks/useInbox';
import { useTasks } from '../hooks/useTasks';
import { goToTask } from '../services/openTask';
import InboxPanel from './InboxPanel';
import { PageActions, PageSubtitle } from './PageHeader';

export default function InboxView({ navigate }) {
  const { notices, unread, markRead, markAllRead } = useInbox();
  const { tasks } = useTasks();
  const taskById = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  const openNotice = (notice) => {
    markRead(notice);
    const task = notice.taskId ? taskById[notice.taskId] : null;
    if (task) goToTask(task, navigate);
    else if (notice.taskId) navigate?.({ view: 'board', projectFilter: 'all' });
  };

  return (
    <>
      <PageSubtitle>
        {notices.length === 0
          ? 'Nothing yet — mentions, comments and assignments land here'
          : `${notices.length} notice${notices.length === 1 ? '' : 's'}${unread ? ` · ${unread} unread` : ' · all read'}`}
      </PageSubtitle>
      <PageActions>
        {unread > 0 && (
          <button className="cmd" onClick={markAllRead}>Mark all as read</button>
        )}
      </PageActions>

      <div className="inbox-page">
        <InboxPanel
          notices={notices}
          unread={unread}
          onOpen={openNotice}
          onMarkAllRead={markAllRead}
        />
      </div>
    </>
  );
}
