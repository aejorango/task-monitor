# Task Monitor — Architecture and tech stack (v0.1)

_The parts of the app, what talks to what, and what each piece is built with_

**Date:** 2026-09-21 · **Release:** v0.1 · **How this was worked out:** read from your own code by claude-cli

## 1. The shape of the app

| Part | What it is | What it does | Where it lives |
| --- | --- | --- | --- |
| Web app (React 19 + Vite) | What people open | Everything a person sees and clicks — the kanban board, Gantt chart, calendar, activity log, and the Ask AI screen — all running in the browser as a single static site with no page reloads. | src/ · index.html · public/ · vite.config.js |
| Cloud Firestore (shared data) | Where data is kept | The live database every browser reads and writes directly: workspaces, projects, tasks, daily activity entries, goals, meeting minutes, messages, invites and automation rules. | src/services/firebase.js · firestore.rules · firestore.indexes.json |
| Firebase Storage (file attachments) | Where data is kept | Where uploaded images and documents attached to tasks and activity entries are physically kept. | storage.rules · src/services/uploadPaths.js · src/services/firebase.js |
| Firebase Authentication (Google sign-in) | Something outside the app | Handles signing in with a Google account; there are no passwords and no anonymous visitors, and a new account waits for an owner to approve it. | src/services/firebase.js · src/components/LandingView.jsx · src/components/PendingApprovalView.jsx |
| Local AI bridge (plain Node, no libraries) | The service behind it | A tiny helper program the owner runs on their own laptop; it is the only thing allowed to start the Claude command-line tool, and it answers only on the machine's own address. | bridge/server.mjs · bridge/ai.mjs · bridge/notebooklm.mjs · scripts/start.mjs |
| AI proxy (Firebase Cloud Function) | The service behind it | A small hosted function that holds the company's Anthropic key, checks who is asking, forwards the question, and writes a usage record the admin can see. | functions/index.js · functions/src/authorize.js · src/services/aiProxyClient.js |
| Background rules and webhook sender (Cloud Functions) | Work that runs on its own | Watches task and activity changes in the database and reacts on its own: applies the workspace's automation rules and posts signed webhook messages to outside systems. | functions/webhooks.js · functions/automations.js · functions/src/webhookEvents.js · functions/src/automations.js |
| Anthropic Claude API | Something outside the app | The paid, per-use AI service, called either by the hosted proxy or, for a superadmin with a personal key, straight from the browser. | functions/index.js · src/services/ai.js |
| Claude Code command-line tool (on the owner's machine) | Something outside the app | The default AI brain: the owner's own Claude subscription, started as a locked-down one-shot process with no plugins, tools or project files loaded. | bridge/ai.mjs |
| NotebookLM command-line tool (optional) | Something outside the app | An optional knowledge base of the owner's own documents that AI answers can be grounded in; if it is missing or signed out, the app says so instead of failing. | bridge/notebooklm.mjs |
| Customer webhook endpoints | Something outside the app | Whatever outside addresses an admin configures in Settings, which receive a signed message whenever a task or activity changes. | functions/webhooks.js · functions/src/webhookEvents.js |

### What talks to what

- **Web app (React 19 + Vite)** → **Firebase Authentication (Google sign-in)**: signs the person in with Google and asks who they are
- **Web app (React 19 + Vite)** → **Cloud Firestore (shared data)**: reads and writes projects, tasks, hours and comments, and listens for live updates from other people
- **Web app (React 19 + Vite)** → **Firebase Storage (file attachments)**: uploads attachments and fetches their download links
- **Web app (React 19 + Vite)** → **Local AI bridge (plain Node, no libraries)**: asks the local helper on 127.0.0.1 whether an AI brain is available, then sends it questions
- **Web app (React 19 + Vite)** → **AI proxy (Firebase Cloud Function)**: sends only the prompt — never a key — and gets the answer back
- **Web app (React 19 + Vite)** → **Anthropic Claude API**: direct call with a personal key, superadmin only
- **Local AI bridge (plain Node, no libraries)** → **Claude Code command-line tool (on the owner's machine)**: starts the Claude tool once per question and reads its reply
- **Local AI bridge (plain Node, no libraries)** → **NotebookLM command-line tool (optional)**: lists notebooks, adds sources, and asks document-grounded questions
- **Local AI bridge (plain Node, no libraries)** → **Anthropic Claude API**: falls back to the paid service when the owner has set a key instead of the CLI
- **AI proxy (Firebase Cloud Function)** → **Cloud Firestore (shared data)**: looks up the caller, the company's permission and its stored key, then logs what was spent
- **AI proxy (Firebase Cloud Function)** → **Anthropic Claude API**: forwards the question using the company's key
- **Cloud Firestore (shared data)** → **Background rules and webhook sender (Cloud Functions)**: notifies the background functions whenever a task or activity document changes
- **Background rules and webhook sender (Cloud Functions)** → **Cloud Firestore (shared data)**: applies rule changes to tasks and records what it did and why
- **Background rules and webhook sender (Cloud Functions)** → **Customer webhook endpoints**: posts a signed description of the change

## 2. What it is built with

| Area | What | Version | Why it is here |
| --- | --- | --- | --- |
| Language | JavaScript (modern modules) | — | The whole project — browser, local helper and cloud functions — is one language, no compilation step beyond the bundler. |
| Web app | React | ^19.2.6 | Builds every screen; heavier views are loaded only when first opened. |
| Web app | React DOM | ^19.2.6 | Paints React's screens into the browser page. |
| Web app | @dnd-kit/core | ^6.3.1 | Makes kanban cards and calendar items draggable. |
| Web app | @dnd-kit/sortable | ^10.0.0 | Keeps dragged cards in a sensible order within a column. |
| Database | Firebase (Firestore, Auth, Storage, Functions client) | ^12.13.0 | The single backend the browser talks to for data, sign-in, files and the AI proxy. |
| API | firebase-functions | ^6.0.0 | Defines the hosted AI proxy and the change-watching background jobs. |
| API | firebase-admin | ^13.0.0 | Lets those functions read and write the database with full trust. |
| Other | jsPDF | ^4.2.1 | Turns reports into PDF files in the browser. |
| Other | jspdf-autotable | ^5.0.8 | Lays out tables inside those PDFs. |
| Other | ExcelJS | ^4.4.0 | Exports timesheets and task lists as spreadsheets. |
| Other | docx | ^9.7.1 | Exports minutes and reports as Word documents. |
| Build | Vite | ^8.0.12 | Runs the app while developing and packages the static site for release. |
| Build | @vitejs/plugin-react | ^6.0.1 | Teaches the bundler to read React screens and refresh them instantly while editing. |
| Tests | Node's built-in test runner | — | No test framework was installed; the runner that ships with Node runs everything. |
| Tests | jsdom | ^30.1.0 | Fakes a browser so screens can be tested without opening one. |
| Tests | @firebase/rules-unit-testing | ^5.0.2 | Proves the database's permission rules actually block what they should. |
| Other | ESLint | ^10.3.0 | Checks code style and common mistakes. |
| Styling | Hand-written CSS | — | One stylesheet with light and dark themes; no styling framework. |
| Other | gh-pages | ^6.3.0 | An alternative way to publish the built site to GitHub Pages. |

## 3. Where to start it

| Command or file | What it does |
| --- | --- |
| npm start | Starts both halves at once — the web app and the local AI helper — and shuts both down together; add --no-ai to skip the helper. |
| npm run dev | Runs just the web app for development. |
| npm run bridge | Runs just the local AI helper; it prints an admin code needed to change its settings from the app. |
| src/main.jsx | The first file the browser runs: it checks the Firebase settings, shows a setup screen if they are missing, otherwise clears stale cached data and starts the app. |
| src/App.jsx | Decides which screen you get — share link, invite, sign-in, 'waiting for approval', or the full app. |
| bridge/server.mjs | The local helper's own starting point; listens on 127.0.0.1 port 4319 for a fixed list of approved websites. |
| functions/index.js | The starting point for everything hosted: the AI proxy plus the webhook and automation watchers. |
| npm run build | Packages the site into a 'dist' folder ready to publish. |
| npm run deploy / deploy:all | Publishes the site, the database rules, the indexes and the functions to Firebase. |

## 4. What the service offers

| Route group | What it is for |
| --- | --- |
| bridge: /health and /ai/recheck | Tells the app whether an AI brain is reachable right now and what it is. |
| bridge: /ai/settings | Reads and changes which brain and model the local helper uses; changing anything requires the admin code. |
| bridge: /ai/complete and /ai/json | The two ways to ask a question — free text, or a strictly structured answer. |
| bridge: /ai/usage | How much has been asked and, on a paid key, roughly what it cost. |
| bridge: /knowledge/* | The optional document knowledge base: check setup, list notebooks and sources, add a source, ask a grounded question, rate the answer. |
| cloud function: aiProxy | The one hosted endpoint the browser calls for AI when there is no local helper. |
| cloud triggers: onTaskWritten / onActivityWritten / onTaskAutomations | Not called by anyone — they fire by themselves whenever the matching data changes. |

## 5. The screens

| Screen | Where |
| --- | --- |
| Ask AI | #/ask-ai |
| Dashboard | #/dashboard |
| Projects | #/projects |
| Kanban board | #/board/<project> |
| Calendar | #/calendar |
| Gantt chart | #/gantt |
| Work breakdown (WBS) | #/wbs |
| Workload | #/workload |
| Goals | #/goals |
| Messages | #/messages |
| Minutes | #/minutes |
| Task table | #/tasks-table |
| Activity Log | #/table |
| Work Performed | #/work-performed |
| Timesheet | #/timesheet |
| Review | #/review |
| Artifacts | #/artifacts |
| Analytics | #/analytics |
| Trash | #/trash |
| How to Use | #/how-to-use |
| Settings | #/settings |
| Accept an invite | #/invite/<invite id> |
| Public shared page (no sign-in) | #/shared/<token> |
| Sign in | shown when signed out |
| Waiting for approval | shown until an owner approves the account |

## 6. Where the data is

| Kept in | What is kept there |
| --- | --- |
| workspaces, projects, tasks, activities | The core of the app: who shares what, the projects, the task cards, and the per-day log entries with hours. |
| goals, minutes, templates, categories | Goals being tracked, meeting minutes, reusable project templates and the label lists. |
| conversations, messages, taskComments, notifications | In-app chat threads, comments on individual tasks, and the alerts people get. |
| users, companies, companies/{id}/secrets | Each person's profile, approval status and role; each company's settings, with its AI key locked in a sub-document only the proxy and a superadmin may read. |
| invites, presence, savedViews, sharedViews | Pending invitations, who is online, saved filter views, and world-readable snapshots behind public share links. |
| webhooks, webhookDeliveries, automations, automationRuns | The configured integrations and rules, plus a 30-day record of every delivery and every rule that fired. |
| aiUsage | One row per AI call, written by the server so nobody can under-report what they spent. |
| Firebase Storage | The actual attachment files, compressed before upload. |
| Browser local storage | Per-device preferences only — theme, AI settings, bridge address and admin code — deliberately never written onto shared task documents. |
| ~/.task-monitor on the owner's machine | The local helper's own configuration file and its admin code. |

## 7. Tests

Run them with `npm test  (and `npm run test:all`, which additionally runs the database-permission tests against the Firebase emulator)`.

## 8. Worth knowing

- There is no traditional server: the browser talks to Firestore directly, and the database's permission rules are the real security boundary — the app only shows the full interface to a user whose profile says 'approved', exactly matching what the rules allow.
- The 'no server' constraint has one deliberate exception, explained in the code itself: a small set of Firebase Cloud Functions exists because a browser cannot safely hold a company's AI key, cannot watch the database for changes, and cannot send webhooks. These need Firebase's paid plan.
- There are three possible AI brains and the app picks in order: the owner's local Claude tool (free, via the local helper), the hosted proxy on the company's key, or canned placeholder text. Placeholder answers are switched off outside development so a real user gets an honest 'not available' instead.
- Any answer that fell back or was degraded travels with a reason attached, so the screen can never present it as a clean result.
- Deletion is always soft: records are marked hidden rather than removed, and the code comments say so at every point where a delete is proposed.
- The site is published to Firebase Hosting at tasks.blueinnovation.ph, with the built files cached forever and the entry page never cached; a second recipe can publish the same build to GitHub Pages.
- A small service worker exists purely so due-task reminders can appear when the tab is closed.
- Worth flagging: the brief calls this release v0.1, but package.json says version 0.2.0, and that number is baked into the built app's About screen.
