# Task Monitor — Complete Build & Deploy Guide

End-to-end walkthrough for shipping the personal task monitor: GitHub repo → local build with the starter kit → Firebase connection → Claude Code integration → live deployment on GitHub Pages.

Estimated time first run-through: **2–3 hours**. Subsequent edits: minutes.

---

## Prerequisites Check

Open Terminal on your Mac (Cmd + Space → "Terminal") and run:

```bash
node --version       # need v20+
npm --version
git --version
```

If Node is missing or older than v20:
```bash
brew install node    # if you have Homebrew
# or download from nodejs.org
```

You'll also need:
- A **GitHub account** (free)
- A **Google account** for Firebase (free Spark tier is plenty)
- A **Claude Pro or Max subscription** ($20/mo) — required for Claude Code; the free Claude plan does not include it

---

## Phase 1 — Create the GitHub Repo (5 min)

1. Go to **https://github.com/new**
2. Repository name: `task-monitor`
3. Description: *Personal task monitoring app with Firebase backend*
4. Set to **Private** (your activity log is personal data)
5. **Do NOT** check "Add README" or "Add .gitignore" — Vite will create these
6. Click **Create repository**
7. Leave the page open — you'll need the URL it shows

---

## Phase 2 — Initialize the Local Project (10 min)

In Terminal:

```bash
# Pick a sensible home for your projects
mkdir -p ~/Projects
cd ~/Projects

# Scaffold the React + Vite app
npm create vite@latest task-monitor -- --template react
cd task-monitor

# Install everything
npm install
npm install firebase
npm install -D gh-pages
```

When `npm create vite` asks questions, accept defaults (React, JavaScript).

Quick sanity check:
```bash
npm run dev
```
You should see a default Vite + React page at `http://localhost:5173`. Press **Ctrl + C** to stop it.

---

## Phase 3 — Drop in the Starter Files (10 min)

Create the folder structure inside `task-monitor/src`:

```bash
mkdir -p src/components src/hooks src/services
```

Place the files you got earlier exactly here:

```
task-monitor/
├── src/
│   ├── components/
│   │   ├── TaskForm.jsx
│   │   └── TaskList.jsx
│   ├── hooks/
│   │   └── useTasks.js
│   ├── services/
│   │   └── firebase.js
│   ├── App.jsx
│   └── App.css
```

Append the contents of **App-additions.css** to the bottom of `src/App.css`.

Update `vite.config.js` so GitHub Pages routes correctly:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/task-monitor/',
});
```

Update `package.json` — add two scripts under `"scripts"`:

```json
"predeploy": "npm run build",
"deploy": "gh-pages -d dist"
```

---

## Phase 4 — Create the Firebase Project (15 min)

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → name it `task-monitor` → disable Google Analytics (not needed) → **Create**
3. Once created, click the **Web icon** `</>` to register a web app
   - App nickname: `task-monitor-web`
   - **Do not** check "Firebase Hosting"
   - Click **Register app**
4. Firebase shows a `firebaseConfig` object — **keep this tab open**, you'll copy values next
5. From the left sidebar:
   - **Build → Firestore Database** → **Create database** → start in **test mode** → choose region **asia-southeast1** (closest to Manila)
   - **Build → Authentication** → **Get started** → **Sign-in method** tab → **Anonymous** → **Enable** → **Save**

---

## Phase 5 — Connect Firebase to the App (5 min)

Create `.env` at the project root (same level as `package.json`):

```env
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=task-monitor-xxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=task-monitor-xxx
VITE_FIREBASE_STORAGE_BUCKET=task-monitor-xxx.appspot.com
VITE_FIREBASE_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

Copy each value from the Firebase config tab. **Watch the prefix** — every variable must start with `VITE_` or Vite won't expose it to the app.

Add `.env` to `.gitignore` so it never reaches GitHub:

```bash
echo ".env" >> .gitignore
```

> **Note:** Firebase API keys are technically not secret (they're embedded in every web app's JS bundle anyway). Security comes from your Firestore rules, not key obscurity. But keeping `.env` out of Git is still good hygiene.

---

## Phase 6 — Run It Locally (10 min)

```bash
npm run dev
```

Open `http://localhost:5173/task-monitor/` (note the `/task-monitor/` path because of the Vite `base` setting).

Test the full flow:
1. Add a task with plan dates (e.g., "Test task" / BRIDGED / next Friday)
2. Click **Move** to send it to *In Progress* — check that `actual.startDate` auto-fills
3. Click **➕ Log** to add an activity — comment, hours, optional Drive/Dropbox link → Save
4. Click **History** to see the entry appear
5. Click **Move** again to mark *Done* — `actual.endDate` should fill
6. Open the **Firebase Console → Firestore Database** in a browser tab and watch documents appear in `tasks` and `activities` in real time

