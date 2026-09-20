# Task status — Task Monitor (v0.1)

Written by Claude Code while it works through the task sheet, generated 2026-09-20 by Ideon.
One line per finished row, appended the moment the row is done. Never edited by hand while a run is going.

Format:  <Task ID> | YES or BLOCKED | estimated AI cost in USD | one-line summary
Example: T-0001 | YES | 0.42 | Added renewal reminders; server/src/routes/reminders.ts; tests added.

Upload this file in Ideon → Tasks → "Sync from Claude Code" to mark the same rows there.
T-0001 | YES | 2.80 | users self-update is now an allowlist (displayName/photoURL/email only) so companyId cannot be self-assigned; firestore.rules, src/services/firebase.js, tests/rules/{harness,users.rules.test}.mjs, package.json (test:rules), firebase.json (emulator); 11 emulator rules tests added. Deploy with npm run deploy:rules.
T-0002 | YES | 2.60 | Invites hardened server-side: create requires project/workspace admin, get-by-id only (no list enumeration), updates limited to appending claims, claim can only set the claimers own ACL slot; presence scoped to workspaceId; getInvite switched to getDoc. firestore.rules, src/services/firebase.js, src/hooks/usePresence.js, src/components/TaskEditor.jsx, tests/rules/{invites,presence}.rules.test.mjs; 15 new emulator tests.
T-0003 | YES | 1.90 | Invite UI now mirrors the rules: sharing panel and invite listener gated on canAdministerProject, non-admins get a plain-language explanation instead of a failing button; all Firestore errors in the sharing panel and invite claim screen run through friendlyError. src/services/access.js (new, pure), src/services/access.test.mjs, src/components/ProjectsView.jsx, src/components/InviteClaimView.jsx, src/hooks/usePresence.js; 7 unit tests added.
T-0004 | YES | 0.55 | Tests and docs for BUG-002: 12 invite + 3 presence emulator tests and 7 access-rule unit tests are in place; README gained a "Security model — who can share a project" table and the npm test / test:rules / test:all commands. README.md, CHANGELOG.md. (No Implementation_plan.md exists in this repo.)
