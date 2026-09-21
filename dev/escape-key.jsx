// dev/escape-key.jsx — harness for BUG-012 (T-0085 / T-0086). No sign-in needed.
//
//   npm run dev  →  http://localhost:5175/dev/escape-key.html
//
// The bug: TimerWidget is mounted for the whole life of the signed-in app and
// called useModalDialog above its own early return, so the hook's
// document-CAPTURE Escape handler — which calls stopPropagation() — was live
// permanently. Every Escape handler on window, or on document in the bubble
// phase, was dead: the ⌘K dropdown, the Export ▾ menu, the inbox panel, the
// Task-table column picker, the tutorial tour and the due-task alert.
//
// This page mounts the REAL TimerWidget beside stand-ins for those listeners,
// each registered exactly where the real one is. Press Escape and watch the
// counters. With the fix: the counters go up while no dialog is open, and stop
// going up the moment the timer's stop dialog is on screen.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TimerWidget from '../src/components/TimerWidget.jsx';
import { ToastProvider } from '../src/components/Toast.jsx';
import { useTimer } from '../src/hooks/useTimer.js';
import '../src/App.css';

/** One of the five real consumers, listening where the real one listens. */
function Consumer({ name, on, where }) {
  const [heard, setHeard] = useState(0);
  useEffect(() => {
    const target = on === 'window' ? window : document;
    const onKey = (e) => { if (e.key === 'Escape') setHeard((n) => n + 1); };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [on]);
  return (
    <tr>
      <td style={{ padding: '6px 12px' }}>{name}</td>
      <td style={{ padding: '6px 12px' }} className="muted">{where}</td>
      <td style={{ padding: '6px 12px', textAlign: 'right' }} className="mono">
        <strong style={{ color: heard ? 'var(--c-ok, #16a34a)' : 'var(--c-text-dim, #888)' }}>{heard}</strong>
      </td>
    </tr>
  );
}

export function Harness() {
  const { running, start, stop } = useTimer();
  return (
    <div style={{ padding: 32, maxWidth: 760, margin: '0 auto' }}>
      <h2 style={{ marginTop: 0 }}>Escape key · BUG-012</h2>
      <p className="muted">
        The real <code>TimerWidget</code> is mounted below, exactly as AppShell mounts it.
        Press <kbd>Esc</kbd> and watch the counters.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '18px 0' }}>
        <button className="btn btn-primary" onClick={() => start({ id: 'demo', title: 'A pretend task' })} disabled={running}>
          Start the timer
        </button>
        <button className="btn" onClick={() => stop()} disabled={!running}>
          Clear the timer
        </button>
        <span className="muted">{running ? 'Timer running — press ⏹ Stop to open its dialog.' : 'No timer running.'}</span>
      </div>

      <div style={{ border: '1px solid var(--c-border, #ddd)', borderRadius: 8, padding: 8, marginBottom: 20 }}>
        <TimerWidget />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 12px' }}>Escape handler</th>
            <th style={{ textAlign: 'left', padding: '6px 12px' }}>Registered on</th>
            <th style={{ textAlign: 'right', padding: '6px 12px' }}>Times heard</th>
          </tr>
        </thead>
        <tbody>
          <Consumer name="⌘K search dropdown" on="window" where="window, bubble" />
          <Consumer name="Tutorial tour" on="window" where="window, bubble" />
          <Consumer name="Export ▾ menu" on="document" where="document, bubble" />
          <Consumer name="Inbox panel" on="document" where="document, bubble" />
          <Consumer name="Task-table column picker" on="document" where="document, bubble" />
        </tbody>
      </table>

      <p className="muted" style={{ marginTop: 20 }}>
        <strong>What good looks like:</strong> every counter rises on each Escape while no dialog
        is open — including while the timer is running. Open the stop dialog and Escape closes
        that dialog and nothing else: the counters hold still for exactly that one press.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>,
);