**If you hit a Firestore index error in the browser console**, it'll include a one-click link to create the missing composite index. Click it, wait ~1 minute, refresh.

---

## Phase 7 — Lock Down Firestore (10 min)

In Firebase Console: **Firestore Database → Rules** tab. Replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isOwner(resource) {
      return request.auth != null
          && request.auth.uid == resource.data.userId;
    }
    function isCreatingOwn() {
      return request.auth != null
          && request.auth.uid == request.resource.data.userId;
    }

    match /tasks/{taskId} {
      allow read:   if isOwner(resource);
      allow create: if isCreatingOwn();
      allow update, delete: if isOwner(resource);
    }
    match /activities/{activityId} {
      allow read:   if isOwner(resource);
      allow create: if isCreatingOwn();
      allow update, delete: if isOwner(resource);
    }
    match /categories/{categoryId} {
      allow read:   if isOwner(resource);
      allow create: if isCreatingOwn();
      allow update, delete: if isOwner(resource);
    }
  }
}
```

Click **Publish**. Refresh your local app — it should still work because anonymous auth provides a `userId`.

---

## Phase 8 — First Commit & Push to GitHub (5 min)

Vite's scaffold already initialized Git. From the project root:

```bash
git add .
git status            # quick sanity check — confirm .env is NOT listed
git commit -m "Initial commit: task monitor with Firebase + activity log"

# Connect to your GitHub repo (use the URL from Phase 1)
git branch -M main
git remote add origin https://github.com/<your-username>/task-monitor.git
git push -u origin main
```

Refresh your GitHub repo page — all the files should now be visible.

---

## Phase 9 — Install Claude Code (10 min)

In Terminal:

```bash
curl -fsSL https://claude.ai/install.sh | sh
```

This is Anthropic's native installer — auto-updates, no Node version juggling. Once it finishes, **close Terminal and open a new window** so your PATH refreshes.

Verify:
```bash
claude --version
```

Authenticate (one-time):
```bash
claude
```
Your browser opens to log in with your Claude Pro/Max account. After approval, return to Terminal — you'll see the Claude Code welcome prompt.

Type `/exit` to leave for now.

---

## Phase 10 — Bootstrap Claude Code in This Project (10 min)

```bash
cd ~/Projects/task-monitor
claude
```

Claude Code opens an interactive session **scoped to this folder**. It can read, edit, run commands — with confirmation prompts by default.

First, generate a project memory file:

```
/init
```

This creates `CLAUDE.md` at the project root — a file Claude Code reads every session to understand your codebase. It's the single most impactful configuration step.

After `/init` finishes, **edit `CLAUDE.md`** and add this section at the top so Claude Code has the right context:

```markdown
# Task Monitor — Project Context

A personal task monitoring web app for Ace, who runs three parallel tracks:
BRIDGED (fintech), AIM (teaching), and Personal. Deployed via GitHub Pages
with a Firebase Firestore backend.

## Architecture
- React 18 + Vite frontend
- Firestore for persistence; anonymous auth for userId scoping
- Two root collections: `tasks` and `activities`
- Activities are a flat collection (not subcollection) — see firestore-schema.md
- Counters on tasks (activityCount, totalHoursLogged) are kept in sync via
  batched writes with FieldValue.increment()

## Conventions
- Dates stored as YYYY-MM-DD strings in user's local timezone (Asia/Manila)
- Timestamps (createdAt, loggedAt) use serverTimestamp()
- Soft delete via `deleted: false`; archive via `archived: false`
- userId on every document — keeps security rules trivial

## When making changes
- Preserve denormalized fields (taskTitle, taskCategory on activities)
- Any new counter must be updated atomically in the same batch as the write
- Composite indexes go in firestore.indexes.json eventually — for now, follow
  the Firestore console prompts on first query
- Keep mobile responsiveness — the board collapses to single column under 720px

