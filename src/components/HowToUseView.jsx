// src/components/HowToUseView.jsx — guided walkthrough of the mental model:
// what Workspaces, Projects, Phases, Tasks, Subtasks, Activities mean, when
// to use each, plus concrete real-world scenarios with the right call.

import { useState } from 'react';
import NavIcon from './Icon';

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

const SECTIONS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'views',       label: 'The Views (what each page does)' },
  { id: 'hierarchy',   label: 'The Hierarchy' },
  { id: 'concepts',    label: 'Concepts (when to use what)' },
  { id: 'decision',    label: 'Decision Guide' },
  { id: 'scenarios',   label: 'Real-World Scenarios' },
  { id: 'workflows',   label: 'Workflows' },
  { id: 'principles',  label: 'Principles & Best Practices' },
  { id: 'antipatterns',label: 'Anti-Patterns to Avoid' },
  { id: 'glossary',    label: 'Glossary' },
];

export default function HowToUseView() {
  const [activeId, setActiveId] = useState('overview');

  const scrollTo = (id) => {
    setActiveId(id);
    const el = document.getElementById(`htu-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">How to Use Task Monitor</h1>
          <p className="page-subtitle">
            The mental model — when something is a Workspace vs. Project vs. Task vs. Subtask vs. Activity,
            with real examples and decision rules.
          </p>
        </div>
      </div>

      <div className="htu-layout">
        <aside className="htu-toc">
          <div className="htu-toc-label">On this page</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`htu-toc-link ${activeId === s.id ? 'active' : ''}`}
              onClick={() => scrollTo(s.id)}
            >
              {s.label}
            </button>
          ))}
        </aside>

        <div className="htu-content">
          <Overview />
          <Views />
          <Hierarchy />
          <Concepts />
          <Decision />
          <Scenarios />
          <Workflows />
          <Principles />
          <AntiPatterns />
          <Glossary />
        </div>
      </div>
    </>
  );
}

// ─── Overview ────────────────────────────────────────────────

function Overview() {
  return (
    <section id="htu-overview" className="review-section htu-section">
      <h2 className="review-h2">Why this guide exists</h2>
      <p className="htu-lede">
        Task Monitor gives you a lot of containers — Workspaces, Projects, Phases, Tasks, Subtasks, Activities,
        Tags, Templates, Dependencies. The power isn't the containers themselves; it's <strong>using each one
        for what it was built for</strong>. This page is the playbook: read it once, refer back when in doubt.
      </p>

      <div className="htu-callout htu-callout-info">
        <div className="htu-callout-title">The one-sentence summary</div>
        <p className="htu-callout-body">
          <strong>Workspaces</strong> separate who can see what. <strong>Projects</strong> are real-world
          initiatives with an outcome. <strong>Phases</strong> are stages a project moves through.
          <strong> Tasks</strong> are the units of work that get done. <strong>Subtasks</strong> are a
          checklist inside a task. <strong>Activities</strong> are time-stamped records of work performed.
        </p>
      </div>

      <div className="htu-callout htu-callout-tip">
        <div className="htu-callout-title">Pro tip — the "shape" test</div>
        <p className="htu-callout-body">
          Ask: <em>"What shape is this thing?"</em>
        </p>
        <ul className="htu-list">
          <li><strong>A boundary</strong> (who's in, who's out) → Workspace</li>
          <li><strong>An outcome</strong> (a thing being delivered) → Project</li>
          <li><strong>A stage</strong> (a milestone within an outcome) → Phase</li>
          <li><strong>A unit of work</strong> (someone does it, then it's done) → Task</li>
          <li><strong>A step inside a unit</strong> (a checkbox) → Subtask</li>
          <li><strong>A record of time spent</strong> (yesterday I…) → Activity</li>
        </ul>
      </div>
    </section>
  );
}

// ─── The Views ───────────────────────────────────────────────

const VIEWS_GUIDE = [
  { icon: 'dashboard', name: 'Dashboard', text: 'Your at-a-glance home: today\'s focus, what\'s overdue, what\'s in progress, and quick stats per project.' },
  { icon: 'projects',  name: 'Projects',  text: 'Create and manage projects + their phases. Save a project as a template, or start a New project from a saved template. Share a project via invite link, and open its WBS, Log, or AI helpers.' },
  { icon: 'board',     name: 'Board',     text: 'Kanban — drag tasks across Todo → Doing → Done. Filter by tag, group by phase, start a timer, or quick-add from a template.' },
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

function Views() {
  return (
    <section id="htu-views" className="review-section htu-section">
      <h2 className="review-h2">The Views — what each page in the sidebar does</h2>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 16 }}>
        The same projects, tasks and activities, seen through different lenses. Two cross-cutting helpers live in the top bar:
        the <strong>project picker</strong> (scopes most views to one project, or <em>All projects</em>) and the
        <strong> ✨ AI button</strong> ("Stuck? Don't know what to do next?" — it suggests your top 3 next actions and can draft a prompt for each).
      </p>
      <div className="htu-views-grid">
        {VIEWS_GUIDE.map((v) => (
          <div key={v.name} className="htu-view-card">
            <span className="htu-view-icon"><NavIcon name={v.icon} size={18} /></span>
            <div>
              <div className="htu-view-name">{v.name}</div>
              <div className="htu-view-text">{v.text}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Hierarchy ───────────────────────────────────────────────

function Hierarchy() {
  return (
    <section id="htu-hierarchy" className="review-section htu-section">
      <h2 className="review-h2">The Hierarchy at a glance</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Each level contains the next. Things only flow downward — a Subtask never contains a Project.
      </p>

      <div className="htu-hierarchy">
        <HierarchyRow
          level={1}
          name="Workspace"
          color="#7c3aed"
          tagline="Who can see this? (the boundary)"
          example="BRIDGED · AIM · Personal"
        />
        <HierarchyArrow />
        <HierarchyRow
          level={2}
          name="Project"
          color="#0ea5e9"
          tagline="What outcome are we delivering?"
          example="Q3 Member Onboarding Revamp"
        />
        <HierarchyArrow />
        <HierarchyRow
          level={3}
          name="Phase"
          color="#10b981"
          tagline="What stage of the project?"
          example="Discovery · Build · Launch · Wrap-up"
        />
        <HierarchyArrow />
        <HierarchyRow
          level={4}
          name="Task"
          color="#f59e0b"
          tagline="What unit of work needs to happen?"
          example="Draft welcome-email copy"
        />
        <HierarchyArrow />
        <HierarchyRow
          level={5}
          name="Subtask"
          color="#fb923c"
          tagline="What checkbox is inside this task?"
          example="☐ Write subject line · ☐ Write body · ☐ Get review"
        />
        <HierarchyArrow />
        <HierarchyRow
          level={6}
          name="Activity"
          color="#ef4444"
          tagline="What time did I actually spend, and on what?"
          example="May 27 · 1.5h · Drafted v1 of welcome email"
        />
      </div>

      <div className="htu-callout htu-callout-info" style={{ marginTop: 18 }}>
        <div className="htu-callout-title">Cross-cutting helpers (live next to the hierarchy)</div>
        <ul className="htu-list">
          <li><strong>Tags</strong> — labels that cut across projects (e.g. <code>#blocker</code>, <code>#deep-work</code>, <code>#client-x</code>).</li>
          <li><strong>Dependencies</strong> — a task that can't start until another is done.</li>
          <li><strong>Recurring tasks</strong> — a task that respawns itself on a schedule.</li>
          <li><strong>Templates</strong> — reusable task or project blueprints for repeated work.</li>
          <li><strong>Saved views</strong> — a filter combo pinned to the sidebar.</li>
        </ul>
      </div>
    </section>
  );
}

function HierarchyRow({ level, name, color, tagline, example }) {
  return (
    <div className="htu-hier-row" style={{ marginLeft: (level - 1) * 14 }}>
      <div className="htu-hier-dot" style={{ background: color }}>{level}</div>
      <div className="htu-hier-text">
        <div className="htu-hier-name">{name}</div>
        <div className="htu-hier-tagline">{tagline}</div>
        <div className="htu-hier-example"><span className="muted small">Example:</span> {example}</div>
      </div>
    </div>
  );
}

function HierarchyArrow() {
  return <div className="htu-hier-arrow" aria-hidden="true">↓</div>;
}

// ─── Concepts ────────────────────────────────────────────────

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

function Concepts() {
  return (
    <section id="htu-concepts" className="review-section htu-section">
      <h2 className="review-h2">The Concepts — when to use each one</h2>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 16 }}>
        Each card answers: <em>what is this thing, when do I reach for it, when do I not, and what does "right" look like</em>.
      </p>

      <div className="htu-concept-grid">
        {CONCEPTS.map((c) => (
          <ConceptCard key={c.name} concept={c} />
        ))}
      </div>
    </section>
  );
}

function ConceptCard({ concept }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`htu-concept-card ${open ? 'open' : ''}`}>
      <button className="htu-concept-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="htu-concept-icon"><Icon name={concept.icon} size={17} /></span>
        <span className="htu-concept-name">{concept.name}</span>
        <span className="htu-concept-toggle">{open ? '▾' : '▸'}</span>
      </button>
      <div className="htu-concept-oneline">{concept.oneLine}</div>

      {open && (
        <div className="htu-concept-body">
          <div className="htu-twocol">
            <div className="htu-twocol-pane htu-pane-do">
              <div className="htu-pane-label htu-pane-label-do"><Icon name="check" size={13} /> Use it when…</div>
              <ul className="htu-list">
                {concept.useWhen.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </div>
            <div className="htu-twocol-pane htu-pane-dont">
              <div className="htu-pane-label htu-pane-label-dont"><Icon name="ban" size={13} /> Don't use it when…</div>
              <ul className="htu-list">
                {concept.dontUseWhen.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </div>
          </div>

          <div className="htu-examples">
            <div className="htu-pane-label">Examples</div>
            {concept.examples.map((ex, i) => (
              <div key={i} className={`htu-example ${ex.good ? 'good' : 'bad'}`}>
                <span className="htu-example-mark">{ex.good ? '✓' : '✗'}</span>
                <span dangerouslySetInnerHTML={{ __html: ex.good || ex.bad }} />
              </div>
            ))}
          </div>

          <div className="htu-rule">
            <strong>Rule of thumb:</strong> {concept.rule}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Decision Guide ──────────────────────────────────────────

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

function Decision() {
  return (
    <section id="htu-decision" className="review-section htu-section">
      <h2 className="review-h2">Decision Guide — what kind of thing is this?</h2>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 16 }}>
        Walk down this list top-to-bottom. Stop at the first <strong>Yes</strong>.
      </p>

      <div className="htu-decision">
        {DECISION_TREE.map((step, i) => (
          <div key={i} className="htu-decision-step">
            <div className="htu-decision-num">{i + 1}</div>
            <div className="htu-decision-body">
              <div className="htu-decision-q">{step.q}</div>
              <div className="htu-decision-answers">
                <div className="htu-decision-yes">
                  <strong>Yes →</strong> {step.yes}
                </div>
                {step.no && (
                  <div className="htu-decision-no">
                    <strong>No →</strong> {step.no}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Real-World Scenarios ────────────────────────────────────

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

function Scenarios() {
  return (
    <section id="htu-scenarios" className="review-section htu-section">
      <h2 className="review-h2">Real-World Scenarios — "what should this be?"</h2>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 16 }}>
        Concrete situations you'll actually hit, with the call and the structure I'd set up.
      </p>

      <div className="htu-scenarios">
        {SCENARIOS.map((s, i) => (
          <div key={i} className="htu-scenario">
            <div className="htu-scenario-head">
              <div className="htu-scenario-title">"{s.title}"</div>
              <span className="htu-scenario-verdict">→ {s.verdict}</span>
            </div>
            <div className="htu-scenario-reason"><strong>Why:</strong> {s.reason}</div>
            <div className="htu-scenario-structure-label">How I'd set it up:</div>
            <ul className="htu-list">
              {s.structure.map((line, j) => <li key={j}>{line}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Workflows ───────────────────────────────────────────────

const WORKFLOWS = [
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

function Workflows() {
  return (
    <section id="htu-workflows" className="review-section htu-section">
      <h2 className="review-h2">Workflows — the rhythms that make it work</h2>
      <div className="htu-workflows">
        {WORKFLOWS.map((w, i) => (
          <div key={i} className="htu-workflow">
            <h3 className="htu-workflow-title">{w.title}</h3>
            <ol className="htu-ol">
              {w.steps.map((s, j) => <li key={j}>{s}</li>)}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Principles ──────────────────────────────────────────────

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

function Principles() {
  return (
    <section id="htu-principles" className="review-section htu-section">
      <h2 className="review-h2">Principles & Best Practices</h2>
      <div className="htu-principle-grid">
        {PRINCIPLES.map((p, i) => (
          <div key={i} className="htu-principle">
            <div className="htu-principle-title">{p.title}</div>
            <div className="htu-principle-body">{p.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Anti-patterns ───────────────────────────────────────────

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

function AntiPatterns() {
  return (
    <section id="htu-antipatterns" className="review-section htu-section">
      <h2 className="review-h2">Anti-patterns — what to avoid</h2>
      <div className="htu-antipattern-list">
        {ANTIPATTERNS.map((a, i) => (
          <div key={i} className="htu-antipattern">
            <div className="htu-antipattern-bad"><Icon name="xCircle" size={15} className="htu-ap-icon htu-ap-icon-bad" /> <strong>{a.bad}</strong></div>
            <div className="htu-antipattern-why"><strong>Why it bites:</strong> {a.why}</div>
            <div className="htu-antipattern-instead"><Icon name="checkCircle" size={15} className="htu-ap-icon htu-ap-icon-good" /> <strong>Instead:</strong> {a.instead}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Glossary ────────────────────────────────────────────────

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

function Glossary() {
  return (
    <section id="htu-glossary" className="review-section htu-section">
      <h2 className="review-h2">Glossary</h2>
      <table className="htu-glossary">
        <tbody>
          {GLOSSARY.map(([term, def]) => (
            <tr key={term}>
              <td className="htu-glossary-term">{term}</td>
              <td className="htu-glossary-def">{def}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
