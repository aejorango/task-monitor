// src/components/PendingApprovalView.jsx — shown to signed-in users whose
// account hasn't been approved yet (status === 'pending') or has been
// rejected (status === 'rejected'). Only options are to wait or sign out.

import { auth, signOutUser, SUPERADMIN_EMAILS } from '../services/firebase';

export default function PendingApprovalView({ profile }) {
  const user = auth.currentUser;
  const rejected = profile?.status === 'rejected';
  const logo = `${import.meta.env.BASE_URL}blueinnov_logo.webp`;

  const handleSignOut = async () => {
    await signOutUser();
  };

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

        <div className="pending-account">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="pending-avatar" />
          ) : (
            <div className="pending-avatar fallback">
              {(user?.displayName || user?.email || '?')[0].toUpperCase()}
            </div>
          )}
          <div className="pending-account-info">
            <div className="pending-account-name">{user?.displayName || 'Signed in'}</div>
            <div className="muted small">{user?.email}</div>
          </div>
        </div>

        {rejected ? (
          <>
            <h2 className="landing-h2" style={{ color: 'var(--c-danger)' }}>
              Access denied
            </h2>
            <p className="landing-sub">
              Your access request was declined by an administrator. If you
              believe this is a mistake, please contact a Blue Innovation
              superadmin to review your request.
            </p>
          </>
        ) : (
          <>
            <h2 className="landing-h2">Waiting for approval</h2>
            <p className="landing-sub">
              Your sign-in was received. A Blue Innovation superadmin needs to
              approve your account before you can access the app.
            </p>
            <div className="pending-status">
              <div className="pending-status-dot" />
              <span>Pending review · we'll notify you by email when approved</span>
            </div>
          </>
        )}

        <div className="pending-admin-list">
          <strong className="small">Superadmins who can approve you:</strong>
          <ul>
            {SUPERADMIN_EMAILS.map((email) => (
              <li key={email} className="mono small">{email}</li>
            ))}
          </ul>
        </div>

        <div className="landing-actions">
          <button className="btn btn-lg landing-guest" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <p className="landing-footer">
        © {new Date().getFullYear()} Blue Innovation · tasks.blueinnovation.ph
      </p>
    </div>
  );
}
