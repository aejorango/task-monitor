// dev/log-time.jsx — dev-only harness for the Dashboard's "Log time" action.
//
// The real LogTimeButton, the real ActivityLogger and the real picker, with
// sample tasks and no Firebase, so the three states the button has can be seen
// side by side: something overdue, nothing overdue, and no tasks at all.
//
// Open: http://localhost:5173/dev/log-time.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LogTimeButton from '../src/components/LogTimeButton';
import { ToastProvider } from '../src/components/Toast';
import { logTimeTarget, logTimeLabel } from '../src/services/logTime';
import '../src/App.css';

const projectById = { p1: { id: 'p1', name: 'BRIDGED' }, p2: { id: 'p2', name: 'AIM' } };
const LATE  = { id: 't1', title: 'Reconcile the September disbursement ledger', projectId: 'p1', workspaceId: 'ws' };
const TODAY = { id: 't2', title: 'Board pack', projectId: 'p1', workspaceId: 'ws' };
const DOING = { id: 't3', title: 'Policy review', projectId: 'p2', workspaceId: 'ws' };
const IDLE  = { id: 't4', title: 'Archive old files', projectId: 'p2', workspaceId: 'ws' };

const CASES = [
  {
    name: 'Something is overdue',
    note: 'One click opens the form on it. Its title is on the button face, not only in the tooltip.',
    props: { tasks: [LATE, TODAY, DOING, IDLE], actionQueue: [{ task: LATE, isLate: true }], inProgress: [DOING] },
  },
  {
    name: 'Nothing overdue, something due today',
    note: 'Same one click, and the tooltip says why that task was chosen.',
    props: { tasks: [TODAY, DOING, IDLE], actionQueue: [{ task: TODAY, isLate: false }], inProgress: [DOING] },
  },
  {
    name: 'Nothing late or due, one task in progress',
    props: { tasks: [DOING, IDLE], actionQueue: [], inProgress: [DOING] },
  },
  {
    name: 'Nothing to go on',
    note: 'The old handler fell through to filtered[0] here — an arbitrary task. Now it asks.',
    props: { tasks: [IDLE, TODAY], actionQueue: [], inProgress: [] },
  },
  {
    name: 'No tasks at all',
    note: 'Disabled, and the tooltip says what to do first.',
    props: { tasks: [], actionQueue: [], inProgress: [] },
  },
];

function Harness() {
  return (
    <ToastProvider>
      <div style={{ padding: 32, maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Log time — every state of the Dashboard hero button</h1>
        <p className="muted">
          Nothing here writes to Firestore; Save log will fail, which is the point at
          which the real app takes over.
        </p>
        {CASES.map((c) => {
          const target = logTimeTarget(c.props);
          const label  = logTimeLabel(target);
          return (
            <section key={c.name} className="dash-card" style={{ padding: 20, marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>{c.name}</h2>
              {c.note && <p className="muted small" style={{ margin: '0 0 12px' }}>{c.note}</p>}
              <LogTimeButton {...c.props} projectById={projectById} userId="u-dev" />
              <p className="muted small" style={{ margin: '10px 0 0' }}>
                picked: <code>{target.reason}</code> · tooltip: “{label.title}”
              </p>
            </section>
          );
        })}
      </div>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
