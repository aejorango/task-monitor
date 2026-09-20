// dev/inbox.jsx — dev-only harness for the inbox and the @mention picker.
//
// Renders the real InboxPanel with sample notices, and the real comment editor
// with sample teammates, so both can be checked without a signed-in session.
//
// Open: http://localhost:5173/dev/inbox.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import InboxPanel from '../src/components/InboxPanel';
import { MarkdownEditor } from '../src/components/Markdown';
import { noticesForComment, sortNotices, unreadCount, watchersOf } from '../src/services/mentions';
import '../src/App.css';

const members = ['u-ace', 'u-mia', 'u-bob'];
const memberProfiles = {
  'u-ace': { displayName: 'Ace Jorango', email: 'ace@blueinnovation.ph' },
  'u-mia': { displayName: 'Mia Santos', email: 'mia.santos@example.com' },
  'u-bob': { displayName: 'Bob Reyes', email: 'bob@example.com' },
};
const task = {
  id: 't1', workspaceId: 'ws1', title: 'Disbursement report',
  userId: 'u-bob', assignedTo: ['u-mia'],
};

const secondsAgo = (s) => ({ seconds: (Date.now() - s * 1000) / 1000 });

const SAMPLE = [
  { id: 'n1', kind: 'mention', read: false, at: secondsAgo(120), taskId: 't1',
    text: 'Ace Jorango mentioned you on “Disbursement report”: can you check the totals?' },
  { id: 'n2', kind: 'assignment', read: false, at: secondsAgo(3600 * 5), taskId: 't2',
    text: 'Mia Santos assigned you “Board pack for Friday”' },
  { id: 'n3', kind: 'comment', read: true, at: secondsAgo(86400 * 2), taskId: 't3',
    text: 'Bob Reyes commented on “SBLAF rollout”: uploaded the signed copy.' },
  { id: 'n4', kind: 'automation', read: true, at: secondsAgo(86400 * 9), taskId: 't4',
    text: 'Quarterly review — A task becomes overdue' },
];

function Harness() {
  const [notices, setNotices] = useState(SAMPLE);
  const [body, setBody] = useState('');
  const [raised, setRaised] = useState([]);

  const open = (n) => setNotices((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
  const markAll = () => setNotices((cur) => cur.map((x) => ({ ...x, read: true })));

  const post = () => {
    setRaised(noticesForComment({
      body, task, authorId: 'u-ace', authorName: 'Ace Jorango',
      members, memberProfiles, watchers: watchersOf(task),
    }));
    setBody('');
  };

  const sorted = sortNotices(notices);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h2>Inbox harness</h2>
      <p className="muted small">
        The real panel with sample notices, and the real comment box with sample
        teammates. Nothing is written — posting shows you the notices it would raise.
      </p>

      <section className="review-section" style={{ marginTop: 16 }}>
        <h2 className="review-h2-accent">The panel ({unreadCount(sorted)} unread)</h2>
        {/* The panel hangs off the topbar bell in the app; here it is pinned
            inside a box so the whole list is on screen. */}
        <div style={{ position: 'relative', height: 460 }}>
          <style>{'.inbox-panel { top: 0 !important; right: auto !important; left: 0; }'}</style>
          <InboxPanel
            notices={sorted}
            unread={unreadCount(sorted)}
            onOpen={open}
            onMarkAllRead={markAll}
          />
        </div>
      </section>

      <section className="review-section" style={{ marginTop: 20 }}>
        <h2 className="review-h2-accent">Naming somebody in a comment</h2>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          rows={3}
          placeholder="Leave a note… type @ to tell somebody about it."
          mentions={{ members, memberProfiles, exclude: ['u-ace'] }}
        />
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={post} disabled={!body.trim()}>
          Comment
        </button>
        {raised.length > 0 && (
          <ul className="dep-list" style={{ marginTop: 12 }}>
            {raised.map((n, i) => (
              <li key={i} className="dep-item" style={{ gridTemplateColumns: 'auto 1fr' }}>
                <span className="badge badge-soft-info">{n.kind}</span>
                <span className="dep-title">
                  <strong>{memberProfiles[n.userId]?.displayName || n.userId}</strong>
                  <span className="muted small" style={{ display: 'block' }}>{n.text}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {raised.length === 0 && body === '' && (
          <p className="muted small">Post something to see who would be told.</p>
        )}
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
