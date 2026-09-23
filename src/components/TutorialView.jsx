// src/components/TutorialView.jsx — Dashboard → Tutorial (T-0158).
//
// The Dashboard Explorer's Tutorial tab, ported panel for panel: a 292px
// lesson rail with a real progress bar, the active lesson as a navy-headed
// card with its steps on a numbered spine, and a "Try it here" card under it.
// Every metric is the mockup's own, off the style objects in its
// `<script type="text/x-dc">` block; `tests/ui/tutorialPage.test.mjs` fails
// the build if one drifts.
//
// THE PAGE DOES NOT RUN THE TOUR. The tour navigates between pages and
// highlights elements on them, so it stays mounted app-wide in `AppShell`;
// this page asks for one by firing `START_TUTORIAL_EVENT`. That separation
// predates the port and survives it — two copies of the sequencing is how a
// tour comes to know about a page that has since been renamed.
//
// Three things the mockup prints that this app does not have, and what each
// one became instead of a fabrication:
//
//   · "3 min" per lesson. Nothing here measures how long a tour takes. The
//     rail prints the STEP COUNT, which is real and answers the same question.
//   · "2/6" done. There was no such fact, so one was RECORDED: a lesson counts
//     as finished when somebody presses Done on the tour's last step — not
//     when they open it and not when they press "Skip tour". Per device, in
//     localStorage, because it is a personal fact about one reader and writing
//     it to a shared document would tell a teammate they had finished a lesson
//     they have never seen. See services/tutorialProgress.js.
//   · "TRY IT HERE · sandbox", a fake form with a Save button. There is no
//     sandbox, and a form that pretends to save is worse than no panel. The
//     card keeps its exact geometry and shows the lesson's REAL facts — how
//     many steps, which pages it walks you through, what it points at — with a
//     CTA that opens that page for real. The chip says "your real data",
//     because that is what it is.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { PageSubtitle } from './PageHeader';
import { TUTORIALS, startTutorial } from '../services/tutorials';
import { useAuth } from '../hooks/useTasks';
import { VIEW_REGISTRY, resolveView } from '../services/views';
import {
  TUTORIAL_DONE_EVENT, readDone, markUndone,
  lessonState, lessonNumber, lessonSize, lessonPages,
  progressOf, STATE_LABEL, STATE_MARK,
} from '../services/tutorialProgress';

/** A view id as the rest of the app names it — "Portfolio", not "projects". */
function viewLabel(id) {
  const target = resolveView(id);
  return VIEW_REGISTRY.find((v) => v.id === target)?.label || target;
}

/** The mockup's six-colour chip rotation, on the app's own tokens. */
const PALETTE = ['htu-pal-0', 'htu-pal-1', 'htu-pal-2', 'htu-pal-3', 'htu-pal-4', 'htu-pal-5'];

