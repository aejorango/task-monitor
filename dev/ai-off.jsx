// dev/ai-off.jsx — dev-only harness for the "AI is switched off" copy.
//
// Every state `available: false` can mean, side by side, for both audiences.
// The helper's empty state renders exactly these three strings, so this is
// what a reader sees without having to break a bridge to find out.
//
// Open: http://localhost:5173/dev/ai-off.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { aiUnavailableCopy } from '../src/services/ai';
import '../src/App.css';

const CASES = [
  { name: 'Nothing connected',        status: { provider: 'none', known: true, allowed: true } },
  { name: 'Still probing',            status: { provider: null, known: false, allowed: true } },
  { name: 'Company switched AI off',  status: { provider: 'none', known: true, allowed: false } },
  // These two are `available: true`, so an empty state never renders for them
  // — they are here to show that providerHeadline has a sentence for every
  // provider, which is why the empty state does not need one of its own.
  { name: 'Mock only (never empty)',  status: { provider: 'mock', known: true, allowed: true } },
  { name: 'Bridge set but silent (never empty)', status: { provider: 'claude-code', known: true, allowed: true } },
];

function Card({ name, status, isOperator }) {
  const off = aiUnavailableCopy(status, { isOperator });
  return (
    <section className="dash-card" style={{ padding: 18, marginBottom: 12 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>{name}</h3>
      <div className="empty-state" style={{ padding: '16px 12px' }}>
        <p className="muted">{off.headline}</p>
        {off.detail && <p className="small muted">{off.detail}</p>}
        {isOperator && off.operatorHint && (
          <p className="muted small" style={{ marginTop: 6 }}>
            <strong>Operator:</strong> {off.operatorHint}
          </p>
        )}
      </div>
    </section>
  );
}

function Harness() {
  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0, fontSize: 20 }}>AI unavailable — what each reader is told</h1>
      <p className="muted small">
        The operator column is what an approved superadmin sees; everyone else sees the
        left column and never a Settings section or a shell command.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <h2 style={{ fontSize: 14 }}>Everyone else</h2>
          {CASES.map((c) => <Card key={c.name} {...c} isOperator={false} />)}
        </div>
        <div>
          <h2 style={{ fontSize: 14 }}>Operator</h2>
          {CASES.map((c) => <Card key={c.name} {...c} isOperator />)}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
