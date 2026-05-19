# Task Monitor — Feature Roadmap

This is the working backlog. Each tier is a coherent buildout shipped as one
deploy. Tier 1 starts immediately after Phase 1 ships; later tiers run
autonomously in sequence.

---

## Tier 1 — High-value, fills real gaps

| # | Feature | Approach |
|---|---|---|
| 1.1 | **Rich-text descriptions** | Markdown in `description` field. Render via a small dependency-free renderer (or `marked` if needed). Edit raw, preview live. Applies to task + project descriptions + activity comments. |
| 1.2 | **File uploads** | Firebase Storage integration. Upload from ActivityLogger / TaskEditor; compress images (canvas), store under `users/{uid}/...`; metadata in the existing `attachments` array. Lifecycle rule to auto-delete soft-deleted task attachments. |
| 1.3 | **Comments on tasks** | New `taskComments/{id}` collection: `{ taskId, userId, body, createdAt }`. Comments tab in TaskEditor. Threaded display. |
| 1.4 | **PWA + offline mode** | `manifest.webmanifest`, install prompt, icons. `enableIndexedDbPersistence(db)` for Firestore offline. Sync indicator in topbar (online / queued / syncing). |
| 1.5 | **Natural-language quick-add** | Parser that recognizes `next Friday`, `tomorrow`, `!urgent`, `#tag`, `@person`. Wire into TaskForm. Real-time preview of parsed structure. |

### Tier 1 task list

1. `marked` dep (or hand-rolled) + `<Markdown>` component
2. TaskEditor / ProjectEditor / ActivityLogger description switches to Markdown editor
3. Markdown rendering in cards, tables, activity log, comments
4. Firebase Storage setup: rules + bucket path
5. File upload component: drag-drop zone, multi-file, progress bars
6. Image compression (canvas → JPEG, max 1600px on long edge)
7. Storage cleanup hook on task / activity delete
8. `taskComments` collection + CRUD + subscription
9. Comments tab in TaskEditor (thread view + add)
10. `manifest.webmanifest` + 192px / 512px icons
11. `enableIndexedDbPersistence(db, { synchronizeTabs: true })`
12. Online/offline detector + topbar sync pill
13. NL date parser (`chrono-node` or custom for common phrases)
14. NL token extractor for `!priority`, `#tag`, `@assignee`
15. Live-preview chip strip beside the quick-add input
16. Tests / smoke + ship

---

## Tier 2 — Power-user / scale

| # | Feature | Approach |
|---|---|---|
| 2.1 | **Saved filters / custom views** | `savedViews/{id}` collection. Each view stores: view type (board/table/etc), project filter, tag filter, status filter, sort, density. Sidebar shows pinned saved views. |
| 2.2 | **Subtask → task promotion** | Right-click on subtask → "Promote to task". Creates a real task; original subtask gets a `taskId` link; can keep or remove. |
| 2.3 | **Task linking** | New `links: [{ targetId, type }]` field. Types: blocks, relates-to, duplicate-of. Visual treatment per type. UI in TaskEditor → Links tab. |
| 2.4 | **AI assist (Claude API)** | "Summarize my week", "What should I tackle today?", "Draft a status update for Mark from these activities". Same API key as Tier 0 (already in Settings). New AI chat panel docked from Review view. |

### Tier 2 task list

1. `savedViews` collection + CRUD + rules
2. "Save current view" button in topbar; named view dialog
3. Sidebar section listing saved views with edit/delete
4. Subtask context menu / hover button → promote
5. Promote flow: create task, optionally remove subtask
6. `task.links` field; migration for missing field
7. Links tab in TaskEditor (multi-select picker per type)
8. Link badges on Board card (color/icon per type)
9. AI assist prompts module: `summarizeWeek`, `suggestNextTask`, `draftStatus`
10. AI panel UI (chat-style or one-shot) docked in Review
11. Activity-aware context for the AI (pass recent activities)
12. Tests / smoke + ship

---

## Tier 3 — Collaboration (requires real auth model + rules)

| # | Feature | Approach |
|---|---|---|
| 3.1 | **Project sharing** | `project.acl: { [uid]: 'viewer' \| 'editor' \| 'admin' }`. Invite by email (lookup via Firebase Auth admin API — needs Cloud Function). Rules updated to check acl on project + cascade to tasks/activities. |
| 3.2 | **@-mentions** | Autocomplete in comments and descriptions from project ACL. Stored as `@uid` tokens, rendered as user pills. |
| 3.3 | **Real-time presence** | Lightweight `presence/{taskId}/{uid}` doc with TTL via Realtime DB (or Firestore with a serverTimestamp + 30s ping). Avatar stack on top of task editor. |

### Tier 3 task list

1. Cloud Function: `inviteToProject(email, role)` — uses Admin SDK to resolve UID, writes to project.acl
2. Project sharing UI: invite by email, role dropdown, revoke
3. Firestore rules: acl-aware reads/writes for projects, tasks, activities
4. Schema migration: existing projects get `acl: { [owner uid]: 'admin' }`
5. @-mention autocomplete in comment + description editors
6. Mention rendering as pills with avatars
7. Presence: pinger every 20s, listener for active tasks
8. Avatar stack UI in TaskEditor
9. Tests / smoke + ship

---

## Tier 4 — Analytics & automation

| # | Feature | Approach |
|---|---|---|
| 4.1 | **Burndown / velocity / cumulative-flow charts** | New "Analytics" view. Daily snapshots of task counts by status (or compute from `updatedAt` timestamps). SVG charts (no library). |
| 4.2 | **Workload view** | Stacked bars per week showing planned hours per project. Allows over-allocation detection. Uses task.plan dates + estimated hours. |
| 4.3 | **Webhooks / Zapier** | `webhooks/{id}` collection: `{ url, secret, events: [...] }`. Cloud Function listens to Firestore changes and POSTs. |
| 4.4 | **Custom fields per project** | `project.customFields: [{ id, name, type, options? }]`. Stored on tasks as `task.customValues: { [fieldId]: value }`. UI in TaskEditor renders per project. |

### Tier 4 task list

1. Analytics view + sidebar entry
2. Burndown chart (SVG): tasks open over time within a project / sprint window
3. Velocity chart: tasks completed per week
4. Cumulative flow: stacked area chart of status mix over time
5. Workload calculator + week-stacked bar chart
6. `webhooks` collection + UI in Settings
7. Cloud Function: Firestore trigger → HTTP POST
8. `customFields` schema + project-level editor
9. Custom-field render in TaskEditor (text / number / select / date)
10. Custom-field column in Table view (configurable)
11. Tests / smoke + ship

---

## Out-of-tier work (already shipped or pending one-offs)

- ✅ Anthropic API key in Settings + AI task generator from project description (v6.1)
- ✅ CSV import for activities (v6.1)
- ✅ Hide plan/actual dates on Board cards (v6.1)
- ✅ Gantt: Phase column + Add-task button (v6.1)
- (One-offs that come up during tier work get appended here.)

---

## Notes on AI feature design

The AI task generator (Phase 1) and AI assist (Tier 2) share a service:

- **Key storage:** `localStorage` only. Never sent to Firestore or any other server.
- **Direct browser call:** Uses `anthropic-dangerous-direct-browser-access: true`
  header. Fine for a personal app; if this ever becomes multi-user, proxy
  through Firebase Functions.
- **Prompt patterns:** System prompt enforces a JSON response shape; client
  parses and shows preview UI for accept/edit/reject. This is the dominant
  pattern across the AI features — we don't free-form-render LLM output into
  the data store without a review step.

---

_Last updated: 2026-05-20_
