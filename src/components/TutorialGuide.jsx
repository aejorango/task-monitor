// src/components/TutorialGuide.jsx — interactive product-tour overlay.
//
// A topbar button opens a menu of guided walkthroughs (create a project,
// create a task, etc). Picking one drives the app through its real views
// (via `navigate`) and spotlights the actual DOM element for each step with
// a floating instruction card. The dimming layer has pointer-events: none,
// so the user can click the highlighted element live instead of only reading
// about it.
//
// Steps target elements via `[data-tutorial="…"]` attributes sprinkled
// through the app, or plain stable selectors (e.g. `.page-header`) for
// "look at this view" steps where only one view is ever mounted at a time.

import { useEffect, useRef, useState } from 'react';

const TUTORIALS = [
  {
    id: 'create-project',
    icon: '📁',
    title: 'Create a project',
    blurb: 'Set up a project with phases to organize work.',
    steps: [
      {
        view: 'projects',
        selector: '.page-header',
        title: 'Projects',
        body: 'Everything in Task Monitor — tasks, activity, Gantt bars — belongs to a project. Let’s create one.',
      },
      {
        view: 'projects',
        selector: '[data-tutorial="new-project-btn"]',
        title: 'New project',
        body: 'Click **+ New project**. Give it a name and color, then optionally add phases (e.g. "Planning", "Build", "Launch") to break the work into stages.',
      },
      {
        view: 'projects',
        selector: '.page-header',
        title: 'You’re set',
        body: 'Once saved, the project shows up here and becomes selectable from the project picker in the topbar, on the Board, and in the Gantt chart.',
      },
    ],
  },
  {
    id: 'create-task',
    icon: '✅',
    title: 'Create a task',
    blurb: 'Add a task from the Board’s quick-add bar.',
    steps: [
      {
        view: 'board',
        selector: '[data-tutorial="quick-add-input"]',
        title: 'Quick-add',
        body: 'Type what needs doing here. You can use shortcuts right in the title — try `next Friday`, `!urgent`, `#tag`, or `@name` — Task Monitor parses them automatically.',
      },
      {
        view: 'board',
        selector: '[data-tutorial="quick-add-more"]',
        title: 'More details',
        body: 'Click **+ More details** to set a phase, priority, requested-by, or plan dates before saving.',
      },
      {
        view: 'board',
        selector: '[data-tutorial="quick-add-submit"]',
        title: 'Add it',
        body: 'Hit **Add task**. It lands in the To Do column, ready to drag into In Progress or Done.',
      },
    ],
  },
  {
    id: 'use-board',
    icon: '🗂️',
    title: 'Use the Kanban board',
    blurb: 'Drag tasks across columns, filter by project or tag.',
    steps: [
      {
        view: 'board',
        selector: '[data-tutorial="board-columns"]',
        title: 'Three columns',
        body: 'Tasks flow To Do → In Progress → Done. Drag a card between columns to update its status — dropping onto a phase row (when grouped) sets the phase too.',
      },
      {
        view: 'board',
        selector: '[data-tutorial="project-picker"]',
        title: 'Filter by project',
        body: 'Use the project picker in the topbar to narrow the whole app — Board, Gantt, Calendar, Table — to a single project.',
      },
      {
        view: 'board',
        selector: '.task-card',
        title: 'Card actions',
        body: 'Each card has quick actions: **▶** starts a live timer, **+ Log** records an activity entry, and **Edit** opens the full editor with subtasks, dependencies, and recurrence.',
      },
    ],
  },
  {
    id: 'track-time',
    icon: '⏱️',
    title: 'Log time & activity',
    blurb: 'Track hours and leave a progress note on a task.',
    steps: [
      {
        view: 'board',
        selector: '.task-card',
        title: 'Start a timer',
        body: 'Click the **▶** button on any card to start tracking. Only one timer runs at a time, app-wide.',
      },
      {
        view: 'board',
        selector: '[data-tutorial="timer-widget"]',
        title: 'Live in the topbar',
        body: 'While a timer runs, it shows here with the elapsed time. Click **⏹ Stop** to finish — you’ll be prompted to log it as an activity in one click.',
      },
      {
        view: 'board',
        selector: '.task-card',
        title: 'Or log without a timer',
        body: 'Prefer to log after the fact? Click **+ Log** on any card to record hours, a comment, and completion status directly.',
      },
    ],
  },
  {
    id: 'gantt-chart',
    icon: '📊',
    title: 'Explore the Gantt chart',
    blurb: 'See planned timelines and drag to reschedule.',
    steps: [
      {
        view: 'gantt',
        selector: '.page-header',
        title: 'Gantt timeline',
        body: 'Every task with plan dates shows up here as a bar, grouped by project and sorted by earliest start.',
      },
      {
        view: 'gantt',
        selector: '.gantt-bar.plan',
        title: 'Drag to reschedule',
        body: 'Drag the middle of a bar to move it, or drag either edge to resize — both update the task’s plan dates immediately. Lines between bars show dependencies.',
      },
    ],
  },
  {
    id: 'workspaces',
    icon: '🧭',
    title: 'Switch workspaces',
    blurb: 'Understand workspaces and how to switch between them.',
    steps: [
      {
        selector: '[data-tutorial="ws-switcher"]',
        title: 'Your workspace',
        body: 'A workspace is the top-level container for projects, tasks, and activity — click here to switch workspaces, create a new one, or manage members.',
      },
      {
        selector: '[data-tutorial="nav-projects"]',
        title: 'Projects live inside it',
        body: 'Everything you see in the sidebar — Projects, Board, Gantt, Calendar — is scoped to whichever workspace is active.',
      },
    ],
  },
];

