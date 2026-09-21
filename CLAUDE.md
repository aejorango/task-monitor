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
  memberProfiles: { [uid]: { displayName, email, photoURL } }
  pendingInvites:      [{ email, role, invitedBy, invitedAt }]  ← the record
  pendingInviteEmails: [email, ...]      ← flat, so array-contains can find it
  pendingInviteRoles:  { [email]: role } ← flat, so the security rule can check it
  lastClaimedInviteEmail: email          ← side channel for isClaimingWorkspaceInvite
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

automations/{ruleId}:                                              ← v13
  userId, workspaceId, name
  trigger                          ← one of TRIGGERS in functions/src/automations.js
  conditions: [{ field, operator, value }, ...]   ← ANDed
  action, actionValue              ← one of ACTIONS; the value is an id or a word
  enabled, deleted, createdAt, updatedAt

automationRuns/{runId}:            ← written by the function, read-only in a browser
  ruleId, ruleName, workspaceId, taskId, taskTitle
  description                      ← the same sentence the editor previews
  outcome: 'done' | 'skipped', message, at, expiresAt

sharedViews/{token}:               ← v14: the ONE world-readable document
  workspaceId, projectId, projectName
  kind: 'board' | 'gantt'
  createdByUserId, createdByName, createdAt, updatedAt
  revoked, expiresAt                 ← rules refuse a dead link, not just the UI
  snapshot: { generatedAt, projectName, phases, tasks: [...], counts }
                                     ← a SNAPSHOT, never a pointer: nothing in
                                       tasks/projects/workspaces opens up

notifications/{noticeId}:          ← the inbox: mentions, comments, assignments,
  userId, workspaceId                  and whatever an automation raised
  kind: 'mention'|'comment'|'assignment'|'automation'
  source: 'person' | 'automation', fromUserId
  text                               ← the whole sentence, built by mentions.js
  taskId, taskTitle, read, at

savedViews/{viewId}:                                               ← v12
  userId, workspaceId, name, icon
  view, projectFilter, tagFilter, statusFilter   ← the filters
  columns: [columnId, ...], groupBy, sortBy, sortDir  ← the TABLE (tasks-table)
  deleted, createdAt, updatedAt

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
6. **Task table** — every task as a configurable report: pick the columns and their
   order, group by project / phase / status / priority / assignee, sort by any column,
   then save the whole arrangement as a saved view or export it. Logic lives in the pure
   `services/tableViews.js`; the saved view stores `{ columns, groupBy, sortBy, sortDir }`.
7. **Projects** — Project + phase CRUD. **Templates section** lists all saved task/project templates with delete + use actions.
8. **Settings** — Per-device prefs: theme override, default project, week start. **Automations** section: rules as dropdowns, the run log, and the notices they raised for you. **Account section** with Google sign-in / sign-out. **Notifications section** with permission status + enable button. **Knowledge base (NotebookLM)** with setup / sign-in / empty / ready states, Re-check, notebook table, source add and per-notebook usage. Data export.

## v5 Cross-cutting features

