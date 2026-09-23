// src/components/FindItem.jsx — the "Find item" box at the end of the tab strip.
//
// It is the Board hub's, and it really filters: the text goes on the route as
// `?q=`, and every Board page already runs its list through `scopeTasks`, so
// one input narrows the Kanban, the Table, the Calendar, the Gantt, the WBS,
// the Workload, the Flow and the Item picker at once. A box in the chrome that
// searched only whichever page drew it would be the worse of the two options.
//
// The route is the state, but typing into the route on every keystroke would
// push a history entry per letter, so the input keeps its own value and
// commits on a short pause (or on Enter).

import { useEffect, useRef, useState } from 'react';

export default function FindItem({ value = '', onChange, placeholder = 'Find item' }) {
  const [text, setText] = useState(value || '');
  const committed = useRef(value || '');

  // A change from elsewhere — a cleared filter, a link opened — wins over
  // what is in the box, but only when it is genuinely different, or every
  // commit would bounce back and fight the caret.
  useEffect(() => {
    if ((value || '') !== committed.current) {
      committed.current = value || '';
      setText(value || '');
    }
  }, [value]);

  useEffect(() => {
    if (text === committed.current) return undefined;
    const id = setTimeout(() => {
      committed.current = text;
      onChange(text.trim() ? text.trim() : null);
    }, 250);
    return () => clearTimeout(id);
  }, [text, onChange]);

  return (
    <div className="findbox">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
      </svg>
      <input
        type="search"
        className="findbox-input"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { committed.current = text; onChange(text.trim() || null); }
          if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); }
        }}
      />
    </div>
  );
}
