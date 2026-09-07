// dev/knowledge.jsx — dev-only harness for the NotebookLM knowledge layer.
//
// Renders Settings → "Knowledge base" and a NotebookPicker against the LIVE
// bridge without a signed-in Firestore session, so the four setup states can
// be checked directly:
//
//   npm run bridge                          → CLI found, signed in / signed out
//   TM_NOTEBOOKLM_BIN=none npm run bridge   → the install panel
//   (no bridge at all)                      → the "start the bridge" panel
//
// Open: http://localhost:5173/dev/knowledge.html
// Not part of the production build (vite builds index.html only).

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import KnowledgeSection from '../src/components/KnowledgeSection';
import NotebookPicker from '../src/components/NotebookPicker';
import { useKnowledgeStatus } from '../src/hooks/useKnowledgeStatus';
import '../src/App.css';

// No setup needed: `bridge: auto` already probes on localhost, and the harness
// only ever runs there. It deliberately does NOT write to the app's stored AI
// settings — a harness must not change the real app's configuration.

function Harness() {
  const k = useKnowledgeStatus();
  const [picked, setPicked] = useState(null);
  const [raw, setRaw] = useState(null);

  useEffect(() => {
    fetch('http://127.0.0.1:4319/knowledge/status')
      .then((r) => r.json()).then(setRaw)
      .catch((e) => setRaw({ error: String(e) }));
  }, [k.probed, k.authenticated]);

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h2>Knowledge base harness</h2>
      <p className="muted small">
        available: <b>{String(k.available)}</b> · bridgeOk: <b>{String(k.bridgeOk)}</b> ·
        cliFound: <b>{String(k.cliFound)}</b> · authenticated: <b>{String(k.authenticated)}</b> ·
        notebooks: <b>{k.notebooks === null ? 'null (never fetched)' : k.notebooks.length}</b>
      </p>

      <KnowledgeSection />

      <section className="review-section" style={{ marginTop: 20 }}>
        <h2 className="review-h2-accent">NotebookPicker</h2>
        <NotebookPicker
          value={picked}
          title="A previously saved notebook"
          onChange={(id) => setPicked(id)}
          hint="Reads the shared cache only — opening it must never spawn the CLI."
        />
        <p className="muted small">picked: <code>{String(picked)}</code></p>
      </section>

      <details style={{ marginTop: 20 }}>
        <summary className="muted small">raw GET /knowledge/status</summary>
        <pre className="mono small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
