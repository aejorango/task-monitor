# Task Monitor — Project Context

A personal **project-management suite** for Ace. Originally a task monitor; now
extended with projects + phases, drag-and-drop kanban, table view, Gantt chart,
and a professional Linear-inspired theme.

Deployed via Firebase Hosting with a Firebase Firestore backend.

---

## Architecture

- **Frontend:** React 19 + Vite + plain CSS (no Tailwind, no UI library)
- **Backend:** Firebase Firestore + Firebase Auth (Anonymous + Google)
- **Hosting:** Firebase Hosting (site `task-monitor-cbaf2`, https://task-monitor-cbaf2.web.app) at `tasks.blueinnovation.ph`. Config in `firebase.json` → `hosting` (SPA rewrite, `sw.js`/`index.html` no-cache, hashed assets immutable). Deploy with the `aejorango888@gmail.com` Firebase CLI account — the other logged-in accounts have no access to the project. GitHub Pages (`npm run deploy:pages`) is legacy; it only serves while the repo is public.
- **Top-level container:** `workspaces` — every project/task/activity/template/comment/webhook belongs to exactly one workspace. Members of a workspace share its contents.
- **AI brain:** all generative features go through `src/services/ai.js`. Default provider is the **Claude Code CLI** on the operator's machine, reached via the local bridge in `bridge/` (`npm run bridge`, `127.0.0.1:4319`); falls back to the Anthropic API key, then to a visibly-degraded mock.
- **Drag-and-drop:** `@dnd-kit/core` + `@dnd-kit/sortable`
- **Routing:** URL hash (`#/<view>/<projectFilter>?ws=<workspaceId>&tag=…&status=…`). No react-router.
- **Counters on each task** (`activityCount`, `totalHoursLogged`, `attachmentCount`, `lastActivityAt`) kept in sync via batched writes with `FieldValue.increment()`

## Data Model

```
workspaces/{workspaceId}:                ← v10 top-level container
  createdByUserId, name, description, color, icon
  members: [uid, ...]                    ← array-contains query
  acl: { [uid]: 'owner'|'admin'|'editor'|'viewer' }
  pendingInvites: [{ email, role, token }]
  knowledge: { notebookId, notebookTitle, setAt } | null   ← NotebookLM default
  archived, deleted, createdAt, updatedAt

projects/{projectId}:
  userId, workspaceId, name, description, color
  phases: [{ id, name, order }]
  acl: { [uid]: role }                   ← per-project ACL inside the workspace
  members: [uid, ...]
  knowledge: { notebookId, notebookTitle, setAt } | null   ← null = inherit ws
  archived, deleted, createdAt, updatedAt

tasks/{taskId}:
  userId, title, description
  projectId, phaseId               ← PM suite
  category                         ← legacy back-compat
  priority, status, progress
  requestedBy
  plan: { startDate, endDate }
  actual: { startDate, endDate }
  tags: [string, ...]              ← v4: cross-cutting tags
  subtasks: [{ id, text, done }]   ← v4: checklist
  dependsOn: [taskId, ...]         ← v4: dependencies
  recurrence: { rule, interval, dayOfWeek?, dayOfMonth?, until? }  ← v5
  recurrenceParentId: taskId       ← v5: points to original recurring task
  activityCount, totalHoursLogged, attachmentCount, lastActivityAt
  archived, deleted, createdAt, updatedAt

templates/{templateId}:                                            ← v5
  userId, name, description
  kind: 'task' | 'project'
  payload: <task or project shape; no IDs, no dates, no counters>
  deleted, createdAt, updatedAt

activities/{activityId}:
  taskId, userId
  taskTitle, taskCategory          ← denormalized snapshots
  projectId, phaseId               ← new
  date, comment, hoursSpent, statusAtTime
  attachments: [{ name, url, type, size }]
  completionStatus                 ← new (not-started|in-progress|blocked|completed)
  bottleneckRemarks                ← new
  requestedBy                      ← new
  loggedAt
```

## Migration: legacy categories → projects

`migrateLegacyCategories(userId)` in firebase.js runs on first sign-in (via the
`useProjects` hook). It seeds three projects (BRIDGED / AIM / Personal) and
links existing tasks to them. **Idempotent** — safe to call repeatedly.

## Views (in sidebar order)

1. **Board** — Kanban with drag-drop. Tag-filter chip-strip auto-populated. Cards show: project, status badges, **🔗 deps**, **🔁 recurrence**, **⏱ tracking**, tag pills, subtask progress bar, ▶ Start-timer button. Optional "Group by phase" mode (single-project filter only). **"+ From template"** quick-add button when task templates exist.
2. **Table** — Flat activity log with bulk actions (delete / set completion / export). Sortable columns.
3. **Gantt** — Timeline. Plan bars are draggable (resize + move). SVG dependency arrows. Rows grouped by project, sorted by earliest start.
4. **Calendar** — Month grid. **Tasks are draggable between days to reschedule** — drops update `plan.endDate` and shift `plan.startDate` to preserve duration. Click a task to edit.
9. **Review** — KPIs, hours-by-project, daily-hours strip, overdue/completed/bottleneck lists.
6. **Projects** — Project + phase CRUD. **Templates section** lists all saved task/project templates with delete + use actions.
7. **Settings** — Per-device prefs: theme override, default project, week start. **Account section** with Google sign-in / sign-out. **Notifications section** with permission status + enable button. **Knowledge base (NotebookLM)** with setup / sign-in / empty / ready states, Re-check, notebook table, source add and per-notebook usage. Data export.

## v5 Cross-cutting features

- **Code-splitting** — Board is eager; every other view is `React.lazy()` + Suspense.
- **Time tracker** — Single-track timer in localStorage. Topbar widget shows live elapsed time. ▶ button on each Board card starts tracking. Stop → modal pre-filled with elapsed hours → log activity in one click.
- **Recurring tasks** — On marking done, `spawnNextRecurrence` creates the next instance with shifted plan dates (daily/weekly/monthly + interval). Idempotent: skips if the dates already exist for this `recurrenceParentId`. Subtasks reset.
- **Templates** — Two kinds: `task` and `project`. Save-as-template button in editors. Picker in TaskForm (task) and as click-to-use cards in Projects view (project).
- **Notifications** — Service worker at `public/sw.js`. Browser notifications fired for newly-overdue tasks (deduped by `localStorage`-tracked "shown" set). Permission requested from Settings. Scan runs on load + every 5 min.
- **Google sign-in** — `signInWithGoogle()` does `linkWithPopup` if anonymous (keeps existing data), `signInWithPopup` otherwise. `signOutUser()` signs out then re-anonymous-signs-in so the app stays usable. Sidebar footer shows avatar + name when signed in.
- **Due-task alerts** — `DueTaskAlertModal` is mounted once in `ApprovedApp` (App.jsx) and shows **one task at a time**. Eligibility lives in the pure module `src/services/dueAlerts.js` (`isDueForAlert`, `buildAlertQueue`): not done, has `plan.endDate`, and `plan.endDate <= today + leadDays`. Queue order: most overdue → priority → title. `useDueAlertQueue` recomputes every 60 s and on task changes, keeps the on-screen task pinned, and hides (without dequeuing) during quiet hours, while another `.modal-backdrop` / the celebration is open, or while the timer runs for that task. **Snooze / skip are per-device localStorage** (`task-monitor.dueAlerts.{snooze,skip}.v1.<uid>`) — tasks are shared, so never persist them on the task doc. The prompt block calls `generateClaudePrompt` once per task and caches it in `task-monitor.dueAlerts.prompt.v1.<taskId>` keyed by `updatedAt` (user edits are kept); **Run** goes through `askAI` (`meta.kind = 'due-alert-run'`). The browser notification scan (`useOverdueScan`) uses the same `buildAlertQueue`, so both surfaces agree. Settings → *Due-task alerts* stores `settings.dueAlerts` `{ enabled, leadDays, defaultSnoozeMin, quietFrom, quietTo }`. Keyboard: Esc = default snooze, D = done, S = skip. The × in the dialog header is **close all**: it mutes every alert for the rest of the day on this device (`task-monitor.dueAlerts.mutedOn.v1.<uid>`, nothing is skipped); `DueAlertBell` in the topbar shows the waiting count and toggles that mute.

## AI provider layer

```
functions/index.js    ← aiProxy: holds the COMPANY key server-side. The browser
                        sends a prompt; the function checks the caller
                        (approved + company + aiEnabled) and calls Anthropic.
functions/src/authorize.js ← that check, as a pure tested function
bridge/ai.mjs         ← the only place that spawns `claude`; also API + mock
bridge/notebooklm.mjs ← the only place that spawns `notebooklm` (knowledge base)
bridge/server.mjs     ← localhost HTTP: /health /ai/complete /ai/json /ai/recheck
                        /ai/settings /ai/usage /knowledge/*.
                        127.0.0.1 only, origin allowlist.
src/services/ai.js        ← the only place the frontend picks a brain.
                            askAI / askAIJson / detectProvider / aiSettings
src/services/knowledge.js ← the only door to /knowledge/*; shared probe + cache
```

`/knowledge/*` routes (all on the same origin allowlist; a CLI failure is a
**502** carrying the CLI's own message):

| Route | Does |
| --- | --- |
| `GET /knowledge/status` | cliFound / authenticated / hint / notebooks (cached 60 s) |
| `POST /knowledge/status/refresh` | Re-check: clear caches and re-probe |
| `GET /knowledge/notebooks` | `[{ id, title, sourceCount }]` (cached 5 min) |
| `GET /knowledge/sources?notebook=` | `[{ id, title, kind }]` |
| `POST /knowledge/sources` | `{ notebook, kind:'url'\|'text', url \| title+text }` |
| `POST /knowledge/ask` | `{ notebook, question, conversationId?, source? }` → answer + citations |
| `GET /knowledge/usage?notebook=` | `{ stats, recent }` from the local ask log |
| `PATCH /knowledge/asks/<id>` | `{ helpful }` — local log only |

**Grounding.** `askAI(system, user, { ground: { notebookId } })` asks the
notebook first and prepends its answer to the system prompt as authoritative
source material (truncated to 8 000 chars). Only `claude-code` can ground; the
other providers return `degraded` with the reason. A failed lookup still
answers — with `degraded` + `grounding: null` — never a swallowed question.
Surfaces: Ask AI ("Ground with my notebook"), the due-task alert prompt block,
and `generateClaudePromptFull`.

- **A company's API key never reaches a browser.** It lives in
  `companies/{id}/secrets/anthropic`, readable only by a superadmin and by the
  `aiProxy` function (admin credentials). The company document carries a
  `hasApiKey` boolean, not the key. `getEffectiveApiKey()` returns ONLY a
  superadmin's own device key. Members' AI goes through provider `'proxy'`.
- **One chokepoint.** New AI features call `askAI` / `askAIJson` (or the
  `callClaude` / `callClaudeJson` wrappers in `anthropic.js`). Never `fetch`
  a model directly, and never spawn the CLI from anywhere but `bridge/ai.mjs`.
- **Hermetic CLI invocation.** `--safe-mode --strict-mcp-config --tools ""`
  and the role in `--system-prompt` (not prefixed to the user prompt). Dropping
  any of these turns a 280-token question into a 99,000-token one and lets the
  operator's own MCP servers editorialise in the answer.
- **A denied tool exits 0.** `parseCliResult` throws on non-empty
  `permission_denials` — the model's apology must never be stored as an answer.
- **Web access** is a provider capability: pass `{ web: true }` to `askAI`. Only
  `claude-code` can browse; other providers return the answer marked `degraded`.
- **Provider ≠ transport.** `claude-code` means the bridge is running the CLI
  (subscription, can browse, can ground). `bridge-api` means the same bridge is
  running on an `ANTHROPIC_API_KEY` — billed per token, and it can do neither.
  Both route through the bridge (`isBridgeProvider`); capability checks use
  `canBrowse(provider)` / `canGround(provider)`. `bridge-api` is never offered
  as a choice in Settings; it is what the bridge turns out to be.
- **The AI brain panel's wording comes from `providerLabel` / `providerHeadline`**
  in `services/ai.js`. Components must not write their own — that is how a
  bridge billing API tokens ended up advertising "no API billing".
- **Degraded ≠ success.** Every fallback sets `degraded` + `reason`. Propagate
  it; don't render a fallback as a clean result.
- **Gate UI with `useAiStatus()`**, not with `getEffectiveApiKey()` — the CLI
  needs no key, so a key check would hide AI from CLI users.
- `npm test` runs `bridge/ai.test.mjs` (`node --test`). Never spawn the CLI in
  a unit test.

## Conventions

- **Dates as YYYY-MM-DD strings** in user's local timezone (Asia/Manila). Helper: `todayLocal()` — defined in `services/recurrence.js`, re-exported from firebase.js.
- **Logic goes in a pure service, not in a component or in firebase.js.** `services/recurrence.js`, `services/csv.js`, `services/askAiCore.js`, `services/access.js`, `services/dueAlerts.js`, `services/errorMessages.js` and `services/nlpQuickAdd.js` import no Firebase and no network — that is what makes them testable with `node --test`. Components render what those modules return.
- **Every downloadable file is date-stamped**: `<name>-YYYY-MM-DD.<ext>` from `downloadFile()` in `services/download.js`, using `todayLocal()` — never `new Date().toISOString()`, which is UTC and stamps Manila mornings with yesterday. Nothing outside that module may set `a.download`.
- **Timestamps** (`createdAt`, `updatedAt`, `loggedAt`, `lastActivityAt`) use `serverTimestamp()`.
- **Soft delete** via `deleted: false` flag; **archive** via `archived: false`. Never hard-delete tasks because activities reference them.
- **`userId` on every document** — keeps security rules trivial.
- **Theme:** CSS variables in `:root` and `@media (prefers-color-scheme: dark)`. All tokens prefixed `--c-` (colors), `--s-` (spacing), `--r-` (radii).
- **Mobile-responsive** — sidebar hides under 720px.

## File Layout

```
src/
├── components/
│   ├── AppShell.jsx          ← sidebar + topbar + view router + global search + ⌘K
│   ├── Board.jsx             ← kanban with drag-drop + swim-lanes + tag filter
│   ├── TaskForm.jsx          ← quick-add (top of Board)
│   ├── TaskEditor.jsx        ← modal with tabs: Details / Subtasks / Dependencies
│   ├── DueTaskAlertModal.jsx ← two-column due alert: task + actions left, GenAI prompt right
│   ├── KnowledgeSection.jsx  ← Settings: NotebookLM setup states, notebooks, sources, usage
│   ├── NotebookPicker.jsx    ← cache-only notebook select (never spawns the CLI)
│   ├── AddToNotebookButton.jsx ← ＋ Notebook on a task/artifact URL
│   ├── DueAlertBell.jsx      ← topbar 🔔: waiting count, pause / resume alerts for today
│   ├── ActivityLogger.jsx    ← modal: log new activity
│   ├── ActivityEditor.jsx    ← modal: edit existing activity (atomic counter sync)
│   ├── TableView.jsx         ← activity table + bulk actions + CSV
│   ├── GanttView.jsx         ← timeline + draggable bars + dependency arrows
│   ├── CalendarView.jsx      ← month grid by plan.endDate
│   ├── ReviewView.jsx        ← KPIs, charts, lists
│   ├── ProjectsView.jsx      ← project & phase CRUD
│   └── SettingsView.jsx      ← per-device prefs + data export
├── hooks/
│   ├── useTasks.js           ← useAuth, useProjects, useTasks, useActivities, useAllActivities
│   ├── useDueAlertQueue.js   ← one current due task + snooze / skip / markDone
│   ├── useKnowledgeStatus.js ← is the knowledge base usable + which notebooks
│   ├── useNotifications.js   ← service worker, permission, browser-notification scan
│   └── useSettings.js        ← localStorage-backed settings + theme application
├── services/
│   ├── ai.js                 ← THE AI module: provider detection + askAI/askAIJson
│   ├── aiCredentials.js      ← company / personal API-key resolution
│   ├── anthropic.js          ← AI features (task drafts, summaries…) on top of ai.js
│   ├── askAi.js              ← Ask AI digest + narration
│   ├── dueAlerts.js          ← pure due-alert rules (tested by dueAlerts.test.mjs)
│   ├── knowledge.js          ← THE knowledge module: bridge client + shared cache
│   └── firebase.js           ← init, CRUD, subscriptions, migration helper (dedup-cached)
├── App.jsx                   ← root: routes view based on URL hash
└── App.css                   ← single stylesheet, design tokens + components
```

## When Making Changes

1. **Preserve denormalized fields.** When an activity is created, snapshot `taskTitle`, `taskCategory`, `projectId`, `phaseId` onto it.
2. **Atomic counter updates.** Any new counter on `tasks` must be updated in the same `writeBatch` as the activity write.
3. **No hard deletes.** Set `deleted: true`.
4. **Composite indexes.** Every filtered+ordered query needs one. They live in `firestore.indexes.json` (deploy with `npm run deploy:indexes`) — add the entry there, not just by clicking the link Firestore prints in the console, or the next environment breaks.
5. **Bound every query at the server.** `orderBy` + `limit` in the query, never `.sort().slice()` on the result: slicing after the download does not save a single read. Activity history pages with `loadMoreActivities(workspaceId, beforeDate)`; the live listener holds `ACTIVITY_PAGE_SIZE` entries.
6. **Mobile-first.** Sidebar collapses under 720px; board collapses under 960px. Any new view must respect this.
7. **No build-time secrets** beyond `.env.example`. The config is checked before Firebase is imported: `main.jsx` calls `readFirebaseConfig(import.meta.env)` and renders `SetupRequiredView` when anything is missing, so `services/firebase.js` and `App.jsx` must stay dynamic imports there — `initializeApp()` runs at module scope.
8. **No general backend.** Static frontend + Firestore, plus the single-purpose `functions/aiProxy` (see AI provider layer).
9. **Theme tokens.** Use CSS variables (`var(--c-text)`) not hardcoded colors. Dark mode is automatic via `prefers-color-scheme`.

## What Each Hook Returns

- `useAuth()` → `{ userId, ready }`
- `useProjects()` → `{ projects, byId, loading, userId }` — runs migration on first call
- `useTasks()` → `{ tasks, loading, todo, doing, done, overdue, userId }`
- `useActivities(taskId)` → `{ activities, loading }`
- `useAllActivities()` → `{ activities, loading }` — cross-task, for Table view
- `useRecentActivities(days)` → `{ activities, byDay, totalHours, loading }`

## Key Firebase Functions

- `addTask`, `updateTask`, `setTaskStatus(task, nextStatus)`, `moveTaskStatus(task)` (cycle), `archiveTask`, `softDeleteTask`, `subscribeToTasks`
- `addActivity`, `editActivity(oldActivity, updates)` ← **syncs task counters atomically**, `updateActivity` (raw, no counter sync), `deleteActivity`
- `bulkDeleteActivities(activities)`, `bulkUpdateActivityCompletion(activities, status)` ← used by Table bulk bar
- `subscribeToActivities`, `subscribeToAllActivities`, `subscribeToRecentActivities`
- `addProject`, `updateProject`, `archiveProject`, `softDeleteProject`, `subscribeToProjects`
- `migrateLegacyCategories(userId)` — idempotent
- `todayLocal()` — YYYY-MM-DD in local timezone
- `uid()` — short random id (used for phase IDs)

## Out of Scope (Don't Build Unless Asked)

**Shipped since this list was first written — these are NOT scope violations:**

- **Multi-user workspaces and sharing** — `workspaces/{id}` with `members[]` + `acl{}`,
  `pendingInvites`, and roles owner / admin / editor / viewer enforced in `firestore.rules`.
- **Google sign-in** — `signInWithGoogle()` in firebase.js (`linkWithPopup` when anonymous, so
  existing data survives). Anonymous auth is still the default way in, not the only one.
- **File upload bytes** — `FileUpload.jsx` → `uploadFile()` pushes to Firebase Storage under
  `storage.rules`. Plain attachment URLs (Drive, any external store) still work alongside it.

**Still out of scope:**

- A general server-side backend — Firestore is still the backend and the app is
  still a static SPA. The **one** exception is `functions/`, which exists solely
  so a company's Anthropic key can be held server-side (T-0034 / IMP-001): a
  shared secret cannot be kept in a browser. Deploying it needs the Blaze plan
  (`npm run deploy:functions`). Do not grow it into a general API.
- Server-side rendering.
- Running the AI bridge anywhere but `127.0.0.1` behind its origin allowlist.
- Real-time collaborative text editing.
- Server-sent push (FCM or similar). The service worker in `public/sw.js` only fires **local**
  notifications from a client-side overdue scan; nothing is pushed from a server.
- Email digests / SMTP — notifications are the service worker plus in-app surfaces.

## Development Workflow

```bash
npm install          # one install
npm start            # one run: vite + the AI bridge together (scripts/start.mjs,
                     # zero-dep launcher; Ctrl-C stops both; --no-ai skips the bridge)
npm run bridge       # AI bridge alone on 127.0.0.1:4319 (Claude Code CLI brain)
npm test             # bridge/*.test.mjs + src/**/*.test.mjs + tests/ui/*.test.mjs
                     # (node --test; jsdom + a rolldown JSX loader for components)
                     # never spawns `claude` or `notebooklm` — fixtures only
npm run test:rules   # firestore.rules against the Firestore emulator (needs Java)
npm run test:all     # both — run this before a deploy
notebooklm login     # optional: connect the NotebookLM knowledge base (see README)
npm run dev          # local at http://localhost:5173/task-monitor/
                     # dev/due-alert.html — harness that renders the due-task
                     # AlertDialog with sample tasks (no sign-in needed); ?ai=0 forces the offline template,
                     # &nb=1 pretends a notebook is configured
                     # dev/knowledge.html — harness for Settings → Knowledge base +
                     # NotebookPicker against the live bridge (no sign-in needed)
npm run build        # produces dist/
npm run deploy       # builds + deploys dist/ to Firebase Hosting
npm run deploy:rules # Firestore + Storage rules
npm run deploy:pages # legacy: push dist/ to the gh-pages branch
```

## Common Pitfalls

- ❌ Storing dates as JS `Date` objects in Firestore — use string `YYYY-MM-DD` for date-only fields
- ❌ Naming a download with `new Date().toISOString().slice(0,10)` — that is the UTC day. Use `downloadFile(base, ext, content)` from `services/download.js`.
- ❌ Reading the activities collection just for a count — use the denormalized counter
- ❌ `query(ref, where(...))` then `.sort().slice()` in the callback — the whole collection was already downloaded. Put `orderBy` and `limit` in the query and add the composite index to `firestore.indexes.json`.
- ❌ Using `arrayUnion` to push activities into a task document — they go in the root `activities` collection
- ❌ Renaming `userId` — it's referenced by security rules
- ❌ Adding new collections without adding security rules
- ❌ Hardcoding colors instead of using CSS variables — breaks dark mode
- ❌ Promising something the app cannot do — an approval email above all. There is no backend and no SMTP (see Out of Scope), so `services/approvalCopy.js` says "no email is sent, the page lets you in the moment someone approves" instead. `tests/ui/approvalScreens.test.mjs` fails the build if any screen promises one.
- ❌ Calling the session "anonymous". Anonymous auth was removed; use `sessionLine(profile, auth.currentUser)`.
- ❌ Showing a repo filename, a config key or "check the console" to a user. Error copy goes through `friendlyError(err, '<plain sentence>')` in `services/access.js`; `tests/ui/copy.test.mjs` fails the build otherwise.
- ❌ Drag-and-drop: if a card click triggers a drag, wrap inner buttons with `onPointerDown={(e) => e.stopPropagation()}` and `onClick={(e) => e.stopPropagation()}` so dnd-kit doesn't capture the gesture
- ❌ Editing an activity's hoursSpent or attachments with `updateActivity` directly — that won't sync the parent task's denormalized counters. Use `editActivity(oldActivity, updates)` instead.
- ❌ Swim-lanes when projectFilter is "all" — phase IDs differ across projects so the toggle is hidden in that case. The page header chip only shows when a single project is selected.
- ❌ Calling the Anthropic API directly from a component — go through `askAI`
- ❌ Gating an AI surface on `getEffectiveApiKey()` — CLI users have no key
- ❌ Reading `company.anthropicApiKey` in the client. It is not there any more — check `company.hasApiKey`.
- ❌ Gating an AI surface on `profile.companyId` — a user with no company still has AI when the bridge is up. Use `useAiStatus().available`.
- ❌ Treating `bridge-api` as `claude-code` — it cannot browse or ground, and it is billed per token
- ❌ Returning a mock or API fallback without setting `degraded` + `reason`
- ❌ Omitting `--tools ""` when spawning the CLI (that leaves every built-in tool live)
- ❌ Persisting due-alert snooze/skip on the task document — tasks are shared across workspace members; one person's snooze must not silence a teammate. Keep it in per-device localStorage via `dueAlerts.js`.
- ❌ Gating the due-alert prompt block on an API key — use `useAiStatus().available`; CLI users have no key. When AI is unavailable the block falls back to `buildFallbackPrompt` and labels it as a template.
- ❌ Gantt drag persistence: pointer events have to be on `window` for `pointermove`/`pointerup` (not just the bar element) — otherwise releases outside the bar leave the drag state stuck.
- ❌ Showing a shell command, a bridge URL or a CLI name to anyone but the operator. `KnowledgeSection` takes `isOperator` (approved superadmin only); the wording for both audiences comes from `knowledgeCopy(status, { isOperator })` in `services/knowledgeCopy.js`, tested by `knowledgeCopy.test.mjs` and `tests/ui/KnowledgeSection.test.mjs`.
- ❌ Spawning `notebooklm` anywhere but `bridge/notebooklm.mjs` — same rule as `claude` in `bridge/ai.mjs`. A component, a hook and `src/services/*` all reach it through `/knowledge/*`.
- ❌ Passing `ask --new`. It **deletes** the notebook's server-side conversation and the turns are not recoverable. Continue with `-c <conversationId>` instead.
- ❌ Using `payload.error` as an error message. In this CLI `error` is a **boolean** flag — read `payload.message`, or the user is told the problem is "true". Covered by `bridge/notebooklm.test.mjs`.
- ❌ Letting a picker or a validator call the CLI. `NotebookPicker` and `validateNotebookChoice` read `cachedNotebooks()` only; a `null` cache means "don't know", never "it's gone" — a saved `notebookId` is kept with a warning, never cleared.
- ❌ Rendering a failed grounding as a clean answer. Propagate `degraded` + `reason` and show the "not grounded" badge; `grounding` is `null` when the lookup failed.
