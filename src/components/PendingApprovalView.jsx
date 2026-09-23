// src/components/PendingApprovalView.jsx — shown to signed-in users whose
// account hasn't been approved yet (status === 'pending') or has been
// rejected (status === 'rejected'). Only options are to wait or sign out.

import { signOutUser } from '../services/firebase';
import { approvalCopy } from '../services/approvalCopy';

export default function PendingApprovalView({ profile }) {
  const copy = approvalCopy(profile);
  const rejected = copy.state === 'rejected';
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

        <h2
          className="landing-h2"
          style={rejected ? { color: 'var(--c-danger)' } : undefined}
        >
          {copy.title}
        </h2>
        <p className="landing-sub">{copy.message}</p>
        {/* The account echo, the status pill and the superadmin email list were
            removed from this card. `waitNote` stayed, as a plain line: it is the
            sentence that says NO EMAIL IS SENT and that the page lets you in by
            itself. Dropping it with its pill would have put the approval-email
            promise back by omission — the one thing this screen must never do
            (see approvalCopy.js and tests/ui/approvalScreens.test.mjs). */}
        {copy.waitNote && <p className="landing-sub muted">{copy.waitNote}</p>}

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
