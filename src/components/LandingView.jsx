// src/components/LandingView.jsx — login page. Anonymous/guest access has
// been removed; Google sign-in is required.

import { useState } from 'react';
import { signInWithGoogle } from '../services/firebase';

export default function LandingView() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleGoogle = async () => {
    setBusy(true); setError(null);
    const res = await signInWithGoogle();
    setBusy(false);
    if (!res.ok && res.code !== 'popup-closed') {
      setError({ code: res.code, message: res.message });
    }
    // On success, App.jsx will re-render with the user signed in. The auth
    // gate routes to PendingApprovalView or the full app depending on the
    // user's profile status — nothing else to do here.
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

        <h2 className="landing-h2">Sign in to continue</h2>
        <p className="landing-sub">
          Access is invite-only. Sign in with Google and a Blue Innovation
          administrator will review your request.
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
            <span>{busy ? 'Signing in…' : 'Sign in with Google'}</span>
          </button>
        </div>

        <p className="landing-fineprint">
          New accounts are placed in a pending state until an administrator
          approves them. You will be notified once your access is granted.
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
