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
npm run deploy:all    # both
```

Deploys use the Firebase CLI account in `FIREBASE_ACCOUNT` (defaults to the
project owner). Log in first with `firebase login`.

## AI brain — the Claude Code CLI

Every AI feature in the app (task drafts, subtask suggestions, weekly summaries,
Ask AI, the prompt writer) runs through one provider layer with three brains,
picked automatically in this order:

| Provider | What it is | Cost |
| --- | --- | --- |
| `claude-code` | The local **Claude Code CLI**, reached through the bridge | **$0** — your Pro/Max subscription |
| `api` | Anthropic Messages API with the company (or superadmin) key | Per token |
| `mock` | Canned offline text, always labelled as placeholder | $0 |

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
| Read presence (who else is on a task) | Members of that task's workspace |
| Set your own `companyId` | Nobody — superadmins assign companies |

### Tests

```bash
npm test            # fast: pure logic + component tests (no network, no emulator)
npm run test:rules  # Firestore emulator: the security rules
npm run test:all    # both — what to run before a deploy
```

`npm test` needs nothing but Node. `npm run test:rules` needs Java, because the
Firestore emulator is a JAR; it never touches the real project.

| Suite | Covers |
| --- | --- |
| `bridge/ai.test.mjs` | Hermetic CLI invocation, denied-tool handling, JSON extraction |
| `bridge/settings.test.mjs` | What a web page may change on the bridge, and the admin code |
| `src/services/aiProvider.test.mjs` | Which provider is answering, what it can do, and who pays |
| `bridge/notebooklm.test.mjs` | NotebookLM CLI payload parsing, timeouts, concurrency |
| `src/services/dueAlerts.test.mjs` | Which task is due for an alert, and in what order |
| `src/services/recurrence.test.mjs` | Recurring-task date maths and the next instance's payload |
| `src/services/csv.test.mjs` | CSV parsing, column matching, and what an import will do |
| `src/services/nlpQuickAdd.test.mjs` | The quick-add parser (priority, tags, dates, @names) |
| `src/services/askAiCore.test.mjs` | Ask AI: digest facts, intent routing, task search, answers |
| `src/services/access.test.mjs` | Who may share a project; plain-language error text |
| `src/services/errorMessages.test.mjs` | What a person is told when a page crashes |
| `src/services/download.test.mjs` | Date-stamped filenames in the user's own timezone |
| `tests/ui/copy.test.mjs` | No screen names a repo file or tells a user to open the console |
| `tests/ui/*.test.mjs` | Components, rendered into a real DOM (jsdom) |
| `tests/rules/*.test.mjs` | firestore.rules, against the emulator |

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
| `/dev/error-boundary.html` | The crash-recovery card (`?kind=chunk\|network`, `?scope=app`) |

## Working with Claude Code

`CLAUDE.md` is read every session — conventions, data model, and the mistakes
that have already been made once.

```bash
cd task-monitor
claude
```

## License

Personal project — adapt freely.
