# Task Monitor

A project-management suite for small teams: Kanban board, table, Gantt, calendar,
WBS, goals, meeting minutes, weekly review, and an AI assistant that answers from
your own live data.

Static React frontend, Firebase Firestore behind it, no server of our own.

---

## Run it locally

You need **Node 20+** and a Firebase project.

```bash
npm install     # one install
npm start       # one run — the app AND the local AI bridge
```

`npm start` runs both and prefixes their output (`[web]` / `[ai]`); Ctrl-C stops
both. The bridge is optional — if it fails to start, the app keeps working
without AI. `npm start -- --no-ai` skips it; `npm run dev` runs only the app.

### Firebase config

The app talks to your own Firebase project. Copy the template and fill in the
six values from **Firebase console → Project settings → Your apps → SDK setup**:

```bash
cp .env.example .env
```

```
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=…
VITE_FIREBASE_PROJECT_ID=…
VITE_FIREBASE_STORAGE_BUCKET=…
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_FIREBASE_APP_ID=…
```

Then, once per project:

1. **Authentication → Sign-in method → Google** — enable it.
2. **Firestore Database** — create one (production mode).
3. **Storage** — create a bucket (only needed for file attachments).
4. `npm run deploy:rules` — push `firestore.rules` and `storage.rules`.

If `.env` is missing — or still holds the example values — the app shows a setup
page naming exactly which variables it could not find, instead of a blank page.

Start the app and sign in with Google. The first account whose email is in
`SUPERADMIN_EMAILS` (`src/services/firebase.js`, mirrored in `firestore.rules`)
is approved automatically and can approve everyone else from
**Settings → User management**. Everyone else waits on the approval screen —
that gate is enforced in the security rules, not just on screen.


## What's in it

| Page | What it does |
| --- | --- |
| Dashboard | Today's work, what's overdue, what moved |
| Board | Kanban with drag-and-drop, swim-lanes by phase, tag filters, quick-add |
| Task table | Every task as a report: pick the columns, group, sort, save the arrangement |
| Activity Log | Every logged entry, sortable, with bulk actions and export |
| Gantt | Timeline with draggable plan bars and dependency arrows |
| Calendar | Month grid; drag a task to another day to reschedule it |
| WBS | Work breakdown by project → phase → task → subtask |
| Goals | Objectives with progress rolled up from their tasks |
| Minutes | Meeting minutes with attendees, decisions and action items |
| Review | KPIs, hours by project, overdue / completed / blocked lists |
| Analytics | Trends over time |
| Ask AI | Ask a question about your own data and get a computed answer |
| Projects | Projects, phases, custom fields, sharing, templates |
| Settings | Preferences, workspaces, members, companies, AI, knowledge base, export |

**Adding people.** A workspace admin invites by **email address** — no Firebase
UID ever changes hands. The invitation waits on the workspace; the person joins
automatically the next time they sign in with that address, at exactly the role
offered. No email is sent (there is no backend to send one), so tell them it is
waiting.

**Workspaces** are the top-level container. Everything — projects, tasks,
activities, templates, minutes, goals — belongs to exactly one workspace, and
members of a workspace share its contents. Roles are owner / admin / editor /
viewer, enforced in `firestore.rules`.

## Tech

- **React 19 + Vite**, plain CSS (no Tailwind, no UI library)
- **Firebase Firestore + Auth (Google)** — the only backend
- **Firebase Hosting** — <https://tasks.blueinnovation.ph>
- **`@dnd-kit`** for drag-and-drop; routing is the URL hash, no router library

## Deploy

```bash
npm run build         # produces dist/
npm run deploy        # dist/ → Firebase Hosting
npm run deploy:rules  # firestore.rules + storage.rules
npm run deploy:indexes # firestore.indexes.json (composite indexes)
npm run deploy:all    # both
```

Log in first with `firebase login`. By default the deploy uses whichever
account the CLI is logged in as; set `FIREBASE_ACCOUNT` to pick a specific one:

```bash
FIREBASE_ACCOUNT=you@example.com npm run deploy
```

The running version is shown in **Settings → About** and in the sidebar footer —
quote it in a bug report. It comes from `package.json` at build time, so it
cannot drift from what was shipped.

## AI brain — the Claude Code CLI

Every AI feature in the app (task drafts, subtask suggestions, weekly summaries,
Ask AI, the prompt writer) runs through one provider layer with three brains,
picked automatically in this order:

