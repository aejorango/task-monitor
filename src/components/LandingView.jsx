// src/components/LandingView.jsx — login/signup landing page for new users.

import { useState } from 'react';
import { signInWithGoogle, switchToGoogle } from '../services/firebase';

const LANDING_DISMISSED_KEY = 'tm.landingDismissed';

export function isLandingDismissed() {
  try { return localStorage.getItem(LANDING_DISMISSED_KEY) === '1'; }
  catch { return false; }
}

export function dismissLanding() {
  try { localStorage.setItem(LANDING_DISMISSED_KEY, '1'); } catch { /* ignore */ }
}

export default function LandingView({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleGoogle = async () => {
    setBusy(true); setError(null);
    const res = await signInWithGoogle();
    setBusy(false);
    if (res.ok) {
      dismissLanding();
      onDone?.();
      return;
    }
    if (res.code === 'popup-closed') return; // user cancelled, no error UI
    setError({ code: res.code, message: res.message });
  };

  const handleSwitch = async () => {
    setBusy(true); setError(null);
    const res = await switchToGoogle();
    setBusy(false);
    if (res.ok) {
      dismissLanding();
      onDone?.();
      return;
    }
    setError({ code: res.code, message: res.message || 'Sign-in failed.' });
  };

  const handleGuest = () => {
    dismissLanding();
    onDone?.();
  };

  const logo = `${import.meta.env.BASE_URL}blueinnov_logo.webp`;

  return (
    <div className="landing-root">
      <div className="landing-bg-orb landing-bg-orb-1" aria-hidden="true" />
      <div className="landing-bg-orb landing-bg-orb-2" aria-hidden="true" />

      <div className="landing-card">
        <div className="landing-brand">
          <img src={logo} alt="Blue Innovation" className="landing-logo" />
          <div>
            <h1 className="landing-title">Task Monitor</h1>
            <p className="landing-tag">Project management, by Blue Innovation</p>
          </div>
        </div>

        <h2 className="landing-h2">Welcome</h2>
        <p className="landing-sub">
          Plan projects, track activity, and collaborate with your team —
          everything in one workspace.
        </p>

        <ul className="landing-feat">
          <li><span className="landing-feat-dot" /> Kanban, Gantt, Calendar &amp; Activity log views</li>
          <li><span className="landing-feat-dot" /> Real-time sync across all your devices</li>
          <li><span className="landing-feat-dot" /> Shareable workspaces with role-based access</li>
        </ul>

        <div className="landing-actions">
          <button
            className="btn btn-primary btn-lg landing-google"
            onClick={handleGoogle}
            disabled={busy}
          >
            <GoogleIcon />
            <span>{busy ? 'Signing in…' : 'Continue with Google'}</span>
          </button>

          <button
            className="btn btn-lg landing-guest"
            onClick={handleGuest}
            disabled={busy}
          >
            Continue as guest
          </button>
        </div>

        <p className="landing-fineprint">
          Signing in with Google syncs your data across devices. Guest mode keeps
          everything on this device — you can upgrade to Google any time.
        </p>

        {error && (
          <div className="auth-error" style={{ marginTop: 16 }}>
            <div className="auth-error-head">
              <span className="badge badge-soft-danger">Sign-in error</span>
              <span className="mono small">{error.code}</span>
              <button
                type="button"
                className="link-danger"
                onClick={() => setError(null)}
                style={{ marginLeft: 'auto' }}
              >✕</button>
            </div>
            <p className="auth-error-msg">{error.message}</p>
            {error.code === 'account-already-exists' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={handleSwitch} disabled={busy}>
                  {busy ? 'Switching…' : 'Switch to this account'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="landing-footer">
        © {new Date().getFullYear()} Blue Innovation · tasks.blueinnovation.ph
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
