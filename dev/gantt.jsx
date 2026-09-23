// dev/gantt.jsx — harness for BUG-014 (T-0089 / T-0090). No sign-in needed.
//
//   npm run dev  →  http://localhost:5175/dev/gantt.html
//   ?zoom=month  →  six-pixel day columns, where a milestone is hardest to grab
//
// The bug: the Gantt admitted any task with ANY one of its four dates into the
// row list, but the bar needed BOTH plan dates. Quick-add and the
// natural-language parser only ever write an end date, so the commonest task in
// the app — "draft proposal next Friday" — got a row with a title and a
// completely blank track, and dragging could not fix it either.
//
// Drag the marker's LEFT EDGE and watch the write appear below: that is a
// plan.startDate the task never had.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GanttRow } from '../src/components/GanttView.jsx';
import { ToastProvider } from '../src/components/Toast.jsx';
import '../src/App.css';

// The chart is fluid in the app — its day width is measured off the card.
// Here it is a knob, so a narrow window (the case a one-day milestone has to
// survive) can be reproduced on purpose.
const WIDTHS = { day: 36, week: 16, month: 6 };
const dayWidth = WIDTHS[new URLSearchParams(location.search).get('zoom')] || WIDTHS.day;

const RANGE = { min: new Date(2026, 8, 21), max: new Date(2026, 9, 21) };
const TODAY = new Date(2026, 8, 21);
const DAYS = 31;

const PROJECT = { id: 'p1', name: 'Bridged', color: '#4f46e5' };

const SAMPLES = [
  { id: 't1', title: 'Draft proposal (due date only)', status: 'todo', phaseName: 'Discovery',
    plan: { startDate: null, endDate: '2026-09-25' } },
  { id: 't2', title: 'Write the report (a real range)', status: 'todo', phaseName: 'Discovery',
    plan: { startDate: '2026-09-22', endDate: '2026-09-28' } },
  { id: 't3', title: 'Kick-off (start date only)', status: 'doing', phaseName: 'Delivery',
    plan: { startDate: '2026-09-30', endDate: null } },
  { id: 't4', title: 'Review (both dates, same day)', status: 'todo', phaseName: 'Delivery',
    plan: { startDate: '2026-10-05', endDate: '2026-10-05' } },
  { id: 't5', title: 'No plan at all, only an actual', status: 'doing', phaseName: 'Delivery',
    plan: {}, actual: { startDate: '2026-09-23' } },
];

export function Harness() {
  const [tasks, setTasks] = useState(SAMPLES);
  const [writes, setWrites] = useState([]);

  const save = (id, patch) => {
    setWrites((w) => [...w, { id, patch, at: new Date().toLocaleTimeString() }]);
    setTasks((ts) => ts.map((t) => (t.id === id ? {
      ...t,
      plan: { startDate: patch['plan.startDate'], endDate: patch['plan.endDate'] },
    } : t)));
  };

  const trackWidth = DAYS * dayWidth;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>Gantt rows · BUG-014</h2>
      <p className="muted">
        <strong>{dayWidth}px a day</strong> — try{' '}
        <a href="?zoom=day">day</a> · <a href="?zoom=week">week</a> · <a href="?zoom=month">month</a>.
        Drag the first row’s <strong>left edge</strong> to give it a start date it never had.
      </p>

      <div className="bcard" style={{ width: 220 + trackWidth }}>
        {tasks.map((t, i) => (
          <GanttRow
            key={t.id}
            task={t}
            project={PROJECT}
            range={RANGE}
            dayWidth={dayWidth}
            alt={i % 2 === 1}
            todayPct={0}
            today={TODAY}
            onSavePlan={save}
          />
        ))}
      </div>

      <h3>Writes</h3>
      {writes.length === 0 ? (
        <p className="muted">Nothing saved yet. A drag that changes nothing must write nothing.</p>
      ) : (
        <ul className="mono" style={{ fontSize: 13 }}>
          {writes.map((w, i) => (
            <li key={i}>
              {w.at} · {w.id} → plan.startDate {String(w.patch['plan.startDate'])},
              plan.endDate {String(w.patch['plan.endDate'])}
            </li>
          ))}
        </ul>
      )}

      <p className="muted">
        <strong>What good looks like:</strong> rows 1, 3 and 4 each show a one-day marker on
        their date — none of them was drawn at all before this fix. Row 5 has no plan bar,
        which is right: it earns its row from its actual bar. Dragging row 1’s left edge
        three columns writes a <code>plan.startDate</code>; dropping any bar back where it
        started writes nothing.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>,
);