- **Code-splitting** — Board is eager; every other view is `React.lazy()` + Suspense.
- **Time tracker** — Single-track timer in localStorage. Topbar widget shows live elapsed time. ▶ button on each Board card starts tracking. Stop → modal pre-filled with elapsed hours → log activity in one click.
- **Recurring tasks** — Two paths, both idempotent on `recurrenceParentId` + the due date. (1) On marking done, `spawnNextRecurrence` creates the next instance with shifted plan dates (daily/weekly/monthly + interval); subtasks reset. (2) On schedule: `useRecurrenceCatchUp` runs on load and hourly, and `catchUpPlan` (pure, `services/recurrenceSchedule.js`) works out every occurrence that has become due and is missing — so a series nobody ever ticks off still comes round. Bounded: due today or earlier (`HORIZON_DAYS = 0`), nothing older than `STALE_DAYS`, at most `MAX_PER_RUN` per series per run.
- **Templates** — Two kinds: `task` and `project`. Save-as-template button in editors. Picker in TaskForm (task) and as click-to-use cards in Projects view (project).
- **Notifications** — Service worker at `public/sw.js`. Browser notifications fired for newly-overdue tasks (deduped by `localStorage`-tracked "shown" set). Permission requested from Settings. Scan runs on load + every 5 min.
- **Google sign-in** — `signInWithGoogle()` does `linkWithPopup` if anonymous (keeps existing data), `signInWithPopup` otherwise. `signOutUser()` signs out then re-anonymous-signs-in so the app stays usable. Sidebar footer shows avatar + name when signed in.
- **Due-task alerts** — `DueTaskAlertModal` is mounted once in `ApprovedApp` (App.jsx) and shows **one task at a time**. Eligibility lives in the pure module `src/services/dueAlerts.js` (`isDueForAlert`, `buildAlertQueue`): not done, has `plan.endDate`, and `plan.endDate <= today + leadDays`. Queue order: most overdue → priority → title. `useDueAlertQueue` recomputes every 60 s and on task changes, keeps the on-screen task pinned, and hides (without dequeuing) during quiet hours, while another `.modal-backdrop` / the celebration is open, or while the timer runs for that task. **Snooze / skip are per-device localStorage** (`task-monitor.dueAlerts.{snooze,skip}.v1.<uid>`) — tasks are shared, so never persist them on the task doc. The prompt block calls `generateClaudePrompt` once per task and caches it in `task-monitor.dueAlerts.prompt.v1.<taskId>` keyed by `updatedAt` (user edits are kept); **Run** goes through `askAI` (`meta.kind = 'due-alert-run'`). The browser notification scan (`useOverdueScan`) uses the same `buildAlertQueue`, so both surfaces agree. Settings → *Due-task alerts* stores `settings.dueAlerts` `{ enabled, leadDays, defaultSnoozeMin, quietFrom, quietTo }`. **`enabled` defaults to `false`** — it interrupts and it spends AI budget, so it is opt-in. Devices that saved the old default-on value are cleared once by `applyDueAlertOptIn` in `useSettings.js` (flagged by `task-monitor.dueAlerts.optIn.v1`, so a deliberate opt-in is never undone). `enabled` gates **both** surfaces: the modal and `useOverdueScan`'s browser notifications. It used to gate only the modal, so a user who switched alerts off kept getting desktop banners every five minutes and read that as broken (T-0107). Keyboard: Esc = default snooze, D = done, S = skip. The × in the dialog header is **close all**: it mutes every alert for the rest of the day on this device (`task-monitor.dueAlerts.mutedOn.v1.<uid>`, nothing is skipped); `DueAlertBell` in the topbar is the on/off **switch** for the whole feature — it shows the waiting count, renders in both states (hiding it while off would leave no way back on), and clears today's mute when switched on.
- **Automations** — "when this happens, do that", authored in Settings → Automations as dropdowns and run by `onTaskAutomations` (`functions/automations.js`). The vocabularies, the matching, the plan, the one-sentence description and the refusals all live in the pure `functions/src/automations.js`, which the **editor imports directly** — one vocabulary, so the form and the runner can never mean different things. Admin-only to write, member-readable. Every run is logged to `automationRuns`; "Tell someone" writes a `notifications` doc that the same panel shows the person it was for. Loop guards: `wouldLoop()` refuses a rule that would set off its own trigger, and every write the runner makes carries `lastAutomationRunId` so the next `onDocumentWritten` ignores it.

## AI provider layer

```
functions/webhooks.js ← onTaskWritten / onActivityWritten: signs and POSTs
                        webhooks, logs every attempt to `webhookDeliveries`
functions/src/webhookEvents.js ← which events fire and what the body is (pure)
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

## Exports — getting work out of the app

One module builds them all: `src/services/exporters.js`. Content is described
once as a list of blocks (`heading`, `paragraph`, `bullets`, `table`,
`keyValues`) and rendered to **.xlsx · .docx · .pdf · .md · .html · .txt · .csv**.

```
services/exporters.js      ← the document model + all seven writers
services/taskExport.js     ← a task list as a document (Board, Gantt, Projects)
services/activityExport.js ← buildActivityLogDocument() (Activity Log, its bulk
                             bar, the WBS activity modal, Projects) and
                             buildWbsDocument() (the WBS modal)
