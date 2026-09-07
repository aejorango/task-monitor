// dev/due-alert.jsx — dev-only harness: renders the due-task AlertDialog with
// a sample task so it can be inspected without a signed-in Firestore session.
// Not part of the production build (vite builds index.html only).
// Open: http://localhost:5173/dev/due-alert.html?ai=1 (ai=1 → treat AI as available)

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertDialog } from '../src/components/DueTaskAlertModal';
import { useAiStatus } from '../src/hooks/useAiStatus';
import '../src/App.css';

const params = new URLSearchParams(location.search);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const TASKS = [
  { id: 't1', title: 'Send Q3 lender performance report to CFO', priority: 'high', status: 'doing',
    description: 'Summarise **approvals, disbursements and defaults** for July–Sept. Attach the sheet.',
    requestedBy: 'CFO', tags: ['finance', 'report'], projectId: 'p1',
    plan: { startDate: daysAgo(10), endDate: daysAgo(2) },
    subtasks: [{ id: 's1', text: 'Pull numbers from Firestore export', done: true }, { id: 's2', text: 'Draft cover email', done: false }, { id: 's3', text: 'Get sign-off from Ops', done: false }] },
  { id: 't2', title: 'Renew domain tasks.blueinnovation.ph', priority: 'medium', status: 'todo', projectId: 'p1',
    plan: { endDate: today }, subtasks: [] },
  { id: 't3', title: 'Write onboarding guide for new lenders', priority: 'low', status: 'todo', projectId: 'p2',
    plan: { endDate: today }, subtasks: [] },
];
const PROJECTS = { p1: { name: 'BRIDGED', color: '#1D7CC7', description: 'Loan marketplace operations' }, p2: { name: 'AIM', color: '#1DA449' } };

export function Harness() {
  const [queue, setQueue] = useState(TASKS);
  const [log, setLog] = useState([]);
  const ai = useAiStatus();
  const aiAvailable = params.get('ai') === '0' ? false : ai.available;
  const note = (m) => setLog((l) => [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 8));
  const advance = () => setQueue((q) => q.slice(1));
  const task = queue[0];
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>Due-task alert harness</h2>
      <p>AI provider: <b>{ai.provider || 'none'}</b> · available: <b>{String(aiAvailable)}</b> · queue: {queue.length}</p>
      <button className="btn" onClick={() => setQueue(TASKS)}>Reset queue</button>
      <ul>{log.map((l, i) => <li key={i}><code>{l}</code></li>)}</ul>
      {task && (
        <AlertDialog
          key={task.id}
          task={task}
          project={PROJECTS[task.projectId]}
          today={today}
          remaining={queue.length}
          prefs={{ defaultSnoozeMin: 15 }}
          aiAvailable={aiAvailable}
          provider={ai.provider}
          busy={false}
          onDone={() => { note(`done: ${task.title}`); advance(); }}
          onSkip={() => { note(`skip: ${task.title}`); advance(); }}
          onSnooze={(m) => { note(`snooze ${m} min: ${task.title}`); advance(); }}
          onOpen={() => note(`open: ${task.title}`)}
          onCloseAll={() => { note(`close all (${queue.length})`); setQueue([]); }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