## Out of scope
- Multi-user teams (schema supports it, UI doesn't)
- Email/Google sign-in (anonymous auth only for now)
- Server-side rendering
```

Commit this:
```bash
git add CLAUDE.md
git commit -m "Add CLAUDE.md project memory"
git push
```

---

## Phase 11 — Build with Claude Code (ongoing)

Now you can ask Claude Code in plain English. A few starter prompts that work well with this codebase:

**Update TaskForm to capture plan dates**
> "Update src/components/TaskForm.jsx to accept plan.startDate and plan.endDate from date inputs, and pass them when calling addTask. Use the same styling pattern as the existing fields."

**Add a daily journal view**
> "Create src/components/DailyJournal.jsx that uses the useRecentActivities hook to show the last 7 days of activity grouped by day, with total hours per day and a per-category breakdown. Add it as a new tab in App.jsx alongside the task board."

**Add task editing**
> "Add an Edit button to each TaskCard in TaskList.jsx that opens a modal similar to ActivityLogger, allowing title, description, category, priority, and plan dates to be edited. Use updateTask from firebase.js."

**Add a weekly review**
> "Build a /review route using react-router-dom that shows: total hours this week vs last, completion rate, list of overdue tasks, and finished-late vs finished-early counts. Install react-router-dom and wire it up in main.jsx."

**Best practices when prompting Claude Code:**
- Reference exact filenames so it doesn't guess
- Mention which existing function/pattern to follow
- For larger changes, ask it to **plan first**, then implement: *"First describe the plan in 5 bullets, wait for me to confirm, then implement"*
- Review the diff before approving — Claude Code shows changes before writing
- Press **Esc** to interrupt if it's heading the wrong direction
- Use `/compact` after long sessions to keep context tight
- Use `/clear` to start fresh between unrelated tasks

After Claude Code makes changes, **always test locally before pushing**:
```bash
npm run dev
# Verify the change works
# Then:
git add .
git commit -m "Add daily journal view"
git push
```

---

## Phase 12 — Deploy to GitHub Pages (10 min, one-time)

```bash
npm run deploy
```

This builds the app and pushes the output to a `gh-pages` branch on your repo.

Then enable Pages:
1. Go to your GitHub repo → **Settings** → **Pages** (left sidebar)
2. Source: **Deploy from a branch**
3. Branch: **gh-pages** / folder: **/ (root)** → **Save**
4. Wait 1–2 minutes; your app goes live at:
   `https://<your-username>.github.io/task-monitor/`

**Important final Firebase step:** authorize the GitHub Pages domain.

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain**
3. Enter: `<your-username>.github.io`
4. Save

Without this step, anonymous auth fails on the live site and you'll see no data.

---

## Daily Workflow (Once Everything Is Running)

```bash
# Start work
cd ~/Projects/task-monitor
claude                    # opens Claude Code in this project

# In another terminal tab:
npm run dev               # live local preview

# Ask Claude to make changes, review diffs, save
# Test in the browser at http://localhost:5173/task-monitor/

# When happy:
git add .
git commit -m "Describe the change"
git push
npm run deploy            # redeploy to live site
```

That's the loop. Edit, test, commit, deploy.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank page on `localhost:5173` | Missing `/task-monitor/` in URL | Open `http://localhost:5173/task-monitor/` |
| `signInAnonymously` error in console | Anonymous auth not enabled | Firebase → Auth → Sign-in method → Enable Anonymous |
| Permission denied reading tasks | Security rules block or userId mismatch | Check Firestore rules tab; confirm `userId` is being written |
| Console error with index creation link | Composite index missing | Click the link Firebase provides — auto-creates the index |
| Live site loads but shows no tasks | Authorized domains not set | Firebase → Auth → Settings → Authorized domains → add `<user>.github.io` |
| `command not found: claude` | PATH not refreshed | Close Terminal, open a new one; or `source ~/.zshrc` |
| `gh-pages` deploys but page is 404 | Pages source not set | GitHub → Settings → Pages → set branch to `gh-pages` |
| Data on phone differs from laptop | Anonymous auth = different uid per browser | Expected; upgrade to Google sign-in when ready |

---

## What to Build Next (Suggestions)

Once the base is solid, these are natural additions Claude Code can scaffold:

1. **Plan vs Actual variance dashboard** — chart of completion rate over weeks
2. **Category time allocation pie** — where your hours actually go
3. **Recurring tasks** — for your Sunday standing with Mark, Wednesday class prep
4. **Quick capture from iOS** — a simple Shortcuts integration that POSTs to Firestore
5. **Export to Excel** — for monthly review or sharing with Mark
6. **Tags layer** — cross-cutting beyond category (e.g., "client-facing", "deep-work")
7. **Google sign-in upgrade** — so phone and laptop share the same data

For any of these, copy the prompt patterns from Phase 11 and let Claude Code handle the implementation.

---

## Safety Net

Everything important is recoverable:

- **Code:** lives on GitHub, every commit is permanent
- **Data:** lives in Firestore, has automatic backups on paid tiers; for free tier, run a manual export monthly via `gcloud firestore export`
- **Local file mistakes:** `git stash` or `git checkout .` reverts uncommitted changes; `git reset --hard HEAD~1` undoes the last commit
- **Claude Code mistakes:** review every diff before accepting; if something slipped through, `git diff` shows it and `git checkout <file>` reverts

Keep work on a branch for anything risky:
```bash
git checkout -b try-something-new
# experiment with Claude Code
# if good:    git checkout main && git merge try-something-new
# if not:     git checkout main && git branch -D try-something-new
```

---

You're set. The first time through is slow; from the second project on, this same pattern (repo → Vite → Firebase → Claude Code → Pages) takes under an hour.
