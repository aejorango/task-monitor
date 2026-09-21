// src/components/ProjectAskPanel.jsx — ask about THIS project, here
// (T-0140 / NEW-024).
//
// Ask AI is workspace-wide and lives on its own page. The question people
// actually have is project-shaped — "what is holding up the Riverside job?" —
// and they have it while looking at the project.
//
// Everything goes through `narrate` → `askAI`, the one chokepoint: no new
// provider path and no direct model call. What is new is the SCOPE (this
// project's tasks and activities only) and the grounding (this project's
// notebook, falling back to the workspace's).

import { useMemo, useState } from 'react';
import { routeIntent, buildAnswer } from '../services/askAiCore';
import { narrate } from '../services/askAi';
import { askSuggestions, groundFor, groundingState, notebookForProject, projectDigest } from '../services/projectAsk';
import { describeAiFailure } from '../services/errorMessages';
import { useAiStatus } from '../hooks/useAiStatus';
import { useIsOperator } from '../hooks/useUserProfile';
import { aiUnavailableCopy } from '../services/ai';
import AiOperatorHint from './AiOperatorHint';
import Markdown from './Markdown';

export default function ProjectAskPanel({
  project, workspace, tasks = [], activities = [], memberProfiles = {}, userId,
  // The answer path. Defaults to the real one; a test hands it a stand-in.
  ask = narrate,
}) {
  const aiStatus = useAiStatus();
  const { isOperator } = useIsOperator(userId);

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState(null);      // { question, answer } | { question, error }

  const digest = useMemo(
    () => projectDigest({ project, tasks, activities, memberProfiles, workspace }),
    [project, tasks, activities, memberProfiles, workspace],
  );
  const nb = useMemo(() => notebookForProject(project, workspace), [project, workspace]);
  const suggestions = useMemo(() => askSuggestions(digest), [digest]);

  const run = async (q) => {
    const text = String(q || '').trim();
    if (!text || busy) return;
    setBusy(true);
    setTurn({ question: text });
    try {
      const intent = routeIntent(text, digest);
      const base = buildAnswer(intent, digest, text);
      const answer = await ask({
        question: text,
        answer: base,
        digest,
        scope: project?.name || 'This project',
        ground: groundFor(project, workspace),
      });
      setTurn({ question: text, answer });
      setQuestion('');
    } catch (err) {
      const { message, detail } = describeAiFailure(
        err, 'Could not answer that just now. Try again in a moment.', { isOperator },
      );
      console.error('[project-ask] failed:', detail);
      setTurn({ question: text, error: message });
    } finally {
      setBusy(false);
    }
  };

  if (!aiStatus.available) {
    const off = aiUnavailableCopy(aiStatus, { isOperator });
    return (
      <div className="pa-off">
        <p className="muted">{off.headline}</p>
        {off.detail && <p className="small muted">{off.detail}</p>}
        <AiOperatorHint hint={off.operatorHint} />
      </div>
    );
  }

  const ground = turn?.answer ? groundingState(turn.answer, nb) : null;

  return (
    <div className="pa">
      <p className="muted small pa-scope">
        Answers use only this project’s tasks and activity
        {nb.notebookId
          ? `, and read ${nb.from === 'workspace' ? 'the workspace’s' : 'this project’s'} notebook first`
          : ''}.
      </p>

      <form
        className="pa-form"
        onSubmit={(e) => { e.preventDefault(); run(question); }}
      >
        <label className="label" htmlFor="pa-q">Ask about this project</label>
        <div className="pa-row">
          <input
            id="pa-q"
            className="input"
            value={question}
            placeholder="e.g. What is holding this up?"
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>

      {!turn && suggestions.length > 0 && (
        <div className="pa-suggestions">
          {/* Built from what this project actually has, so a starter question
              never comes back empty. */}
          {suggestions.map((s) => (
            <button key={s} type="button" className="btn btn-sm" disabled={busy} onClick={() => run(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {turn && (
        <div className="pa-turn">
          <p className="pa-question">{turn.question}</p>

          {busy && <p className="muted small">Reading this project…</p>}

          {turn.error && <p className="pa-error">{turn.error}</p>}

          {turn.answer && (
            <>
              {/* Grounded ≠ succeeded. A lookup that failed still answered, and
                  says so — rendering that as a clean result is the thing the
                  grounding contract forbids. */}
              {ground.state !== 'none' && (
                <span
                  className={`pa-ground is-${ground.state}`}
                  title={ground.title}
                >◇ {ground.label}</span>
              )}

              <div className="pa-answer"><Markdown src={turn.answer.summary} /></div>

              {turn.answer.actions?.length > 0 && (
                <ul className="pa-actions">
                  {turn.answer.actions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}

              {ground.citations.length > 0 && (
                <div className="pa-citations">
                  <span className="pa-citations-label">Read from</span>
                  <ul>
                    {ground.citations.map((c, i) => (
                      <li key={i} title={c.snippet || ''}>{c.title || c.source || `Source ${i + 1}`}</li>
                    ))}
                  </ul>
                </div>
              )}

              {turn.answer.followUps?.length > 0 && (
                <div className="pa-suggestions">
                  {turn.answer.followUps.map((f) => (
                    <button
                      key={f.q || f.label} type="button" className="btn btn-sm"
                      disabled={busy} onClick={() => run(f.q || f.label)}
                    >{f.label}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
