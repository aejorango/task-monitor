// src/hooks/usePresence.js — ping presence on a task while it's open, and
// subscribe to who else is viewing it.

import { useEffect, useState } from 'react';
import {
  pingPresence,
  clearPresence,
  subscribeToPresence,
  auth,
} from '../services/firebase';

const EMPTY = [];

export function usePresence(taskId, workspaceId) {
  const [others, setOthers] = useState([]);

  // Ping every 20s while mounted; on unmount, clear.
  useEffect(() => {
    if (!taskId || !workspaceId) return;
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;  // anonymous users skip presence

    const ping = () => pingPresence({
      taskId,
      workspaceId,
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
  }, [taskId, workspaceId]);

  // Subscribe to the presence collection for this task.
  useEffect(() => {
    if (!taskId || !workspaceId) return undefined;
    const unsub = subscribeToPresence(taskId, workspaceId, setOthers);
    return () => unsub();
  }, [taskId, workspaceId]);

  // Strip ourselves from the list. Presence is workspace-scoped, so without a
  // workspace there is nothing we are allowed to show — derive that here
  // rather than clearing state from inside the effect.
  const me = auth.currentUser?.uid;
  if (!taskId || !workspaceId) return EMPTY;
  return others.filter((p) => p.userId !== me);
}