| Provider | What it is | Cost |
| --- | --- | --- |
| `claude-code` | The local **Claude Code CLI**, reached through the bridge | **$0** — your Pro/Max subscription |
| `bridge-api` | The bridge, running on an `ANTHROPIC_API_KEY` rather than the CLI | Per token |
| `proxy` | The **aiProxy Cloud Function**, holding the company's key server-side | Per token, billed to the company |
| `api` | Anthropic Messages API with a superadmin's own device key | Per token |
| `mock` | Canned offline text, always labelled as placeholder | $0 |

**The company key never reaches a browser.** It lives in
`companies/{id}/secrets/anthropic`, which only a superadmin can read. A member's
AI request goes to the `aiProxy` function, which checks that they are approved,
in a company, and that the company has AI switched on — then calls Anthropic and
writes a usage record the member cannot forge. Deploy it with:

```bash
npm run deploy:functions   # needs the Firebase Blaze plan (outbound network)
```

The app is a static frontend, so the browser can't spawn the CLI itself. A tiny
zero-dependency Node bridge does it instead, on your own machine:

```bash
npm i -g @anthropic-ai/claude-code
claude          # log in once with a Pro/Max account, then exit
npm run bridge  # starts the AI bridge on http://127.0.0.1:4319
npm run dev     # the app finds the bridge automatically
```

`Settings → AI brain` shows which brain is live, lets you pin a provider or CLI
model, and has a **Re-check AI** button — logging into the CLI while the app is
open is picked up within 60s or instantly on Re-check.

**Notes**

- No `ANTHROPIC_API_KEY` is needed for `claude-code`. A key is only used as a
  fallback, and every fallback is reported as **degraded** with the reason, so a
  failed CLI never passes as a clean success.
- The CLI is invoked hermetically (`--safe-mode --strict-mcp-config --tools ""`),
  so it acts as a one-shot LLM instead of booting as a coding agent that loads
  your `CLAUDE.md`, skills, plugins, hooks and MCP servers. That is the
  difference between ~280 and ~99,000 input tokens for a one-line question.
- The bridge binds to `127.0.0.1` and answers a fixed origin allowlist, so a
  random site you visit cannot spend your subscription. Add origins with
  `TM_BRIDGE_ORIGINS="https://your.app" npm run bridge`.
- On the deployed site the bridge is not probed by default (a page on `https://`
  can usually only reach `127.0.0.1` in Chromium). Set `Bridge: Always` in
  Settings → AI brain to try anyway.
- The CLI must be on `PATH` for the process running the bridge. If a GUI launcher
  gives it a trimmed `PATH`, set an explicit `cliPath` in
  `~/.task-monitor/bridge-config.json`.
- `npm test` runs the bridge's unit tests (`node --test`, no dependencies — the
  CLI is never spawned).

### Bridge security

The bridge runs a program on your machine, so two things are locked down:

- **It chooses its own executable.** `cliPath` can only be set from the
  environment (`TM_BRIDGE_CLI_PATH`) or by editing
  `~/.task-monitor/bridge-config.json` by hand. The HTTP endpoint ignores it —
  otherwise any page on an allow-listed origin could point the bridge at an
  arbitrary local binary.
- **Changing its settings needs an admin code.** The bridge prints one on
  startup and saves it to `~/.task-monitor/bridge-token`. Paste it into
  Settings → AI brain. Asking questions, reading status and "Re-check AI" never
  need it — only changes to the bridge's own configuration do.

The model name is also argv, so it is picked from a fixed list rather than
typed (`ALLOWED_CLI_MODELS` in `bridge/ai.mjs`).

## Getting work out of the app

Anywhere there is something worth keeping, there is an **Export ▾** button:

| Page | What comes out | Formats |
| --- | --- | --- |
| Review | A status report: hours by project, completed, overdue, blockers raised | .docx .pdf .md .html .txt |
| Board / Gantt | The task list you are looking at, filters applied | .xlsx .csv .pdf |
| Task table | Exactly the table you built — your columns, your grouping | .xlsx .csv .pdf |
| Minutes | Attendees, notes, decisions, the action table | .docx .pdf .md .html .txt |
| Goals | Initiatives, KPIs, change agenda, deliverables with progress | .pdf .docx .md .html |
| Activity Log | Every logged entry | .csv |
| Settings → Your data | Everything, for a backup | .json |

