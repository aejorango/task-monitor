// dev/automations.jsx — dev-only harness for Settings → Automations.
//
// Renders the rule editor with sample projects, people and connections so the
// whole form can be checked without a signed-in Firestore session: every part
// of a rule is a dropdown, the sentence under the form is the rule read back,
// and an unfinished rule cannot be saved.
//
// Open: http://localhost:5173/dev/automations.html
// Not part of the production build (vite builds index.html only).

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AutomationEditor } from '../src/components/AutomationsSection';
import { describeRule } from '../functions/src/automations.js';
import ToastProvider from '../src/components/Toast';
import DialogProvider from '../src/components/Dialog';
import '../src/App.css';

const PROJECTS = [
  { id: 'p1', name: 'SBLAF rollout', phases: [{ id: 'ph1', name: 'Discovery' }, { id: 'ph2', name: 'Build' }] },
  { id: 'p2', name: 'Website revamp', phases: [{ id: 'ph3', name: 'Copy' }] },
];
const MEMBERS = ['u1', 'u2'];
const PROFILES = {
  u1: { displayName: 'Ace', email: 'ace@example.com' },
  u2: { displayName: 'Mia', email: 'mia@example.com' },
};
const WEBHOOKS = [{ id: 'w1', name: 'Slack — #projects', url: 'https://example.com/hook' }];

const BLANK = {
  workspaceId: 'ws-dev',
  name: '',
  trigger: 'task.completed',
  conditions: [],
  action: 'follow_up',
  actionValue: '',
  enabled: true,
};

function Harness() {
  const [saved, setSaved] = useState(null);
  const [open, setOpen] = useState(true);

  const nameFor = useMemo(() => (id) => (
    PROJECTS.find((p) => p.id === id)?.name
    || PROFILES[id]?.displayName
    || PROJECTS.flatMap((p) => p.phases).find((ph) => ph.id === id)?.name
    || WEBHOOKS.find((w) => w.id === id)?.name
    || id
  ), []);

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h2>Automations harness</h2>
      <p className="muted small">
        The real rule editor, with sample projects, people and connections. Saving
        here does not write anything — it shows you the rule it would have saved.
      </p>

      <button className="btn" onClick={() => setOpen(true)}>Open the editor</button>

      {open && (
        <AutomationEditor
          rule={BLANK}
          projects={PROJECTS}
          members={MEMBERS}
          memberProfiles={PROFILES}
          webhooks={WEBHOOKS}
          nameFor={nameFor}
          busy={false}
          onSave={(rule) => { setSaved(rule); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}

      {saved && (
        <section className="review-section" style={{ marginTop: 20 }}>
          <h2 className="review-h2-accent">What would have been saved</h2>
          <p className="au-preview"><strong>{saved.name}</strong> — {describeRule(saved, { nameFor })}</p>
        </section>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <Harness />
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
);
