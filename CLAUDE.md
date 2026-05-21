# Task Monitor — Project Context

A personal **project-management suite** for Ace. Originally a task monitor; now
extended with projects + phases, drag-and-drop kanban, table view, Gantt chart,
and a professional Linear-inspired theme.

Deployed via GitHub Pages with a Firebase Firestore backend.

---

## Architecture

- **Frontend:** React 19 + Vite + plain CSS (no Tailwind, no UI library)
- **Backend:** Firebase Firestore + Firebase Auth (Anonymous + Google)
- **Hosting:** GitHub Pages at `tasks.blueinnovation.ph` (custom domain, CNAME at dot.ph)
- **Top-level container:** `workspaces` — every project/task/activity/template/comment/webhook belongs to exactly one workspace. Members of a workspace share its contents.
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
  archived, deleted, createdAt, updatedAt

projects/{projectId}:
  userId, workspaceId, name, description, color
  phases: [{ id, name, order }]
  acl: { [uid]: role }                   ← per-project ACL inside the workspace
  members: [uid, ...]
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
5. **Review** — KPIs, hours-by-project, daily-hours strip, overdue/completed/bottleneck lists.
6. **Projects** — Project + phase CRUD. **Templates section** lists all saved task/project templates with delete + use actions.
7. **Settings** — Per-device prefs: theme override, default project, week start. **Account section** with Google sign-in / sign-out. **Notifications section** with permission status + enable button. Data export.

## v5 Cross-cutting features

- **Code-splitting** — Board is eager; every other view is `React.lazy()` + Suspense.
- **Time tracker** — Single-track timer in localStorage. Topbar widget shows live elapsed time. ▶ button on each Board card starts tracking. Stop → modal pre-filled with elapsed hours → log activity in one click.
- **Recurring tasks** — On marking done, `spawnNextRecurrence` creates the next instance with shifted plan dates (daily/weekly/monthly + interval). Idempotent: skips if the dates already exist for this `recurrenceParentId`. Subtasks reset.
- **Templates** — Two kinds: `task` and `project`. Save-as-template button in editors. Picker in TaskForm (task) and as click-to-use cards in Projects view (project).
- **Notifications** — Service worker at `public/sw.js`. Browser notifications fired for newly-overdue tasks (deduped by `localStorage`-tracked "shown" set). Permission requested from Settings. Scan runs on load + every 5 min.
- **Google sign-in** — `signInWithGoogle()` does `linkWithPopup` if anonymous (keeps existing data), `signInWithPopup` otherwise. `signOutUser()` signs out then re-anonymous-signs-in so the app stays usable. Sidebar footer shows avatar + name when signed in.

## Conventions

- **Dates as YYYY-MM-DD strings** in user's local timezone (Asia/Manila). Helper: `todayLocal()` in firebase.js.
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
│   └── useSettings.js        ← localStorage-backed settings + theme application
├── services/
│   └── firebase.js           ← init, CRUD, subscriptions, migration helper (dedup-cached)
├── App.jsx                   ← root: routes view based on URL hash
└── App.css                   ← single stylesheet, design tokens + components
```

## When Making Changes

1. **Preserve denormalized fields.** When an activity is created, snapshot `taskTitle`, `taskCategory`, `projectId`, `phaseId` onto it.
2. **Atomic counter updates.** Any new counter on `tasks` must be updated in the same `writeBatch` as the activity write.
3. **No hard deletes.** Set `deleted: true`.
4. **Composite indexes.** New filtered+ordered queries will require an index. Firestore shows a one-click link in the console.
5. **Mobile-first.** Sidebar collapses under 720px; board collapses under 960px. Any new view must respect this.
6. **No build-time secrets** beyond `.env.example`.
7. **No backend.** Static frontend + Firestore.
8. **Theme tokens.** Use CSS variables (`var(--c-text)`) not hardcoded colors. Dark mode is automatic via `prefers-color-scheme`.

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

- Multi-user teams / sharing
- Email/Google sign-in (anonymous auth is intentional)
- Server-side rendering
- Real-time collaborative editing
- File upload bytes (only URLs to external storage)
- Push notifications

## Development Workflow

```bash
npm run dev          # local at http://localhost:5173/task-monitor/
npm run build        # produces dist/
npm run deploy       # builds + pushes to gh-pages branch
```

## Common Pitfalls

- ❌ Storing dates as JS `Date` objects in Firestore — use string `YYYY-MM-DD` for date-only fields
- ❌ Reading the activities collection just for a count — use the denormalized counter
- ❌ Using `arrayUnion` to push activities into a task document — they go in the root `activities` collection
- ❌ Renaming `userId` — it's referenced by security rules
- ❌ Adding new collections without adding security rules
- ❌ Hardcoding colors instead of using CSS variables — breaks dark mode
- ❌ Drag-and-drop: if a card click triggers a drag, wrap inner buttons with `onPointerDown={(e) => e.stopPropagation()}` and `onClick={(e) => e.stopPropagation()}` so dnd-kit doesn't capture the gesture
- ❌ Editing an activity's hoursSpent or attachments with `updateActivity` directly — that won't sync the parent task's denormalized counters. Use `editActivity(oldActivity, updates)` instead.
- ❌ Swim-lanes when projectFilter is "all" — phase IDs differ across projects so the toggle is hidden in that case. The page header chip only shows when a single project is selected.
- ❌ Gantt drag persistence: pointer events have to be on `window` for `pointermove`/`pointerup` (not just the bar element) — otherwise releases outside the bar leave the drag state stuck.
