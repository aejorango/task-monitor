// src/hooks/usePresence.js — ping presence on a task while it's open, and
// subscribe to who else is viewing it.

import { useEffect, useState } from 'react';
import {
  pingPresence,
  clearPresence,
  subscribeToPresence,
  auth,
} from '../services/firebase';

export function usePresence(taskId) {
  const [others, setOthers] = useState([]);

  // Ping every 20s while mounted; on unmount, clear.
  useEffect(() => {
    if (!taskId) return;
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;  // anonymous users skip presence

    const ping = () => pingPresence({
      taskId,
      userId: user.uid,
      displayName: user.displayName || user.email || '',
      photoURL: user.photoURL || '',
    }).catch((e) => console.warn('presence ping failed:', e));

    ping();
    const id = setInterval(ping, 20_000);
    return () => {
      clearInterval(id);
      clearPresence({ taskId, userId: user.uid }).catch(() => {});
    };
  }, [taskId]);

  // Subscribe to the presence collection for this task.
  useEffect(() => {
    if (!taskId) return;
    const unsub = subscribeToPresence(taskId, setOthers);
    return () => unsub();
  }, [taskId]);

  // Strip ourselves from the list.
  const me = auth.currentUser?.uid;
  return others.filter((p) => p.userId !== me);
}
