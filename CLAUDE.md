# Task Monitor — Project Context

A personal **project-management suite** for Ace. Originally a task monitor; now
extended with projects + phases, drag-and-drop kanban, table view, Gantt chart,
and a professional Linear-inspired theme.

Deployed via GitHub Pages with a Firebase Firestore backend.

---

## Architecture

- **Frontend:** React 19 + Vite + plain CSS (no Tailwind, no UI library)
- **Backend:** Firebase Firestore for persistence; Firebase Anonymous Auth for `userId` scoping
- **Hosting:** GitHub Pages (static); `base: '/task-monitor/'` in vite.config.js
- **Three root collections:** `projects`, `tasks`, `activities`
- **Drag-and-drop:** `@dnd-kit/core` + `@dnd-kit/sortable`
- **Routing:** URL hash (`#/<view>/<projectFilter>`). No react-router.
- **Counters on each task** (`activityCount`, `totalHoursLogged`, `attachmentCount`, `lastActivityAt`) kept in sync via batched writes with `FieldValue.increment()`

## Data Model

```
projects/{projectId}:
  userId, name, description, color
  phases: [{ id, name, order }]
  archived, deleted, createdAt, updatedAt

tasks/{taskId}:
  userId, title, description
  projectId, phaseId               ← new (PM suite)
  category                         ← legacy back-compat
  priority, status, progress
  requestedBy                      ← new
  plan: { startDate, endDate }
  actual: { startDate, endDate }
  activityCount, totalHoursLogged, attachmentCount, lastActivityAt
  archived, deleted, createdAt, updatedAt

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

## Views

1. **Board** — Kanban (To Do / In Progress / Done) with drag-and-drop between columns. Cards have inline log/edit actions and expand to show activity history. **Optional "Group by phase" mode** subdivides each status column into phase swim-lanes (only available when a single project is selected).
2. **Table** — Flat activity log. Columns: Project | Phase | Task | Activity details | Date | Completion | Output link | Bottlenecks | Requested by | Hours. Sortable. CSV export. **Bulk actions:** row selection + bulk delete / set completion / export selected.
3. **Gantt** — CSS-grid timeline with plan bars (faded) overlaid by actual bars (solid). Today line. Day/Week/Month zoom. Color-coded by project. **Plan bars are draggable**: edges resize, middle moves the whole bar. Snaps to whole days, writes back via `updateTask`.
4. **Review** — Period-scoped summary (7/14/30/90 days). KPI cards (hours logged, tasks completed/created, overdue, activities, completed/blocked entries). Horizontal bar chart of hours-by-project. Daily-hours strip with today highlighted. Lists: overdue tasks, completed in period, bottlenecks.
5. **Projects** — Create, edit, archive, delete projects. Manage phase list per project.

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
│   ├── AppShell.jsx          ← sidebar + topbar + view router (useRoute)
│   ├── Board.jsx             ← kanban with drag-and-drop + swim-lanes
│   ├── TaskForm.jsx          ← quick-add (top of Board)
│   ├── TaskEditor.jsx        ← modal: edit any task field
│   ├── ActivityLogger.jsx    ← modal: log new activity (PM fields)
│   ├── ActivityEditor.jsx    ← modal: edit existing activity (atomic counter sync)
│   ├── TableView.jsx         ← activity table + bulk actions + CSV export
│   ├── GanttView.jsx         ← timeline with draggable plan bars
│   ├── ReviewView.jsx        ← KPIs, charts, lists
│   └── ProjectsView.jsx      ← project & phase CRUD
├── hooks/
│   └── useTasks.js           ← useAuth, useProjects, useTasks, useActivities, useAllActivities
├── services/
│   └── firebase.js           ← init, CRUD, subscriptions, migration helper
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
