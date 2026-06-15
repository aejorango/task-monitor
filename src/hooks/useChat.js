// src/hooks/useChat.js — React hooks for the workspace chat.

import { useEffect, useState } from 'react';
import { onAuthChange, subscribeToConversations, subscribeToMessages, auth } from '../services/firebase';
import { useActiveWorkspaceId } from './useWorkspace';

// The signed-in user as a chat identity: { uid, displayName, email, photoURL }.
export function useMe() {
  const [me, setMe] = useState(() => authToMe(auth.currentUser));
  useEffect(() => {
    const unsub = onAuthChange(() => setMe(authToMe(auth.currentUser)));
    return () => unsub();
  }, []);
  return me;
}

function authToMe(u) {
  if (!u) return null;
  return { uid: u.uid, displayName: u.displayName || '', email: u.email || '', photoURL: u.photoURL || '' };
}

// Conversations the user is a member of in the active workspace.
export function useConversations() {
  const workspaceId = useActiveWorkspaceId();
  const me = useMe();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !me?.uid) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToConversations(workspaceId, me.uid, (data) => {
      setConversations(data);
      setLoading(false);
    });
    return () => unsub();
  }, [workspaceId, me?.uid]);

  return { conversations, loading, workspaceId, me };
}

// Messages for one conversation, oldest → newest.
export function useMessages(conversationId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!conversationId) { setMessages([]); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToMessages(conversationId, (data) => {
      setMessages(data);
      setLoading(false);
    });
    return () => unsub();
  }, [conversationId]);

  return { messages, loading };
}
