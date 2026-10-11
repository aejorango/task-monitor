// dev/mobile.jsx — dev-only harness for the phone app (src/mobile).
//
// Renders the REAL MobileApp over dev/mobileStore.js: no sign-in, no Firebase,
// every write applied in memory and logged to the console. Needs its own dev
// server, because the stubs must not leak into the real app:
//
//   npx vite --config dev/mobile.vite.config.js --port 5176
//   open http://localhost:5176/dev/mobile.html   (at 375px wide)
//
// Dark mode follows the OS (the app's own Theme setting is System by default).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '../src/components/Toast';
import { DialogProvider } from '../src/components/Dialog';
import MobileApp from '../src/mobile/MobileApp';
import { HARNESS_USER, HARNESS_PROFILE } from './mobileStore';
import '../src/App.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <MobileApp userId={HARNESS_USER} profile={HARNESS_PROFILE} route={{ view: 'board', projectFilter: 'all' }} />
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
);
