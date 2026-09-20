# Changelog

One line per task from the Ideon task sheet.

## 2026-09-20 — audit-and-task-2026-09-20

- T-0001 — Any user can self-assign a company and read its AI key — firestore.rules, src/services/firebase.js, tests/rules/harness.mjs, tests/rules/users.rules.test.mjs, package.json, firebase.json
- T-0002 — Invite links let any signed-in user become project admin (API/data layer) — firestore.rules, src/services/firebase.js, src/hooks/usePresence.js, src/components/TaskEditor.jsx, tests/rules/invites.rules.test.mjs, tests/rules/presence.rules.test.mjs
- T-0003 — Invite links let any signed-in user become project admin (UI) — src/services/access.js, src/services/access.test.mjs, src/components/ProjectsView.jsx, src/components/InviteClaimView.jsx, src/hooks/usePresence.js
- T-0004 — Invite links let any signed-in user become project admin (tests & docs) — README.md, tests/rules/invites.rules.test.mjs, tests/rules/presence.rules.test.mjs, src/services/access.test.mjs
- T-0005 — Approval gate is client-side only; pending users can write data — firestore.rules, src/App.jsx, tests/rules/approval.rules.test.mjs
- T-0006 — Next recurring task is created without workspaceId — src/services/recurrence.js, src/services/recurrence.test.mjs, src/services/firebase.js, src/hooks/useWorkspace.js
- T-0007 — Bridge lets web pages set the executable it spawns — bridge/ai.mjs, bridge/server.mjs, bridge/settings.test.mjs, src/services/ai.js, src/components/SettingsView.jsx, README.md
- T-0008 — No error boundary; render errors blank the app — src/components/ErrorBoundary.jsx, src/services/errorMessages.js, src/services/errorMessages.test.mjs, src/App.jsx, src/main.jsx, src/App.css, dev/error-boundary.html, dev/error-boundary.jsx, tests/ui/*.mjs, package.json
- T-0009 — Tests cover only bridge parsing and due-alert rules (API/data layer) — src/services/csv.js, src/services/csv.test.mjs, src/services/askAiCore.js, src/services/askAiCore.test.mjs, src/services/askAi.js, src/services/nlpQuickAdd.js, src/services/nlpQuickAdd.test.mjs
- T-0010 — Tests cover only bridge parsing and due-alert rules (UI) — src/components/CsvImporter.jsx, src/services/csv.js, src/services/csv.test.mjs, tests/ui/CsvImporter.test.mjs, tests/ui/dom.mjs, tests/ui/jsx-hooks.mjs
- T-0011 — Tests cover only bridge parsing and due-alert rules (tests & docs) — README.md, CLAUDE.md, CHANGELOG.md
