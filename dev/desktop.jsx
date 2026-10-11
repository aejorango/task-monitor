// dev/desktop.jsx — the REAL desktop app over dev/mobileStore.js.
//
// Only services/firebase.js is swapped (HARNESS=desktop in
// dev/mobile.vite.config.js); every hook, page and rule is the shipped one.
// Signed in as the sample superadmin, with two workspaces of sample data.
//
//   HARNESS=desktop npx vite --config dev/mobile.vite.config.js --port 5178
//   open http://localhost:5178/dev/desktop.html
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../src/components/ErrorBoundary';
import App from '../src/App';
import '../src/App.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