Every filename is `<name>-YYYY-MM-DD.<ext>` in your own timezone. The Excel and
PDF libraries load only when you actually export something.

**Custom fields travel with the task.** A project can define fields of its own
(Client, Contract value, Go-live) in the project editor. The values show as
chips on the board card, can be added as columns in **Reports → Task table**
— sorted, grouped (for a select field) and saved in a view — and are appended
as columns to every task export. Two projects with a field of the same name are
labelled with the project so they can be told apart.

## Recurring tasks

A recurring task used to appear only when the previous one was ticked off, so a
weekly ritual nobody completed died at the first missed week. Now both happen:

- **Ticking one off** still creates the next, immediately.
- **The schedule runs anyway.** The app checks on load and hourly, and creates
  any occurrence that has become due. A weekly task last scheduled for the 14th
  gets its 21st instance on the 21st, whether or not the 14th was ever finished.

It is bounded on purpose: an occurrence appears **on the day it is due**, never
early; nothing older than 30 days is created, so returning to a dormant series
does not produce a year of overdue copies; and at most 8 per series per run, so
catching up is gradual. Creating one is idempotent — keyed on the series and the
due date — so two devices running it at the same moment, or the same device
twice, produce the same result.

The check runs in the app rather than on a cloud schedule, which keeps this a
static front end. The honest limit: a workspace nobody opens for a month catches
up the next time somebody opens it, not before.

## Sharing a project with a client

**Project editor → Share with a client** publishes a read-only page anyone can
open without an account: the tasks, where each one stands and when each is due,
as a **board** or a **timeline**.

- **It is a snapshot, not a window.** The link holds the rows it shows. Nothing
  in the database opens up, so a leaked link leaks one project's headline state
  and never grows into more. It shows the project as it was when you published
  or last **Refresh**ed it.
- **What it never shows:** comments, attachments, hours, custom fields, tags,
  who is working on what, or anything from another project.
- **It can be switched off**, and it expires (7/30/90 days, or not at all —
  your choice at publish time). Revoked or expired, the link stops working —
  `firestore.rules` refuses it, so it is not merely hidden.
- **Publishing is an owner's or admin's decision**, and the app tells you
  exactly what you are handing out before the link exists.
- **The only person named** on the page is whoever shared it ("Shared by …"),
  so the recipient knows where it came from. Nobody else on the project is
  named at all.

`sharedViews` is the one world-readable collection in the app: readable only by
its exact token (never listable), and only while it is live. Deploy the rules
with `npm run deploy:rules` before the first link will open.

## Workload

**Board → Workload** is the next six weeks: people down the side, weeks across
the top, every cell holding what that person is carrying and how full it makes
them — *nothing planned · room to spare · a full week · more than a full week*,
with the key printed so the colours stand alone.

Drag a task to **another week** to move its deadline (the weekday is kept, and a
task that runs over several days keeps its length), or to **another person** to
hand it over — they get a notice. A drop where the task already was writes
nothing. Tasks with no due date cannot be placed, so they are listed underneath
rather than quietly left out.

A task counts as four hours unless it carries an estimate, less whatever has
already been logged against it; a week is assumed to be forty.

## Inbox and @mentions

Type **@** in a comment and a picker offers the people in the workspace by name;
the name it inserts is one that resolves back to the person you chose, even when
two of them are called Mia. Posting tells them:

| What happened | Who hears about it |
| --- | --- |
| You named somebody with an @ | That person — “Ace mentioned you on “Disbursement report”: …” |
| You commented without naming anybody | The task's creator and whoever it is assigned to |
| You put somebody on a task | That person — “Ace assigned you “Board pack for Friday”” |
| An automation was told to tell somebody | That person |

They land in the **📥 inbox** in the topbar, with a count of what is unread.
Opening a row goes to the task and marks it read; *Mark all as read* clears the
rest. You never hear about your own message, and somebody both mentioned and
watching is told once.

Nothing is emailed — there is no SMTP here (see *Out of scope*).

## Automations

**Settings → Automations** makes the app do something itself when something
happens. A rule is three plain-language choices — nothing is typed but a name:

