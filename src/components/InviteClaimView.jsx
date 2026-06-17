// src/components/InviteClaimView.jsx — landing page for invite links
// (#/invite/<id>). Reads the invite, requires sign-in if anonymous, then
// lets the user accept to join the project.

import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useTasks';
import {
  auth,
  getInvite,
  claimInvite,
  signInWithGoogle,
} from '../services/firebase';

export default function InviteClaimView({ inviteId, navigate }) {
  const { userId, ready } = useAuth();
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);
  const [done, setDone] = useState(null);  // { projectId, alreadyMember }

  // Load the invite once auth is ready (need to be signed in to read).
  useEffect(() => {
    if (!ready || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const inv = await getInvite(inviteId);
        if (cancelled) return;
        if (!inv) {
          setLoadError('This invite link is invalid or has been deleted.');
          return;
        }
        setInvite(inv);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setLoadError(err.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [inviteId, ready, userId]);

  const handleSignIn = async () => {
    const result = await signInWithGoogle();
    if (!result.ok && result.code !== 'popup-closed') {
      alert(result.message || 'Sign-in failed.');
    }
  };

  const handleClaim = async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      const result = await claimInvite(inviteId, auth.currentUser);
      setDone(result);
      // After a short delay, navigate to the project's board.
      setTimeout(() => {
        navigate?.({ view: 'board', projectFilter: result.projectId });
      }, 1200);
    } catch (err) {
      console.error(err);
      setClaimError(err.message || String(err));
    } finally {
      setClaiming(false);
    }
  };

  // ── Render states ──────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="invite-screen">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  // Not signed in yet → prompt Google sign-in. After the popup resolves, useAuth
  // updates `userId`, the effect loads the invite, and the accept screen shows.
  if (!userId) {
    return (
      <div className="invite-screen">
        <div className="invite-card">
          <h1 className="invite-title">You've been invited 🎉</h1>
          <p className="muted">
            Sign in with Google to accept this invite. Your account will be linked
            to the project.
          </p>
          <button className="btn btn-primary" onClick={handleSignIn}>
            Sign in with Google
          </button>
          <p className="muted small" style={{ marginTop: 16 }}>
            Invite ID: <span className="mono">{inviteId}</span>
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="invite-screen">
        <div className="invite-card">
          <h1 className="invite-title">Invite unavailable</h1>
          <p className="auth-error-msg">{loadError}</p>
          <button className="btn" onClick={() => navigate?.({ view: 'dashboard' })}>Back to dashboard</button>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="invite-screen">
        <p className="muted">Loading invite…</p>
      </div>
    );
  }

  const expiresMs = invite.expiresAt?.toMillis?.() ?? (invite.expiresAt ? Date.parse(invite.expiresAt) : null);
  const expired   = expiresMs && expiresMs < Date.now();

  if (done) {
    return (
      <div className="invite-screen">
        <div className="invite-card">
          <h1 className="invite-title">{done.alreadyMember ? 'Welcome back' : 'You\'re in!'}</h1>
          <p className="muted">
            {done.alreadyMember
              ? 'You were already a member of this project.'
              : 'You have joined the project. Redirecting to the Board…'}
          </p>
          <button className="btn btn-primary" onClick={() => navigate?.({ view: 'board', projectFilter: done.projectId })}>
            Open project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="invite-screen">
      <div className="invite-card">
        <h1 className="invite-title">Project invitation</h1>
        <p className="muted">
          You've been invited as <strong>{invite.role}</strong>.
        </p>
        <p className="muted small">
          Project ID: <span className="mono">{invite.projectId}</span>
        </p>
        {invite.revoked && (
          <div className="auth-error">
            <p className="auth-error-msg">This invite has been revoked by the project admin.</p>
          </div>
        )}
        {expired && (
          <div className="auth-error">
            <p className="auth-error-msg">This invite expired on {new Date(expiresMs).toLocaleDateString()}.</p>
          </div>
        )}
        {claimError && (
          <div className="auth-error">
            <p className="auth-error-msg">{claimError}</p>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={() => navigate?.({ view: 'dashboard' })}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleClaim}
            disabled={claiming || invite.revoked || expired}
          >
            {claiming ? 'Joining…' : 'Accept invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
