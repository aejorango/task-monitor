// src/components/MessagesView.jsx — workspace chat (DMs + group chats).
// Two-pane iMessage-style layout: conversation list on the left, thread on the
// right. On mobile a single pane shows at a time.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useConversations, useMessages, useMe } from '../hooks/useChat';
import { useWorkspaces } from '../hooks/useWorkspace';
import {
  findOrCreateDM, createGroupConversation, sendMessage,
  markConversationRead, renameConversation,
} from '../services/firebase';

/* ── helpers ─────────────────────────────────────────────── */
function relTime(ts) {
  const ms = ts?.toMillis?.();
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(ms).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
function clockTime(ts) {
  const ms = ts?.toMillis?.();
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}
function dayLabel(ts) {
  const ms = ts?.toMillis?.();
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });
}
function initialOf(name) { return (name || '?').trim()[0]?.toUpperCase() || '?'; }

function otherMembers(conv, meUid) {
  return (conv.members || []).filter((u) => u !== meUid);
}
function profileOf(conv, uid) { return conv.memberProfiles?.[uid] || {}; }
function nameOf(conv, uid) {
  const p = profileOf(conv, uid);
  return p.displayName || p.email || 'Member';
}
function convTitle(conv, meUid) {
  if (conv.type === 'group') return conv.name || 'Group';
  const o = otherMembers(conv, meUid)[0];
  return o ? nameOf(conv, o) : 'Direct message';
}
function isUnread(conv, meUid) {
  const last = conv.lastMessageAt?.toMillis?.();
  if (!last) return false;
  if (conv.lastMessageSenderId === meUid) return false;
  const read = conv.readBy?.[meUid]?.toMillis?.() ?? 0;
  return last > read + 500; // small skew tolerance
}

/* ── Avatar ──────────────────────────────────────────────── */
function Avatar({ photoURL, name, size = 38, color }) {
  if (photoURL) {
    return <img className="chat-avatar" src={photoURL} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <div className="chat-avatar fallback" style={{ width: size, height: size, fontSize: size * 0.42, background: color }}>
      {initialOf(name)}
    </div>
  );
}

function ConvAvatar({ conv, meUid, size = 40 }) {
  if (conv.type === 'group') {
    return (
      <div className="chat-avatar group" style={{ width: size, height: size }}>
        <GroupGlyph />
      </div>
    );
  }
  const o = otherMembers(conv, meUid)[0];
  const p = o ? profileOf(conv, o) : {};
  return <Avatar photoURL={p.photoURL} name={p.displayName || p.email} size={size} />;
}