| | |
| --- | --- |
| **When this happens** | a task is created · completed · becomes overdue · is assigned · is changed · work is logged on it |
| **Only when** | any number of conditions, all of which must hold — project, priority, status, tag, assigned to, task name |
| **Then** | tell someone · assign it · set its priority · move it to a phase · add a tag · create a follow-up task · send it to a webhook |

Every id is shown as the name you know it by — a project, a person, a phase, a
connection — and the rule is read back to you as one sentence *before* you save
it: “When a task is completed and its project is “SBLAF rollout”, create a
follow-up task (Write the handover note).” A rule that is not finished cannot be
saved; the form says what is missing instead.

- **Admins write them, everybody can see them.** Rules act on the whole
  workspace, so authoring is owner/admin only — but no member is surprised by a
  task that changed by itself.
- **What they did.** Every run is logged with the sentence and the outcome, and
  shown under *What they did* — the last 50, kept for 30 days.
- **Notices.** “Tell someone” raises an in-app notice for that person, shown at
  the top of the same panel. Nothing is emailed: there is no SMTP here.
- **No runaway rules.** A rule that would set off its own trigger is refused
  before it writes, and every write a rule makes is marked so it cannot start
  another round.

Rules run in `functions/automations.js`; deploy it with
`npm run deploy:functions` (Blaze plan). Until it is deployed, rules can be
written and read but nothing runs them.

## Webhooks

**Settings → Webhooks** posts a small JSON body to a URL you choose when
something happens — a task is created, completed, deleted, or work is logged.

- **Signed.** If you set a secret, every request carries
  `x-taskmonitor-signature: sha256=<hex>` — an HMAC-SHA256 over the exact body.
  Compute the same thing on your side and compare; if it matches, the request
  came from your workspace and was not altered.
- **Retried.** A timeout, a 429 or a 5xx is retried twice (after 30 s and
  5 min). A 4xx is not — that means the request was wrong, not the moment.
- **Logged.** Every attempt lands in **Delivery history** with what came back.
- **https only**, and never to loopback or a private network address.

Delivery runs in `functions/webhooks.js`; deploy it with
`npm run deploy:functions` (Blaze plan).

## Knowledge base — NotebookLM (optional)

By default the AI answers from the model's general knowledge. Point it at your
own Google **NotebookLM** notebooks and it answers from *your* documents
instead — policies, specs, meeting notes, contracts — with citations.

Two surfaces use it:

- **Ask AI → "My notebook"** — ask your sources directly and get a cited answer.
- **Grounding** — NotebookLM retrieves the relevant material first, then Claude
  reasons over it together with your live task data. Toggle it per workspace or
  per project (`Settings → Knowledge base`, and the picker in each editor).

### Operator setup

Only an approved superadmin sees any of this. Everyone else's Settings page just
says whether a knowledge base is connected, and that their admin sets it up.

This runs on the machine that runs the bridge, and it is a **one-time** setup:

```bash
brew install pipx && pipx ensurepath
pipx install "notebooklm-py[browser]"
notebooklm login    # use a DEDICATED Google account (see below)
```

