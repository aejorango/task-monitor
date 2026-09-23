// src/components/HowToUseView.jsx — Dashboard → How to use (T-0156).
//
// The Dashboard Explorer's "How to use" tab, ported panel for panel: a navy
// one-line hero, the data model drawn as NESTING, the loop as four numbered
// chips, and the status language beside the shortcuts. Every metric in it is
// the mockup's own, copied from the style objects in its `<script
// type="text/x-dc">` block rather than measured off a screenshot;
// `tests/ui/howToUse.test.mjs` fails the build if one drifts.
//
// Two rules the port is built on, both from PORTING-A-MOCKUP.md:
//
//   · NEVER INVENT. The mockup's Shortcuts panel lists six keys — N for a new
//     item, L to log, "G then B" to go to the board. This app has none of
//     them. Printing a shortcut that does nothing is worse than printing no
//     panel: somebody presses it, nothing happens, and they stop trusting the
//     page. `SHORTCUTS` below is the app's REAL key handling, each row
//     carrying the file it is implemented in. Same rule for the data model —
//     it draws the reader's OWN most recent entry, and says so; only when
//     there is nothing to draw does it fall back to a labelled example.
//
//   · THE APP WINS ON COVERAGE. The mockup draws four panels. This page also
//     carries the decision guide, the scenarios, the concepts, the
//     anti-patterns and the glossary — which the mockup has no room for and
//     which are the reason anybody opens it twice. They were re-homed into
//     the mockup's own card idiom below the four panels, not deleted.
//
// The status vocabulary is `STATUS_TEXT` + `displayStatus` from
// services/boardScope.js — the same function the Kanban card, the WBS and the
// Dashboard ask. A guide that named the statuses itself would be a fifth
// surface free to drift from the four that matter.

import { useMemo, useState } from 'react';
import NavIcon from './Icon';
import Avatar from './Avatar';
import { PageSubtitle } from './PageHeader';
import { startTutorial } from '../services/tutorials';
import { fmtDay } from './ActivityTimeline';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { STATUS_TEXT } from '../services/boardScope';

// ─── Icon set ────────────────────────────────────────────────
// Inline stroke SVGs (Lucide-style) so the guide matches the app's
// monochrome, professional aesthetic instead of colorful emoji.
// Every glyph inherits `currentColor`, so theming is automatic.

const ICON_PATHS = {
  workspace: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
    </>
  ),
  project: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  phase: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>
  ),
  task: (
    <>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  subtask: (
    <>
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </>
  ),
  activity: (
    <>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </>
  ),
  tag: (
    <>
      <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  dependency: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  recurring: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  template: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>
  ),
  checkCircle: (
    <>
      <path d="M21.8 10A10 10 0 1 1 17 3.3" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
  goal: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  minutes: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8M8 17h6" />
    </>
  ),
  message: (
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
  ),
  wbs: (
    <>
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <rect x="3" y="17" width="6" height="4" rx="1" />
      <rect x="15" y="17" width="6" height="4" rx="1" />
      <path d="M12 7v4M6 17v-2a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" />
    </>
  ),
};

function Icon({ name, size = 18, className }) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

// 6-color rotation reused for the page and concept icon chips — the imported
// mockup's palette, built entirely from existing theme tokens so dark mode
// stays automatic.
const CHIP_PALETTE = ['htu-pal-0', 'htu-pal-1', 'htu-pal-2', 'htu-pal-3', 'htu-pal-4', 'htu-pal-5'];


// ─── The loop ────────────────────────────────────────────────
// The mockup's four numbered chips. `where` is a REAL destination, and the
// chip navigates there — the mockup prints the path as decoration, but a path
// printed next to a thing you can click is a thing that should click.

const FLOWS = [
  { n: '1', title: 'Log',     where: 'Dashboard → Log time', view: 'dashboard' },
  { n: '2', title: 'Track',   where: 'Board → Kanban',       view: 'board' },
  { n: '3', title: 'Measure', where: 'Reports → Analytics',    view: 'analytics' },
  { n: '4', title: 'Report',  where: 'Reports → Summary',    view: 'review' },
];

// ─── Status language ─────────────────────────────────────────
// Four of these five ARE the board's columns, and their names come from
// `STATUS_TEXT` so this page cannot drift from the card, the WBS and the
// Dashboard. The fifth is not a column at all: "Stuck" is what
// `displayStatus` PRINTS over whatever column a task is sitting in, which is
// exactly the kind of thing a guide has to say out loud.

const STATUS_GUIDE = [
  { key: 'todo',   label: STATUS_TEXT.todo,   when: 'Nobody has started it yet.' },
  { key: 'doing',  label: STATUS_TEXT.doing,  when: 'Someone has picked it up and it is moving.' },
  { key: 'review', label: STATUS_TEXT.review, when: 'Done by its owner, waiting on a second pair of eyes.' },
  { key: 'stuck',  label: 'Stuck',            when: 'A bottleneck somebody logged, or open and past its plan date.' },
  { key: 'done',   label: STATUS_TEXT.done,   when: 'Shipped. The hours stay in the report.' },
];

// ─── Shortcuts ───────────────────────────────────────────────
// THE APP'S OWN KEYS, not the mockup's. The Explorer lists N, L, "G then B",
// "G then R" and "?"; none of them exist here, and a shortcut card that lies
// is the fastest way to lose a reader. Each row names the file that handles
// the key, so the next person to change one knows this panel has to move too.

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

const SHORTCUTS = [
  { k: IS_MAC ? '⌘K' : 'Ctrl K', a: 'Command palette' },   // AppShell.jsx
  { k: 'Esc',  a: 'Close it again' },                       // AppShell / useModalDialog
  { k: '↑ ↓',  a: 'Move through results' },                 // AppShell.jsx
  { k: '↵',    a: 'Open the highlighted one' },             // AppShell.jsx
  { k: 'D',    a: 'Due alert: done' },                // DueTaskAlertModal.jsx
  { k: 'S',    a: 'Due alert: skip' },           // DueTaskAlertModal.jsx
];

/**
 * The entry the Data-model panel draws.
 *
 * It is the reader's OWN most recent activity, with the task it belongs to
 * and that task's project — because "workspace › project › item › activity"
 * is a claim about their data, and the fastest way to believe a claim is to
 * see your own row in it. `real` is false only when there is nothing yet to
 * draw, and the panel says so in its head rather than passing a fabrication
 * off as a reading.
 */
