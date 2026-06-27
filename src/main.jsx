import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { registerServiceWorker } from './hooks/useNotifications.js'
import { purgeStaleCacheOnce } from './services/firebase.js'

function boot() {
  // Service worker for notifications (no-op if not granted)
  registerServiceWorker();

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
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
    boot();
  })
  .catch(() => boot());
