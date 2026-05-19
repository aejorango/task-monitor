# Task Monitor — Project Context

A personal task monitoring web app for Ace, who runs three parallel tracks:
**BRIDGED** (fintech), **AIM** (teaching), and **Personal**. Deployed via
GitHub Pages with a Firebase Firestore backend.

---

## Architecture

- **Frontend:** React 18 + Vite + plain CSS (no Tailwind, no UI library)
- **Backend:** Firebase Firestore for persistence; Firebase Anonymous Auth for `userId` scoping
- **Hosting:** GitHub Pages (static); `base: '/task-monitor/'` in vite.config.js
- **Two root collections:** `tasks` and `activities`
- **Activities are a flat root collection** (not a subcollection) — see `docs/firestore-schema.md` for the reasoning
- **Counters on each task** (`activityCount`, `totalHoursLogged`, `attachmentCount`, `lastActivityAt`) are kept in sync via batched writes with `FieldValue.increment()`

## Data Model (essentials)

```
tasks/{taskId}:
  userId, title, description, category, priority, status, progress
  plan: { startDate, endDate }
  actual: { startDate, endDate }
  activityCount, totalHoursLogged, attachmentCount, lastActivityAt
  archived, deleted, createdAt, updatedAt

activities/{activityId}:
  taskId, userId
  taskTitle, taskCategory       ← denormalized snapshots
  date, comment, hoursSpent, statusAtTime
  attachments: [{ name, url, type, size }]
  loggedAt
```

Full schema in `docs/firestore-schema.md`.

## Conventions

- **Dates as YYYY-MM-DD strings** in user's local timezone (Asia/Manila) for `plan.*`, `actual.*`, and `activities.date`. Helper: `todayLocal()` in firebase.js.
- **Timestamps** (`createdAt`, `updatedAt`, `loggedAt`, `lastActivityAt`) use `serverTimestamp()`.
- **Soft delete** via `deleted: false` flag; **archive** via `archived: false`. Never hard-delete tasks because activities reference them.
- **`userId` on every document** — keeps security rules trivial and unlocks future multi-user.
- **CSS:** uses CSS variables (`--bg`, `--surface`, `--ink`, `--muted`, `--border`, `--accent`). Mobile-responsive at 720px breakpoint. No icon library — uses emoji or unicode for icons.

## File Layout

```
src/
├── components/
│   ├── TaskForm.jsx       ← add new tasks, expandable for plan dates
│   └── TaskList.jsx       ← kanban board + activity logger modal
├── hooks/
│   └── useTasks.js        ← useAuth, useTasks, useActivities, useRecentActivities
├── services/
│   └── firebase.js        ← init, CRUD, subscriptions, todayLocal helper
├── App.jsx                ← shell with session pill
└── App.css                ← all styles, mobile-first
```

## When Making Changes — Rules to Follow

1. **Preserve denormalized fields.** When an activity is created, snapshot `taskTitle` and `taskCategory` onto it. Don't read these from the task on each render.
2. **Atomic counter updates.** Any new counter or summary field on `tasks` must be updated in the same `writeBatch` as the activity write that affects it.
3. **No hard deletes of tasks** — set `deleted: true`. Activities will be orphaned if you do, breaking the journal view.
4. **Composite indexes** — when adding a new query that filters + sorts, Firestore will prompt in the console with a one-click link. Always wait for the index to build before claiming the feature works.
5. **Mobile-first** — the board collapses to one column under 720px. Any new component must respect this.
6. **Don't introduce build-time secrets** beyond what's in `.env.example`. All API keys must use the `VITE_` prefix.
7. **Don't add a backend.** The whole appeal is a static frontend + Firestore. If something seems to need a server, propose a Cloud Function instead.

## What Each Hook Returns

- `useAuth()` → `{ userId, ready }`
- `useTasks()` → `{ tasks, loading, todo, doing, done, overdue, byCategory, userId }`
- `useActivities(taskId)` → `{ activities, loading }`
- `useRecentActivities(days)` → `{ activities, byDay, totalHours, loading }`

## What Each Firebase Function Does

- `addTask(userId, task)` — creates task with default counters and lifecycle fields
- `updateTask(taskId, updates)` — partial update, auto-stamps `updatedAt`
- `moveTaskStatus(task)` — cycles todo → doing → done; auto-fills `actual` dates
- `archiveTask(taskId)`, `softDeleteTask(taskId)` — flag-based, recoverable
- `addActivity(userId, task, activity)` — batched: writes activity + increments task counters atomically
- `deleteActivity(activity)` — batched: removes activity + decrements task counters
- `subscribeToTasks(userId, cb)` — live; filters out deleted and archived
- `subscribeToActivities(taskId, cb)` — live; one task's log
- `subscribeToRecentActivities(userId, sinceDate, cb)` — live; cross-task journal feed
- `todayLocal()` — YYYY-MM-DD in Asia/Manila; use this everywhere instead of `new Date().toISOString()`

## Out of Scope (Don't Build Unless Asked)

- Multi-user teams (schema supports it, UI doesn't)
- Email/Google sign-in (anonymous auth is intentional — keeps friction at zero)
- Server-side rendering
- Real-time collaboration on the same task
- File upload bytes (only URLs to external storage are stored)
- Push notifications (no service worker setup)

## Development Workflow

```bash
npm run dev          # local at http://localhost:5173/task-monitor/
npm run build        # produces dist/
npm run deploy       # builds + pushes to gh-pages branch
```

## Testing Approach

No formal test suite yet — manual smoke test:
1. Add a task with plan dates
2. Log an activity with comment + hours + attachment URL
3. Move the task through todo → doing → done; verify actual dates auto-fill
4. Open the task History; verify the log shows up
5. Refresh; everything persists

Before any commit, run through this on `npm run dev` at minimum.

## Common Pitfalls Future-Claude Should Avoid

- ❌ Storing dates as JS `Date` objects in Firestore — use string `YYYY-MM-DD` for date-only fields
- ❌ Reading the activities collection just to show a count on a task card — use the denormalized counter
- ❌ Using `arrayUnion` to push activities into a task document — they go in the root `activities` collection
- ❌ Renaming `userId` — it's referenced by security rules; changing the key breaks everything
- ❌ Adding new collections without adding security rules for them
- ❌ Using `console.log` for errors — use `console.error` so they're visible in production
