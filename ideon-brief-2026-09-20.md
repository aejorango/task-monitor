# Ideon → Task Monitor → Brief tab (2026-09-20)

Project: **Task Monitor** · id `f26833fb-d821-4730-a21f-4f87ce74eed3` · folder `/Users/aldenrayejorango/Developer/PROJECTS/task-monitor`

Replaces the quick-create stub brief. Paste field by field, then **Save brief**.

## App type (≤80)

Read by research and audit.

```text
Personal PM suite; kanban+Gantt+time log, local Claude CLI as the AI brain
```

## Benchmarks (≤6 × 40)

One per chip. Read by research.

```text
Linear
Asana
Monday.com
ClickUp
Notion
Motion
```

## Vision (≤600)

Read by research, audit AND the executor — the only long text every stage sees.

```text
A personal project-management suite for one owner and the people invited into a workspace: kanban, Gantt, calendar, per-day activity log with hours, and AI drafting. Constraints that never change: Firestore + static hosting is the whole backend, no server. Every AI call goes through askAI/askAIJson and only bridge/ai.mjs spawns the CLI, hermetically, on 127.0.0.1. Any fallback is returned and shown as degraded with a reason, never as a clean answer. Soft delete only. Dates are YYYY-MM-DD local strings. Per-device preferences never touch shared task docs.
```

## Target users (≤300)

Read by research and audit.

```text
Ace (owner) plus teammates invited to a workspace. Firebase Anonymous or Google auth. Roles enforced per workspace and per project via members[] + acl{}: owner, admin, editor, viewer, with Firestore rules as the enforcement point, not the UI.
```

## Must-have (≤15 × 160)

One per line. The audit judges the code against these.

```text
Kanban board with dnd-kit drag-drop across To Do / In Progress / Done; moves persist to Firestore and sync live to other devices.
Plan vs actual dates on every task, with overdue, done-early and done-late indicators.
Gantt with draggable/resizable plan bars and SVG dependency arrows, grouped by project.
Calendar month grid where dragging a task to another day shifts plan.endDate and keeps the duration.
Per-day activity log with comment, hoursSpent, completion status, bottleneck remarks and attachment URLs.
Task counters (activityCount, totalHoursLogged, attachmentCount, lastActivityAt) stay correct via batched increment writes.
Recurring tasks spawn the next instance on done, dates shifted, subtasks reset, idempotent per recurrenceParentId.
Task and project templates save and re-use a payload with no IDs, dates or counters.
Due-task alerts show one task at a time, respect quiet hours, and keep snooze/skip/mute per-device only.
Every generative feature calls askAI/askAIJson; only bridge/ai.mjs spawns claude, with --safe-mode --strict-mcp-config --tools "".
A denied CLI tool or any provider fallback returns degraded + reason and renders as degraded, never as a clean result.
NotebookLM grounding prepends cited notebook material; a failed lookup still answers, marked degraded.
Workspace isolation: every project, task, activity, template and comment belongs to one workspace, enforced in firestore.rules.
Google sign-in links an anonymous account and keeps its data; sign-out re-signs anonymously so the app stays usable.
npm test (node --test) passes without spawning claude or notebooklm; sidebar collapses under 720px.
```

## Excluded (≤15 × 160)

One per line, reason after the semicolon. Read by research only.

```text
Any server-side backend or SSR; Firestore plus static Firebase Hosting is the entire architecture.
Running the AI bridge on a public host; it binds 127.0.0.1 with an origin allowlist on purpose.
Calling Anthropic or any model directly from a component; askAI/askAIJson is the only door.
Spawning the Claude CLI anywhere but bridge/ai.mjs; hermetic flags and token cost depend on one chokepoint.
Server-side file processing; uploads go straight from the browser to Firebase Storage, and URL attachments stay supported.
Hard-deleting tasks or activities; activities reference tasks by id, so soft delete and archive only.
Storing JS Date objects for date-only fields; YYYY-MM-DD local strings (Asia/Manila) only.
Persisting due-alert snooze, skip or mute on the task document; tasks are shared, those are per-device.
Tailwind or any UI library; plain CSS with --c-/--s-/--r- tokens is what keeps dark mode working.
react-router or a router rewrite; routing is the URL hash (#/view/filter?ws=...).
New Firestore collections without matching rules in firestore.rules.
Any rewrite toward Vite+Express+SQLite; the earlier Ideon brief was wrong, the app is React 19 + Firestore.
Email digests or SMTP; notifications are the service worker plus in-app surfaces.
Gating an AI surface on getEffectiveApiKey(); CLI users have no key, use useAiStatus().
Real-time collaborative text editing; out of scope for v0.x.
```

## Descriptive fields (stored only)

```text
Stack:         React 19 + Vite, Firestore/Auth, local Node AI bridge
AI provider:   claude-code CLI via bridge, API, mock
Auth:          Firebase Anonymous + Google
Existing code: /Users/aldenrayejorango/Developer/PROJECTS/task-monitor
Notes:         (leave empty — no phase reads it)
```
