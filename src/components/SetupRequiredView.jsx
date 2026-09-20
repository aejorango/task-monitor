// src/components/SetupRequiredView.jsx — shown instead of the app when the
// Firebase configuration is missing or still holds the example values.
//
// This is the first thing a new developer sees when something is wrong, so it
// says exactly what to do, in order, and names the variables it could not find.
// It deliberately imports nothing from services/firebase — that module is what
// cannot start.

export default function SetupRequiredView({ missing = [] }) {
  const allMissing = missing.length === 6;

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-icon" aria-hidden="true">🔧</div>
        <h1 className="setup-title">Almost there — connect a Firebase project</h1>
        <p className="setup-lede">
          {allMissing
            ? 'Task Monitor stores your data in your own Firebase project, and it has not been told which one yet.'
            : 'Task Monitor found your configuration, but some of it is incomplete.'}
        </p>

        <ol className="setup-steps">
          <li>
            Create a project at{' '}
            <a className="table-link" href="https://console.firebase.google.com" target="_blank" rel="noreferrer">
              console.firebase.google.com
            </a>, then add a <strong>Web app</strong> to it.
          </li>
          <li>
            In <strong>Project settings → Your apps → SDK setup and configuration</strong>,
            copy the six values.
          </li>
          <li>
            In the project folder, copy <code>.env.example</code> to <code>.env</code> and
            paste each value in.
          </li>
          <li>Stop the app and start it again — the values are read at startup.</li>
        </ol>

        <div className="setup-missing">
          <h2 className="setup-subtitle">
            {allMissing ? 'These six values are needed' : 'Still needed'}
          </h2>
          <ul className="setup-list">
            {missing.map((m) => (
              <li key={m.key}>
                <code>{m.key}</code>
                <span className="muted small"> — {m.label} ({m.reason})</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="muted small setup-foot">
          Full instructions are in <strong>README.md</strong> under “Run it locally”.
        </p>
      </div>
    </div>
  );
}