Then create a notebook at [notebooklm.google.com](https://notebooklm.google.com),
add sources to it, and pick it in `Settings → Knowledge base` (or on a
workspace / project). Press **Re-check** — no restart needed.

**Notes**

- **Use a dedicated Google account.** `notebooklm login` drives a real browser
  session and stores its cookies on disk; that session can read every notebook
  the account can see. Don't point it at a personal or an admin account.
- Optional isolation: create `~/.notebooklm-sandbox` and the bridge sets
  `NOTEBOOKLM_HOME` to it automatically, keeping CLI state out of `~/.notebooklm`.
  An explicit `NOTEBOOKLM_HOME` in the environment always wins.
- **The whole feature is optional.** With the CLI absent the app installs,
  starts, builds and passes its tests exactly as before — Settings shows the
  install commands instead of a notebook list, and nothing else changes.
- `bridge/notebooklm.mjs` is the only place in the repo that spawns
  `notebooklm`, exactly as `bridge/ai.mjs` is the only place that spawns
  `claude`. It never passes `ask --new`, which would **delete** a notebook's
  server-side conversation.
- Asks are logged locally in `~/.task-monitor/knowledge-asks.json` (capped at
  500) so `Settings → Knowledge base → Usage` can answer "what depends on this
  notebook, and how often is it asked" — NotebookLM keeps no history of its own.
  Nothing beyond the question itself is sent to Google.
- `TM_NOTEBOOKLM_BIN=none npm run bridge` forces the not-installed path, which
  is how to check the degraded states look right.

## Security model — who can share a project

Access is enforced in `firestore.rules`, not in the UI. The UI only hides
controls a person would be refused anyway (`src/services/access.js` mirrors the
rules so the two stay in step).

| Action | Who |
| --- | --- |
| Create an invite link for a project | Project admins, the project's creator, and workspace owners/admins |
| List a project's invite links | The same people (invite ids are the secret in the link) |
| Open an invite by its exact link | Anyone signed in — the link *is* the credential |
| Accept an invite | Anyone with the link; the claim can only set the claimer's own role, to exactly the role the invite names |
| Invite someone to a workspace | Workspace owners and admins, by email address |
| Join a workspace you were invited to | The holder of that email address, at exactly the role offered, once — the invitation is consumed |
| Read presence (who else is on a task) | Members of that task's workspace |
| Set your own `companyId` | Nobody — superadmins assign companies |
| Open, replace or delete an attachment | Any member of the workspace the file belongs to |

**Attachments belong to the workspace, not to the uploader.** A file goes to
`workspaces/{workspaceId}/{taskId}/…` in Storage and `storage.rules` decides
access by reading that workspace document — so an admin cleaning up somebody
else's activity removes the bytes as well as the record, and a person who has
left does not take their files hostage. Deleting an activity (one or in bulk),
and removing an attachment while editing one, delete the stored objects.

Files uploaded before this change are still under `users/{uid}/…`: their
uploader can still open and delete them, nothing new is written there, and the
old download links keep working. Deploy both rule sets together with
`npm run deploy:rules`.

### Tests

```bash
npm test            # fast: pure logic + component tests (no network, no emulator)
npm run test:rules  # Firestore emulator: the security rules
npm run test:all    # both — what to run before a deploy
```

`npm test` needs nothing but Node. `npm run test:rules` needs Java, because the
Firestore and Storage emulators are JARs; it never touches the real project.
Storage rules read the workspace document out of Firestore, so both emulators
run together.

| Suite | Covers |
| --- | --- |
| `bridge/ai.test.mjs` | Hermetic CLI invocation, denied-tool handling, JSON extraction |
| `bridge/settings.test.mjs` | What a web page may change on the bridge, and the admin code |
| `src/services/aiProvider.test.mjs` | Which provider is answering, what it can do, and who pays |
| `src/services/aiProxy.test.mjs` | The browser never holds a company key |
| `functions/src/authorize.test.mjs` | Who the AI proxy lets spend the company budget |
| `functions/src/webhookEvents.test.mjs` | Which webhooks fire, for what, and with what body |
| `functions/src/automations.test.mjs` | What a rule means: conditions, actions, the sentence, the refusals |
| `functions/src/automationFlow.test.mjs` | The acceptance path: task completed → follow-up, and the loop guards |
| `functions/src/signature.test.mjs` | The HMAC a receiver checks |
| `bridge/notebooklm.test.mjs` | NotebookLM CLI payload parsing, timeouts, concurrency |
| `src/services/dueAlerts.test.mjs` | Which task is due for an alert, and in what order |
| `src/services/recurrence.test.mjs` | Recurring-task date maths and the next instance's payload |
| `src/services/csv.test.mjs` | CSV parsing, column matching, and what an import will do |
| `src/services/nlpQuickAdd.test.mjs` | The quick-add parser (priority, tags, dates, @names) |
| `src/services/askAiCore.test.mjs` | Ask AI: digest facts, intent routing, task search, answers |
| `src/services/access.test.mjs` | Who may share a project; plain-language error text |
| `src/services/errorMessages.test.mjs` | What a person is told when a page crashes |
| `src/services/download.test.mjs` | Date-stamped filenames in the user's own timezone |
| `src/services/uploadPaths.test.mjs` | Where an attachment is stored, and which files stop being referenced |
| `src/services/tableViews.test.mjs` | Columns, grouping and sorting for the task table |
| `src/services/customFields.test.mjs` | A project's own fields: labels, values, chips and columns |
| `src/services/mentions.test.mjs` | Who a comment is for, and what their notice says |
| `src/services/workload.test.mjs` | The workload grid, and what dropping a task on a cell means |
| `src/services/shareLinks.test.mjs` | What a share link holds, and exactly what never leaves the workspace |
| `src/services/recurrenceSchedule.test.mjs` | Which occurrences are due, and never creating one twice |
| `src/services/exporters.test.mjs` | The document model → Markdown, HTML, text, sheets |
| `src/services/taskExport.test.mjs` | A task list as a document |
| `src/services/minutesExport.test.mjs` | Minutes as a document |
| `src/services/firestoreQueries.test.mjs` | Queries are bounded server-side and have their indexes |
| `src/services/sharedSubscription.test.mjs` | One Firestore listener per query, however many callers |
| `src/services/knowledgeCopy.test.mjs` | Operator runbook vs. what everyone else is told |
| `src/services/approvalCopy.test.mjs` | What a not-yet-approved account is told |
| `src/services/invites.test.mjs` | Inviting by email: validation, claiming, member labels |
| `tests/ui/exporters.test.mjs` | The real .xlsx, .docx and .pdf bytes are valid files |
| `tests/ui/noNativeDialogs.test.mjs` | No alert/confirm/prompt; every confirm labels its action |
| `tests/ui/dialog.test.mjs` | Focus trap, Escape, focus restore, aria-modal |
| `tests/ui/modalSemantics.test.mjs` | Every modal is a real dialog; every icon button is labelled |
| `tests/ui/attachments.test.mjs` | Uploads go to the workspace; deletes take the bytes with them |
| `tests/ui/customFields.test.mjs` | A custom field reaches the card, the table and the export |
| `tests/ui/inboxApi.test.mjs` | Notices are raised where the message is written, and cannot lose it |
| `tests/ui/inbox.test.mjs` | The topbar inbox, the @ picker, and getting to the task |
| `tests/ui/inboxFlow.test.mjs` | A mentions B → B's inbox shows it → it opens the task |
| `tests/ui/workloadApi.test.mjs` | A move is one write plus the notice the new owner deserves |
| `tests/ui/workload.test.mjs` | The planner grid, the drag, and what a drop writes |
| `tests/ui/workloadFlow.test.mjs` | Overloaded → dragged → assignedTo and plan.endDate updated |
| `tests/ui/shareLinksApi.test.mjs` | One world-readable document, by exact token, and nothing else |
| `tests/ui/shareLinks.test.mjs` | Publishing a link, and the page a client opens |
| `tests/ui/shareFlow.test.mjs` | A link opened signed-out renders read-only — and what it never contains |
| `tests/ui/recurrenceCatchUp.test.mjs` | A weekly task nobody completed still comes round |
| `tests/ui/automations.test.mjs` | The rule editor: dropdowns only, the sentence, what cannot be saved |
| `tests/ui/useModalDialog.test.mjs` | The hook that gives an existing modal those things, and stays quiet while closed |
| `tests/ui/escapeKey.test.mjs` | Escape belongs to whatever is actually on screen, not to a hidden modal |
| `tests/ui/recurrenceOnSave.test.mjs` | Finishing a recurring task means the same thing whichever button you press |
| `src/services/ganttGeometry.test.mjs` | Where a plan bar sits, and what a drag on it writes |
| `tests/ui/ganttMilestone.test.mjs` | A task with only a due date draws, and can be dragged into a range |
| `src/services/taskStatus.test.mjs` | What a status implies about progress and the actual dates |
| `tests/ui/importStatus.test.mjs` | A mapped Status column reaches the task, and no offered field is dropped |
| `tests/ui/quickCreateActivity.test.mjs` | ⌘K → Log an activity actually opens the picker |
| `tests/ui/aiErrorCopy.test.mjs` | An AI failure is one plain sentence; the operator's version is in the console |
| `tests/ui/quickCreateSeed.test.mjs` | What you typed in ⌘K survives the trip to the form |
| `src/services/tagFilter.test.mjs` | A saved view's tag filter, and where an activity's tags come from |
| `tests/ui/tagFilterViews.test.mjs` | Every page the router filters by a tag actually honours it |
| `tests/ui/notificationPermission.test.mjs` | The permission badge updates without polling, and unsubscribes |
| `tests/ui/aiOperatorCopy.test.mjs` | A shell command reaches the operator and nobody else |
| `src/services/activityExport.test.mjs` | The activity log and the WBS as documents, not just CSV |
| `tests/ui/activityExportUi.test.mjs` | The four pages that could only make a CSV, and the real .xlsx bytes |
| `tests/ui/copy.test.mjs` | No screen names a repo file or tells a user to open the console |
| `tests/ui/*.test.mjs` | Components, rendered into a real DOM (jsdom) |
| `tests/rules/*.test.mjs` | firestore.rules and storage.rules, against the emulators |

**Where logic lives.** Anything worth testing is a pure module under
`src/services/`, not a function inside a component or inside `firebase.js`:

- `recurrence.js` — date maths + the next recurrence payload
- `csv.js` — CSV in and out, column matching, import preview
- `askAiCore.js` — the whole Ask AI analysis engine, with no Firebase import
  (`askAi.js` adds only the parts that write or call a model)
- `access.js` — the permission checks that mirror `firestore.rules`
- `download.js` — the one way a file reaches the user
- `preferences.js`, `projects.js`, `dueAlerts.js`, `errorMessages.js`, `nlpQuickAdd.js`

**Every downloadable file is date-stamped** — `<name>-YYYY-MM-DD.<ext>`, in the
user's own timezone, produced by `downloadFile()` in `services/download.js`.
Nothing else in the app may build a filename or set `a.download`; two tests in
`tests/ui/download.test.mjs` enforce that.

Components import from those modules and render the result. A new piece of
logic goes in a service with a test, not in a `.jsx` file.

**Component tests** run the real component in jsdom — see `tests/ui/dom.mjs`
for `mount`, `clickText` and `text`. `tests/ui/jsx-loader.mjs` compiles JSX with
the transform Vite already ships, so there is no second toolchain to configure.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — architecture, data model, conventions and the
  gotchas that bite. Read this before changing anything.
- **[docs/firestore-schema.md](docs/firestore-schema.md)** — the data model and
  why it is shaped that way.
- **[firestore.rules](firestore.rules)** — who can read and write what.
  Deploy with `npm run deploy:rules`; test with `npm run test:rules`.
- **[bridge/](bridge/)** — the local AI bridge: `ai.mjs` (providers),
  `notebooklm.mjs` (knowledge base), `server.mjs` (HTTP).
- **[CHANGELOG.md](CHANGELOG.md)** — what changed, per task.

## Project structure

```
task-monitor/
├── src/
│   ├── components/      one file per view or modal
│   ├── hooks/           Firestore subscriptions as React hooks
│   ├── services/        all logic worth testing (see "Where logic lives")
│   ├── App.jsx          routes on the URL hash
│   └── App.css          the single stylesheet — design tokens + components
├── bridge/              the local AI bridge (Node, zero dependencies)
├── tests/
│   ├── ui/              component tests (jsdom)
│   └── rules/           firestore.rules tests (Firestore emulator)
├── dev/                 standalone harnesses — no sign-in needed
├── firestore.rules      security rules
├── firebase.json        hosting + emulator config
└── .env.example         copy to .env and fill in
```

### Dev harnesses

Pages that render one piece of the UI on its own, with no Firebase and no
sign-in — the fastest way to iterate on a component:

| URL (after `npm run dev`) | Shows |
| --- | --- |
| `/dev/due-alert.html` | The due-task alert dialog (`?ai=0` forces the offline template, `&nb=1` fakes a notebook) |
| `/dev/knowledge.html` | Settings → Knowledge base against the live bridge |
| `/dev/automations.html` | The automation rule editor, with sample projects, people and connections |
| `/dev/inbox.html` | The inbox panel with sample notices, and the @mention picker |
| `/dev/workload.html` | The workload grid and its drag-and-drop, against sample people |
| `/dev/shared.html` | The page a client opens (`?kind=board`, `?kind=dead`) |
| `/dev/recurrence.html` | Move the clock forward and watch a recurring task come round |
| `/dev/error-boundary.html` | The crash-recovery card (`?kind=chunk\|network`, `?scope=app`) |
| `/dev/escape-key.html` | Who hears Escape: the real timer widget beside the five handlers it used to silence |
| `/dev/gantt.html` | Gantt rows with every shape of plan (`?zoom=day\|week\|month`), and what a drag writes |
| `/dev/tag-filter.html` | The tag chip strip and what it filters (`?tag=client`, `?tag=renamed-since`) |

## Working with Claude Code

`CLAUDE.md` is read every session — conventions, data model, and the mistakes
that have already been made once.

```bash
cd task-monitor
claude
```

## License

Personal project — adapt freely.
