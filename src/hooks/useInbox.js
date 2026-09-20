// src/hooks/useInbox.js — the notices waiting for the signed-in person.
//
// One listener, however many components ask (the topbar bell and the panel are
// two), through the same shared-subscription machinery as tasks and projects.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  markAllNotificationsRead, markNotificationRead, subscribeToMyNotifications,
} from '../services/firebase';
import { createSharedSubscription } from '../services/sharedSubscription';
import { sortNotices, unreadCount } from '../services/mentions';
import { useAuth } from './useTasks';

const inboxCache = createSharedSubscription(
  (userId, emit) => subscribeToMyNotifications(userId, emit),
  { name: 'inbox', empty: [] },
);

export function useInbox() {
  const { userId } = useAuth();
  const [raw, setRaw] = useState(() => (userId ? inboxCache.peek(userId) : []) || []);

  // subscribeToMyNotifications hands back an empty list (and opens no
  // listener) without a signed-in user, so there is nothing to reset here.
  useEffect(() => inboxCache.subscribe(userId, setRaw), [userId]);

  const notices = useMemo(() => sortNotices(raw || []), [raw]);
  const unread = unreadCount(notices);

  const markRead = useCallback(async (notice) => {
    if (!notice?.id || notice.read) return;
    try { await markNotificationRead(notice.id); }
    catch (err) { console.warn('could not mark that notice read', err); }
  }, []);

  const markAllRead = useCallback(async () => {
    try { await markAllNotificationsRead(notices); }
    catch (err) { console.warn('could not clear the inbox', err); }
  }, [notices]);

  return { notices, unread, markRead, markAllRead, userId };
}