/* ── main ────────────────────────────────────────────────── */
export default function MessagesView() {
  const me = useMe();
  const { conversations, loading, workspaceId } = useConversations();
  const { workspaces } = useWorkspaces();
  const activeWs = workspaces.find((w) => w.id === workspaceId);

  const [activeId, setActiveId] = useState(null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const selected = conversations.find((c) => c.id === activeId) || null;

  // Mark read whenever a conversation is opened or receives new messages.
  useEffect(() => {
    if (selected && me?.uid && isUnread(selected, me.uid)) {
      markConversationRead(selected.id, me.uid);
    }
  }, [selected, selected?.lastMessageAt, me?.uid]);

  const openConversation = (id) => {
    setActiveId(id);
    if (me?.uid) markConversationRead(id, me.uid);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">
            Chat with people in {activeWs?.name ? <strong>{activeWs.name}</strong> : 'this workspace'} — direct or group.
          </p>
        </div>
      </div>

      <div className={`chat ${selected ? 'has-active' : ''}`}>
        {/* Conversation list */}
        <aside className="chat-list">
          <div className="chat-list-head">
            <span className="chat-list-title">Conversations</span>
            <button className="btn btn-primary btn-sm" onClick={() => setNewChatOpen(true)}>
              + New
            </button>
          </div>
          <div className="chat-list-scroll">
            {loading ? (
              <p className="muted small" style={{ padding: 16 }}>Loading…</p>
            ) : conversations.length === 0 ? (
              <div className="chat-empty-list">
                <p className="muted small">No conversations yet.</p>
                <button className="btn btn-sm" onClick={() => setNewChatOpen(true)}>Start a chat</button>
              </div>
            ) : conversations.map((c) => {
              const unread = isUnread(c, me?.uid);
              return (
                <button
                  key={c.id}
                  className={`chat-conv ${c.id === activeId ? 'active' : ''} ${unread ? 'unread' : ''}`}
                  onClick={() => openConversation(c.id)}
                >
                  <ConvAvatar conv={c} meUid={me?.uid} />
                  <div className="chat-conv-body">
                    <div className="chat-conv-top">
                      <span className="chat-conv-name">{convTitle(c, me?.uid)}</span>
                      <span className="chat-conv-time">{relTime(c.lastMessageAt)}</span>
                    </div>
                    <div className="chat-conv-preview">
                      {c.lastMessageText
                        ? <>{c.lastMessageSenderId === me?.uid ? 'You: ' : ''}{c.lastMessageText}</>
                        : <span className="muted">No messages yet</span>}
                      {unread && <span className="chat-unread-dot" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Thread */}
        <section className="chat-thread">
          {selected ? (
            <ChatThread
              key={selected.id}
              conversation={selected}
              me={me}
              onBack={() => setActiveId(null)}
            />
          ) : (
            <div className="chat-thread-empty">
              <div className="chat-thread-empty-icon"><GroupGlyph size={34} /></div>
              <p>Select a conversation</p>
              <p className="small muted">or start a new one to begin chatting.</p>
            </div>
          )}
        </section>
      </div>

      {newChatOpen && (
        <NewChatModal
          me={me}
          workspaceId={workspaceId}
          activeWs={activeWs}
          onClose={() => setNewChatOpen(false)}
          onCreated={(id) => { setNewChatOpen(false); openConversation(id); }}
        />
      )}
    </>
  );
}

/* ── Thread ──────────────────────────────────────────────── */
function ChatThread({ conversation, me, onBack }) {
  const { messages, loading } = useMessages(conversation.id);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(conversation.name || '');

  // Auto-scroll to newest on mount and when messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation.id]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !me) return;
    setDraft('');
    setSending(true);
    try {
      await sendMessage(conversation, me, text);
    } catch (err) {
      console.error('send failed', err);
      setDraft(text); // restore on failure
      alert('Could not send. Check console.');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const saveName = async () => {
    setRenaming(false);
    if (nameDraft.trim() && nameDraft.trim() !== conversation.name) {
      try { await renameConversation(conversation.id, nameDraft.trim()); }
      catch (err) { console.error(err); }
    }
  };

  const subtitle = conversation.type === 'group'
    ? `${conversation.members?.length || 0} members`
    : (conversation.memberProfiles?.[otherMembers(conversation, me?.uid)[0]]?.email || '');

  // Group consecutive messages by sender, and insert day separators.
  let lastSender = null;
  let lastDay = null;

  return (
    <div className="chat-thread-inner">
      <header className="chat-thread-head">
        <button className="chat-back" onClick={onBack} aria-label="Back">‹</button>
        <ConvAvatar conv={conversation} meUid={me?.uid} size={34} />
        <div className="chat-thread-head-body">
          {renaming ? (
            <input
              className="input input-sm"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
            />
          ) : (
            <span
              className={`chat-thread-title ${conversation.type === 'group' ? 'editable' : ''}`}
              onClick={() => { if (conversation.type === 'group') { setNameDraft(conversation.name || ''); setRenaming(true); } }}
              title={conversation.type === 'group' ? 'Click to rename' : undefined}
            >
              {convTitle(conversation, me?.uid)}
            </span>
          )}
          {subtitle && <span className="chat-thread-sub">{subtitle}</span>}
        </div>
      </header>

      <div className="chat-messages" ref={scrollRef}>
        {loading ? (
          <p className="muted small" style={{ textAlign: 'center', padding: 20 }}>Loading messages…</p>
        ) : messages.length === 0 ? (
          <div className="chat-messages-empty">
            <p className="muted small">No messages yet — say hello 👋</p>
          </div>
        ) : messages.map((m) => {
          const mine = m.senderId === me?.uid;
          const day = dayLabel(m.createdAt);
          const showDay = day && day !== lastDay;
          lastDay = day;
          const showName = !mine && conversation.type === 'group' && m.senderId !== lastSender;
          lastSender = m.senderId;
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day-sep"><span>{day}</span></div>}
              <div className={`chat-msg ${mine ? 'mine' : 'theirs'}`}>
                {showName && <div className="chat-msg-sender">{m.senderName}</div>}
                <div className="chat-bubble" title={clockTime(m.createdAt)}>
                  {m.text}
                </div>
                <div className="chat-msg-time">{clockTime(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="chat-composer">
        <textarea
          className="chat-input"
          rows={1}
          value={draft}
          placeholder="Message…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="chat-send" onClick={send} disabled={sending || !draft.trim()} aria-label="Send">
          <SendGlyph />
        </button>
      </div>
    </div>
  );
}

/* ── New chat modal ──────────────────────────────────────── */
function NewChatModal({ me, workspaceId, activeWs, onClose, onCreated }) {
  const [mode, setMode] = useState('dm'); // 'dm' | 'group'
  const [selected, setSelected] = useState(new Set());
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  // Candidate members = workspace members minus me.
  const candidates = useMemo(() => {
    const profiles = activeWs?.memberProfiles || {};
    return (activeWs?.members || [])
      .filter((uid) => uid !== me?.uid)
      .map((uid) => ({ uid, ...(profiles[uid] || {}) }))
      .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));
  }, [activeWs, me?.uid]);

  const toggle = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (mode === 'dm') { next.clear(); next.add(uid); }
      else { next.has(uid) ? next.delete(uid) : next.add(uid); }
      return next;
    });
  };

  const create = async () => {
    if (selected.size === 0 || !me) return;
    setBusy(true);
    try {
      const chosen = candidates.filter((c) => selected.has(c.uid));
      let id;
      if (mode === 'dm') {
        id = await findOrCreateDM(workspaceId, me, chosen[0]);
      } else {
        id = await createGroupConversation(workspaceId, me, groupName, [me, ...chosen]);
      }
      onCreated(id);
    } catch (err) {
      console.error(err);
      alert('Could not start the conversation. Check console.');
      setBusy(false);
    }
  };

  const canCreate = selected.size > 0 && (mode === 'dm' || mode === 'group');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3 className="modal-title">New message</h3>

        <div className="chat-mode-toggle">
          <button className={`chip ${mode === 'dm' ? 'active' : ''}`} onClick={() => { setMode('dm'); setSelected(new Set()); }}>Direct</button>
          <button className={`chip ${mode === 'group' ? 'active' : ''}`} onClick={() => { setMode('group'); setSelected(new Set()); }}>Group</button>
        </div>

        {mode === 'group' && (
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label">Group name</label>
            <input className="input" value={groupName} placeholder="e.g. Launch team"
              onChange={(e) => setGroupName(e.target.value)} />
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label className="label">{mode === 'dm' ? 'Choose a person' : 'Add people'}</label>
          {candidates.length === 0 ? (
            <p className="muted small">No other members in this workspace yet. Invite teammates from Settings → Workspaces.</p>
          ) : (
            <div className="chat-member-list">
              {candidates.map((c) => {
                const on = selected.has(c.uid);
                return (
                  <button key={c.uid} className={`chat-member ${on ? 'on' : ''}`} onClick={() => toggle(c.uid)}>
                    <Avatar photoURL={c.photoURL} name={c.displayName || c.email} size={32} />
                    <div className="chat-member-body">
                      <span className="chat-member-name">{c.displayName || c.email || 'Member'}</span>
                      {c.email && c.displayName && <span className="chat-member-email">{c.email}</span>}
                    </div>
                    <span className={`chat-check ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={busy || !canCreate}>
            {busy ? 'Starting…' : mode === 'dm' ? 'Start chat' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── glyphs ──────────────────────────────────────────────── */
function GroupGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function SendGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}
