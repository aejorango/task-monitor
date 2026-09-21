// src/hooks/useUserProfile.js
// Subscribes to the current user's `users/{uid}` document. The doc carries
// the approval status (pending / approved / rejected) and role (user /
// superadmin) used to gate access to the app.

import { useEffect, useState } from 'react';
import { subscribeToUserProfile } from '../services/firebase';

export function useUserProfile(userId) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!!userId);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToUserProfile(userId, (p) => {
      setProfile(p);
      setLoading(false);
    });
    return () => unsub();
  }, [userId]);

  return { profile, loading };
}

/**
 * Is this person the operator — the one who runs the bridge on their own
 * machine and can act on a shell command or a port number?
 *
 * An approved superadmin, and nobody else. Used to decide who may be shown
 * operator copy: `knowledgeCopy(status, { isOperator })` for the knowledge
 * base, `describeAiFailure(err, fallback, { isOperator })` for an AI failure.
 * It was written out by hand in two places before; a third would have drifted.
 */
export function isOperatorProfile(profile) {
  return profile?.role === 'superadmin' && profile?.status === 'approved';
}

/** The same question, for a component that has only the user id. */
export function useIsOperator(userId) {
  const { profile, loading } = useUserProfile(userId);
  // Until the profile arrives, assume not: showing operator copy to somebody
  // who turns out not to be one is the mistake that matters.
  return { isOperator: !loading && isOperatorProfile(profile), loading };
}