function modelExample({ tasks, activities, projects, workspace, memberProfiles }) {
  const liveTasks = tasks.filter((t) => !t.deleted && !t.archived);
  const wsName = workspace?.name || 'Your workspace';
  const ownerOf = (t) =>
    t?.requestedBy?.trim()
    || memberProfiles[t?.userId]?.displayName
    || memberProfiles[t?.userId]?.email
    || null;

  const byNewest = [...activities]
    .filter((a) => !a.deleted && a.taskId)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  for (const a of byNewest) {
    const task = liveTasks.find((t) => t.id === a.taskId);
    if (!task) continue;
    const project = projects.find((p) => p.id === task.projectId) || null;
    return {
      real: true,
      note: 'your most recent entry',
      workspace: wsName,
      project: project?.name || 'No project',
      phases: project?.phases?.length ?? null,
      task: task.title,
      done: task.status === 'done',
      owner: ownerOf(task),
      ownerId: task.assignedTo?.[0] || task.userId,
      hours: Number(a.hoursSpent) || 0,
      comment: a.comment || 'no note',
      date: a.date || null,
    };
  }

  // Nothing logged yet. Draw the shape with a task if there is one, and say
  // plainly that the activity row is what one WOULD look like.
  const task = liveTasks[0] || null;
  const project = task ? projects.find((p) => p.id === task.projectId) || null : projects[0] || null;
  return {
    real: false,
    note: task ? 'nothing logged yet — the activity row is an example' : 'an example — you have not created anything yet',
    workspace: wsName,
    project: project?.name || 'SBLAF onboarding',
    phases: project?.phases?.length ?? null,
    task: task?.title || 'Rotate partner API keys',
    done: task ? task.status === 'done' : false,
    owner: task ? ownerOf(task) : null,
    ownerId: task?.assignedTo?.[0] || task?.userId || 'example',
    hours: 2,
    comment: 'rotated sandbox keys',
    date: null,
  };
}

