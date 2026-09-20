// dev/error-boundary.jsx — harness for ErrorBoundary. No sign-in needed.
//
//   npm run dev  →  http://localhost:5175/dev/error-boundary.html
//
// Query flags choose which crash to simulate:
//   ?kind=render   a plain render error inside a view   (default)
//   ?kind=chunk    a stale-deploy dynamic-import failure
//   ?kind=network  a dropped connection
//   ?scope=app     render it as the whole-app boundary instead of a view
//
// "Break the page" throws for real; "Try again" must bring the page back.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';
import '../src/App.css';

const params = new URLSearchParams(location.search);
const kind  = params.get('kind')  || 'render';
const scope = params.get('scope') || 'view';

const ERRORS = {
  render:  () => { const t = undefined; return t.map((x) => x); },
  chunk:   () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/GanttView-abc123.js'); },
  network: () => { throw new TypeError('NetworkError when attempting to fetch resource.'); },
};

export function FakeView({ broken }) {
  if (broken) (ERRORS[kind] || ERRORS.render)();
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>Gantt (pretend)</h2>
      <p className="muted">This stands in for a real view. It renders fine until you break it.</p>
    </div>
  );
}

export function Harness() {
  const [broken, setBroken] = useState(false);
  const [view, setView] = useState('gantt');
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setBroken(true)}>Break the page</button>
        <button className="btn" onClick={() => setBroken(false)}>Un-break (then press Try again)</button>
        <button className="btn" onClick={() => setView((v) => (v === 'gantt' ? 'board' : 'gantt'))}>
          Navigate to {view === 'gantt' ? 'Board' : 'Gantt'} (must clear the error)
        </button>
        <span className="muted small">kind={kind} · scope={scope} · view={view}</span>
      </div>

      <div style={{ border: '1px dashed var(--c-border)', borderRadius: 12 }}>
        <ErrorBoundary scope={scope} viewName={view === 'gantt' ? 'Gantt' : 'Board'} resetKey={view}>
          <FakeView broken={broken} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><Harness /></StrictMode>,
);