services/minutesExport.js  ← one set of minutes
components/ExportButton.jsx← "Export ▾" — the menu, the spinner, the filename
```

- **The libraries are dynamic imports.** `exceljs` (908 kB), `jspdf` (390 kB)
  and `docx` (394 kB) are code-split and never in the eager bundle; a user who
  never exports never downloads them. Keep it that way — a top-level import of
  any of them lands on every page load.
- **Every file goes through `downloadFile()`**, so every name is
  `<name>-YYYY-MM-DD.<ext>` in the user's own day.
- **`build()` runs only when a format is picked**, so a page never prepares an
  export nobody asked for.
- **Only `exportError()` messages reach the user.** Anything else that escapes
  an export is a library's internal complaint; `ExportButton` shows a generic
  sentence instead.
- A document with a `sheets: [...]` array gets proper worksheets in Excel;
  without one, the first `table` block is used.

## Telling the user something

```
hooks/useActivate.js   ← activateProps(onActivate, { disabled, label }): every
                          prop a div needs to really be a button — Enter AND
                          Space, preventDefault so Space does not scroll
hooks/useModalDialog.js ← turns an EXISTING modal into a real dialog: spread
                          backdropProps + dialogProps, give the heading
                          `id={modal.titleId}` (or pass `title:` when there is
                          no heading). role=dialog, aria-modal, focus trap,
                          Escape, focus restore, backdrop click. Pass
                          `open:` when the component owns the modal's
                          open/closed state — see the pitfall below.
components/Toast.jsx   ← useToast(): a message, optionally with Undo
components/Dialog.jsx  ← useDialog(): await ask.confirm(…) / ask.prompt(…)
                         plus the Modal shell (role=dialog, focus trap, Escape)
services/access.js     ← friendlyError(err, fallback): one plain sentence
services/errorMessages.js ← describeCrash() for a crash; describeAiFailure(err,
                         fallback, { isOperator }) for an AI failure → one
                         sentence for the screen + the operator's version for
                         the console; isPlainUserMessage() is the guard
hooks/useUserProfile.js ← isOperatorProfile() / useIsOperator(): who may be
                          shown operator copy (an approved superadmin)
