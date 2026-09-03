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

## Documentation

- **[docs/BUILD-GUIDE.md](docs/BUILD-GUIDE.md)** — Complete 12-phase setup walkthrough from empty GitHub repo to live deployment
- **[docs/firestore-schema.md](docs/firestore-schema.md)** — Database schema with scalability rationale, index list, and security rules
- **[CLAUDE.md](CLAUDE.md)** — Project context for Claude Code sessions
- **[bridge/](bridge/)** — The local AI bridge: `ai.mjs` (provider layer), `server.mjs` (HTTP), `ai.test.mjs`
- **[firestore.rules](firestore.rules)** — Security rules to paste into Firebase Console

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
