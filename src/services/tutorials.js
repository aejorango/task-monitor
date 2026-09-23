// src/services/tutorials.js — the tours, as data.
//
// Lifted out of TutorialGuide.jsx (T-0158). It is a list of lessons and their
// steps with no JSX in it, and three things now read it: the overlay that runs
// a tour, the Tutorial page that lists them, and the How-to-use page that
// offers one. A component file that also exports the data is the case
// `react-refresh/only-export-components` is about, and it is the same rule
// CLAUDE.md states in its own words — logic goes in a service, components
// render what it returns.
//
// `selector` is a live CSS selector against the running app. When a page is
// restyled, the selectors pointing into it have to move too: T-0148 renamed
// the board's card classes and three steps of "Create a task" would have
// highlighted nothing. `tests/ui/tutorialPage.test.mjs` checks every selector
// still appears somewhere in src/.

export const TUTORIALS = [
  {
    id: 'create-project',
    icon: 'projects',
    title: 'Create a project',
    blurb: 'Set up a project with phases to organize work.',
    steps: [
      {
        view: 'projects',
        selector: '.chrome-bar',
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
        selector: '.chrome-bar',
        title: 'You’re set',
        body: 'Once saved, the project shows up here and becomes selectable from the project picker in the topbar, on the Board, and in the Gantt chart.',
      },
    ],
  },
  {
    id: 'create-task',
    icon: 'check',
    title: 'Create a task',
    blurb: 'Add a task from the Board’s quick-add bar.',
    steps: [
      {
        view: 'board',
        // The board keeps no quick-add strip open (T-0148) and the toolbar's
        // "+ New item" was removed on request (T-0161), so ⌘K is the way in.
        // The palette renders nothing while closed, so there is no element to
        // point at — the step aims at the columns and says which keys to press.
        selector: '[data-tutorial="board-columns"]',
        title: 'Add an item',
        body: 'Press **⌘K** (Ctrl+K on Windows) and choose **New task** to open the quick-add. You can use shortcuts right in the title — try `next Friday`, `!urgent`, `#tag`, or `@name` — Task Monitor parses them automatically.',
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
    icon: 'board',
    title: 'Use the Kanban board',
    blurb: 'Drag tasks across columns, filter by project or tag.',
    steps: [
      {
        view: 'board',
        selector: '[data-tutorial="board-columns"]',
        title: 'Four columns',
        body: 'Tasks flow To Do → In Progress → In Review → Done. The headers sit at the top; the cards below are grouped into bands you can fold open — one per project, or one per phase when the board is filtered to a single project. Drag a card between columns to update its status.',
      },
      {
        view: 'board',
        selector: '[data-tutorial="project-picker"]',
        title: 'Filter by project',
        body: 'Use the project picker in the topbar to narrow the whole app — Board, Gantt, Calendar, Table — to a single project.',
      },
      {
        view: 'board',
        selector: '.bx-kc',
        title: 'Card actions',
        body: 'Each card has quick actions: **▶** starts a live timer, **+ Log** records an activity entry, and **Edit** opens the full editor with subtasks, dependencies, and recurrence.',
      },
    ],
  },
  {
    id: 'track-time',
    icon: 'clock',
    title: 'Log time & activity',
    blurb: 'Track hours and leave a progress note on a task.',
    steps: [
      {
        view: 'board',
        selector: '.bx-kc',
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
        selector: '.bx-kc',
        title: 'Or log without a timer',
        body: 'Prefer to log after the fact? Click **+ Log** on any card to record hours, a comment, and completion status directly.',
      },
    ],
  },
  {
    id: 'gantt-chart',
    icon: 'gantt',
    title: 'Explore the Gantt chart',
    blurb: 'See planned timelines and drag to reschedule.',
    steps: [
      {
        view: 'gantt',
        selector: '.chrome-bar',
        title: 'Gantt timeline',
        body: 'Every task with plan dates shows up here as a bar, grouped by project and sorted by earliest start.',
      },
      {
        view: 'gantt',
        selector: '.gc-bar',
        title: 'Drag to reschedule',
        body: 'Drag the middle of a bar to move it, or drag either edge to resize — both update the task’s plan dates immediately. Lines between bars show dependencies.',
      },
    ],
  },
  {
    id: 'workspaces',
    icon: 'workspace',
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

/** Ask the app-wide tour to start. The Tutorial page fires this. */
export const START_TUTORIAL_EVENT = 'task-monitor:start-tutorial';

export function startTutorial(id) {
  window.dispatchEvent(new CustomEvent(START_TUTORIAL_EVENT, { detail: { id } }));
}
