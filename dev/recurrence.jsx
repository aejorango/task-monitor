// dev/recurrence.jsx — dev-only harness for the recurrence catch-up.
//
// Runs the real planner against sample series and lets you move the clock
// forward a day at a time, applying each plan the way the app would — so
// "a weekly task nobody completed still comes round" can be watched happening.
//
// Open: http://localhost:5173/dev/recurrence.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { catchUpPlan, describeCatchUp } from '../src/services/recurrenceSchedule';
import '../src/App.css';

const START = [
  {
    id: 't1', userId: 'u1', workspaceId: 'ws1', title: 'Weekly status report',
    status: 'todo', deleted: false, archived: false,
    plan: { startDate: '2026-09-14', endDate: '2026-09-14' },
    recurrence: { rule: 'weekly', interval: 1, dayOfWeek: 1 },
  },
  {
    id: 't2', userId: 'u1', workspaceId: 'ws1', title: 'Daily standup notes',
    status: 'todo', deleted: false, archived: false,
    plan: { startDate: '2026-09-19', endDate: '2026-09-19' },
    recurrence: { rule: 'daily', interval: 1 },
  },
];

const shift = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(new Date(y, m - 1, d).getTime() + days * 86400000).toLocaleDateString('en-CA');
};

let counter = 0;

function Harness() {
  const [today, setToday] = useState('2026-09-20');
  const [tasks, setTasks] = useState(START);
  const [log, setLog] = useState([]);

  const plan = catchUpPlan(tasks, { today });

  const runCatchUp = () => {
    const created = catchUpPlan(tasks, { today });
    if (!created.length) { setLog((l) => [`${today}: nothing was due.`, ...l]); return; }
    // Apply it the way addTask would.
    setTasks((cur) => [...cur, ...created.map((c) => ({
      ...c.payload,
      id: `new-${counter += 1}`,
      userId: c.userId,
      status: 'todo', deleted: false, archived: false,
    }))]);
    setLog((l) => [`${today}: ${describeCatchUp(created)}`, ...l]);
  };

  const day = (days) => { setToday((t) => shift(t, days)); };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h2>Recurring tasks harness</h2>
      <p className="muted small">
        The real planner. Move the clock forward, run the catch-up, and watch a
        weekly task that nobody ever completed come round anyway. Nothing is written.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
        <strong>Today: {today}</strong>
        <button className="btn btn-sm" onClick={() => day(1)}>+1 day</button>
        <button className="btn btn-sm" onClick={() => day(7)}>+1 week</button>
        <button className="btn btn-primary btn-sm" onClick={runCatchUp}>
          Run the catch-up {plan.length > 0 && `(${plan.length} due)`}
        </button>
      </div>

      <section className="review-section">
        <h2 className="review-h2-accent">Tasks in the workspace ({tasks.length})</h2>
        <ul className="dep-list">
          {tasks.map((t) => (
            <li key={t.id} className="dep-item" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
              <span className="badge badge-soft-muted">{t.recurrence?.rule}</span>
              <span className="dep-title">
                <strong>{t.title}</strong>
                <span className="muted small" style={{ display: 'block' }}>
                  due {t.plan?.endDate || '—'} · {t.status}
                </span>
              </span>
              <span className="muted small mono">{t.id}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="review-section" style={{ marginTop: 16 }}>
        <h2 className="review-h2-accent">What each run did</h2>
        {log.length === 0
          ? <p className="muted small">Run the catch-up to see.</p>
          : <ul className="dep-list">{log.map((line, i) => (
            <li key={i} className="dep-item" style={{ gridTemplateColumns: '1fr' }}>
              <span className="mono small">{line}</span>
            </li>
          ))}</ul>}
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
