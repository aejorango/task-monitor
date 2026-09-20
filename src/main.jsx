import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import SetupRequiredView from './components/SetupRequiredView.jsx'
import { readFirebaseConfig } from './services/firebaseConfig.js'
import './App.css'

const root = createRoot(document.getElementById('root'))

// Check the configuration BEFORE importing anything that touches Firebase.
// services/firebase.js calls initializeApp() at module scope, so importing it
// with an empty config is what produced the white page this screen replaces.
const { ok, missing } = readFirebaseConfig(import.meta.env)

if (!ok) {
  root.render(
    <StrictMode>
      <SetupRequiredView missing={missing} />
    </StrictMode>,
  )
} else {
  const [{ default: App }, { registerServiceWorker }, { purgeStaleCacheOnce }] = await Promise.all([
    import('./App.jsx'),
    import('./hooks/useNotifications.js'),
    import('./services/firebase.js'),
  ])

  const boot = () => {
    // Service worker for notifications (no-op if not granted)
    registerServiceWorker()

    root.render(
      <StrictMode>
        {/* Last line of defence: if the shell itself throws, the user still gets
            a card with a Reload button instead of a blank white page. */}
        <ErrorBoundary scope="app">
          <App />
        </ErrorBoundary>
      </StrictMode>,
    )
  }

  // Drop any pre-isolation Firestore cache before first render so stale
  // cross-user documents never get a chance to paint. On the purge path the
  // helper terminates Firestore, so we reload into a clean client instead of
  // rendering against a dead instance.
  purgeStaleCacheOnce()
    .then((didPurge) => {
      if (didPurge) { window.location.reload(); return; }
      boot()
    })
    .catch(() => boot())
}
