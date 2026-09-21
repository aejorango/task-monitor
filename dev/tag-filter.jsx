// dev/tag-filter.jsx — harness for BUG-018 (T-0102 / T-0103). No sign-in needed.
//
//   npm run dev  →  http://localhost:5175/dev/tag-filter.html
//
// A saved view stores the tag it was filtered by, and the router hands it to
// every page as `initialTagFilter`. Board honoured it; the Gantt, the Activity
// Log and the Calendar declared no such prop, so the view showed everything
// while the sidebar tooltip still advertised the tag.
//
// The panel on the left is the tasks a page would show; the one on the right is
// the activity log, whose entries have no tags of their own and borrow them
// from the task they were logged against.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TagFilterBar from '../src/components/TagFilterBar.jsx';
import { tagFilterState } from '../src/services/tagFilter.js';
import '../src/App.css';

const TASKS = [
  { id: 't1', title: 'Client kickoff', tags: ['client', 'q3'] },
  { id: 't2', title: 'Fix the build', tags: ['internal'] },
  { id: 't3', title: 'Untagged housekeeping' },
  { id: 't4', title: 'Client review', tags: ['client'] },
];
const taskById = Object.fromEntries(TASKS.map((t) => [t.id, t]));

const ACTIVITIES = [
  { id: 'a1', taskId: 't1', comment: 'Ran the kickoff call' },
  { id: 'a2', taskId: 't2', comment: 'Fixed the build' },
  { id: 'a3', taskId: 't3', comment: 'Tidied the backlog' },
  { id: 'a4', taskId: 'gone', comment: 'Against a task no longer loaded' },
];

function Panel({ title, note, items, tag, setTag, ctx, render }) {
  const state = tagFilterState(items, tag, ctx);
  return (
    <div style={{ flex: 1, minWidth: 320 }}>
      <h3 style={{ marginBottom: 4 }}>{title}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>{note}</p>
      <TagFilterBar state={state} onChange={setTag} />
      {state.filtered.length === 0 ? (
        <p className="muted small">
          Nothing carries #{state.active}.{' '}
          <button className="table-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
            onClick={() => setTag(null)}>Clear the tag filter</button>.
        </p>
      ) : (
        <ul>{state.filtered.map((it) => <li key={it.id}>{render(it)}</li>)}</ul>
      )}
      <p className="small muted">
        Showing {state.filtered.length} of {items.length}
        {state.missing ? ' · the filter names a tag nothing here carries' : ''}
      </p>
    </div>
  );
}

export function Harness() {
  const [tag, setTag] = useState(new URLSearchParams(location.search).get('tag') || null);
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>Tag filter · BUG-018</h2>
      <p className="muted">
        Saved-view filter: <code>{tag ? `#${tag}` : 'none'}</code> — try{' '}
        <a href="?tag=client">#client</a> · <a href="?tag=internal">#internal</a> ·{' '}
        <a href="?tag=renamed-since">a tag nothing carries</a> · <a href="?">none</a>.
      </p>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <Panel
          title="Board / Gantt / Calendar"
          note="Tasks carry their own tags."
          items={TASKS} tag={tag} setTag={setTag}
          render={(t) => `${t.title} — ${(t.tags || []).map((x) => `#${x}`).join(' ') || 'no tags'}`}
        />
        <Panel
          title="Activity Log"
          note="An activity borrows its tags from the task it was logged against."
          items={ACTIVITIES} tag={tag} setTag={setTag} ctx={{ taskById }}
          render={(a) => `${a.comment} — via ${taskById[a.taskId]?.title || 'a task no longer loaded'}`}
        />
      </div>
      <p className="muted" style={{ marginTop: 24 }}>
        <strong>What good looks like:</strong> #client shows two tasks and one log entry.
        The entry against a task that is no longer loaded is never shown under any tag —
        better to show less than to show a #client entry to somebody filtering for
        something else. A tag nothing carries still shows its chip, so the empty page has
        a visible, clearable reason.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
