// src/mobile/MobileAskAi.jsx — Ask AI as a chat. Same engine as the desktop
// Ask AI page: the numbers come from `buildDigest` / `buildAnswer` over the
// live workspace, and Claude only words them (`narrate`). With AI switched
// off the locally written summary is the answer, so the tab always replies.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAllWorkspaceProjects, useAllWorkspaceTasks } from '../hooks/useTasks';
import { buildDigest, routeIntent, buildAnswer, narrate } from '../services/askAi';
import { useMobile, Ico, ICON } from './mobileUi';

// The mockup's four starters, each a question the engine has an intent for.
const SUGGESTIONS = [
  { text: "What's stuck?", tone: 'red' },
  { text: "Today's plan", ask: 'What changed this week and what should I tackle today?', tone: 'orange' },
  { text: 'Week recap', ask: 'What changed this week?', tone: 'slate' },
  { text: "Who's maxed?", ask: 'Who is overloaded right now?', tone: 'gold' },
];

export default function MobileAskAi() {
  const m = useMobile();
  const { projects: allProjects } = useAllWorkspaceProjects();
  const { tasks: allTasks } = useAllWorkspaceTasks();
  const [text, setText] = useState('');
  const tail = useRef(null);
  const seq = useRef(0);

  const digest = useMemo(() => buildDigest({
    tasks: m.tasks, projects: m.projects, activities: m.activities, workspaces: m.workspaces,
    allWorkspaceProjects: allProjects, allWorkspaceTasks: allTasks,
    memberProfiles: m.profiles, activeWorkspaceId: m.workspaceId,
  }), [m.tasks, m.projects, m.activities, m.workspaces, allProjects, allTasks, m.profiles, m.workspaceId]);
  const digestRef = useRef(digest);
  useEffect(() => { digestRef.current = digest; }, [digest]);

  useEffect(() => { tail.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [m.chat.length]);

  const ask = async (shown, question = shown) => {
    const q = String(question || '').trim();
    if (!q) return;
    // The thread outlives this tab; its length keeps ids unique across remounts.
    seq.current += 1;
    const id = `${m.chat.length}.${seq.current}`;
    m.setChat((c) => [...c, { id: `${id}q`, me: true, text: shown }, { id: `${id}a`, me: false, text: '…', thinking: true }]);
    setText('');
    let reply;
    try {
      const d = digestRef.current;
      const base = buildAnswer(routeIntent(q, d), d, q);
      const answer = await narrate({ question: q, answer: base, digest: d, scope: 'Everything' });
      reply = String(answer?.summary || base?.summary || '').replace(/\*\*/g, '').trim()
        || 'I could not find anything to say about that.';
    } catch (err) {
      console.error('[ask-ai mobile]', err);
      reply = 'Something went wrong building that answer. Try again in a moment.';
    }
    m.setChat((c) => c.map((x) => (x.id === `${id}a` ? { ...x, text: reply, thinking: false } : x)));
  };

  const hasChat = m.chat.length > 0;

  return (
    <div className="m-stack is-14 m-ai">
      {!hasChat && (
        <>
          <div className="m-ai-hero">
            <img src="/mobile/ai-robo.jpg" alt="" />
            <div className="m-ai-hero-foot"><div className="m-ai-hero-title">Ask me<br />anything.</div></div>
            <span className="m-ai-badge">✦ AI</span>
          </div>
          <div className="m-ai-sugs">
            {SUGGESTIONS.map((s) => (
              <button key={s.text} type="button" className={`m-ai-sug is-${s.tone}`} onClick={() => ask(s.text, s.ask)}>{s.text}</button>
            ))}
          </div>
        </>
      )}

      {hasChat && (
        <div className="m-ai-head">
          <span className="m-h1 is-32">Ask AI</span>
          <button type="button" className="m-ghost-pill" onClick={() => m.setChat([])}>New</button>
        </div>
      )}

      {m.chat.map((c) => (
        <div key={c.id} className={`m-bubble-row${c.me ? ' is-me' : ''}`}>
          <div className={`m-bubble${c.me ? ' is-me' : ''}${c.thinking ? ' is-thinking' : ''}`}>{c.text}</div>
        </div>
      ))}
      <div ref={tail} />

      <div className="m-composer">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) ask(text.trim()); }}
          placeholder="Ask anything…"
          aria-label="Ask anything"
        />
        <button type="button" className="m-composer-send" aria-label="Send" onClick={() => text.trim() && ask(text.trim())}>
          <Ico d={ICON.send} size={18} stroke={2.4} />
        </button>
      </div>
    </div>
  );
}