```

Both providers are mounted once, in `App.jsx`. A component calls the hook; a
module-level helper cannot, so it returns a result and the component speaks.

## Conventions

- **Dates as YYYY-MM-DD strings** in user's local timezone (Asia/Manila). Helper: `todayLocal()` — defined in `services/recurrence.js`, re-exported from firebase.js.
- **Logic goes in a pure service, not in a component or in firebase.js.** `services/recurrence.js`, `services/csv.js`, `services/askAiCore.js`, `services/access.js`, `services/dueAlerts.js`, `services/errorMessages.js` and `services/nlpQuickAdd.js` import no Firebase and no network — that is what makes them testable with `node --test`. Components render what those modules return.
- **Every downloadable file is date-stamped**: `<name>-YYYY-MM-DD.<ext>` from `downloadFile()` in `services/download.js`, using `todayLocal()` — never `new Date().toISOString()`, which is UTC and stamps Manila mornings with yesterday. Nothing outside that module may set `a.download`.
- **Timestamps** (`createdAt`, `updatedAt`, `loggedAt`, `lastActivityAt`) use `serverTimestamp()`.
- **A custom field is described in one place.** `services/customFields.js` turns a project's `customFields` into labels, chips (`taskChips`) and table columns (`customFieldColumns`); `tableViews.js` merges those into the column catalogue, so a field can be shown, sorted, grouped, saved in a view and exported like any built-in column. A column id is `custom:<fieldId>` — a view whose field has since been deleted still opens, without that column.
- **An attachment belongs to the workspace.** Uploads go to `workspaces/{workspaceId}/{taskId|general|logo}/…` — `uploadPath()` in the pure `services/uploadPaths.js` builds every one and refuses a path with no workspace. `storage.rules` reads that workspace document to decide access, so any member can open, replace or delete the file. `users/{uid}/…` is frozen legacy: readable and deletable by its uploader, never written again.
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
│   ├── AutomationsSection.jsx ← Settings: rule list, the dropdown editor, run log, notices
│   ├── WorkloadView.jsx     ← Board → Workload: people × weeks, drag to rebalance
│   ├── ShareLinksPanel.jsx  ← project editor: publish / refresh / turn off a link
│   ├── SharedViewPage.jsx   ← the public route: fetches one snapshot, no sign-in
│   ├── SharedSnapshot.jsx   ← renders it (board or timeline), fetches nothing
│   ├── InboxBell.jsx         ← topbar 📥: unread count, opens InboxPanel
│   ├── InboxPanel.jsx        ← the list of notices (presentational, harness-friendly)
│   ├── NotebookPicker.jsx    ← cache-only notebook select (never spawns the CLI)
│   ├── AddToNotebookButton.jsx ← ＋ Notebook on a task/artifact URL
│   ├── DueAlertBell.jsx      ← topbar switch: turns due alerts on/off, shows waiting count
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
│   ├── useInbox.js           ← one notices listener, however many components ask
│   ├── useRecurrenceCatchUp.js ← makes a due occurrence appear without a tick-off
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
│   ├── mentions.js           ← who a message is for, and the notice they get
│   ├── workload.js           ← the people × weeks grid, and what a drop means
│   ├── shareLinks.js         ← the read-only snapshot a client outside can open
│   ├── recurrenceSchedule.js ← which occurrences are due, and which are missing
│   ├── customFields.js       ← a project's own fields as chips, columns and labels
│   ├── ganttGeometry.js      ← where a plan bar sits, and what a drag on it writes
│   ├── taskStatus.js         ← what a status implies: progress and the actual dates
│   ├── tagFilter.js          ← "only #client", and where an activity's tags come from
│   ├── views.js              ← THE list of pages: sidebar, topbar, ⌘K and not-found
│   ├── uploadPaths.js        ← where a file is stored, and what a delete orphans
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
- `subscribeToActivities(workspaceId, taskId, cb)` ← **both** ids (see pitfalls), `subscribeToAllActivities`, `subscribeToRecentActivities`
- `addProject`, `updateProject`, `archiveProject`, `softDeleteProject`, `subscribeToProjects`
- `migrateLegacyCategories(userId)` — idempotent
- `todayLocal()` — YYYY-MM-DD in local timezone
- `uid()` — short random id (used for phase IDs)

## Out of Scope (Don't Build Unless Asked)

**Shipped since this list was first written — these are NOT scope violations:**

- **Multi-user workspaces and sharing** — `workspaces/{id}` with `members[]` + `acl{}`,
  and roles owner / admin / editor / viewer enforced in `firestore.rules`.
- **Invite by email** — an admin records an invitation on the workspace; the invited
  person joins themselves at next sign-in (`claimPendingWorkspaceInvites`), validated by
  `isClaimingWorkspaceInvite()` in the rules. No backend, no UID ever changes hands.
  Rules for it live in `services/invites.js`.
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
  (This is why the app never promises an approval email.)

**Also shipped since the list was written:**

- **Webhook delivery** — `functions/webhooks.js` signs each body with the webhook's own
  secret (HMAC-SHA256, `x-taskmonitor-signature`), retries transient failures on a
  0/30/300 s backoff, and logs every attempt to `webhookDeliveries` for Settings to show.
  https only; loopback and private-network addresses are refused.

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
- ❌ Building a CSV by hand in a component. Every export goes through `services/exporters.js`, so a page offers all the formats at once and every file is date-stamped by `downloadFile()`. Four pages kept their own writer and could only produce a CSV — the Activity Log, its bulk bar, the WBS and the per-project log, which are exactly the pages somebody sends to a client. `tests/ui/activityExportUi.test.mjs` fails the build if a component grows a CSV escaper again. Note the round-trip: a column this app **exports** must be an alias the import wizard **recognises**, or the app cannot read its own file back.
- ❌ Importing `exceljs` / `jspdf` / `docx` at the top of a module — they are megabytes, and `await import()` inside the writer keeps them out of the eager bundle.
- ❌ Naming a download with `new Date().toISOString().slice(0,10)` — that is the UTC day. Use `downloadFile(base, ext, content)` from `services/download.js`.
- ❌ Reading the activities collection just for a count — use the denormalized counter
- ❌ Getting one task's activity log from either half of the query alone. It needs **`workspaceId` AND `taskId`**, and this has broken twice in opposite directions. `where('taskId','==',id)` on its own is refused outright — rules are not filters, and that query could match a workspace the caller is not in, so the log came back empty everywhere. Filtering the workspace-wide listener down to one task instead is *silently* worse: that listener stops at the newest `ACTIVITY_PAGE_SIZE` rows **across the whole workspace**, so any task whose entries had scrolled past the cap showed "No activities logged yet." while Table and WBS still listed them. `subscribeToActivities(workspaceId, taskId)` passes both, needs no composite index (two equality clauses, sorted client-side over one task's own history) and no cap. `tests/rules/activities.rules.test.mjs` fails the build if either clause is dropped.
- ❌ `query(ref, where(...))` then `.sort().slice()` in the callback — the whole collection was already downloaded. Put `orderBy` and `limit` in the query and add the composite index to `firestore.indexes.json`.
- ❌ Using `arrayUnion` to push activities into a task document — they go in the root `activities` collection
- ❌ Renaming `userId` — it's referenced by security rules
- ❌ Adding new collections without adding security rules
- ❌ Hardcoding colors instead of using CSS variables — breaks dark mode
- ❌ Promising something the app cannot do — an approval email above all. There is no backend and no SMTP (see Out of Scope), so `services/approvalCopy.js` says "no email is sent, the page lets you in the moment someone approves" instead. `tests/ui/approvalScreens.test.mjs` fails the build if any screen promises one.
- ❌ Calling the session "anonymous". Anonymous auth was removed; use `sessionLine(profile, auth.currentUser)`.
- ❌ `alert()`, `confirm()` or `prompt()`. They block the page, cannot be themed, and give a screen-reader user no title and no focus management. Use `useToast()` (`toast.success/error/info`, with `{ undo }` where something can be taken back) and `useDialog()` (`await ask.confirm({ title, message, confirmLabel, danger })` / `ask.prompt(...)`). `tests/ui/noNativeDialogs.test.mjs` fails the build otherwise.
- ❌ Putting anything a call site re-creates each render into `useModalDialog`'s effect deps. The effect moves focus into the dialog, so it must run **once per open**. It was keyed on `onClose`, and almost every call site passes a fresh arrow (`onClose={() => setLoggingTask(null)}`) — so every render of the parent stole the caret back to the first field. Board re-renders whenever the workspace tasks listener fires: a teammate's edit, a counter bump, the user's own timer. `onClose`, `closeOnEscape` and `autoFocus` live in a ref the handler reads when it fires; the deps are `[open]` and nothing else.
- ❌ Calling `useModalDialog` above the early return of a component that is always mounted. The hook installs a **document-capture** `keydown` listener whose Escape branch calls `stopPropagation()`, which kills the key before anything else in the app sees it — so one such call site made Escape dead for the ⌘K dropdown, the Export ▾ menu, the inbox panel, the Task-table column picker, the tutorial tour and the due-task alert all at once. A component that owns its modal's open/closed state passes `open: <that state>`; the hook then does nothing at all while closed — no listener, no focus moved in, no focus restored. The Escape branch also returns early unless the panel is really in the document, so a forgotten flag cannot resurrect the bug, and `tests/ui/escapeKey.test.mjs` fails the build if a new call site needs the flag and does not pass it.
- ❌ A modal that is only a styled `div`. It needs `useModalDialog` (or the `Modal` component for a new one): without it there is no announcement, no Escape, and Tab walks straight out into the page behind. `tests/ui/modalSemantics.test.mjs` fails the build otherwise. `DueTaskAlertModal` is the one exception — it is `role="alertdialog"` with its own focus handling.
- ❌ A `div` with `role="button"` that handles only Enter. The ARIA button pattern is a contract: Enter **and** Space both activate, and Space must `preventDefault` or the page scrolls instead. Every such row was made keyboard-reachable by hand and most got it half-right. Spread `activateProps()` from `hooks/useActivate.js` — it supplies `role`, `tabIndex`, `onClick` and `onKeyDown` as one set, so they cannot drift. Enter-only is still correct on a **text input**, where Enter submits and Space types a space; `tests/ui/activateProps.test.mjs` tells the two apart and fails the build on the second.
- ❌ An icon-only button (`✕ ✎ ▶ ↑ ↓ ⎘`) with no `aria-label`. It means nothing to a screen reader, and nothing on a touch device where there is no hover to reveal a `title`. Make the two match.
- ❌ A confirm button that says "OK". Say what will happen — Delete, Remove, Revoke — and pass `danger: true` when it destroys something.
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
- ❌ Firing `task.updated` for a counter the app bumped. `taskEventsFor` ignores `updatedAt`, `lastActivityAt`, `activityCount`, `totalHoursLogged` and `attachmentCount` — otherwise every activity write doubles an integration's traffic.
- ❌ Asking anyone for a Firebase UID. Invite by email (`inviteToWorkspaceByEmail`); show `memberLabel(uid, memberProfiles)`, never the uid. The Account ID box is superadmin-only and behind an Advanced toggle.
- ❌ Adding an invite field without its flat twin. `pendingInvites` is an array of maps: rules cannot search it, so `pendingInviteEmails` (array-contains) and `pendingInviteRoles` (role lookup) must be written in the same update. `inviteFields()` / `revokeInviteFields()` do all three.
- ❌ Persisting due-alert snooze/skip on the task document — tasks are shared across workspace members; one person's snooze must not silence a teammate. Keep it in per-device localStorage via `dueAlerts.js`.
- ❌ Gating the due-alert prompt block on an API key — use `useAiStatus().available`; CLI users have no key. When AI is unavailable the block falls back to `buildFallbackPrompt` and labels it as a template.
- ❌ Keeping a second list of the app's pages. `services/views.js` is the registry the sidebar, the topbar title, the not-found check and the ⌘K palette all read. `NAV_TARGETS` used to be a hand-maintained copy of the sidebar's `VIEWS` and drifted: Workload, Trash and Artifacts were in the sidebar and unreachable from search — Trash above all, which is where somebody goes the moment they delete something by accident. `tests/ui/commandPalette.test.mjs` fails the build if a registry entry is not reachable from the palette, so a new page cannot ship unsearchable.
- ❌ Passing a filter prop the receiving view never declares. `App.jsx` handed `initialTagFilter` to four views; three of them declared nothing, so a saved view filtered to `#client` showed everything while the sidebar tooltip still advertised the tag — and nothing fails when a prop is merely unused. Filtering goes through `services/tagFilter.js` and the shared `TagFilterBar`; `tests/ui/tagFilterViews.test.mjs` reads `App.jsx` and fails the build if a view is handed the prop without declaring it. Note that an **activity has no tags of its own** — it borrows its task's, so the Activity Log passes `{ taskById }`.
- ❌ Declaring a `useQuickCreate` listener that ignores its argument. The palette shows the name in its hint — *New project · “Website revamp”* — so a zero-argument `useCallback(() => setEditing('new'), [])` makes that hint a lie and the user retypes what they just typed. Take the text, wrap it with `newSeed()` and apply it with `useSeededField()` (both in `hooks/useQuickCreate.js`); seed only a NEW one, never an existing one being edited, and clear the seed on close. `tests/ui/quickCreateSeed.test.mjs` fails the build on a zero-argument listener.
- ❌ Putting a caught error's own message on the screen — `setError(err.message)`, or `{error.message}` in JSX. An AI error is written for whoever has to fix it ("Start it with `npm run bridge`", "AI API error 429: {…raw body…}"), and inline error rendering is copy just as much as a toast is; the toast guard only ever inspected toasts, so nine surfaces were showing SDK text. Every AI failure goes through `describeAiFailure(err, fallback, { isOperator })` in `services/errorMessages.js`: one plain sentence on screen, the operator's version to `console.error`, and the real thing shown only to an operator (`useIsOperator()`). `tests/ui/copy.test.mjs` fails the build on either pattern.
- ❌ Writing the operator test out by hand. `profile.role === 'superadmin' && profile.status === 'approved'` lived in two components and was about to appear in a third — use `isOperatorProfile()` / `useIsOperator()` from `hooks/useUserProfile.js`. Guarded by `tests/ui/copy.test.mjs`.
- ❌ Offering a field in the import wizard and not writing it. The mapping step, the preview and the write all read from `IMPORT_KINDS` — but the write used to be a hand-built object in `ImportWizard.jsx`, so Status was mapped, guessed from the heading, shown in the preview and then silently dropped, and every imported task landed in To Do. The payload is built by `importedTaskPayload()` in `services/csv.js`, **beside the field list**, and `tests/ui/importStatus.test.mjs` fails the build if a field is added to `IMPORT_KINDS.tasks` without a home in it.
- ❌ Hardcoding a field in `addTask` and overwriting what the caller handed it. It is the single create path for nine call sites (quick-add, the editor's subtask promotion, templates, the gallery, the AI generator, minutes, the CSV importer, the import wizard, the recurrence spawn), and it used to force `status: 'todo'`, `progress: 0` and empty actual dates **in silence** — a caller that asked for anything else got no error and no effect. `status`, `progress` and `actual` are all optional now: whatever the caller states wins, `statusStamps()` fills only the gaps, an unknown status is coerced to `'todo'` and a percentage is clamped to 0–100 rather than rejected. Note `clampProgress` returns `null` for "no statement" so an explicit `0` is not mistaken for silence.
- ❌ Deriving progress and the actual dates from a status by hand. `statusStamps()` in the pure `services/taskStatus.js` is the one rule, used by `addTask` and `setTaskStatus` alike — otherwise a task reaches "done" with different stamps depending on how it got there. `addTask` takes an optional `status` that defaults to `'todo'`, so quick-add and the recurrence spawn are unaffected.
- ❌ Requiring both plan dates to draw a Gantt bar. The row filter admits a task with **any** one of its four dates, and the app's dominant create path — quick-add, and the natural-language parser behind it — writes only an end date, so the commonest task in the app used to get a row with a title and a blank track that dragging could not fix. `effectivePlan()` in `services/ganttGeometry.js` makes a one-date plan a **one-day milestone** on that date; `dragOrigin()` gives it a real origin, so dragging its left edge is how it gains the `plan.startDate` it never had. Geometry and drag arithmetic live in that pure module — not inline in the component, where they were untestable.
- ❌ Gantt drag persistence: pointer events have to be on `window` for `pointermove`/`pointerup` (not just the bar element) — otherwise releases outside the bar leave the drag state stuck.
- ❌ Writing one AI message for two audiences. An `askAI` result carries `reason` (shown to anybody — plain, no CLI name, no provider id, no bridge URL) and `operatorHint` (the commands and the Settings section), and `<AiOperatorHint hint={…} />` renders the second only where `useIsOperator()` is true. `mockReply`'s body used to print `npm i -g @anthropic-ai/claude-code` straight into the answer for every user. `tests/ui/aiOperatorCopy.test.mjs` fails the build if a component outside an operator gate writes an npm command, and checks that the gates it exempts are still there.
- ❌ Showing a shell command, a bridge URL or a CLI name to anyone but the operator. `KnowledgeSection` takes `isOperator` (approved superadmin only); the wording for both audiences comes from `knowledgeCopy(status, { isOperator })` in `services/knowledgeCopy.js`, tested by `knowledgeCopy.test.mjs` and `tests/ui/KnowledgeSection.test.mjs`.
- ❌ Spawning `notebooklm` anywhere but `bridge/notebooklm.mjs` — same rule as `claude` in `bridge/ai.mjs`. A component, a hook and `src/services/*` all reach it through `/knowledge/*`.
- ❌ Putting a long body in argv. `source add --type text` takes the text as a positional argument, so anything past ~256 KB fails with E2BIG. `sourceAddPlan()` switches to a temp file and `--type file` above `STDIN_THRESHOLD`; `askNotebook` already hands long questions over on stdin.
- ❌ Passing `ask --new`. It **deletes** the notebook's server-side conversation and the turns are not recoverable. Continue with `-c <conversationId>` instead.
- ❌ Using `payload.error` as an error message. In this CLI `error` is a **boolean** flag — read `payload.message`, or the user is told the problem is "true". Covered by `bridge/notebooklm.test.mjs`.
- ❌ Letting a picker or a validator call the CLI. `NotebookPicker` and `validateNotebookChoice` read `cachedNotebooks()` only; a `null` cache means "don't know", never "it's gone" — a saved `notebookId` is kept with a warning, never cleared.
- ❌ Writing a second copy of the automation vocabulary in the UI. `AutomationsSection` imports `TRIGGERS` / `CONDITION_FIELDS` / `OPERATORS` / `ACTIONS` / `describeRule` / `validateRule` from `functions/src/automations.js` — the module the runner uses. A parallel list in a component is how a form comes to offer a rule the runner will never run.
- ❌ Showing an id in an automation. Every value in a rule is a project, a person, a phase or a connection: render it through the section's `nameFor`, and pick it from a dropdown. Nobody types an id.
- ❌ An action with nowhere to land. "Tell someone" writes a `notifications` doc — if nothing renders those, the action is dead UI. Settings → Automations shows the signed-in person's unread notices.
- ❌ Relying on the on-completion path alone for a recurring task. It dies at the first missed occurrence, which is the opposite of what a schedule is for. `useRecurrenceCatchUp` is the second path; both key on `recurrenceParentId` + the due date, which is what makes them safe to run at the same time.
- ❌ Creating a recurring occurrence early. `HORIZON_DAYS = 0`: it appears on the day it is due. A horizon of a week puts next week's copy on the board beside this week's.
- ❌ Putting the shared page behind the auth gate. `#/shared/<token>` renders in App.jsx **before** the `!ready` check — asking a client to sign in is the one thing it must never do. It imports `SharedSnapshot` and `getSharedView` and nothing else from the app.
- ❌ Making a share link a window instead of a snapshot. `sharedViews/{token}` holds the rows it shows, so a leaked token leaks one project's headline state and never grows into more; opening `tasks` to an unauthenticated reader would have been a hole the size of the workspace. What may leave is the written-down list in `SHARED_TASK_FIELDS` — no people, no hours, no comments, no attachments.
- ❌ Enforcing a link's expiry in the page. `allow list: if false` plus `shareIsLive()` in `firestore.rules` is what makes a revoked or expired link stop working; a UI check would be bypassed by the SDK in a console.
- ❌ Reusing `is-over` for two things. On a workload cell it means *over capacity*; the drag-over state is `is-drop-target`. One class for both meant a full week and a hovered week looked identical.
- ❌ Giving a workload chip an inner button. The chip is barely bigger than its own text: an inner button that stops the pointer makes the task undraggable. The chip IS the button and the drag handle, and a `dragged` ref stops the click at the end of a drag from also opening the task.
- ❌ Inserting a short @handle from a picker. `preferredHandle()` picks the shortest handle **nobody else answers to** — offering "@mia" when there are two Mias would notify the first one whatever you clicked. `mentionedUids` resolves by first claim, so the picker has to hand back something unambiguous.
- ❌ Navigating to a task by hand. `goToTask(task, navigate)` in `services/openTask.js` does the two steps (filter the Board to its project, then fire `OPEN_TASK_EVENT`); search results and the inbox both use it, so they behave identically.
- ❌ Writing a notice by hand. `mentions.js` builds the whole sentence (`buildNotice`) so an old notice still reads correctly after the wording changes, and the rules only accept `kind` in mention/comment/assignment from a browser — `automation` is the function's, written with admin credentials. Raise them with `raiseNotices`, **after** the message itself is written: a notice that fails must never cost somebody their comment.
- ❌ Reading `TASK_TABLE_COLUMNS` directly in a component. It is the built-ins only; the projects' own fields are added by `columnCatalogue(ctx)`, and `ctx` must carry `projects` or a custom column silently disappears from a saved view. Every `tableViews` function takes that ctx — including `normalizeTableConfig` and `tableConfigFields`.
- ❌ Storing an upload under the uploader. `users/{uid}/…` made the uploader the only person who could ever delete the file, so an admin who deleted somebody else's activity left the bytes behind for ever. Every upload goes through `uploadFile({ workspaceId, … })`.
- ❌ Deleting an activity without its files. `deleteActivity` / `bulkDeleteActivities` call `deleteUploads(attachmentPaths(...))` and `editActivity` calls `deleteUploads(orphanedPaths(...))` — **after** the batch commits, so a file the bucket refuses to drop can never block the record from going.
- ❌ Rendering a failed grounding as a clean answer. Propagate `degraded` + `reason` and show the "not grounded" badge; `grounding` is `null` when the lookup failed.
