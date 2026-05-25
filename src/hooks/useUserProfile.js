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