export default function HowToUseView({ navigate }) {
  const { tasks } = useTasks();
  const { projects } = useProjects();
  const { activities } = useAllActivities();
  const { workspaces } = useWorkspaces();
  const activeWs = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWs) || null;

  // `workspace?.memberProfiles || {}` OUTSIDE the memo would be a fresh object
  // on every render while no workspace is loaded, which makes the memo run on
  // every render — the same trap `useModalDialog` was bitten by twice.
  const model = useMemo(
    () => modelExample({
      tasks, activities, projects, workspace,
      memberProfiles: workspace?.memberProfiles || {},
    }),
    [tasks, activities, projects, workspace],
  );

  const go = (view) => { if (navigate) navigate({ view }); };

  return (
    <>
      <PageSubtitle>The mental model in four panels, then the long answers underneath.</PageSubtitle>

      <div className="htu-stack">
        {/* ── one-line hero ─────────────────────────────────── */}
        <div className="htu-hero">
          <span className="htu-hero-glow" aria-hidden="true" />
          <div className="htu-hero-text">
            <div className="htu-hero-eyebrow">How to use</div>
            <div className="htu-hero-line">Log the work. Everything else is computed.</div>
          </div>
          <button
            type="button"
            className="htu-hero-cta"
            onClick={() => startTutorial()}
          >
            Take the tutorial →
          </button>
        </div>

        {/* ── data model, as nesting ────────────────────────── */}
        <div className="bx-panel htu-card">
          <div className="htu-lbl">
            Data model
            <span className="htu-lbl-note">{model.note}</span>
          </div>
          <div className="htu-nest-ws">
            <div className="htu-nest-head">
              <span className="htu-nest-badge ws">Workspace</span>
              <span className="htu-nest-name ws">{model.workspace}</span>
            </div>

            <div className="htu-nest-proj">
              <div className="htu-nest-head">
                <span className="htu-nest-badge proj">Project</span>
                <span className="htu-nest-name proj">{model.project}</span>
                {model.phases !== null && (
                  <span className="htu-nest-phases">
                    {model.phases} {model.phases === 1 ? 'phase' : 'phases'}
                  </span>
                )}
              </div>

              <div className="htu-nest-item">
                <div className="htu-nest-irow">
                  <span className={`htu-nest-tick${model.done ? '' : ' off'}`} aria-hidden="true">
                    {model.done ? '✓' : ''}
                  </span>
                  <span className="htu-nest-badge item">Item</span>
                  <span className="htu-nest-title">{model.task}</span>
                  {model.owner
                    ? <Avatar name={model.owner} id={model.ownerId} size={20} />
                    : <span className="htu-nest-noone" title="Nobody is assigned" aria-hidden="true" />}
                </div>
                <div className="htu-nest-arow">
                  <span className="htu-nest-badge act">Activity</span>
                  <span className="htu-nest-hours">{model.hours.toFixed(1)}h</span>
                  <span className="htu-nest-comment">{model.comment}</span>
                  <span className="htu-nest-date">{model.date ? fmtDay(model.date) : '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── the loop, terse ───────────────────────────────── */}
        <div className="bx-panel htu-card">
          <div className="htu-lbl">The loop</div>
          <div className="htu-loop">
            {FLOWS.map((f, i) => (
              <span key={f.n} className="htu-loop-cell">
                <button type="button" className="htu-loop-chip" onClick={() => go(f.view)}>
                  <span className="htu-loop-num">{f.n}</span>
                  <span className="htu-loop-text">
                    <span className="htu-loop-title">{f.title}</span>
                    <span className="htu-loop-where">{f.where}</span>
                  </span>
                </button>
                {i < FLOWS.length - 1 && <span className="htu-loop-arrow" aria-hidden="true">→</span>}
              </span>
            ))}
          </div>
        </div>

        {/* ── status language + shortcuts ───────────────────── */}
        <div className="htu-pair">
          <div className="bx-panel htu-card">
            <div className="htu-lbl">Status language</div>
            <div className="htu-statuses">
              {STATUS_GUIDE.map((s) => (
                <div key={s.key} className="htu-status-row">
                  <span className={`bx-st st-${s.key} htu-status-pill`}>{s.label}</span>
                  <span className="htu-status-when">{s.when}</span>
                </div>
              ))}
            </div>
            <div className="htu-foot">
              Four of those are the board's columns. <strong>Stuck</strong> is not — it is
              printed over whatever column the task is in, so a card that says "Working on it"
              twelve days late cannot get away with it.
            </div>
          </div>

          <div className="bx-panel htu-card">
            <div className="htu-lbl">Shortcuts</div>
            <div className="htu-keys">
              {SHORTCUTS.map((k) => (
                <div key={k.k} className="htu-key-row">
                  <span className="htu-keycap">{k.k}</span>
                  <span className="htu-key-act">{k.a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Reference />
      </div>
    </>
  );
}

/**
 * Everything the mockup had no room for.
 *
 * The four panels above are the whole of the Explorer's How-to-use tab. They
 * answer "what is this shaped like" in ten seconds, which is what somebody
 * wants the first time. They do not answer "is this a project or a task?",
 * which is what somebody wants the fifth time — so the long-form guide stayed,
 * re-drawn in the same card idiom and folded shut, rather than being deleted
 * to match a screenshot.
 */
function Reference() {
  return (
    <>
      <Fold label="Decide what goes where" note="stop at the first yes">
        <div className="htu-steps">
          {DECISION_TREE.map((step, i) => (
            <div key={i} className="htu-step">
              <span className="htu-step-n">{i + 1}</span>
              <div className="htu-step-body">
                <div className="htu-step-q">{step.q}</div>
                <div className="htu-step-a yes"><strong>Yes →</strong> {step.yes}</div>
                {step.no && <div className="htu-step-a no"><strong>No →</strong> {step.no}</div>}
              </div>
            </div>
          ))}
        </div>
      </Fold>

      <Fold label="The containers" note={`${CONCEPTS.length} of them, and when each one is the right one`}>
        <div className="htu-concepts">
          {CONCEPTS.map((c, i) => (
            <ConceptCard key={c.name} concept={c} paletteClass={CHIP_PALETTE[i % CHIP_PALETTE.length]} />
          ))}
        </div>
      </Fold>

      <Fold label="Real situations" note="the call, and how it would be set up">
        <div className="htu-cases">
          {SCENARIOS.map((s, i) => (
            <div key={i} className="htu-case">
              <div className="htu-case-head">
                <span className="htu-case-title">“{s.title}”</span>
                <span className="htu-case-verdict">{s.verdict}</span>
              </div>
              <div className="htu-case-why"><strong>Why:</strong> {s.reason}</div>
              <ul className="htu-list">
                {s.structure.map((line, j) => <li key={j}>{line}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Fold>

      <Fold label="The rhythms" note="what to do when">
        <div className="htu-flows">
          {WORKFLOWS.map((w, i) => (
            <div key={i} className="htu-flow">
              <div className="htu-flow-title">{w.title}</div>
              <ol className="htu-ol">
                {w.steps.map((s, j) => <li key={j}>{s}</li>)}
              </ol>
            </div>
          ))}
        </div>
      </Fold>

      <Fold label="Every page, in one line each" note={`${VIEWS_GUIDE.length} pages`}>
        <div className="htu-pages">
          {VIEWS_GUIDE.map((v, i) => (
            <div key={v.name} className="htu-page">
              <span className={`htu-page-icon ${CHIP_PALETTE[i % CHIP_PALETTE.length]}`}>
                <NavIcon name={v.icon} size={16} />
              </span>
              <span className="htu-page-text">
                <span className="htu-page-name">{v.name}</span>
                <span className="htu-page-desc">{v.text}</span>
              </span>
            </div>
          ))}
        </div>
      </Fold>

      <Fold label="Principles" note="the habits that make the rest work">
        <div className="htu-rules">
          {PRINCIPLES.map((p, i) => (
            <div key={i} className="htu-rule">
              <div className="htu-rule-title">{p.title}</div>
              <div className="htu-rule-body">{p.body}</div>
            </div>
          ))}
        </div>
      </Fold>

      <Fold label="What to avoid" note={`${ANTIPATTERNS.length} ways this goes wrong`}>
        <div className="htu-traps">
          {ANTIPATTERNS.map((a, i) => (
            <div key={i} className="htu-trap">
              <div className="htu-trap-bad">
                <Icon name="xCircle" size={15} className="htu-trap-icon bad" /> <strong>{a.bad}</strong>
              </div>
              <div className="htu-trap-why"><strong>Why it bites:</strong> {a.why}</div>
              <div className="htu-trap-fix">
                <Icon name="checkCircle" size={15} className="htu-trap-icon good" /> <strong>Instead:</strong> {a.instead}
              </div>
            </div>
          ))}
        </div>
      </Fold>

      <Fold label="Glossary" note={`${GLOSSARY.length} words`}>
        <table className="htu-gloss">
          <tbody>
            {GLOSSARY.map(([term, def]) => (
              <tr key={term}>
                <td className="htu-gloss-term">{term}</td>
                <td className="htu-gloss-def">{def}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Fold>
    </>
  );
}

/**
 * One reference panel: the mockup's card and uppercase label, with the body
 * folded away.
 *
 * `<details>` rather than a `useState` toggle, so the browser gives it the
 * disclosure semantics, Enter and Space both work, and ⌘F finds text inside a
 * closed one in the browsers that support it. Closed by default: eight open
 * panels is the wall of text the four panels above exist to replace.
 */
function Fold({ label, note, children }) {
  return (
    <details className="bx-panel htu-card htu-fold">
      <summary className="htu-lbl htu-fold-head">
        {label}
        {note && <span className="htu-lbl-note">{note}</span>}
        <span className="htu-fold-mark" aria-hidden="true" />
      </summary>
      <div className="htu-fold-body">{children}</div>
    </details>
  );
}

function ConceptCard({ concept, paletteClass }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`htu-concept${open ? ' open' : ''}`}>
      <button type="button" className="htu-concept-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`htu-concept-icon ${paletteClass}`}><Icon name={concept.icon} size={16} /></span>
        <span className="htu-concept-name">{concept.name}</span>
        <span className="htu-concept-toggle" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      <div className="htu-concept-one">{concept.oneLine}</div>

      {open && (
        <div className="htu-concept-body">
          <div className="htu-twocol">
            <div className="htu-pane do">
              <div className="htu-pane-lbl do"><Icon name="check" size={13} /> Use it when…</div>
              <ul className="htu-list">
                {concept.useWhen.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </div>
            <div className="htu-pane dont">
              <div className="htu-pane-lbl dont"><Icon name="ban" size={13} /> Don't use it when…</div>
              <ul className="htu-list">
                {concept.dontUseWhen.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </div>
          </div>

          <div className="htu-egs">
            <div className="htu-pane-lbl">Examples</div>
            {concept.examples.map((ex, i) => (
              <div key={i} className={`htu-eg ${ex.good ? 'good' : 'bad'}`}>
                <span className="htu-eg-mark" aria-hidden="true">{ex.good ? '✓' : '✗'}</span>
                <span dangerouslySetInnerHTML={{ __html: ex.good || ex.bad }} />
              </div>
            ))}
          </div>

          <div className="htu-thumb"><strong>Rule of thumb:</strong> {concept.rule}</div>
        </div>
      )}
    </div>
  );
}

// ─── Reference data ──────────────────────────────────────────
// The long answers. Rendered by <Reference /> above, inside the mockup's
// own card idiom; the CONTENT is what the page carried before the port.

const DECISION_TREE = [
  {
    q: 'Does this need to be hidden from some current members of my org?',
    yes: 'New Workspace',
    no:  null,
    next: 'Q2',
  },
  {
    q: 'Does it have a clear "done" or "shipped" outcome, and does it group multiple related tasks?',
    yes: 'New Project',
    no:  null,
    next: 'Q3',
  },
  {
    q: 'Is it a unit of work that one person will actively pick up and finish?',
    yes: 'New Task (inside the right project)',
    no:  null,
    next: 'Q4',
  },
  {
    q: 'Is it a small step inside a task that\'s already in motion?',
    yes: 'New Subtask on that task',
    no:  null,
    next: 'Q5',
  },
  {
    q: 'Is it a record of time you already spent on a specific task?',
    yes: 'New Activity on that task',
    no:  null,
    next: 'Q6',
  },
  {
    q: 'Is it a label that cuts across projects (e.g. #blocker, #client-x)?',
    yes: 'New Tag on the relevant tasks',
    no:  'Probably belongs in a notes tool, not Task Monitor. Or sharpen it until it fits one of the above.',
  },
];

const CONCEPTS = [
  {
    name: 'Workspace',
    icon: 'workspace',
    oneLine: 'A separate world. Members of a workspace share everything inside it; people outside see nothing.',
    useWhen: [
      'You need a hard boundary between audiences (e.g. work vs. personal).',
      'A new organization, team, or client is involved who shouldn\'t see the rest.',
      'You\'re collaborating with someone you don\'t want to grant access to all your data.',
    ],
    dontUseWhen: [
      'You just want to "categorize" — that\'s what Projects and Tags are for.',
      'It\'s the same team and the same data, just a different initiative.',
    ],
    examples: [
      { good: 'BRIDGED — your organization\'s shared workspace, all teammates inside.' },
      { good: 'Personal — your private workspace, just you.' },
      { good: 'Client X engagement — a workspace where Client X has read-only access.' },
      { bad:  '"Marketing" as a workspace — it\'s a project area, not a security boundary. Make it a Project (or a Tag).' },
    ],
    rule: 'Default to one workspace per organization. Spin up a new one only when access control demands it.',
  },
  {
    name: 'Project',
    icon: 'project',
    oneLine: 'A real-world initiative with an outcome — something you can declare "done" or "shipped".',
    useWhen: [
      'There\'s a deliverable, launch, or measurable end state.',
      'Multiple tasks ladder up to the same goal.',
      'You\'d talk about it as a single thing in a status update ("the rebrand is on track").',
    ],
    dontUseWhen: [
      'It\'s ongoing forever with no defined end (that\'s often a recurring task or a tag).',
      'It\'s a single afternoon of work — make it a task, not a project.',
      'It\'s really a phase within a bigger project ("Q3 Launch — Build phase" ≠ a project).',
    ],
    examples: [
      { good: '"Member Onboarding Revamp" — clear outcome, several tasks, a target date.' },
      { good: '"Annual Report 2026" — yearly initiative with a publish date.' },
      { good: '"Personal — Health & Fitness" — long-running but with phases (Q1 strength, Q2 cardio).' },
      { bad:  '"Email" — that\'s a routine, not a project. Tag emails instead, or use a recurring task.' },
      { bad:  '"Random ideas" — those go on a personal task with subtasks, or in a notes tool.' },
    ],
    rule: 'If you can\'t finish the sentence "this project is done when …", it shouldn\'t be a project yet.',
  },
  {
    name: 'Phase',
    icon: 'phase',
    oneLine: 'A stage a Project moves through. Use phases when the project has clearly different "modes" of work.',
    useWhen: [
      'The project has distinct stages (Discovery → Build → Launch).',
      'Different tasks belong to different time-boxes within the project.',
      'You want the Board to swim-lane by phase for one project.',
    ],
    dontUseWhen: [
      'Every project gets the same generic "Phase 1 / Phase 2" labels — that\'s noise.',
      'It\'s really just status ("doing" vs "done" — those are statuses, not phases).',
      'The project is small (under ~10 tasks). One bucket is fine.',
    ],
    examples: [
      { good: 'Onboarding Revamp → "Discovery · Build · Launch · Wrap-up"' },
      { good: 'Annual Report → "Drafting · Design · Review · Publish"' },
      { good: 'Event → "Planning · Promotion · Day-of · Recap"' },
      { bad:  '"To do · In progress · Done" as phases — those are statuses on the task, already built in.' },
    ],
    rule: 'A phase is the kind of work, not the state of work. Build vs. Launch ≠ Doing vs. Done.',
  },
  {
    name: 'Task',
    icon: 'task',
    oneLine: 'A unit of work that one person owns end-to-end. Has a status (todo · doing · done) and ideally a due date.',
    useWhen: [
      'Someone has to actively work on it for between ~15 minutes and a few days.',
      'You can name it as a verb + thing ("Draft RFP response", "Migrate users table").',
      'You\'d want to see it on a board and move it through todo → doing → done.',
    ],
    dontUseWhen: [
      'It\'s a single click of a checkbox inside another task — make it a Subtask.',
      'It\'s a multi-week effort with many people — make it a Project, and its work items into tasks.',
      'It\'s a one-time observation ("FYI users hate the new flow") — that\'s a note or an activity comment.',
    ],
    examples: [
      { good: 'Draft the welcome-email copy (due Fri).' },
      { good: 'Migrate the users table to Postgres 16.' },
      { good: 'Interview 3 onboarding drop-offs.' },
      { bad:  '"Marketing" as a task — too vague, no end state.' },
      { bad:  '"Reply to everything in inbox" as a task — that\'s a recurring habit, not a discrete unit.' },
    ],
    rule: 'A good task has a clear owner, a clear "done" criteria, and ideally a date. If any of those is missing, sharpen it before saving.',
  },
  {
    name: 'Subtask',
    icon: 'subtask',
    oneLine: 'A checklist item inside a task. Cheap, lightweight, no due date of its own.',
    useWhen: [
      'A task has 2–10 small steps you want to track without spawning a whole new task.',
      'You want a visible progress bar on the task card.',
      'The steps are sequential and tightly coupled to the parent task.',
    ],
    dontUseWhen: [
      'A "subtask" needs its own owner, due date, or status — promote it to a real Task and link it as a dependency.',
      'You have more than ~10 — that\'s a sign the parent task is really a project (or needs a phase).',
    ],
    examples: [
      { good: 'Task "Publish blog post" → ☐ Write draft · ☐ Get edit · ☐ Add images · ☐ Schedule.' },
      { good: 'Task "Prep board deck" → ☐ Outline · ☐ Pull metrics · ☐ Design · ☐ Rehearse.' },
      { bad:  'Subtask "Have a 1-hr discovery interview with VP of Sales" — that deserves its own task with its own time log.' },
    ],
    rule: 'Subtasks are for momentum, not accountability. If you need accountability, make it a task.',
  },
  {
    name: 'Activity',
    icon: 'activity',
    oneLine: 'A time-stamped record of work performed against a task. This is your timesheet + journal in one.',
    useWhen: [
      'You spent meaningful time on a task and want to log it.',
      'You want to capture context (what happened, blockers, attachments).',
      'You want hours-by-project totals to be real (not guessed).',
    ],
    dontUseWhen: [
      'You did 30 seconds of work — don\'t bother.',
      'You\'re tempted to log "TBD" or "will update later" — log when you actually did something.',
    ],
    examples: [
      { good: 'May 27 · 1.5h · Drafted v1 of welcome email; client asked for warmer tone. Attachment: draft.docx.' },
      { good: 'May 28 · 0.5h · Blocked — waiting on legal to approve copy. Bottleneck noted.' },
      { good: 'May 29 · 0h · Status update: handed off to designer, marking blocked on me.' },
      { bad:  'Logging activity on a project directly — Activities always belong to a specific Task.' },
    ],
    rule: 'Log activity at the end of each work session, while context is fresh. Future-you will thank you.',
  },
  {
    name: 'Tag',
    icon: 'tag',
    oneLine: 'A cross-cutting label that ignores project boundaries. Slice the universe sideways.',
    useWhen: [
      'You want to filter across many projects (e.g. all <code>#blocker</code> tasks, all <code>#client-x</code> work).',
      'The label is about the kind of work, not the project (#deep-work, #email, #meeting).',
      'You need to report "everything urgent" or "everything for Q3".',
    ],
    dontUseWhen: [
      'It\'s really the project name — use the project field.',
      'It\'s a one-off label nobody else will reuse — skip it.',
    ],
    examples: [
      { good: '#blocker · #deep-work · #client-acme · #urgent · #q3-okr' },
      { bad:  '#draft-welcome-email — too narrow; that\'s the task itself.' },
    ],
    rule: 'A tag is useful if you\'d ever want to filter by it later. Otherwise it\'s just decoration.',
  },
  {
    name: 'Dependency',
    icon: 'dependency',
    oneLine: 'A link saying "Task B can\'t start until Task A is done."',
    useWhen: [
      'There\'s a real ordering — B is blocked on A.',
      'You want the Gantt chart to show the link.',
      'You want auto-warnings if A slips, since B is downstream.',
    ],
    dontUseWhen: [
      'They\'re just "both should happen this week" — that\'s scheduling, not a dependency.',
      'They\'re a checklist inside one task — those are subtasks.',
    ],
    examples: [
      { good: 'Task "Launch announcement" depends on "Get legal sign-off".' },
      { bad:  'Tagging two unrelated weekly tasks as dependent because they\'re both due Friday.' },
    ],
    rule: 'Dependencies should be load-bearing. If removing it changes nothing, it doesn\'t belong.',
  },
  {
    name: 'Recurring Task',
    icon: 'recurring',
    oneLine: 'A task that respawns itself on a schedule when you mark it done.',
    useWhen: [
      'The work happens on a cadence (weekly review, monthly invoice, daily standup notes).',
      'You want history of each instance, not just "I always do this".',
    ],
    dontUseWhen: [
      'It\'s a one-off — just make a regular task.',
      'The cadence is so vague nothing useful comes from re-spawning it.',
    ],
    examples: [
      { good: 'Weekly: Friday review.  Monthly: send client invoice.  Daily: write standup update.' },
      { bad:  '"Email" as a recurring daily task — too vague to log meaningfully. Make it a tag instead.' },
    ],
    rule: 'Use recurrence when each instance is a discrete piece of work worth logging.',
  },
  {
    name: 'Template',
    icon: 'template',
    oneLine: 'A reusable blueprint for a Task or a whole Project, so you don\'t rebuild the same shape every time.',
    useWhen: [
      'You\'ve done this kind of work 3+ times.',
      'The new instance differs only in name, dates, and owner.',
    ],
    dontUseWhen: [
      'It\'s genuinely new every time — templates would slow you down.',
    ],
    examples: [
      { good: 'Project template: "New client onboarding" (with phases & standard tasks).' },
      { good: 'Task template: "Monthly invoice" (with the same subtasks every time).' },
    ],
    rule: 'Save as template the third time you copy-paste the same structure.',
  },
  {
    name: 'Goal',
    icon: 'goal',
    oneLine: 'A strategic-plan one-pager: an initiative + KPI, a change agenda (from → to), and deliverables you can link to real projects for live progress.',
    useWhen: [
      'You\'re tracking a strategic objective above the day-to-day tasks (an SP/OKR-style plan).',
      'You want one card that shows the initiative, KPI, what changes, and the deliverables.',
      'You want each deliverable to show the live % of a linked project (even across workspaces).',
    ],
    dontUseWhen: [
      'It\'s just a task or a project — Goals sit above those, summarizing outcomes.',
      'There\'s no measurable target or change being driven.',
    ],
    examples: [
      { good: '"SP3 — Enabling Data-Driven Decisions" with a KPI, change agenda, and 3 deliverables linked to projects.' },
      { bad:  '"Finish the report" as a goal — that\'s a task.' },
    ],
    rule: 'A goal frames the why and the outcome; projects and tasks are how you get there. Link deliverables to projects so progress is live, not guessed.',
  },
  {
    name: 'Minutes',
    icon: 'minutes',
    oneLine: 'A meeting record: attendees, notes, decisions, action items — plus a "Priority" panel for what the boss keeps pushing vs. pushing back on.',
    useWhen: [
      'You ran or attended a meeting and need a durable record.',
      'You want decisions and follow-up action items captured in one place (optionally tagged to a project).',
      'You want to track a boss/stakeholder\'s priorities and pushbacks for next time.',
    ],
    dontUseWhen: [
      'It\'s a personal to-do — that\'s a task, not minutes.',
    ],
    examples: [
      { good: 'Weekly sync minutes: attendees, 3 decisions, 2 action items (with owners + due dates), and "The Priority" filled in.' },
    ],
    rule: 'Capture minutes right after the meeting while it\'s fresh. Tie action items to owners so nothing is dropped. Filter Minutes by project from the top bar.',
  },
  {
    name: 'Message',
    icon: 'message',
    oneLine: 'A direct or group chat with people in your workspace — a closed, real-time conversation, separate from task comments.',
    useWhen: [
      'You need a quick back-and-forth with a teammate or a small group.',
      'The discussion isn\'t about one specific task (use task comments for that).',
    ],
    dontUseWhen: [
      'It\'s feedback on a single task — comment on the task instead so it stays with the work.',
      'It needs to be a tracked deliverable — that\'s a task.',
    ],
    examples: [
      { good: 'A "Launch team" group chat to coordinate the day-of, or a DM to ask a quick question.' },
    ],
    rule: 'Messages are for conversation; tasks and activities are the record of work. Only workspace members can see a conversation, and group members can add/remove people.',
  },
];

const SCENARIOS = [
  {
    title: 'A teammate says: "Let\'s redo our member onboarding."',
    verdict: 'Project',
    reason: 'There\'s a clear outcome (better onboarding), it has multiple tasks (interviews, copy, design, build), and you\'d want to track its progress as one thing.',
    structure: [
      'Workspace: BRIDGED',
      'Project: "Member Onboarding Revamp"',
      'Phases: Discovery · Design · Build · Launch',
      'Tasks (in Discovery): "Interview 3 churned users", "Audit current funnel"',
      'Subtasks on each: e.g. ☐ Pick users · ☐ Draft questions · ☐ Schedule',
      'Activities: logged each time someone works on a task',
    ],
  },
  {
    title: 'You need to "send the monthly invoice to Client X".',
    verdict: 'Recurring Task',
    reason: 'It\'s the same shape every time, it happens on a cadence, and you want history of each month.',
    structure: [
      'Project: "Client X — Engagement" (or your "Operations" project)',
      'Task: "Send monthly invoice — Client X", recurrence = monthly',
      'Subtasks: ☐ Pull hours · ☐ Generate PDF · ☐ Email · ☐ Log in accounting',
      'Activity: log when sent, with attachment of the PDF',
    ],
  },
  {
    title: 'You\'re onboarding a new contractor who shouldn\'t see your internal financials.',
    verdict: 'Workspace (or per-project ACL)',
    reason: 'The constraint is access. If they need broad visibility, spin up a Workspace for the engagement. If it\'s narrow, restrict at the project level inside your existing workspace.',
    structure: [
      'Option A: New workspace "Contractor — Jane" with just the shared projects.',
      'Option B: Stay in BRIDGED, restrict the financials project so the contractor isn\'t a member.',
    ],
  },
  {
    title: 'You want to track "all the blockers across all projects".',
    verdict: 'Tag (#blocker) + Saved View',
    reason: '"Blocker" is a status that cuts across projects. A tag, plus a Saved View filtered to that tag, gives you a sidebar shortcut.',
    structure: [
      'Tag tasks with #blocker as they arise.',
      'Open the Board, filter by #blocker, click "★ Save view" → name it "Blockers".',
      'It now appears in the sidebar as a one-click filter.',
    ],
  },
  {
    title: 'A teammate sends: "Quick — can you fix the typo on the homepage?"',
    verdict: 'Task (not a project)',
    reason: 'It\'s one unit of work, one person, probably under an hour. No need for a project shell.',
    structure: [
      'Project: whatever home for "Website" or "Maintenance" lives in.',
      'Task: "Fix homepage typo (hero section)" — due today.',
      'Subtask: not needed, but ☐ Push fix · ☐ Verify in prod is fine if you want a tiny checklist.',
      'Activity: 0.25h "Fixed; deployed in PR #1234".',
    ],
  },
  {
    title: 'You\'re planning Q3 with goals across multiple departments.',
    verdict: 'Project per goal + Tag for quarter',
    reason: 'Each goal is its own outcome (Project). The shared "Q3" lens is a tag (or saved view), so you can roll up across all of them.',
    structure: [
      'Project: "Q3 — Member Onboarding Revamp"',
      'Project: "Q3 — Retention Playbook"',
      'Project: "Q3 — Brand Refresh"',
      'Tag every task in those projects with #q3.',
      'Saved view "Q3 — all open" filters across projects by that tag.',
    ],
  },
  {
    title: 'You read an interesting article and think "we should explore something like this".',
    verdict: 'Task with #idea tag (in a "Backlog" project)',
    reason: 'Not a project yet — there\'s no commitment, no outcome. A task captures the seed; you can promote to a project later.',
    structure: [
      'Project: "Backlog / Ideas"',
      'Task: "Explore async-first onboarding (see Notion article)"',
      'Tag: #idea',
      'When it earns commitment, copy it into a real project as the first task — or use it as the seed for a "From template" project.',
    ],
  },
  {
    title: 'You have a recurring "Weekly Friday Review" ritual.',
    verdict: 'Recurring Task',
    reason: 'It\'s the same shape every week, you want to log what you covered each time.',
    structure: [
      'Project: "Personal — Routines" (or "Operations")',
      'Task: "Weekly review — Friday", recurrence = weekly, dayOfWeek = Fri',
      'Subtasks: ☐ Inbox zero · ☐ Update board · ☐ Plan next week',
      'Activity: log notes each Friday so you have a journal of decisions.',
    ],
  },
  {
    title: 'You need the designer to finish the mock before the engineer can start building.',
    verdict: 'Dependency between two tasks',
    reason: 'There\'s real ordering — engineer is blocked on designer.',
    structure: [
      'Task A: "Design new dashboard mock" (assignee: designer)',
      'Task B: "Build dashboard from mock" (assignee: engineer)',
      'On Task B, set dependsOn = [Task A].',
      'Gantt will draw the arrow; if A slips, B\'s start auto-slips visually.',
    ],
  },
  {
    title: 'You spent 2 hours on the proposal yesterday but forgot to log it.',
    verdict: 'Activity (back-dated)',
    reason: 'Activities are the time records. Back-date the date field to yesterday so the timesheet stays accurate.',
    structure: [
      'Open the proposal task → Log activity → set date = yesterday, hoursSpent = 2.',
      'Add a comment with what you actually did.',
    ],
  },
];

const WORKFLOWS = [
  {
    title: 'When a task comes due',
    steps: [
      'Due-task alerts are off until you ask for them: flick the alerts switch in the top bar (or Settings → Due-task alerts).',
      'Once on, the alert opens on the due date (or earlier, per Settings → Due-task alerts) on whatever view you are in. It shows one task at a time.',
      'Read the ready-made GenAI prompt. Press Edit to tweak it, Copy to paste it into any GenAI tool, or Run to get the deliverable right there.',
      'Finished? Press Done (or D) — the task closes and the next due task appears, if any.',
      'Busy? Press Snooze (or Esc) for the default interval, or open the ▾ menu for 5 min to 2 h or a custom number of minutes. It comes back at that time.',
      'Not today? Press Skip (or S) — it stays quiet until tomorrow. Open task → jumps to the full editor.',
      'Too many at once? The × in the corner closes every alert for the rest of the day. The alerts switch in the top bar shows how many are waiting, and turning it off and on again brings them straight back.',
    ],
  },
  {
    title: 'Teach the app your documents',
    steps: [
      'By default the AI answers from general knowledge. Point it at your own Google NotebookLM notebooks and it answers from your policies, specs and notes instead — with citations.',
      'One-time setup on the machine running the AI bridge: Settings → Knowledge base prints the exact commands (pipx install, then notebooklm login with a DEDICATED Google account). Press Re-check when done — no restart.',
      'Create a notebook at notebooklm.google.com and add sources to it: PDFs, Google Docs, web pages, pasted text.',
      'Pick that notebook on the workspace (Edit workspace) so every project inherits it, or on a single project (Project editor → Knowledge base) to override.',
      'Feed it as you work: ＋ Notebook on any task attachment or artifact link adds it as a source, and "Save to notebook" stores a finished AI answer as one.',
      'Ask it directly: Ask AI → "My notebook" gives a cited answer, and follow-ups continue the same conversation.',
      'Or let it work behind the scenes: leave "Ground with my notebook" on and NotebookLM finds the relevant material before Claude writes the answer. A "grounded · N sources" badge says when that happened — and "not grounded" says when it did not.',
    ],
  },
  {
    title: 'Starting a new initiative',
    steps: [
      'Decide: is this really a Project (has an outcome) or just a Task? If unsure, start as a Task — you can promote later.',
      'Create the Project. Give it a meaningful color so it\'s easy to spot on the Board.',
      'If it has clear stages, add Phases (Discovery / Build / Launch). If small, skip phases.',
      'Add the first 3–5 Tasks. Don\'t over-plan; surface the next concrete steps.',
      'Set plan.startDate and plan.endDate on tasks so they appear on the Gantt and Calendar.',
    ],
  },
  {
    title: 'Working a task end-to-end',
    steps: [
      'Pull it from "Todo" on the Board to "Doing" when you start (or click ▶ to start the timer).',
      'Add subtasks if it has 3+ small steps — gives you a progress bar.',
      'When you stop, log an Activity (the timer pre-fills hours). Capture what you did, not just hours.',
      'If blocked, set the activity\'s completionStatus = "blocked" and note the bottleneck.',
      'Move to "Done" when complete. If it\'s recurring, the next instance auto-spawns.',
    ],
  },
  {
    title: 'Weekly review (every Friday)',
    steps: [
      'Open the Dashboard. Check overdue and in-progress counts.',
      'Open the Review view. Scan hours-by-project and the bottleneck list.',
      'Open the Board with no filter. Move stale "Doing" cards back to "Todo" or onto someone else.',
      'On the Calendar, drag-reschedule anything slipping next week.',
      'Add a journal entry as an Activity on whatever "Weekly review" task you keep.',
    ],
  },
  {
    title: 'Onboarding a new teammate to a workspace',
    steps: [
      'Settings → Workspaces → invite by email. Pick the right role (admin / editor / viewer).',
      'Point them to this How-To-Use page first.',
      'Give them a starter Project (or a few tasks tagged #starter) so they can practice the flow.',
      'Within 1 week, do a 1:1 to make sure the mental model clicked.',
    ],
  },
];

const VIEWS_GUIDE = [
  { icon: 'dashboard', name: 'Dashboard', text: 'Your at-a-glance home: today\'s focus, what\'s overdue, what\'s in progress, and quick stats per project.' },
  { icon: 'projects',  name: 'Projects',  text: 'Create and manage projects + their phases. Save a project as a template, or start a New project from a saved template. Share a project via invite link, and open its WBS, Log, or AI helpers.' },
  { icon: 'board',     name: 'Kanban',    text: 'Drag tasks across Todo → Doing → Done. Filter by tag, group by phase, start a timer, or quick-add from a template. Nested under "Board" in the sidebar alongside Calendar, Gantt chart, and WBS.' },
  { icon: 'calendar',  name: 'Calendar',  text: 'Month grid by plan end date. Drag a task to reschedule, filter by status (All / To do / Ongoing / Done), and add a new task.' },
  { icon: 'gantt',     name: 'Gantt',     text: 'Timeline of plan vs. actual. Drag bars to resize/move, see dependency arrows, and filter by a date period.' },
  { icon: 'wbs',       name: 'WBS',       text: 'Work-breakdown structure: Project → Phase → Task → Subtask with duration, dates, resource, and % complete, plus a Gantt-style timeline. Click any row for its activity log; filter by status or date.' },
  { icon: 'goals',     name: 'Goals',     text: 'Strategic-plan one-pagers — initiative, KPI, change agenda, and deliverables linked to projects for live progress. Pick your own banner + card colors.' },
  { icon: 'messages',  name: 'Messages',  text: 'Direct and group chat with workspace members — real-time, closed to the workspace. Add or remove people from a group.' },
  { icon: 'minutes',   name: 'Minutes',   text: 'Meeting minutes — attendees, notes, decisions, action items, and a boss-focused "Priority" panel. Filter by project from the top bar.' },
  { icon: 'list',      name: 'Activity Log', text: 'A flat, sortable table of every logged activity, with bulk actions and CSV export.' },
  { icon: 'clock',     name: 'Work Performed', text: 'Swimlane of activities by project over time — see who did what, when, and for how long.' },
  { icon: 'review',    name: 'Review',    text: 'KPIs, hours-by-project, the daily-hours strip, and overdue / completed / bottleneck lists.' },
  { icon: 'analytics', name: 'Analytics', text: 'Charts and trends — including the "Work performed" hero bar chart (hours per day, stacked by project, with totals) over 7 / 15 / 30 days.' },
  { icon: 'settings',  name: 'Settings',  text: 'Per-device prefs (theme, default project, week start), workspaces + members, account, notifications, and data export. Admins also approve users here.' },
];

const PRINCIPLES = [
  {
    title: 'Capture before you organize',
    body: 'Get the task in the system fast (even if rough). You can sharpen the title, set the project, and add subtasks later. Friction kills capture.',
  },
  {
    title: 'A good task name is a verb + a noun + a "done" criteria',
    body: 'Not: "marketing". Yes: "Draft Q3 launch email — first version ready for review".',
  },
  {
    title: 'Promote, don\'t hoard',
    body: 'If a task is sprawling, promote it to a project. If a project never finishes, demote it to a recurring task or a tag. Containers should fit the work.',
  },
  {
    title: 'Phases are stages, statuses are states',
    body: 'Phase = "what kind of work is this?" (Build vs Launch). Status = "where is this work right now?" (Todo vs Doing vs Done).',
  },
  {
    title: 'Subtasks for momentum, tasks for accountability',
    body: 'If a step needs an owner or a deadline, it deserves to be a task. Otherwise the checkbox is enough.',
  },
  {
    title: 'Log activities while context is fresh',
    body: 'A 30-second log at the end of a work block is worth more than a 5-minute reconstruction next week. Future-you forgets the bottlenecks.',
  },
  {
    title: 'Tags should be reusable',
    body: 'Before you create a new tag, ask: would I ever filter the whole org by this? If not, it\'s noise. Keep the tag vocabulary small.',
  },
  {
    title: 'Dependencies are load-bearing',
    body: 'Add a dependency only when removing it would change something (Gantt ordering, blocked notifications). Don\'t use dependencies as "related to".',
  },
  {
    title: 'One workspace per organization, by default',
    body: 'Workspaces are for access boundaries, not categorization. Most teams should have 1–2 workspaces, never one per project.',
  },
  {
    title: 'If you copy-paste structure 3 times, save it as a template',
    body: 'Saves time, enforces consistency, and surfaces the "right way" for newcomers.',
  },
];

const ANTIPATTERNS = [
  {
    bad: 'A project called "Stuff to do".',
    why: 'No outcome, no end. It becomes a graveyard. Tasks go in but nothing ever ships.',
    instead: 'Either kill the project and let those tasks live in their real homes, or split into actual outcomes ("Personal — Health", "Personal — Finances").',
  },
  {
    bad: 'Every department gets its own Workspace.',
    why: 'Now nobody can see the whole company. Cross-team work becomes impossible. You\'ve recreated departmental silos in software.',
    instead: 'One workspace per organization. Use Projects for departments / streams.',
  },
  {
    bad: 'Tasks with 20+ subtasks.',
    why: 'You\'ve hidden a project inside a task. No real ownership on the sub-steps, no dates, no visibility.',
    instead: 'Promote it to a project; the subtasks become tasks.',
  },
  {
    bad: 'A task per email or per Slack message.',
    why: 'Capture overload. Most of those don\'t deserve to live in the task system.',
    instead: 'Only capture tasks for things that need >15 minutes of focused work or a delivery you owe someone.',
  },
  {
    bad: 'Logging "I worked on stuff today" with no detail.',
    why: 'Activities are your forensic trail. "Stuff" is forensically useless.',
    instead: 'A sentence about what you did and what shifted. 10 seconds of writing pays for itself.',
  },
  {
    bad: 'Tagging every task with the project name.',
    why: 'Redundant — the task already has a project. Tags should add information, not repeat it.',
    instead: 'Use tags for cross-cutting signals only (#blocker, #q3, #client-x where Client X spans projects).',
  },
  {
    bad: 'Letting "Doing" pile up with 15+ tasks.',
    why: 'You\'re not actually doing 15 things in parallel. "Doing" loses its meaning.',
    instead: 'Be honest. Move stale Doing back to Todo. Aim for ≤3 in Doing per person.',
  },
  {
    bad: 'Treating the Activity Log as a to-do list.',
    why: 'Activities are about what already happened, not what needs to happen.',
    instead: 'Tasks for what needs to happen. Activities for the time you spent doing it.',
  },
];

const GLOSSARY = [
  ['Workspace',  'The top-level container. A boundary for who can see what. Like a Slack workspace or a Google Drive shared drive.'],
  ['Project',    'A real-world initiative with an outcome. Lives inside a Workspace. Has color, phases, and contains tasks.'],
  ['Phase',      'A stage a Project moves through. Optional. Used for board swim-lanes within a single project.'],
  ['Task',       'A unit of work with a status (todo / doing / done), optionally a due date, an owner, and progress. The atom of the system.'],
  ['Subtask',    'A checklist item inside a Task. No date, no owner, just a checkbox.'],
  ['Activity',   'A time-stamped record of work performed against a task. Has hours, a comment, optional attachments and bottleneck notes.'],
  ['Tag',        'A cross-cutting label. Slices the system independently of projects.'],
  ['Dependency', 'A "blocks / blocked by" relationship between two tasks.'],
  ['Recurrence', 'A schedule on a task. When you mark it done, the next instance auto-spawns.'],
  ['Template',   'A reusable blueprint for a Task or Project.'],
  ['Saved view', 'A filter combo (project + tag + status) pinned to the sidebar for one-click recall.'],
  ['Bottleneck', 'A flag on an Activity indicating what blocked progress. Surfaces on the Review page.'],
  ['Plan dates', 'The intended start and end dates for a task. Used by Gantt and Calendar.'],
  ['Actual dates', 'The real start and end dates a task actually ran. Used for variance analysis.'],
];