// ─── Track a DOM element's bounding rect every frame while a tour is
// active, so the spotlight follows layout shifts, smooth-scrolling, and
// animated panels without extra plumbing. ────────────────────────────────
function useTrackedRect(el) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!el) { setRect(null); return undefined; }
    let raf;
    const tick = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) => {
        if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) {
          return prev;
        }
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [el]);
  return rect;
}

// Minimal **bold** renderer — the copy above only ever uses simple bold spans.
function renderBody(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

export default function TutorialGuide({ route, navigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState(null); // { tutorial, stepIndex }
  const [targetEl, setTargetEl] = useState(null);
  const [searching, setSearching] = useState(false);
  const menuRef = useRef(null);

  const step = active ? active.tutorial.steps[active.stepIndex] : null;
  const rect = useTrackedRect(targetEl);

  // Close the launcher menu on outside click.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDocClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  // Close the active tour on Escape.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setActive(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // Resolve the current step's target element: navigate to its view first if
  // needed, then poll for the selector (views are lazy-loaded and Firestore
  // data streams in, so the element may not exist on the first render pass).
  useEffect(() => {
    if (!step) { setTargetEl(null); return undefined; }

    if (step.view && route.view !== step.view) {
      navigate({ view: step.view, savedViewId: null, tagFilter: null, statusFilter: null });
      return undefined; // effect re-runs once route.view catches up
    }

    let cancelled = false;
    let attempts = 0;
    setSearching(true);
    setTargetEl(null);

    const tryFind = () => {
      if (cancelled) return;
      const el = step.selector ? document.querySelector(step.selector) : null;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTargetEl(el);
        setSearching(false);
      } else if (attempts < 24) {
        attempts += 1;
        setTimeout(tryFind, 150);
      } else {
        setSearching(false); // give up — tooltip falls back to centered
      }
    };
    tryFind();
    return () => { cancelled = true; };
  }, [active?.tutorial?.id, active?.stepIndex, step, route.view, navigate]);

  const startTutorial = (tutorial) => {
    setMenuOpen(false);
    setActive({ tutorial, stepIndex: 0 });
  };
  const endTutorial = () => setActive(null);
  const goNext = () => {
    if (!active) return;
    if (active.stepIndex >= active.tutorial.steps.length - 1) { endTutorial(); return; }
    setActive({ ...active, stepIndex: active.stepIndex + 1 });
  };
  const goBack = () => {
    if (!active || active.stepIndex === 0) return;
    setActive({ ...active, stepIndex: active.stepIndex - 1 });
  };

  return (
    <>
      <div className="dropdown" ref={menuRef}>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setMenuOpen((o) => !o)}
          title="Interactive tutorials"
        >
          🎓 <span className="tutorial-btn-label">Tutorials</span>
        </button>
        {menuOpen && (
          <div className="dropdown-menu tutorial-menu">
            <div className="search-group-label">Walk me through…</div>
            {TUTORIALS.map((t) => (
              <button key={t.id} className="dropdown-item tutorial-menu-item" onClick={() => startTutorial(t)}>
                <span className="tutorial-menu-icon">{t.icon}</span>
                <span className="tutorial-menu-text">
                  <span className="tutorial-menu-title">{t.title}</span>
                  <span className="muted small">{t.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <TutorialOverlay
          tutorial={active.tutorial}
          stepIndex={active.stepIndex}
          step={step}
          rect={rect}
          searching={searching}
          onNext={goNext}
          onBack={goBack}
          onClose={endTutorial}
        />
      )}
    </>
  );
}

function TutorialOverlay({ tutorial, stepIndex, step, rect, searching, onNext, onBack, onClose }) {
  const isLast = stepIndex === tutorial.steps.length - 1;
  const cardStyle = computeCardStyle(rect);

  return (
    <div className="tutorial-layer" role="dialog" aria-label={`${tutorial.title} tutorial`}>
      {rect && (
        <div
          className="tutorial-spotlight"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div className="tutorial-card" style={cardStyle}>
        <div className="tutorial-card-head">
          <span className="tutorial-card-eyebrow">{tutorial.icon} {tutorial.title} · {stepIndex + 1}/{tutorial.steps.length}</span>
          <button className="tutorial-close" onClick={onClose} aria-label="End tutorial" title="End tutorial">✕</button>
        </div>
        <h4 className="tutorial-card-title">{step.title}</h4>
        <p className="tutorial-card-body">
          {searching && !rect ? 'Looking for that on screen…' : renderBody(step.body)}
        </p>
        {!rect && !searching && (
          <p className="muted small tutorial-card-hint">
            (Can’t find this on screen right now — it may only appear once there’s data. Keep going.)
          </p>
        )}
        <div className="tutorial-card-actions">
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Skip tour</button>
          <div style={{ flex: 1 }} />
          {stepIndex > 0 && <button className="btn btn-sm" onClick={onBack}>← Back</button>}
          <button className="btn btn-sm btn-primary" onClick={onNext}>{isLast ? 'Done' : 'Next →'}</button>
        </div>
      </div>
    </div>
  );
}

// Position the instruction card near the target rect, flipping above/below
// and clamping horizontally so it never runs off-screen. Falls back to a
// centered card when there's no target (selector never resolved).
function computeCardStyle(rect) {
  const MARGIN = 12;
  const CARD_W = Math.min(320, window.innerWidth - MARGIN * 2);
  if (!rect) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: CARD_W,
    };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - (rect.top + rect.height);
  const placeBelow = spaceBelow > 180 || spaceBelow > rect.top;

  let left = rect.left + rect.width / 2 - CARD_W / 2;
  left = Math.max(MARGIN, Math.min(left, vw - CARD_W - MARGIN));

  const top = placeBelow
    ? Math.min(rect.top + rect.height + 16, vh - 220)
    : undefined;
  const bottom = !placeBelow
    ? Math.max(vh - rect.top + 16, MARGIN)
    : undefined;

  return {
    left,
    width: CARD_W,
    ...(top !== undefined ? { top } : {}),
    ...(bottom !== undefined ? { bottom } : {}),
  };
}