export default function TutorialView({ navigate }) {
  const { userId } = useAuth();
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(() => readDone(userId));

  // Re-read when the reader changes: two people on one device must not see
  // each other's progress, and the uid arrives a tick after the first render.
  // Adjusted during render — the React-recommended pattern, and the one
  // `useAllActivities` already uses for a workspace switch — rather than in an
  // effect, so the previous reader's ticks never paint for a frame.
  const [seenUid, setSeenUid] = useState(userId);
  if (seenUid !== userId) {
    setSeenUid(userId);
    setDone(readDone(userId));
  }

  // The tour is a sibling in the shell, so finishing one cannot re-render this
  // page on its own. It says so with an event.
  useEffect(() => {
    const onDone = () => setDone(readDone(userId));
    window.addEventListener(TUTORIAL_DONE_EVENT, onDone);
    return () => window.removeEventListener(TUTORIAL_DONE_EVENT, onDone);
  }, [userId]);

  const active = TUTORIALS[Math.min(index, TUTORIALS.length - 1)];
  const progress = useMemo(() => progressOf(TUTORIALS, done), [done]);
  const state = lessonState(active.id, done, active.id) === 'done' ? 'done' : 'active';
  const pages = useMemo(() => lessonPages(active, viewLabel), [active]);

  const start = useCallback(() => startTutorial(active.id), [active.id]);
  const unread = useCallback(() => setDone(markUndone(userId, active.id)), [userId, active.id]);
  const openFirstPage = useCallback(() => {
    const first = active.steps.find((s) => s.view)?.view;
    if (first && navigate) navigate({ view: resolveView(first) });
  }, [active, navigate]);

  return (
    <>
      <PageSubtitle>
        {progress.done} of {progress.total} finished · each one takes over the screen and points at
        the thing it is talking about. Escape ends it.
      </PageSubtitle>

      <div className="tv-layout">
        {/* ── lesson rail ──────────────────────────────────── */}
        <div className="bx-panel tv-rail">
          <div className="tv-rail-head">
            <span className="tv-lbl">Lessons</span>
            <span className="tv-count">{progress.done}/{progress.total}</span>
          </div>
          <div className="tv-bar">
            <span className="tv-bar-fill" style={{ width: `${progress.pct}%` }} />
          </div>
          <div className="tv-rail-list">
            {TUTORIALS.map((t, i) => {
              const st = lessonState(t.id, done, active.id);
              const sel = i === index;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`tv-lesson${sel ? ' is-sel' : ''}`}
                  onClick={() => setIndex(i)}
                  aria-current={sel ? 'true' : undefined}
                >
                  <span className={`tv-dot st-${st}`} aria-hidden="true">{STATE_MARK[st]}</span>
                  <span className="tv-lesson-text">
                    <span className="tv-lesson-title">{t.title}</span>
                    <span className="tv-lesson-meta">{lessonNumber(i)} · {lessonSize(t)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── the active lesson ────────────────────────────── */}
        <div className="tv-main">
          <div className="bx-panel tv-card">
            <div className="tv-head">
              <span className="tv-head-glow" aria-hidden="true" />
              <span className="tv-head-n">{lessonNumber(index)}</span>
              <div className="tv-head-text">
                <div className="tv-head-title">{active.title}</div>
                <div className="tv-head-meta">{lessonSize(active)} · {STATE_LABEL[state]}</div>
              </div>
            </div>

            <div className="tv-body">
              <div className="tv-steps">
                {active.steps.map((s, j) => (
                  <div key={j} className="tv-step">
                    <div className="tv-step-rail">
                      <span className="tv-step-n">{j + 1}</span>
                      {j < active.steps.length - 1 && <span className="tv-step-line" />}
                    </div>
                    <div className="tv-step-text">
                      <div className="tv-step-title">{s.title}</div>
                      <div className="tv-step-body">{renderBody(s.body)}</div>
                      {s.view && <span className="tv-step-where">{viewLabel(s.view)}</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="tv-actions">
                <button
                  type="button"
                  className="tv-btn"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                >
                  ← Back
                </button>
                <button type="button" className="tv-btn tv-btn-go" onClick={start}>
                  <Icon name="play" size={13} /> Start this tour →
                </button>
                {state === 'done' && (
                  <button type="button" className="tv-btn tv-btn-quiet" onClick={unread}>
                    Mark as unread
                  </button>
                )}
                <span className="tv-pos">Lesson {index + 1} of {TUTORIALS.length}</span>
              </div>
            </div>
          </div>

          {/* ── try it here ────────────────────────────────── */}
          <div className="bx-panel tv-try">
            <div className="tv-try-head">
              <span className="tv-lbl">Try it here</span>
              {/* NOT "sandbox" — there isn't one. The tour runs on the real app. */}
              <span className="tv-try-chip">your real data</span>
            </div>
            <div className="tv-try-bed">
              <div className="tv-try-top">
                <span className={`tv-try-icon ${PALETTE[index % PALETTE.length]}`}>
                  <Icon name={active.icon} size={11} />
                </span>
                <span className="tv-try-title">{active.title}</span>
                <span className={`bx-st st-${state === 'done' ? 'done' : 'todo'}`}>
                  {STATE_LABEL[state]}
                </span>
              </div>
              <div className="tv-try-grid">
                <Field label="Steps" value={String(active.steps.length)} strong />
                <Field label="Pages it walks you through" value={pages.join(' · ') || '—'} wide />
                <Field label="It points at" value={`${active.steps.filter((s) => s.selector).length} controls`} mono />
              </div>
              <div className="tv-try-actions">
                <button type="button" className="tv-btn tv-btn-open" onClick={openFirstPage}>
                  Open {pages[0] || 'the page'}
                </button>
                <span className="tv-try-note">
                  The tour highlights each control in turn — this just takes you there.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, value, strong = false, mono = false, wide = false }) {
  return (
    <div className={`tv-field${wide ? ' wide' : ''}`}>
      <div className="tv-field-lbl">{label}</div>
      <div className={`tv-field-val${strong ? ' is-strong' : ''}${mono ? ' is-mono' : ''}`}>{value}</div>
    </div>
  );
}

/**
 * A step's body carries **bold** markup. The tour's overlay renders it the
 * same way — one format, two surfaces, and the emphasis is usually on the
 * button the reader is being told to press, so dropping it here would lose
 * the point of the sentence.
 */
function renderBody(textValue) {
  return String(textValue || '').split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>);
}
