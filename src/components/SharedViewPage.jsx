// src/components/SharedViewPage.jsx — what somebody outside the company sees.
//
// Opened from a share link, with nobody signed in. It reads exactly one
// document — the snapshot the link holds — and hands it to SharedSnapshot to
// render. There is no sidebar, no navigation into the app, and nothing to click
// that would ask for an account.
//
// A link that is missing, switched off or past its date all end here the same
// way, deliberately: telling a stranger *which* would tell them a token was
// once real.

import { useEffect, useState } from 'react';
import { getSharedView } from '../services/firebase';
import SharedSnapshot from './SharedSnapshot';

export default function SharedViewPage({ token }) {
  const [state, setState] = useState({ loading: true, share: null, token });

  // A different token is a different page: reset during render rather than in
  // an effect, so the old project is never shown under the new link.
  if (state.token !== token) setState({ loading: true, share: null, token });

  useEffect(() => {
    let alive = true;
    getSharedView(token)
      .then((share) => { if (alive) setState({ loading: false, share, token }); })
      .catch(() => { if (alive) setState({ loading: false, share: null, token }); });
    return () => { alive = false; };
  }, [token]);

  if (state.loading) {
    return (
      <div className="shared-page shared-page-centred">
        <div className="spinner" />
        <p className="muted small">Opening…</p>
      </div>
    );
  }

  if (!state.share) {
    return (
      <div className="shared-page shared-page-centred">
        <h1 className="shared-title">This link is not available</h1>
        <p className="muted">
          It may have been switched off, or it may have expired. Ask whoever sent it
          to you for a new one.
        </p>
      </div>
    );
  }

  return <SharedSnapshot share={state.share} />;
}
