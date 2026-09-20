# Task Monitor

A personal task monitoring web app with plan-vs-actual tracking, daily activity logs with attachments, and real-time sync via Firebase Firestore.

Built for a multi-track workflow (BRIDGED / AIM / Personal) but adaptable to any category set.

## Features

- 📋 **Kanban board** with To Do / In Progress / Done columns
- 📅 **Plan vs Actual dates** with overdue, done-early, and done-late indicators
- 📝 **Per-day activity log** with comments, hours, and file attachments
- 🔗 **Attachment links** to Google Drive, Firebase Storage, or any URL
- 📊 **Atomic counters** for activity count and total hours per task
- 🔥 **Real-time sync** across all your devices via Firestore
- 🔒 **Per-user data isolation** via Firebase Anonymous Auth + security rules
- 📱 **Mobile-responsive** — works on phone, tablet, and desktop

## Tech Stack

- **React 18** + **Vite** — fast HMR, clean ES modules
- **Firebase Firestore** — NoSQL real-time database
- **Firebase Anonymous Auth** — zero-friction per-device identity
- **GitHub Pages** — free static hosting
- **Plain CSS** — no Tailwind, no UI library, fully customisable

## Quick Start

Full step-by-step instructions in **[docs/BUILD-GUIDE.md](docs/BUILD-GUIDE.md)**.

TL;DR:

```bash
# 1. Initialize
npm create vite@latest task-monitor -- --template react
cd task-monitor
npm install firebase
npm install -D gh-pages

# 2. Drop in the files from this starter into src/ and root/
# 3. Copy .env.example to .env and fill in your Firebase config
# 4. Run
npm run dev
```

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
| `bridge/notebooklm.test.mjs` | NotebookLM CLI payload parsing, timeouts, concurrency |
| `src/services/dueAlerts.test.mjs` | Which task is due for an alert, and in what order |
| `src/services/recurrence.test.mjs` | Recurring-task date maths and the next instance's payload |
| `src/services/csv.test.mjs` | CSV parsing, column matching, and what an import will do |
| `src/services/nlpQuickAdd.test.mjs` | The quick-add parser (priority, tags, dates, @names) |
| `src/services/askAiCore.test.mjs` | Ask AI: digest facts, intent routing, task search, answers |
| `src/services/access.test.mjs` | Who may share a project; plain-language error text |
| `src/services/errorMessages.test.mjs` | What a person is told when a page crashes |
| `tests/ui/*.test.mjs` | Components, rendered into a real DOM (jsdom) |
| `tests/rules/*.test.mjs` | firestore.rules, against the emulator |

**Where logic lives.** Anything worth testing is a pure module under
`src/services/`, not a function inside a component or inside `firebase.js`:

- `recurrence.js` — date maths + the next recurrence payload
- `csv.js` — CSV in and out, column matching, import preview
- `askAiCore.js` — the whole Ask AI analysis engine, with no Firebase import
  (`askAi.js` adds only the parts that write or call a model)
- `access.js` — the permission checks that mirror `firestore.rules`
- `dueAlerts.js`, `errorMessages.js`, `nlpQuickAdd.js`

Components import from those modules and render the result. A new piece of
logic goes in a service with a test, not in a `.jsx` file.

**Component tests** run the real component in jsdom — see `tests/ui/dom.mjs`
for `mount`, `clickText` and `text`. `tests/ui/jsx-loader.mjs` compiles JSX with
the transform Vite already ships, so there is no second toolchain to configure.

## Documentation

- **[docs/BUILD-GUIDE.md](docs/BUILD-GUIDE.md)** — Complete 12-phase setup walkthrough from empty GitHub repo to live deployment
- **[docs/firestore-schema.md](docs/firestore-schema.md)** — Database schema with scalability rationale, index list, and security rules
- **[CLAUDE.md](CLAUDE.md)** — Project context for Claude Code sessions
- **[bridge/](bridge/)** — The local AI bridge: `ai.mjs` (provider layer), `notebooklm.mjs` (NotebookLM knowledge base), `server.mjs` (HTTP), `*.test.mjs`
- **[firestore.rules](firestore.rules)** — Security rules; deploy with `npm run deploy:rules`
- **[tests/rules/](tests/rules/)** — Firestore emulator tests for those rules (`npm run test:rules`)

## Project Structure

```
task-monitor/
├── src/
│   ├── components/
│   │   ├── TaskForm.jsx        Add new tasks (expandable for plan dates)
│   │   └── TaskList.jsx        Kanban board + activity logger modal
│   ├── hooks/
│   │   └── useTasks.js         useAuth, useTasks, useActivities, useRecentActivities
│   ├── services/
│   │   ├── ai.js               THE AI module — provider detection + askAI/askAIJson
│   │   ├── aiCredentials.js    Which key pays for an API call
│   │   ├── anthropic.js        AI features, all built on services/ai.js
│   │   └── firebase.js         Firestore init + all CRUD + subscriptions
│   ├── App.jsx
│   └── App.css
├── bridge/
│   ├── ai.mjs                  AI provider layer (claude-code / api / mock)
│   ├── server.mjs              Local HTTP bridge on 127.0.0.1:4319
│   └── ai.test.mjs             Unit tests (node --test)
├── docs/
│   ├── BUILD-GUIDE.md          End-to-end setup instructions
│   └── firestore-schema.md     Scalable schema design
├── CLAUDE.md                   Project memory for Claude Code
├── firestore.rules             Security rules (paste into Firebase Console)
├── vite.config.js
├── .env.example                Template — copy to .env and fill in
└── .gitignore
```

## Working with Claude Code

This project is designed to be extended via [Claude Code](https://claude.com/code). The `CLAUDE.md` file documents conventions, data model, and gotchas — Claude Code reads this every session.

```bash
cd task-monitor
claude
```

Then ask in plain English, e.g.:
- *"Add a weekly review page showing hours by category"*
- *"Update TaskList to support editing existing tasks"*
- *"Add a CSV export of all activities for the last 30 days"*

## License

Personal project — adapt freely.
