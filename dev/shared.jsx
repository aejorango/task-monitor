// dev/shared.jsx — dev-only harness for the page a client opens.
//
// Renders the real SharedSnapshot with a sample share, so both forms and the
// not-available state can be checked without publishing anything.
//
// Open: http://localhost:5173/dev/shared.html  (?kind=board, ?kind=dead)
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SharedSnapshot from '../src/components/SharedSnapshot';
import { buildShareLink } from '../src/services/shareLinks';
import '../src/App.css';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') || 'gantt';

const project = {
  id: 'p1', name: 'SBLAF rollout', color: '#4f7cff',
  phases: [{ id: 'ph1', name: 'Discovery' }, { id: 'ph2', name: 'Build' }],
};
const tasks = [
  { id: 'a', projectId: 'p1', phaseId: 'ph1', title: 'Requirements workshop', status: 'done', priority: 'high', progress: 100, plan: { startDate: '2026-09-01', endDate: '2026-09-05' } },
  { id: 'b', projectId: 'p1', phaseId: 'ph1', title: 'Disbursement report', status: 'doing', priority: 'high', progress: 40, plan: { startDate: '2026-09-08', endDate: '2026-09-18' } },
  { id: 'c', projectId: 'p1', phaseId: 'ph2', title: 'Build the intake form', status: 'doing', priority: 'medium', progress: 15, plan: { startDate: '2026-09-15', endDate: '2026-10-02' } },
  { id: 'd', projectId: 'p1', phaseId: 'ph2', title: 'User acceptance testing', status: 'todo', priority: 'medium', progress: 0, plan: { startDate: '2026-10-05', endDate: '2026-10-16' } },
  { id: 'e', projectId: 'p1', phaseId: 'ph2', title: 'Write the handover note', status: 'todo', priority: 'low', progress: 0, plan: {} },
];

const share = {
  ...buildShareLink({
    token: 'devtoken', workspaceId: 'ws1', project, tasks,
    kind: kind === 'board' ? 'board' : 'gantt',
    createdByUserId: 'u-ace', createdByName: 'Ace Jorango', expiryDays: 30,
  }),
  id: 'devtoken',
};

function Dead() {
  return (
    <div className="shared-page shared-page-centred">
      <h1 className="shared-title">This link is not available</h1>
      <p className="muted">
        It may have been switched off, or it may have expired. Ask whoever sent it
        to you for a new one.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>{kind === 'dead' ? <Dead /> : <SharedSnapshot share={share} />}</StrictMode>,
);
