# Changelog

One line per task from the Ideon task sheet.

## 2026-09-20 — audit-and-task-2026-09-20

- T-0001 — Any user can self-assign a company and read its AI key — firestore.rules, src/services/firebase.js, tests/rules/harness.mjs, tests/rules/users.rules.test.mjs, package.json, firebase.json
- T-0002 — Invite links let any signed-in user become project admin (API/data layer) — firestore.rules, src/services/firebase.js, src/hooks/usePresence.js, src/components/TaskEditor.jsx, tests/rules/invites.rules.test.mjs, tests/rules/presence.rules.test.mjs
- T-0003 — Invite links let any signed-in user become project admin (UI) — src/services/access.js, src/services/access.test.mjs, src/components/ProjectsView.jsx, src/components/InviteClaimView.jsx, src/hooks/usePresence.js
- T-0004 — Invite links let any signed-in user become project admin (tests & docs) — README.md, tests/rules/invites.rules.test.mjs, tests/rules/presence.rules.test.mjs, src/services/access.test.mjs
- T-0005 — Approval gate is client-side only; pending users can write data — firestore.rules, src/App.jsx, tests/rules/approval.rules.test.mjs
