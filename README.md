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

## Documentation

- **[docs/BUILD-GUIDE.md](docs/BUILD-GUIDE.md)** — Complete 12-phase setup walkthrough from empty GitHub repo to live deployment
- **[docs/firestore-schema.md](docs/firestore-schema.md)** — Database schema with scalability rationale, index list, and security rules
- **[CLAUDE.md](CLAUDE.md)** — Project context for Claude Code sessions
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
│   │   └── firebase.js         Firestore init + all CRUD + subscriptions
│   ├── App.jsx
│   └── App.css
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
