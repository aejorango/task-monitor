# Task Monitor — Project Context

A personal **project-management suite** for Ace. Originally a task monitor; now
extended with projects + phases, drag-and-drop kanban, table view, Gantt chart,
and a professional Linear-inspired theme.

Deployed via Firebase Hosting with a Firebase Firestore backend.

---

## Porting a design mockup

The Explorer mockups in `~/Downloads/task-monitor 3/*.dc.html` are being
brought into the app page by page. **`docs/PORTING-A-MOCKUP.md` is the
process** — render the mockup first, copy it panel for panel, wire the real
data, delete what it replaced in the same pass, guard it, verify in
`dev/shell.html`. Read it before opening a `.dc.html` file; it exists so the
instructions do not have to be given again for each page.

## Architecture

- **Frontend:** React 19 + Vite + plain CSS (no Tailwind, no UI library)
- **Backend:** Firebase Firestore + Firebase Auth (Anonymous + Google)
- **Hosting:** Firebase Hosting (site `task-monitor-cbaf2`, https://task-monitor-cbaf2.web.app) at `tasks.blueinnovation.ph`. Config in `firebase.json` → `hosting` (SPA rewrite, `sw.js`/`index.html` no-cache, hashed assets immutable). Deploy with the `aejorango888@gmail.com` Firebase CLI account — the other logged-in accounts have no access to the project. GitHub Pages (`npm run deploy:pages`) is legacy; it only serves while the repo is public.
- **Top-level container:** `workspaces` — every project/task/activity/template/comment/webhook belongs to exactly one workspace. Members of a workspace share its contents.
- **AI brain:** all generative features go through `src/services/ai.js`. Default provider is the **Claude Code CLI** on the operator's machine, reached via the local bridge in `bridge/` (`npm run bridge`, `127.0.0.1:4319`); falls back to the Anthropic API key, then to a visibly-degraded mock.
- **Drag-and-drop:** `@dnd-kit/core` + `@dnd-kit/sortable`
- **Routing:** URL hash (`#/<view>/<projectFilter>?ws=<workspaceId>&tag=…&status=…`). No react-router.
- **Counters on each task** (`activityCount`, `totalHoursLogged`, `attachmentCount`, `lastActivityAt`) kept in sync via batched writes with `FieldValue.increment()`

## Data Model

```
workspaces/{workspaceId}:                ← v10 top-level container
  createdByUserId, name, description, color, icon
  members: [uid, ...]                    ← array-contains query
  acl: { [uid]: 'owner'|'admin'|'editor'|'viewer' }
  memberProfiles: { [uid]: { displayName, email, photoURL } }
  pendingInvites:      [{ email, role, invitedBy, invitedAt }]  ← the record
  pendingInviteEmails: [email, ...]      ← flat, so array-contains can find it
  pendingInviteRoles:  { [email]: role } ← flat, so the security rule can check it
  lastClaimedInviteEmail: email          ← side channel for isClaimingWorkspaceInvite
  knowledge: { notebookId, notebookTitle, setAt } | null   ← NotebookLM default
  archived, deleted, createdAt, updatedAt

projects/{projectId}:
  userId, workspaceId, name, description, color
  phases: [{ id, name, order }]
  wipLimits: { todo?, doing?, done? }    ← v15: advisory column limits. A key is
                                           absent when there is no limit; 0 is
                                           never stored (see the pitfall below)
  wipAgeingDays: number | null           ← days in Doing before a card is flagged
  acl: { [uid]: role }                   ← per-project ACL inside the workspace
  members: [uid, ...]
  knowledge: { notebookId, notebookTitle, setAt } | null   ← null = inherit ws
  archived, deleted, createdAt, updatedAt

tasks/{taskId}:
  userId, title, description
  projectId, phaseId               ← PM suite
  category                         ← legacy back-compat
  priority, status, progress       ← status: todo | doing | review | done
  estimateHours                    ← v15: hours it was expected to take.
                                     null = nobody estimated it, which is NOT 0
  requestedBy
  plan: { startDate, endDate }
  actual: { startDate, endDate }
  tags: [string, ...]              ← v4: cross-cutting tags
  subtasks: [{ id, text, done }]   ← v4: checklist
  dependsOn: [taskId, ...]         ← v4: dependencies
  recurrence: { rule, interval, dayOfWeek?, dayOfMonth?, until? }  ← v5
  recurrenceParentId: taskId       ← v5: points to original recurring task
  activityCount, totalHoursLogged, attachmentCount, lastActivityAt
  archived, deleted, createdAt, updatedAt

automations/{ruleId}:                                              ← v13
  userId, workspaceId, name
  trigger                          ← one of TRIGGERS in functions/src/automations.js
  conditions: [{ field, operator, value }, ...]   ← ANDed
  action, actionValue              ← one of ACTIONS; the value is an id or a word
  enabled, deleted, createdAt, updatedAt

automationRuns/{runId}:            ← written by the function, read-only in a browser
  ruleId, ruleName, workspaceId, taskId, taskTitle
  description                      ← the same sentence the editor previews
  outcome: 'done' | 'skipped', message, at, expiresAt

sharedViews/{token}:               ← v14: the ONE world-readable document
  workspaceId, projectId, projectName
  kind: 'board' | 'gantt'
  createdByUserId, createdByName, createdAt, updatedAt
  revoked, expiresAt                 ← rules refuse a dead link, not just the UI
  snapshot: { generatedAt, projectName, phases, tasks: [...], counts }
                                     ← a SNAPSHOT, never a pointer: nothing in
                                       tasks/projects/workspaces opens up

notifications/{noticeId}:          ← the inbox: mentions, comments, assignments,
  userId, workspaceId                  and whatever an automation raised
  kind: 'mention'|'comment'|'assignment'|'automation'
  source: 'person' | 'automation', fromUserId
  text                               ← the whole sentence, built by mentions.js
  taskId, taskTitle, read, at

savedViews/{viewId}:                                               ← v12
  userId, workspaceId, name, icon
  view, projectFilter, tagFilter, statusFilter   ← the filters
  sortBy, sortDir                                ← still read
  columns: [...], groupBy                        ← INERT since T-0152 deleted
                                                   the task table; not written
  deleted, createdAt, updatedAt

templates/{templateId}:                                            ← v5
  userId, name, description
  kind: 'task' | 'project'
  payload: <task or project shape; no IDs, no dates, no counters>
  deleted, createdAt, updatedAt

activities/{activityId}:
  taskId, userId
  taskTitle, taskCategory          ← denormalized snapshots
  projectId, phaseId               ← new
  date, comment, hoursSpent, statusAtTime
  attachments: [{ name, url, type, size }]
  completionStatus                 ← new (not-started|in-progress|blocked|completed)
  bottleneckRemarks                ← new
  requestedBy                      ← new
  loggedAt
```

## Migration: legacy categories → projects

`migrateLegacyCategories(userId)` in firebase.js runs on first sign-in (via the
`useProjects` hook). It seeds three projects (BRIDGED / AIM / Personal) and
links existing tasks to them. **Idempotent** — safe to call repeatedly.

## Navigation: six hubs on an icon rail

The sidebar is a **196px labelled rail of six hubs** — Dashboard · Projects ·
Board · Reports · Messages · Settings — and, inside each page, a **tab strip**
naming the other pages of that hub. The Explorer mockups draw the rail at 64px
with icons only; six unlabelled glyphs is a memory test, so the names stayed
(T-0144). The **«** button collapses it back to the mockups' 64px, remembered
per device in `task-monitor.rail.narrow.v1`; the mobile drawer is always
labelled whatever the desktop is set to. `HUBS` in `services/views.js` says which hub owns which page;
every entry in `VIEW_REGISTRY` belongs to **exactly one**, and
`tests/ui/hubs.test.mjs` fails the build otherwise — a page no hub owns is a page
only ⌘K can reach, which is where Trash and Artifacts were in BUG-029.

**A tab navigates.** Board → Gantt sets the route to `gantt`; it does not
mount a second copy of the Gantt inside the Board. So there is still one
implementation and one URL per page, and a sub-tab can be linked, bookmarked and
saved as a view. The mobile bottom bar is the same six hubs, derived from `HUBS`
rather than listed again, and it lights the hub you are *in* (on Calendar, Board
is lit). At ≤720px the rail becomes the off-canvas drawer, where the icons get
their labels back.

**There is no top bar** (T-0146). Once its contents had moved there was
nothing left in it, so the row went too: the app now starts at the breadcrumb
strip, and `--topbar-h` is `0px` for the handful of `calc(100vh - …)` heights
that budgeted for it. What the bar still had to carry became slots on the
header — `tools` (the running timer, the saved-views menu, Save as view) sits
in the title block left of the page's own commands, and the phone's menu
button moved to the head of the crumb strip. Nothing was merely deleted; a
control taken off the chrome and not re-homed is not simpler, it is a feature
nobody can reach:

| Was in the top bar | Is now |
| --- | --- |
| Workspace switcher | the **rail**, under the wordmark (`.rail-ws`) — the navy skin it was drawn for, so the whole `.topbar .ws-*` override block went with it |
| Project picker | the **middle of the crumb strip** (`.crumbs-mid`, absolutely centred so a long workspace name cannot shunt it) — it decides what every page below is about, which is a breadcrumb's job |
| Tutorials dropdown | **Dashboard → Tutorial** (Settings → Tutorial until T-0158, when the page was rebuilt to the mockup and moved to the hub that draws it). The tour itself is still mounted app-wide by `AppShell` with `showLauncher={false}`, because it navigates between pages and highlights elements on them; the page asks for one by firing `START_TUTORIAL_EVENT`, and reads the same `TUTORIALS` list — which lives in `services/tutorials.js` now, not in the component |
| Inbox bell 📥 | **Messages → Inbox**, the same `InboxPanel` over the same `useInbox` listener. Notices had to keep a home or `mentions.js` would go on writing things nobody could read |
| Due-alert bell | gone; the on/off switch is **Settings → Notifications**, which is why removing it does not strand the feature |
| Search box | gone; **⌘K opens a centred palette** instead. It renders *nothing at all* while closed — a hidden input is still something Tab and a screen reader find — so the shortcut opens first and focuses a frame later |
| "My tasks" chip | gone; `?mine=1` is still a route the palette, a link and the Board toolbar's **Mine** pill all set |
| AI helper popup | gone; AI is the **Ask AI** page |
| Tag chip strip (every page) | gone (T-0148); the **filter** stays — `?tag=` still applies, a saved view still carries it, and each page **names the active tag in its subtitle with a "show all"** beside it. Dropping the strip and the filter both would make one saved view mean two different things |
| Board's "+ Add item" per column | gone (T-0148); **"+ New item"** in the Board toolbar and ⌘K → New task both open the quick-add, which is no longer a strip standing open on every visit |

`AiHelper.jsx`, `InboxBell.jsx` and `DueAlertBell.jsx` are still in the tree
and still tested, but **nothing mounts them**. They are the previous homes of
three of those rows.

**The page chrome** is `components/PageHeader.jsx`, drawn once by `AppShell`:
a navy breadcrumb strip (`Workspaces › workspace › hub › page`), a white title
block, and the tab strip. The **title is the hub's** and the **tab names the
page** — "Reports" over an underlined "Summary", never "Review" over "Summary".
No view writes a title of its own any more; it publishes its count line and its
buttons with `<PageSubtitle>` and `<PageActions>`, which are **portals** into
the header, not a context (a context would hand the shell a fresh object every
render — the `useModalDialog` trap, twice bitten). With no header above them
they render **in place** rather than returning null, so a view mounted in a
harness does not silently lose its Export button.

Commands are flat `.cmd` buttons, at most one `.cmd-primary` per page; a toggle
is `.cmd.is-on`. Numbers across the top of a page are `<Tile>` (from
`DashboardView`) in a `.tiles` grid — the Dashboard, Projects and Reports all
use the same one.

**A task past its plan date is CALLED stuck.** `displayStatus(task,
blockedIds, today)` in `services/boardScope.js` is the one rule: a logged
bottleneck, or open and past its own plan date, reads **Stuck** in red
whatever column the task is sitting in — a board that says "Working on it"
about something twelve days late is taking the task's word for it. It is
deliberately the same predicate as the Stuck pill and the breadcrumb's count,
so the chip, the filter and the number cannot disagree; the corollary is that
a not-yet-started item past its date also reads Stuck, which is the right word
for it. Three surfaces print a status — the Kanban card, the WBS and the
Dashboard's Main board — and all three ask this function. (It was five until
T-0152 deleted the Table and the Item page.)
It changes nothing on the task: this is what to print, not what to write.

**The Board hub's six ported tabs are one CSS system, `.bx-*`** (T-0148).
`.bx-panel` is the card every tab is built from, `.bx-st` is a status —
a **saturated fill with white text**, which is what the mockup prints, not
the soft `-bg` tint that sits behind ink text — and `.bx-prio`, `.bx-flag`,
`.bx-kc*`, `.bx-col*`, `.bx-band*` carry the rest. Every number in it is the
mockup's own, copied from the style objects in its
`<script type="text/x-dc">` block rather than measured off a screenshot;
`tests/ui/boardExplorer.test.mjs` fails the build if one drifts, or if a
class from the design it replaced comes back.

**The project editor leads with a 44px tile and carries a Pace track**
(T-0153, `Projects Explorer.dc.html`). The tile is the project's own colour
with its initial in the display face — it is what makes one project
recognisable in a stack of modals, where a 14px dot read as a bullet. **Pace**
is the mockup's own panel and the one thing the editor could not say before:
the bar is how much of the WORK is done, the notch is how much of the
SCHEDULE has gone, and the gap between them is the point — which is why they
share one track instead of sitting in two tiles. It is drawn only when there
are planned dates; a notch with no schedule behind it is decoration. The four
KPI cards are tinted in their tone rather than white-with-a-coloured-edge,
so the red one is findable at four across — and because they are now a tint,
their text uses the **ink** tokens.

**Text on a soft tint uses an ink token, never the fill colour.** `#c0392b` on
a red tint, `#8a5410` on amber, `#0f5f2a` on green — the mockups' own `T.fg`
values, because the fill is too light to read at 10px. They are
`--c-danger-ink` / `--c-warn-ink` / `--c-success-ink` / `--c-info-ink` /
`--c-purple-ink` / `--c-teal-ink`, separate from the fills so dark mode can
lift them without touching a chart bar. The `-soft` tints themselves finally
have dark values too; before that every chip built on one glowed as a pale
pastel on a dark card.

**A person is a circle.** `components/Avatar.jsx` is the one of them: the
Board Explorer draws the same coloured initial on a kanban card, in the
Table's Owner column, on a Gantt row, beside a WBS task, down the Workload
and against a subitem. The colour is **derived from the account id**, never
stored, so it needs no migration and the same person is the same circle on
every device. A "👤 Diana" pill is not the same thing: the mockup's card has
room for four facts and a pill spends the row on one of them.

**The chrome carries two more things from the mockups.** The breadcrumb's
right-hand end is the red **"N stuck"** count and the connection as one mono
word — `live` / `offline` — not the sentence "Sync healthy". And the tab strip
ends in a **Find item** box: it writes `?q=` and every Board page already runs
its list through `scopeTasks`, so one input narrows every tab at once. It
commits on a pause rather than per keystroke, or the back button would walk
back through every letter.

**The Board hub is five tabs and one toolbar.** Calendar · Gantt · Kanban ·
WBS · Workload — schedule first, board second (T-0159, at Ace's request; the
Explorer draws Kanban first). The **rail still opens the Kanban**: `landing`
on the hub states that, because `hubLanding` otherwise returns `tabs[0]` and a
cosmetic reorder would silently move the hub's home. The Board Explorer draws eight; **Table, Flow and Item were
deleted in T-0152** at Ace's request, and their pages went with them rather
than being left unreachable — what that cost is in the "what happened to each
mockup tab" table below. Above all five sits `BoardToolbar`: **+ New item**,
the **All · Mine · Stuck** pills and the member roster. `AppShell` draws it
**once**, for `hubForView(view)?.id === 'board'` — five copies is how the
Kanban and the Timeline come to disagree about how much work there is.

What the pills MEAN is `services/boardScope.js`, and only there. "Stuck" is
deliberately narrow: a bottleneck somebody wrote down, or an item that is open
and past its own plan date. Not "in progress for a while" — that is ageing,
which Flow measures separately and which is a different claim. Every page runs
its list through `scopeTasks` and `tests/ui/boardHub.test.mjs` fails the build
if one does not: a filter drawn on five pages and honoured by three is worse
than no filter, because the number that is wrong is the one you cannot see.
The route carries it — `?mine=1`, `?stuck=1`, `?who=<uid>` — so a filtered
board is a link.

The panels the mockups specify, and the modules behind them:

| Panel | Where | Built from |
| --- | --- | --- |
| Main board (grouped table, RAG per group) | Dashboard | `rateProjects` |
| Delivery pipeline · alerts · utilization | Dashboard | the page's own numbers |
| Portfolio table, grouped by segment | Projects → Portfolio | `rateProjects` |
| Project spans against today (`.ptl-*`) | Projects → Timeline | `services/projectTimeline.js` |
| Pace: work done against schedule gone | Project editor | `projectHealth` |
| Kanban card with project rail (`.bx-kc-rail`) | Board | `dueChip`, `wipLimits` |
| Fluid Gantt: ruler, project bands, one filled bar | Board → Gantt | `services/ganttGeometry.js` |
| Hours by day, stacked (`.stack`) · status mix | Reports | activities, tasks |
| By project: planned vs logged (`.rtable`) | Reports | `services/effort.js` |
| Settings group card (`.sgroup` / `.srow`) | Settings | `useSettings` |
| Access tiles · role assignments · role definitions | Settings → Members | `services/accessControl.js` |
| Goal cards: ring, Target/Now, key results | Dashboard → Goals | `services/goalProgress.js` |
| Metric tiles + alert rules | Dashboard → Monitoring | tasks + activities |
| Data model as nesting · the loop · status language · shortcuts | Dashboard → How to use | the reader's own newest activity, `STATUS_TEXT` |
| Lesson rail · the active lesson on a numbered spine · Try it here | Dashboard → Tutorial | `services/tutorials.js`, `services/tutorialProgress.js` |
| Utilization with a cap notch | Reports → People | activities + `assignedTo` |
| Diverging plan-vs-actual bars | Reports → Variance | `services/effort.js` |
| Report cards | Reports → Library | `savedViews` + the export builders |
| Load per person, segmented, against a cap | Board → Workload | `services/workload.js` |
| Numbered outline (WBS · 1 · 1.2 · dates · priority) | Board → WBS | projects › phases › tasks |

None of them invent a number. Where the mockup showed something this app does
not have, the panel was pointed at the nearest real thing rather than filled
with a plausible fiction — and where there was no real thing, the tab was not
built and the reason is written down:

| Mockup tab | What happened |
| --- | --- |
| Dashboard → Pipelines | No build pipelines exist. The run log they show is `automationRuns`, which is already on the Automations page. |
| Dashboard → Main board | It is the Overview's own centre panel; the wide version is Reports → Table. |
| Dashboard → Access control | The two mockups disagree — Dashboard Explorer draws "Access control", Settings Explorer draws "Members". **Settings won** (T-0155): one surface, at the address the team already knows. The Access-control *design* was ported onto it, so nothing was lost either way. |
| Library → Cadence / Recipients | Scheduling and email need a backend and SMTP, both out of scope. The page says so once, at the foot. |
| WBS (the day grid) | **Removed** in T-0149. The page was a Gantt in a table — a scrolling day grid with a zoom preset, plan bars and six data columns — sitting next to the Gantt tab it duplicated. The mockup's WBS is an outline, so that is what it is. The dates and the % live on **Gantt** and **Table**; the owner is still the row's face. |
| Workload (the weeks grid) | **Removed** in T-0150 on request. It was people × six weeks with drag-to-rebalance. Both halves are still reachable: move **when** on the **Calendar** or **My Week** (both drag), move **who** with the **Table's bulk bar** or the task editor. `services/workload.js` keeps the arithmetic and its tests — `buildWorkload`, `planningWeeks`, `moveTaskPlan`, `describeCell` are unrendered but not deleted, and the file says so at the top. `moveTaskToDay` from the same module is still live. |
| Board → Table | **Deleted** in T-0152 on request. It was the configurable task report *and* the app's only bulk editor. Gone with it: `TasksTableView.jsx`, `services/tableViews.js`, `services/bulkTasks.js`, `hooks/useBulkTasks.js`, `firebase.bulkUpdateTasks` and `taskTree.asTree`. **Reassigning many tasks at once is no longer possible** — the task editor does one at a time. `savedViews` documents keep their inert `columns` / `groupBy` fields; a saved view pointing at the deleted page is filtered out of the menu rather than opening Not Found. `chunkWrites` was rescued into `services/writeBatches.js` because `duplicateProject` batches through it. |
| Board → Flow | **Deleted** in T-0152 on request. Stage counts, time-in-stage and the status mix went with it; the Dashboard's tiles and Reports → Variance are the nearest remaining numbers. |
| Board → Item | The **page** was deleted in T-0152 on request; `?item=<id>` no longer resolves. Its **design** is not lost: T-0160 ported the Explorer's task-editor modal onto `TaskEditor`, which was always the one write path — the navy nav strip, the orange-railed primary block with five hover-editable fields, description + comments on the left and Details · AI · Activity · Subitems · Files on the right. |
| Projects → Portfolio (the old one) | **Deleted** in T-0153 on request. It was a cross-workspace roll-up; the Dashboard carries the same rating, and every service it used (`buildPortfolio`, `buildStatusReport`, `useAllWorkspaceProjects`) has other callers. The **Projects page took the name** — it is the portfolio now. |
| Projects → Archive | **Deleted** in T-0153 on request, and it stranded nothing: Projects → Portfolio already folds archived projects away at its own foot, so the tab was a second door to one room. |
| How to use (four panels) | **Ported in full** (T-0156), with two deliberate divergences, both honesty ones — see the row below and the Shortcuts pitfall. |
| How to use → Shortcuts | The mockup lists **N**, **L**, **G then B**, **G then R** and **?**. This app handles none of them: the only global keys are ⌘K, Escape, the palette's ↑↓/↵, and D / S inside the due-task alert. The panel prints **those six**. A shortcut card is read as a promise; every key on it that does nothing costs the reader their trust in the rest of the page. |
| Tutorial → the "2/6" done count | There was no such fact, so one was **recorded** rather than faked: a lesson counts as finished when somebody presses **Done** on the tour's last step — not when they open it, and emphatically not when they press "Skip tour". Per device in `localStorage`, keyed by uid, for the same reason the due-alert snooze is: it is a personal fact about one reader, and writing it to a shared document would tell a teammate they had finished a lesson they have never seen. |
| Tutorial → "3 min" per lesson | Nothing in this app measures how long a tour takes. The rail prints the **step count**, which is real and answers the same question. |
| Tutorial → "TRY IT HERE · sandbox" | There is no sandbox, and a form with a Save button that saves nothing is worse than no panel. The card keeps the mockup's exact geometry and carries the lesson's **real** facts — how many steps, which pages it walks you through, how many controls it points at — with a CTA that opens that page for real. The chip says **"your real data"**, because that is what the tour runs on. |
| Goals (the SP3 one-pager) | **Replaced** in T-0154. Each goal was a full-width card — coloured banner, INITIATIVES, KPI, then three aligned columns (CHANGE AGENDA's FROM→TO pairs, numbered DELIVERABLES, TARGET DATE). The mockup's card has no room for the change agenda, so **none of that data was dropped**: it is still edited in the modal and still written out in full by `buildGoalsDocument`, which is the version people actually send. The mockup also prints a measured "Now" reading; this app has no current-value field, so **Now is the count of deliverables finished** — a real number rather than a plausible one. |

**Settings → Members is the Access-control card** (T-0155). Four tiles, a
Role-assignments table (member · role · scope · last logged), what each role
can actually do, and the invitations nobody has claimed. Three things in it
are deliberately NOT the mockup's:

| The mockup says | Why it could not be copied |
| --- | --- |
| Guests · Role changes tiles | No guest access exists and no audit trail is kept. Those two slots carry **Can change access** and **Read-only** instead — numbers `acl` can actually support. |
| "invite expires in 6 days" | An invitation carries no expiry field. The card says "waiting to be claimed" and nothing about time. |
| "Full control — billing…", "run pipelines" | Neither exists. The role text is written from `firestore.rules` — `isWorkspaceOwner` / `isWorkspaceAdmin` / `canEditWorkspace` — because a permissions table that lists a power nobody has is worse than no table: somebody will rely on it. |

**Last logged** is read from the activity entries the workspace listener is
holding, which is one page — so a dash means *nothing of theirs is in that
window*, not *never*. The table says so at its foot rather than letting the
dash imply the stronger claim. `projects` and `activities` are passed in from
the Settings page, which already subscribes to both; the Workspaces modal
renders the same component without them and degrades to "Workspace" and a
dash, which is the truth when nothing is known.

**Settings is five routes over one component** (six until T-0158 moved Tutorial to the Dashboard hub). `SETTINGS_SECTIONS` in
`SettingsView.jsx` maps each route to the blocks it draws, and the blocks are
only **mounted** when their tab is open — several subscribe or probe the local
bridge, and paying for all six to open Preferences is how a settings page comes
to spam a CLI. The "On this page" rail is gone; the tab strip is that list.
`WorkspaceMembers` is exported so the Members page and the Workspaces modal
render one implementation, not two.

## Views

Which hub each one belongs to, and in what order its tab strip lists them, is
`HUBS` in `services/views.js` — not this list, whose numbering is historical.

1. **Board** — Kanban with drag-drop, **four columns**: To Do · In Progress ·
   In Review · Done. `review` is a real status (T-0147), not a fourth-coloured
   label — work its owner has finished that is waiting on somebody else. Its
   `statusStamps` give it a start date and **no end date** (the thing that
   ends it is acceptance) and floor its progress at 90 rather than 100, so a
   review queue does not read as delivered. The columns are **derived from
   `TASK_STATUSES`**, as is the drag cycle, so a fifth status would need
   remembering nowhere. Existing tasks were not migrated — there was nothing
   to migrate them to.

   **The headers are drawn once; the cards below are bands** (T-0148). The
   four column heads sit at the top of the page and stay there, and
   everything under them is divided into collapsible bands, the way Ace's
   reference board does it. **The FIRST band opens; the rest are collapsed**
   (T-0159) — the board lands on something to read, without twenty expanded
   projects turning it into a scroll. That makes the state THREE-valued —
   open / shut / nobody-has-said — and `services/boardBands.js` owns it. The
   trap is "Collapse all": it must write an explicit `false` for every band,
   **not** `{}`, because `{}` means "nobody has said" and the default reopens
   the first band the instant it is written, so the button visibly fails to do
   the one thing it is named after. A **collapsed band still prints its
   per-column counts** ("3 In
   Progress · 1 Done"), because folding a project away must not hide how much
   work is in it. There is **no toggle** choosing the grouping: across every
   project a band IS a project, and inside one project a band is a phase.
   Offering a switch would ask the reader to choose between "by project" and
   "by project" when only one of them can apply. A drop between bands moves
   the **phase** in the second case and never the project in the first —
   dragging a card sideways must not silently reassign which project owns it.

   A card is the Board Explorer's four rows: title + priority dot; the status
   chip and whatever is wrong with it; a footer ruled off above it with the
   owner's face, the due date (mono, bold red once it has passed) and whose
   it is — a tick when it is done; and a 5px progress bar in the project's
   colour. The column head is four things too: the dot, the name, a plain
   white **count** pill and — only where the project set a limit — a **WIP**
   chip at the far right. One pill reading "4 / 3" made the count and the
   policy the same number. Amber at the limit, red past it; a card that has
   sat In Progress longer than the project allows carries an ageing badge.
   Both are advisory; see `services/wipLimits.js`. Cards show status badges,
   **🔗 deps**, **↔ links**, **🔁 recurrence**, **⏱ tracking** and the
   project's own custom fields. **There are no tag chips and no "+ Add item"**
   — see the chrome table. **"+ From template"** is in the quick-add when task
   templates exist.

2. **Activity Log** (`TableView.jsx`, Reports hub) — flat activity log with bulk actions (delete / set completion / export). Sortable columns. Not to be confused with the Board's Table tab, which was deleted in T-0152.
3. **Gantt** — the Board Explorer's chart, rebuilt to it (T-0145): a 220px
   label column (project dot · title · owner's face), a proportional ruler
   across the top, 44px rows **segmented by project** — a band per project
   carrying its item count and its own span — and **one** bar per row: a
   tinted bed in the project's colour filled from the left by progress,
   green when finished, with a 2px red Today line and a ▲ at the end of a
   bar whose date has gone. Three things in the legend, and no more.
   **It fits the card**: there is no pixels-per-day preset, the track column
   is measured and `dayWidth = trackW / range.total` falls out of it, so
   bars, the Today line, the dependency arrows and the drag arithmetic all
   still work in pixels off that one number. The ruler's granularity is
   **derived** from the window (weeks up to 11, months beyond), not asked
   for. The card head holds the **period switch** — All · This week ·
   This month · This quarter · Next 30 days (This week added T-0159, and it
   asks `weekDays` for where a week starts so it cannot disagree with the
   Timesheet or My Week) — which is what the chart is OF, so it belongs on
   the chart rather than in a filter bar above it; `PERIODS` is the one
   vocabulary and `periodOf` reads the current dates back through it, so a
   window that arrived on a link still lights the right segment, and one
   picked by hand says "Custom" instead of lighting nothing. Plan bars are
   still draggable (resize + move) and the SVG dependency arrows are still
   drawn, over the track column only. There is **no tag chip strip** on this
   page; a tag from a saved view is still applied and named in the subtitle
   with a way to clear it. What went: the sideways-scrolling day grid, the
   weekend columns, the per-day header row, the second "actual" bar under
   the plan, the sticky phase column, and the five-chip period filter bar.
4. **Calendar** — Month grid. **Tasks are draggable between days to reschedule** — drops update `plan.endDate` and shift `plan.startDate` to preserve duration. Click a task to edit.
9. **Review** (the Reports hub's "Summary" tab) — five `<Tile>`s, a **period band**
   (`.period-bar`) that is deliberately not among the commands because it decides what
   every number below it means, hours-by-project, daily-hours strip, and the
   overdue/completed/bottleneck lists.
5. **My Week** — everything assigned to *you*, from **every workspace you belong to**, in
   seven day columns honouring the week-start preference, with a "No date yet" rail to drag
   from and a "Still open from before" rail so last week's work cannot vanish. Each card
   names its workspace, because the point is that they are mixed. Bucketing is the pure
   `services/myWeek.js`; a drop goes through `moveTaskToDay` in `services/workload.js`.
   Reads through `subscribeToMyTasksAcrossWorkspaces` — filtered at the server, because
   this is a page people leave open. The week and the drop sequence are `hooks/useMyWeek.js`
   (with an injectable `commit`), because the page needs
   a live workspace before it renders, so anything left inside it can only be read, not run.
7. **Projects → Portfolio** — health tiles (Active / At risk / Due ≤ 14d /
   Delivered, rated by `services/portfolio.js`, so the Dashboard, the Portfolio
   and the Timeline cannot disagree about what amber means), then the project
   table and phase CRUD. It **opens grouped by segment** (T-0153): a segment is
   what somebody decided the project *is*, while health is a derived judgement
   that moves week to week — opening on the stable grouping means the page looks
   the same tomorrow. `Group: Health` is one click away.
   **Archived projects fold away at the foot of the page** rather than sitting in
   the grid behind a small badge, where a finished project looked live at a
   glance — which is also why the separate Archive tab could go. Each saved
   project gets an **Ask about this project** panel: the digest is that project's
   tasks and activity only, grounded in the project's own NotebookLM notebook
   (falling back to the workspace's), with the cited sources beside the answer.
   **Templates section** lists all saved task/project templates with delete + use
   actions.

7b. **Projects → Timeline** — one row per PROJECT: its span as a tinted bar
   filled by completion, a red Today line, and a ◆ where each phase ends. It is
   **not** the Board's Gantt zoomed out — that chart is one row per task and
   answers a different question. Geometry is the pure
   `services/projectTimeline.js`: the window is every project's own extent and
   **always contains today** (a timeline whose "now" is off the edge is a picture
   of somebody else's project), bars are clamped into it, and the ruler is
   labelled from the window's real dates rather than a fixed list. The mockup
   draws a "milestone"; this app has no such field, so the diamond marks the last
   dated task in each **phase** — a real date — and the legend says "Phase end".
   A project nothing in which has a date gets no bar and says so.

8. **Settings** — Five routes now, not six: **Tutorial moved to the Dashboard hub** in T-0158. Per-device prefs: theme override, default project, week start. **Automations** section: rules as dropdowns, the run log, and the notices they raised for you. **Account section** with Google sign-in / sign-out. **Notifications section** with permission status + enable button. **Knowledge base (NotebookLM)** with setup / sign-in / empty / ready states, Re-check, notebook table, source add and per-notebook usage. Data export.

## v5 Cross-cutting features

- **Code-splitting** — Board is eager; every other view is `React.lazy()` + Suspense.
- **Time tracker** — Single-track timer in localStorage. Topbar widget shows live elapsed time. ▶ button on each Board card starts tracking. Stop → modal pre-filled with elapsed hours → log activity in one click.
- **Recurring tasks** — Two paths, both idempotent on `recurrenceParentId` + the due date. (1) On marking done, `spawnNextRecurrence` creates the next instance with shifted plan dates (daily/weekly/monthly + interval); subtasks reset. (2) On schedule: `useRecurrenceCatchUp` runs on load and hourly, and `catchUpPlan` (pure, `services/recurrenceSchedule.js`) works out every occurrence that has become due and is missing — so a series nobody ever ticks off still comes round. Bounded: due today or earlier (`HORIZON_DAYS = 0`), nothing older than `STALE_DAYS`, at most `MAX_PER_RUN` per series per run. **The note in the recurrence editor must describe both paths and the limit on the second** — it named only the on-completion path for as long as there were two, which reads as "a ritual nobody ticks off stops", the opposite of what a schedule is for. The catch-up runs in the app, not on a cloud schedule, so "the next time somebody opens the app" is part of the sentence, not a footnote. `tests/ui/copy.test.mjs` fails the build if either half goes missing.
- **Templates** — Two kinds: `task` and `project`. Save-as-template button in editors. Picker in TaskForm (task) and as click-to-use cards in Projects view (project).
- **Notifications** — Service worker at `public/sw.js`. Browser notifications fired for newly-overdue tasks (deduped by `localStorage`-tracked "shown" set). Permission requested from Settings. Scan runs on load + every 5 min.
- **Google sign-in** — `signInWithGoogle()` does `linkWithPopup` if anonymous (keeps existing data), `signInWithPopup` otherwise. `signOutUser()` signs out then re-anonymous-signs-in so the app stays usable. Sidebar footer shows avatar + name when signed in.
- **Due-task alerts** — `DueTaskAlertModal` is mounted once in `ApprovedApp` (App.jsx) and shows **one task at a time**. Eligibility lives in the pure module `src/services/dueAlerts.js` (`isDueForAlert`, `buildAlertQueue`): not done, has `plan.endDate`, and `plan.endDate <= today + leadDays`. Queue order: most overdue → priority → title. `useDueAlertQueue` recomputes every 60 s and on task changes, keeps the on-screen task pinned, and hides (without dequeuing) during quiet hours, while another `.modal-backdrop` / the celebration is open, or while the timer runs for that task. **Snooze / skip are per-device localStorage** (`task-monitor.dueAlerts.{snooze,skip}.v1.<uid>`) — tasks are shared, so never persist them on the task doc. The prompt block calls `generateClaudePrompt` once per task and caches it in `task-monitor.dueAlerts.prompt.v1.<taskId>` keyed by `updatedAt` (user edits are kept); **Run** goes through `askAI` (`meta.kind = 'due-alert-run'`). The browser notification scan (`useOverdueScan`) uses the same `buildAlertQueue`, so both surfaces agree. Settings → *Due-task alerts* stores `settings.dueAlerts` `{ enabled, leadDays, defaultSnoozeMin, quietFrom, quietTo }`. **`enabled` defaults to `false`** — it interrupts and it spends AI budget, so it is opt-in. Devices that saved the old default-on value are cleared once by `applyDueAlertOptIn` in `useSettings.js` (flagged by `task-monitor.dueAlerts.optIn.v1`, so a deliberate opt-in is never undone). `enabled` gates **both** surfaces: the modal and `useOverdueScan`'s browser notifications. It used to gate only the modal, so a user who switched alerts off kept getting desktop banners every five minutes and read that as broken (T-0107). Keyboard: Esc = default snooze, D = done, S = skip. The × in the dialog header is **close all**: it mutes every alert for the rest of the day on this device (`task-monitor.dueAlerts.mutedOn.v1.<uid>`, nothing is skipped); `DueAlertBell` was the topbar's on/off **switch** for the whole feature; the top bar was cleared in T-0146 and it is no longer mounted, so **Settings → Notifications** is the switch. That is the only reason removing it was safe: a feature whose only control is hidden while it is off has no way back on.
- **Automations** — "when this happens, do that", authored in Settings → Automations as dropdowns and run by `onTaskAutomations` (`functions/automations.js`). The vocabularies, the matching, the plan, the one-sentence description and the refusals all live in the pure `functions/src/automations.js`, which the **editor imports directly** — one vocabulary, so the form and the runner can never mean different things. Admin-only to write, member-readable. Every run is logged to `automationRuns`; "Tell someone" writes a `notifications` doc that the same panel shows the person it was for. Loop guards: `wouldLoop()` refuses a rule that would set off its own trigger, and every write the runner makes carries `lastAutomationRunId` so the next `onDocumentWritten` ignores it.

## AI provider layer

```
functions/webhooks.js ← onTaskWritten / onActivityWritten: signs and POSTs
                        webhooks, logs every attempt to `webhookDeliveries`
functions/src/webhookEvents.js ← which events fire and what the body is (pure)
functions/index.js    ← aiProxy: holds the COMPANY key server-side. The browser
                        sends a prompt; the function checks the caller
                        (approved + company + aiEnabled) and calls Anthropic.
functions/src/authorize.js ← that check, as a pure tested function
bridge/ai.mjs         ← the only place that spawns `claude`; also API + mock
bridge/notebooklm.mjs ← the only place that spawns `notebooklm` (knowledge base)
bridge/server.mjs     ← localhost HTTP: /health /ai/complete /ai/json /ai/recheck
                        /ai/settings /ai/usage /knowledge/*.
                        127.0.0.1 only, origin allowlist.
src/services/ai.js        ← the only place the frontend picks a brain.
                            askAI / askAIJson / detectProvider / aiSettings
src/services/knowledge.js ← the only door to /knowledge/*; shared probe + cache
```

`/knowledge/*` routes (all on the same origin allowlist; a CLI failure is a
**502** carrying the CLI's own message):

| Route | Does |
| --- | --- |
| `GET /knowledge/status` | cliFound / authenticated / hint / notebooks (cached 60 s) |
| `POST /knowledge/status/refresh` | Re-check: clear caches and re-probe |
| `GET /knowledge/notebooks` | `[{ id, title, sourceCount }]` (cached 5 min) |
| `GET /knowledge/sources?notebook=` | `[{ id, title, kind }]` |
| `POST /knowledge/sources` | `{ notebook, kind:'url'\|'text', url \| title+text }` |
| `POST /knowledge/ask` | `{ notebook, question, conversationId?, source? }` → answer + citations |
| `GET /knowledge/usage?notebook=` | `{ stats, recent }` from the local ask log |
| `PATCH /knowledge/asks/<id>` | `{ helpful }` — local log only |

**Grounding.** `askAI(system, user, { ground: { notebookId } })` asks the
notebook first and prepends its answer to the system prompt as authoritative
source material (truncated to 8 000 chars). Only `claude-code` can ground; the
other providers return `degraded` with the reason. A failed lookup still
answers — with `degraded` + `grounding: null` — never a swallowed question.
Surfaces: Ask AI ("Ground with my notebook"), the due-task alert prompt block,
and `generateClaudePromptFull`.

- **A company's API key never reaches a browser.** It lives in
  `companies/{id}/secrets/anthropic`, readable only by a superadmin and by the
  `aiProxy` function (admin credentials). The company document carries a
  `hasApiKey` boolean, not the key. `getEffectiveApiKey()` returns ONLY a
  superadmin's own device key. Members' AI goes through provider `'proxy'`.
- **One chokepoint.** New AI features call `askAI` / `askAIJson` (or the
  `callClaude` / `callClaudeJson` wrappers in `anthropic.js`). Never `fetch`
  a model directly, and never spawn the CLI from anywhere but `bridge/ai.mjs`.
- **Hermetic CLI invocation.** `--safe-mode --strict-mcp-config --tools ""`
  and the role in `--system-prompt` (not prefixed to the user prompt). Dropping
  any of these turns a 280-token question into a 99,000-token one and lets the
  operator's own MCP servers editorialise in the answer.
- **A denied tool exits 0.** `parseCliResult` throws on non-empty
  `permission_denials` — the model's apology must never be stored as an answer.
- **Web access** is a provider capability: pass `{ web: true }` to `askAI`. Only
  `claude-code` can browse; other providers return the answer marked `degraded`.
- **Provider ≠ transport.** `claude-code` means the bridge is running the CLI
  (subscription, can browse, can ground). `bridge-api` means the same bridge is
  running on an `ANTHROPIC_API_KEY` — billed per token, and it can do neither.
  Both route through the bridge (`isBridgeProvider`); capability checks use
  `canBrowse(provider)` / `canGround(provider)`. `bridge-api` is never offered
  as a choice in Settings; it is what the bridge turns out to be.
- **Why AI is OFF comes from `aiUnavailableCopy(status, { isOperator })`.**
  `available` goes false for two unrelated reasons — the company gate, and
  nothing being connected — and an empty state that writes its own sentence
  describes only one of them. The AI helper blamed a missing company key
  whatever the cause and pointed at Settings → User Management, a superadmin-only
  screen, at a reader who cannot open it (T-0125). It returns
  `headline` + `detail` for anybody and `operatorHint` for `<AiOperatorHint>`,
  the same split `knowledgeCopy` makes.
- **The AI brain panel's wording comes from `providerLabel` / `providerHeadline`**
  in `services/ai.js`. Components must not write their own — that is how a
  bridge billing API tokens ended up advertising "no API billing".
- **Degraded ≠ success.** Every fallback sets `degraded` + `reason`. Propagate
  it; don't render a fallback as a clean result.
- **Gate UI with `useAiStatus()`**, not with `getEffectiveApiKey()` — the CLI
  needs no key, so a key check would hide AI from CLI users.
- `npm test` runs `bridge/ai.test.mjs` (`node --test`). Never spawn the CLI in
  a unit test.

## Exports — getting work out of the app

One module builds them all: `src/services/exporters.js`. Content is described
once as a list of blocks (`heading`, `paragraph`, `bullets`, `table`,
`keyValues`) and rendered to **.xlsx · .docx · .pdf · .md · .html · .txt · .csv**.

```
services/exporters.js      ← the document model + all seven writers
services/taskExport.js     ← a task list as a document (Board, Gantt, Projects)
services/activityExport.js ← buildActivityLogDocument() (Activity Log, its bulk
                             bar, the WBS activity modal, Projects) and
                             buildWbsDocument() (the WBS modal)
services/minutesExport.js  ← one set of minutes
components/ExportButton.jsx← "Export ▾" — the menu, the spinner, the filename
```

- **The libraries are dynamic imports.** `exceljs` (908 kB), `jspdf` (390 kB)
  and `docx` (394 kB) are code-split and never in the eager bundle; a user who
  never exports never downloads them. Keep it that way — a top-level import of
  any of them lands on every page load.
- **Every file goes through `downloadFile()`**, so every name is
  `<name>-YYYY-MM-DD.<ext>` in the user's own day.
- **`build()` runs only when a format is picked**, so a page never prepares an
  export nobody asked for.
- **Only `exportError()` messages reach the user.** Anything else that escapes
  an export is a library's internal complaint; `ExportButton` shows a generic
  sentence instead.
- A document with a `sheets: [...]` array gets proper worksheets in Excel;
  without one, the first `table` block is used.

## Telling the user something

```
hooks/useActivate.js   ← activateProps(onActivate, { disabled, label }): every
                          prop a div needs to really be a button — Enter AND
                          Space, preventDefault so Space does not scroll
hooks/useModalDialog.js ← turns an EXISTING modal into a real dialog: spread
                          backdropProps + dialogProps, give the heading
                          `id={modal.titleId}` (or pass `title:` when there is
                          no heading). role=dialog, aria-modal, focus trap,
                          Escape, focus restore, backdrop click. Pass
                          `open:` when the component owns the modal's
                          open/closed state — see the pitfall below.
components/Toast.jsx   ← useToast(): a message, optionally with Undo
components/Dialog.jsx  ← useDialog(): await ask.confirm(…) / ask.prompt(…)
                         plus the Modal shell (role=dialog, focus trap, Escape)
services/access.js     ← friendlyError(err, fallback): one plain sentence
services/errorMessages.js ← describeCrash() for a crash; describeAiFailure(err,
                         fallback, { isOperator }) for an AI failure → one
                         sentence for the screen + the operator's version for
                         the console; isPlainUserMessage() is the guard
hooks/useUserProfile.js ← isOperatorProfile() / useIsOperator(): who may be
                          shown operator copy (an approved superadmin)
```

Both providers are mounted once, in `App.jsx`. A component calls the hook; a
module-level helper cannot, so it returns a result and the component speaks.

## Conventions

- **Dates as YYYY-MM-DD strings** in user's local timezone (Asia/Manila). Helper: `todayLocal()` — defined in `services/recurrence.js`, re-exported from firebase.js.
- **Logic goes in a pure service, not in a component or in firebase.js.** `services/recurrence.js`, `services/csv.js`, `services/askAiCore.js`, `services/access.js`, `services/dueAlerts.js`, `services/errorMessages.js` and `services/nlpQuickAdd.js` import no Firebase and no network — that is what makes them testable with `node --test`. Components render what those modules return.
- **Every downloadable file is date-stamped**: `<name>-YYYY-MM-DD.<ext>` from `downloadFile()` in `services/download.js`, using `todayLocal()` — never `new Date().toISOString()`, which is UTC and stamps Manila mornings with yesterday. Nothing outside that module may set `a.download`.
- **Timestamps** (`createdAt`, `updatedAt`, `loggedAt`, `lastActivityAt`) use `serverTimestamp()`.
- **A custom field is described in one place.** `services/customFields.js` turns a project's `customFields` into labels and chips (`taskChips`); the board card shows them and `taskExport.js` adds them as export columns. The table-column helpers (`customFieldColumns`, `columnIdFor`, `fieldIdOf`) went with the task table in T-0152.
- **An attachment belongs to the workspace.** Uploads go to `workspaces/{workspaceId}/{taskId|general|logo}/…` — `uploadPath()` in the pure `services/uploadPaths.js` builds every one and refuses a path with no workspace. `storage.rules` reads that workspace document to decide access, so any member can open, replace or delete the file. `users/{uid}/…` is frozen legacy: readable and deletable by its uploader, never written again.
- **Soft delete** via `deleted: false` flag; **archive** via `archived: false`. Never hard-delete tasks because activities reference them.
- **`userId` on every document** — keeps security rules trivial.
- **Theme:** CSS variables in `:root` and `@media (prefers-color-scheme: dark)`. All tokens prefixed `--c-` (colors), `--s-` (spacing), `--r-` (radii). **The default is `'system'`** (T-0126) — it was `'light'` from before the System option existed, so a new user on a dark-mode Mac got a bright white app. No migration was written and none is wanted: a stored value always beats a default, so a device that chose Light keeps Light. **`color-scheme` is declared beside the tokens in all three states**, because native chrome — date pickers, number spinners, select popups, scrollbars — is painted by the browser and stays light without it, which is a white date picker inside a dark task editor.
- **Mobile-responsive** — the icon rail becomes a drawer under 720px, with the six hubs repeated in the bottom bar.

## File Layout

```
src/
├── components/
│   ├── AppShell.jsx          ← icon rail + topbar + view router + global search + ⌘K
│   ├── PageHeader.jsx        ← breadcrumb + title + tabs; PageSubtitle / PageActions
│   ├── Avatar.jsx            ← a person as a coloured circle; colour derived from the id
│   ├── BoardToolbar.jsx      ← the Board hub's one strip: New item · All/Mine/Stuck · roster
│   ├── FindItem.jsx          ← the tab strip's find box; writes ?q=, debounced
│   ├── TutorialView.jsx      ← Dashboard → Tutorial: the lesson rail, the active
│   │                            lesson, Try it here; the tour runs in the shell
│   ├── Board.jsx             ← kanban with drag-drop + swim-lanes + tag filter
│   ├── TaskForm.jsx          ← quick-add (top of Board)
│   ├── TaskEditor.jsx        ← the ported modal (T-0160): navy nav strip, the
│   │                            five editable meta fields, description +
│   │                            comments left, five tabs right (`.te-*`)
│   ├── DueTaskAlertModal.jsx ← two-column due alert: task + actions left, GenAI prompt right
│   ├── KnowledgeSection.jsx  ← Settings: NotebookLM setup states, notebooks, sources, usage
│   ├── AutomationsSection.jsx ← Settings: rule list, the dropdown editor, run log, notices
│   ├── WorkloadView.jsx     ← Board → Workload: load per person against a cap
│   ├── WBSView.jsx          ← Board → WBS: project › phase › item outline
│   ├── MyWeekView.jsx       ← My Week: my tasks from every workspace, by day
│   ├── ShareLinksPanel.jsx  ← project editor: publish / refresh / turn off a link
│   ├── SharedViewPage.jsx   ← the public route: fetches one snapshot, no sign-in
│   ├── SharedSnapshot.jsx   ← renders it (board or timeline), fetches nothing
│   ├── InboxView.jsx         ← Messages → Inbox: the notices, as a page
│   ├── InboxBell.jsx         ← legacy 📥 bell; not mounted (see the chrome table)
│   ├── InboxPanel.jsx        ← the list of notices (presentational, harness-friendly)
│   ├── NotebookPicker.jsx    ← cache-only notebook select (never spawns the CLI)
│   ├── AddToNotebookButton.jsx ← ＋ Notebook on a task/artifact URL
│   ├── DueAlertBell.jsx      ← topbar switch: turns due alerts on/off, shows waiting count
│   ├── ActivityLogger.jsx    ← modal: log new activity (inline task switcher)
│   ├── LogActivityPicker.jsx ← "which task did you work on?" — the one copy
│   ├── LogTimeButton.jsx     ← Dashboard hero: pick → form → change task
│   ├── ActivityEditor.jsx    ← modal: edit existing activity (atomic counter sync)
│   ├── TableView.jsx         ← activity table + bulk actions + CSV
│   ├── GanttView.jsx         ← timeline + draggable bars + dependency arrows
│   ├── CalendarView.jsx      ← month grid by plan.endDate
│   ├── ReviewView.jsx        ← Reports → Summary: tiles, stacked hours, by-project
│   ├── AutomationsView.jsx   ← Dashboard → Automations: a page for AutomationsSection
│   ├── PeopleView.jsx        ← Reports → People: utilization against a real cap
│   ├── VarianceView.jsx      ← Reports → Variance: plan vs actual, diverging
│   ├── LibraryView.jsx       ← Reports → Library: standing + saved reports
│   ├── ProjectsView.jsx      ← Projects → Portfolio: health, table, phase CRUD,
│   │                            and the project editor modal (`.pe-*`)
│   ├── TimelineView.jsx      ← Projects → Timeline: one row per project
│   ├── GoalsView.jsx         ← Dashboard → Goals: ring, Target/Now, key results
│   ├── ProjectAskPanel.jsx   ← Ask about THIS project, grounded in its notebook
│   ├── HowToUseView.jsx      ← Dashboard → How to use: the data model as nesting,
│   │                            the loop, the status language and the REAL keys
│   ├── MonitoringView.jsx    ← Reports → Analytics (it was Dashboard → Monitoring
│   │                            until T-0157; the file kept its name, the route did not)
│   └── SettingsView.jsx      ← per-device prefs + data export
├── hooks/
│   ├── useTasks.js           ← useAuth, useProjects, useTasks, useActivities, useAllActivities
│   ├── useDueAlertQueue.js   ← one current due task + snooze / skip / markDone
│   ├── useInbox.js           ← one notices listener, however many components ask
│   ├── useRecurrenceCatchUp.js ← makes a due occurrence appear without a tick-off
│   ├── useMyWeek.js          ← the week you are looking at, and what a drop does
│   ├── useKnowledgeStatus.js ← is the knowledge base usable + which notebooks
│   ├── useNotifications.js   ← service worker, permission, browser-notification scan
│   └── useSettings.js        ← localStorage-backed settings + theme application
├── services/
│   ├── ai.js                 ← THE AI module: provider detection + askAI/askAIJson
│   ├── aiCredentials.js      ← company / personal API-key resolution
│   ├── anthropic.js          ← AI features (task drafts, summaries…) on top of ai.js
│   ├── askAi.js              ← Ask AI digest + narration
│   ├── dueAlerts.js          ← pure due-alert rules (tested by dueAlerts.test.mjs)
│   ├── logTime.js            ← which task "Log time" means, and what it says
│   ├── dueChip.js            ← the due date as a board card shows it
│   ├── myWeek.js             ← my week across workspaces: day columns and two rails
│   ├── effort.js             ← estimated hours vs logged hours, and the variance
│   ├── boardScope.js         ← what Mine and Stuck mean, for all eight Board tabs
│   ├── boardBands.js        ← which Kanban bands are open; first one by default
│   ├── activeWorkspace.js    ← which workspace is active after a snapshot, and
│   │                            why an EMPTY one must never clear it
│   ├── tutorials.js          ← the tours, as data: lessons, steps, selectors
│   ├── tutorialProgress.js   ← which lessons are finished, and what the rail says
│   ├── wipLimits.js          ← what a column may hold, and how long a card may sit
│   ├── duplicate.js          ← "do that again": what a copy carries and what it drops
│   ├── projectAsk.js         ← one project's digest, its notebook, its grounding badge
│   ├── taskTree.js           ← a promoted subtask that is still part of its parent
│   ├── knowledge.js          ← THE knowledge module: bridge client + shared cache
│   ├── mentions.js           ← who a message is for, and the notice they get
│   ├── workload.js           ← load per person; the weeks-grid arithmetic is
│   │                            kept but unrendered (see WorkloadView's header)
│   ├── writeBatches.js       ← chunkWrites: splitting a write into commits
│   ├── shareLinks.js         ← the read-only snapshot a client outside can open
│   ├── recurrenceSchedule.js ← which occurrences are due, and which are missing
│   ├── customFields.js       ← a project's own fields as chips, columns and labels
│   ├── ganttGeometry.js      ← where a plan bar sits, and what a drag on it writes
│   ├── taskStatus.js         ← what a status implies: progress and the actual dates
│   ├── tagFilter.js          ← "only #client", and where an activity's tags come from
│   ├── views.js              ← THE list of pages + HUBS: rail, tabs, ⌘K, not-found
│   ├── projectTimeline.js    ← a project's span, the window, the ruler, the ◆
│   ├── goalProgress.js       ← how far a goal has got, and what it may claim
│   ├── accessControl.js      ← who has access, what it lets them do, last seen
│   ├── uploadPaths.js        ← where a file is stored, and what a delete orphans
│   └── firebase.js           ← init, CRUD, subscriptions, migration helper (dedup-cached)
├── App.jsx                   ← root: routes view based on URL hash
└── App.css                   ← single stylesheet, design tokens + components
```

## When Making Changes

1. **Preserve denormalized fields.** When an activity is created, snapshot `taskTitle`, `taskCategory`, `projectId`, `phaseId` onto it.
2. **Atomic counter updates.** Any new counter on `tasks` must be updated in the same `writeBatch` as the activity write.
3. **No hard deletes.** Set `deleted: true`.
4. **Composite indexes.** Every filtered+ordered query needs one. They live in `firestore.indexes.json` (deploy with `npm run deploy:indexes`) — add the entry there, not just by clicking the link Firestore prints in the console, or the next environment breaks. **And then actually deploy it**: the file and the project drifted completely apart once (BUG-033) and five pages went blank. `npx firebase firestore:indexes --project task-monitor-cbaf2` prints what is really deployed.
5. **Bound every query at the server.** `orderBy` + `limit` in the query, never `.sort().slice()` on the result: slicing after the download does not save a single read. Activity history pages with `loadMoreActivities(workspaceId, beforeDate)`; the live listener holds `ACTIVITY_PAGE_SIZE` entries.
6. **Mobile-first.** Sidebar collapses under 720px; board collapses under 960px. Any new view must respect this.
7. **No build-time secrets** beyond `.env.example`. The config is checked before Firebase is imported: `main.jsx` calls `readFirebaseConfig(import.meta.env)` and renders `SetupRequiredView` when anything is missing, so `services/firebase.js` and `App.jsx` must stay dynamic imports there — `initializeApp()` runs at module scope.
8. **No general backend.** Static frontend + Firestore, plus the single-purpose `functions/aiProxy` (see AI provider layer).
9. **Theme tokens.** Use CSS variables (`var(--c-text)`) not hardcoded colors. Dark mode is automatic via `prefers-color-scheme`.

## What Each Hook Returns

- `useAuth()` → `{ userId, ready }`
- `useProjects()` → `{ projects, byId, loading, userId }` — runs migration on first call
- `useTasks()` → `{ tasks, loading, todo, doing, done, overdue, userId }`
- `useActivities(taskId)` → `{ activities, loading }`
- `useAllActivities()` → `{ activities, loading }` — cross-task, for Table view
- `useRecentActivities(days)` → `{ activities, byDay, totalHours, loading }`

## Key Firebase Functions

- `addTask`, `updateTask`, `setTaskStatus(task, nextStatus)`, `moveTaskStatus(task)` (cycle), `archiveTask`, `softDeleteTask`, `subscribeToTasks`
- `addActivity`, `editActivity(oldActivity, updates)` ← **syncs task counters atomically**, `updateActivity` (raw, no counter sync), `deleteActivity`
- `bulkDeleteActivities(activities)`, `bulkUpdateActivityCompletion(activities, status)` ← used by Table bulk bar
- `subscribeToActivities(workspaceId, taskId, cb)` ← **both** ids (see pitfalls), `subscribeToAllActivities`, `subscribeToRecentActivities`
- `addProject`, `updateProject`, `archiveProject`, `softDeleteProject`, `subscribeToProjects`
- `migrateLegacyCategories(userId)` — idempotent
- `todayLocal()` — YYYY-MM-DD in local timezone
- `uid()` — short random id (used for phase IDs)

## Out of Scope (Don't Build Unless Asked)

**Shipped since this list was first written — these are NOT scope violations:**

- **Multi-user workspaces and sharing** — `workspaces/{id}` with `members[]` + `acl{}`,
  and roles owner / admin / editor / viewer enforced in `firestore.rules`.
- **Invite by email** — an admin records an invitation on the workspace; the invited
  person joins themselves at next sign-in (`claimPendingWorkspaceInvites`), validated by
  `isClaimingWorkspaceInvite()` in the rules. No backend, no UID ever changes hands.
  Rules for it live in `services/invites.js`.
- **Google sign-in** — `signInWithGoogle()` in firebase.js (`linkWithPopup` when anonymous, so
  existing data survives). Anonymous auth is still the default way in, not the only one.
- **File upload bytes** — `FileUpload.jsx` → `uploadFile()` pushes to Firebase Storage under
  `storage.rules`. Plain attachment URLs (Drive, any external store) still work alongside it.

**Still out of scope:**

- A general server-side backend — Firestore is still the backend and the app is
  still a static SPA. The **one** exception is `functions/`, which exists solely
  so a company's Anthropic key can be held server-side (T-0034 / IMP-001): a
  shared secret cannot be kept in a browser. Deploying it needs the Blaze plan
  (`npm run deploy:functions`). Do not grow it into a general API.
- Server-side rendering.
- Running the AI bridge anywhere but `127.0.0.1` behind its origin allowlist.
- Real-time collaborative text editing.
- Server-sent push (FCM or similar). The service worker in `public/sw.js` only fires **local**
  notifications from a client-side overdue scan; nothing is pushed from a server.
- Email digests / SMTP — notifications are the service worker plus in-app surfaces.
  (This is why the app never promises an approval email.)

**Also shipped since the list was written:**

- **Webhook delivery** — `functions/webhooks.js` signs each body with the webhook's own
  secret (HMAC-SHA256, `x-taskmonitor-signature`), retries transient failures on a
  0/30/300 s backoff, and logs every attempt to `webhookDeliveries` for Settings to show.
  https only; loopback and private-network addresses are refused.

## Development Workflow

```bash
npm install          # one install
npm start            # one run: vite + the AI bridge together (scripts/start.mjs,
                     # zero-dep launcher; Ctrl-C stops both; --no-ai skips the bridge)
npm run bridge       # AI bridge alone on 127.0.0.1:4319 (Claude Code CLI brain)
npm test             # bridge/*.test.mjs + src/**/*.test.mjs + tests/ui/*.test.mjs
                     # (node --test; jsdom + a rolldown JSX loader for components)
                     # never spawns `claude` or `notebooklm` — fixtures only
npm run test:rules   # firestore.rules against the Firestore emulator (needs Java)
npm run test:all     # both — run this before a deploy
notebooklm login     # optional: connect the NotebookLM knowledge base (see README)
npm run dev          # local at http://localhost:5173/  (vite base is "/",
                     # so the harnesses are /dev/<name>.html — NOT /task-monitor/…)
                     # dev/due-alert.html — harness that renders the due-task
                     # AlertDialog with sample tasks (no sign-in needed); ?ai=0 forces the offline template,
                     # &nb=1 pretends a notebook is configured
                     # dev/log-time.html — every state of the Dashboard's
                     # "Log time" button and the form it opens
                     # dev/due-chip.html — a board card at every due state
                     # dev/shell.html — the rail, the page chrome and every
                     # Board tab as a static sample (no sign-in); also the
                     # four How-to-use panels and the Tutorial page
                     # (NEW_SAMPLES['how-to-use'], NEW_SAMPLES.tutorial)
                     # dev/knowledge.html — harness for Settings → Knowledge base +
                     # NotebookPicker against the live bridge (no sign-in needed)
npm run build        # produces dist/
npm run deploy       # builds + deploys dist/ to Firebase Hosting
npm run deploy:rules # Firestore + Storage rules
npm run deploy:pages # legacy: push dist/ to the gh-pages branch
```

## Common Pitfalls

- ❌ Storing dates as JS `Date` objects in Firestore — use string `YYYY-MM-DD` for date-only fields
- ❌ Building a CSV by hand in a component. Every export goes through `services/exporters.js`, so a page offers all the formats at once and every file is date-stamped by `downloadFile()`. Four pages kept their own writer and could only produce a CSV — the Activity Log, its bulk bar, the WBS and the per-project log, which are exactly the pages somebody sends to a client. `tests/ui/activityExportUi.test.mjs` fails the build if a component grows a CSV escaper again. Note the round-trip: a column this app **exports** must be an alias the import wizard **recognises**, or the app cannot read its own file back.
- ❌ Importing `exceljs` / `jspdf` / `docx` at the top of a module — they are megabytes, and `await import()` inside the writer keeps them out of the eager bundle.
- ❌ Naming a download with `new Date().toISOString().slice(0,10)` — that is the UTC day. Use `downloadFile(base, ext, content)` from `services/download.js`.
- ❌ Reading the activities collection just for a count — use the denormalized counter
- ❌ Getting one task's activity log from either half of the query alone. It needs **`workspaceId` AND `taskId`**, and this has broken twice in opposite directions. `where('taskId','==',id)` on its own is refused outright — rules are not filters, and that query could match a workspace the caller is not in, so the log came back empty everywhere. Filtering the workspace-wide listener down to one task instead is *silently* worse: that listener stops at the newest `ACTIVITY_PAGE_SIZE` rows **across the whole workspace**, so any task whose entries had scrolled past the cap showed "No activities logged yet." while Table and WBS still listed them. `subscribeToActivities(workspaceId, taskId)` passes both, needs no composite index (two equality clauses, sorted client-side over one task's own history) and no cap. `tests/rules/activities.rules.test.mjs` fails the build if either clause is dropped.
- ❌ `query(ref, where(...))` then `.sort().slice()` in the callback — the whole collection was already downloaded. Put `orderBy` and `limit` in the query and add the composite index to `firestore.indexes.json`.
- ❌ Using `arrayUnion` to push activities into a task document — they go in the root `activities` collection
- ❌ Renaming `userId` — it's referenced by security rules
- ❌ Adding new collections without adding security rules
- ❌ Hardcoding colors instead of using CSS variables — breaks dark mode
- ❌ Promising something the app cannot do — an approval email above all. There is no backend and no SMTP (see Out of Scope), so `services/approvalCopy.js` says "no email is sent, the page lets you in the moment someone approves" instead. `tests/ui/approvalScreens.test.mjs` fails the build if any screen promises one.
- ❌ Calling the session "anonymous". Anonymous auth was removed; use `sessionLine(profile, auth.currentUser)`.
- ❌ `alert()`, `confirm()` or `prompt()`. They block the page, cannot be themed, and give a screen-reader user no title and no focus management. Use `useToast()` (`toast.success/error/info`, with `{ undo }` where something can be taken back) and `useDialog()` (`await ask.confirm({ title, message, confirmLabel, danger })` / `ask.prompt(...)`). `tests/ui/noNativeDialogs.test.mjs` fails the build otherwise.
- ❌ Putting anything a call site re-creates each render into `useModalDialog`'s effect deps. The effect moves focus into the dialog, so it must run **once per open**. It was keyed on `onClose`, and almost every call site passes a fresh arrow (`onClose={() => setLoggingTask(null)}`) — so every render of the parent stole the caret back to the first field. Board re-renders whenever the workspace tasks listener fires: a teammate's edit, a counter bump, the user's own timer. `onClose`, `closeOnEscape` and `autoFocus` live in a ref the handler reads when it fires; the deps are `[open]` and nothing else.
- ❌ Calling `useModalDialog` above the early return of a component that is always mounted. The hook installs a **document-capture** `keydown` listener whose Escape branch calls `stopPropagation()`, which kills the key before anything else in the app sees it — so one such call site made Escape dead for the ⌘K dropdown, the Export ▾ menu, the inbox panel, the Task-table column picker, the tutorial tour and the due-task alert all at once. A component that owns its modal's open/closed state passes `open: <that state>`; the hook then does nothing at all while closed — no listener, no focus moved in, no focus restored. The Escape branch also returns early unless the panel is really in the document, so a forgotten flag cannot resurrect the bug, and `tests/ui/escapeKey.test.mjs` fails the build if a new call site needs the flag and does not pass it.
- ❌ A modal that is only a styled `div`. It needs `useModalDialog` (or the `Modal` component for a new one): without it there is no announcement, no Escape, and Tab walks straight out into the page behind. `tests/ui/modalSemantics.test.mjs` fails the build otherwise. `DueTaskAlertModal` is the one exception — it is `role="alertdialog"` with its own focus handling.
- ❌ A `div` with `role="button"` that handles only Enter. The ARIA button pattern is a contract: Enter **and** Space both activate, and Space must `preventDefault` or the page scrolls instead. Every such row was made keyboard-reachable by hand and most got it half-right. Spread `activateProps()` from `hooks/useActivate.js` — it supplies `role`, `tabIndex`, `onClick` and `onKeyDown` as one set, so they cannot drift. Enter-only is still correct on a **text input**, where Enter submits and Space types a space; `tests/ui/activateProps.test.mjs` tells the two apart and fails the build on the second.
- ❌ Losing the hierarchy when a subtask is promoted. `promoteSubtask` writes
  `type: CHILD_OF` on the new task — it used to write `'related-to'`, which threw
  the parent away at exactly the moment a checklist item started needing dates,
  an owner or its own log. `services/taskTree.js` reads that back: `rollup()`
  counts the checklist AND the promoted children as units of equal weight, so
  promoting one does not move the parent's percentage, and a parent explicitly
  marked done stays done whatever is underneath it. **Every walk is cycle-guarded**
  — `seen` plus `MAX_DEPTH` — because A child-of B child-of A is data that should
  not exist but must not take the editor down. (`asTree`, which indented the task table's rows, was deleted with that table in T-0152.)
- ❌ Rendering a project answer as workspace-wide, or a failed grounding as a
  clean one. `services/projectAsk.js` scopes the digest to ONE project (its
  tasks, and the activities that reach it by project id *or* through one of its
  tasks), resolves the notebook project-first with the workspace as the
  documented fallback, and returns three grounding states that are not
  interchangeable: grounded (with what it read and whose notebook), degraded
  (answered anyway, and marked with the reason), and never asked. The panel goes
  through `narrate` → `askAI` — no new provider path, no direct model call — and
  gates on `useAiStatus()`, never on a key.
- ❌ Duplicating by spreading the original. A copy carries the PLAN and drops the
  HISTORY: `services/duplicate.js` builds the payload, and the things that must
  never travel are listed in `NEVER_COPIED` (ids, counters, `lastActivityAt`,
  `recurrenceParentId`, the actual dates). Subtasks come back unticked with fresh
  ids — two tasks sharing a subtask id tick together — and a copied project gets
  NEW phase ids, or moving a task in one project moves it in the other. A
  dependency inside the copy is remapped to the copy; one pointing outside it is
  dropped, because a copy that waits on the thing it was copied from is wrong.
  `duplicateProject` writes the tasks in batches (twelve tasks is twelve round
  trips otherwise) and returns the ids, because `undoDuplicateProject` needs them.
- ❌ Writing from the ⌘K box. "Duplicate <project>" OPENS the project so its
  editor can say what is about to be copied and how far the dates move; copying
  twelve documents from a search box with no preview is not a thing a palette
  should do. The matching lives in `services/commandPalette.js`, not in AppShell.
- ❌ Blocking a drop that breaks a WIP limit. A hard stop on a personal board is
  an annoyance, not a discipline: `setTaskStatus` runs first and `warnOnDrop`'s
  sentence follows as an **info** toast — nothing went wrong, you were told
  something. A limit of 0 is not a limit either (a column you may put nothing in
  is a column you should delete), so it reads as "no limit" rather than "always
  breached", and limits only apply when the board is filtered to ONE project —
  across all of them, "5 / 3" compares a count to a limit it does not belong to.
  The ageing badge takes its threshold from the CARD's own project, not the
  board's, for the same reason.
- ❌ Treating "not estimated" as an estimate of zero. `estimateHours` is `null`
  when nobody has said, and `services/effort.js` is the only module that reads
  it: `estimateOf` returns null rather than 0, `variance()` gives `state: 'none'`
  so the table shows a dash instead of "−12h (−100%)", and `normalizeEstimate`
  turns a blank form field into null. A percentage against a ZERO estimate is
  also refused — "+Infinity%" and "+0%" are both lies, so the hours are shown
  and the percentage is not. `totalVariance` carries `unestimated` so a roll-up
  can say that some of its logged hours are against nothing.
- ❌ Letting the workload grid quietly assume four hours a task. It still falls
  back to `HOURS_PER_TASK` when there is no estimate, but `describeCell` now says
  which tasks were counted that way — a manager trusting a full-week bar deserves
  to know it was an assumption all the way down.
- ❌ Adding an export column without an import alias. A column the app EXPORTS
  must be one the wizard RECOGNISES, or the app cannot read its own file back:
  `Estimate (hours)` is spelled identically in `taskExport.js` and
  `IMPORT_KINDS.tasks`, and `tests/ui/importStatus.test.mjs` fails the build if a
  new importable field has no home in `importedTaskPayload`.
- ❌ A second copy of what a drop means. `services/workload.js` owns both:
  `moveTaskPlan` (a different WEEK, keeping the weekday) and `moveTaskToDay` (a
  day column, keeping the duration). The Calendar had its own inline version and
  it returned early on `!oldEnd` — so a task with no date could not be dropped on
  a day, which is precisely the task that needs one. Dropping on `DAY_UNSCHEDULED`
  clears the date, and the start date with it: a start with no end is a plan that
  began and will never finish.
- ❌ Keeping a second list of page NAMES either. `VIEW_NAMES` in App.jsx — what the
  error boundary calls the page it caught — was hand-kept and had already drifted
  (Task table and others were missing, so a crash there was reported on ""). It is
  derived from `RENDERABLE_VIEWS` now; only `shared`, which renders outside the
  shell, is named by hand.
- ❌ Drawing a timeline whose window does not contain today. `timelineRange`
  always folds `today` into the extent, because the Today line is the only
  thing on a project timeline that says *when you are* — a chart that crops it
  is a picture of somebody else's project. The same function clamps every bar
  into the window; without that a project starting before the window opens gets
  a negative `left` and paints over the label column, which is exactly what the
  Gantt did in T-0145.
- ❌ Copying a permissions table out of a mockup. The Dashboard Explorer's
  Access-control card promises "Full control — billing, deletion, role
  assignment" and "run pipelines"; this app has no billing and no pipelines.
  A table that lists a power nobody has is worse than no table, because
  somebody will rely on it — `services/accessControl.js` writes its role text
  from `firestore.rules` and cites it, and a test fails the build if the
  mockup's words come back.
- ❌ Letting a dash imply "never". "Last logged" on Settings → Members is read
  from the activity entries the workspace listener is holding, which is ONE
  page — somebody active last month can be absent from it. The cell shows a
  dash, the title says "not necessarily never", and the table repeats it at
  the foot. The same trap as reading a task's whole history off the
  workspace-wide listener (see the activities pitfall above).
- ❌ Counting "nobody linked this" as 0%. On Dashboard → Goals a deliverable
  with no project behind it has **no** percentage — `null`, shown as a dash,
  with no bar drawn — because 0% means "started, got nowhere" and reads as
  failure for work nobody has wired up. The ring averages only the deliverables
  that HAVE a number, and the card says how many it left out; a goal reading
  20% because half of it is unwired is a goal people stop believing. Same
  family as "not estimated is not zero" in `services/effort.js`.
- ❌ Inventing a milestone. The Projects Explorer draws a ◆ and calls it one;
  this app has no milestone field, so the diamond marks the **last dated task
  in each phase** — a real date off real tasks — and the legend says "Phase
  end" rather than borrowing the mockup's word for something the data cannot
  support. A phase nobody has dated gets no diamond, not one at zero.
- ❌ Adding a column to the WBS row without a fixed-width slot. `.wbs-ititle`
  is the only thing that flexes; the planned window, the priority and the
  status each sit in a slot of their own width (`132px` / `46px` / `92px`), so
  every chip lines up into a column you can scan down. A chip sized by its own
  content puts a different edge on every row — the same mistake the Workload's
  cap notch made in T-0150.
- ❌ Answering a page that MOVED with Not Found. A page whose content was
  deleted is a 404; a page whose content moved is a redirect, and the two make
  different claims. T-0157 deleted the Analytics charts on request and put
  Monitoring's panels at that address, so `#/monitoring` forwards through
  `MOVED_VIEWS` / `resolveView` in `services/views.js` rather than erroring —
  bookmarks and saved views keep working, and the Analytics registry entry
  carries Monitoring's search words so ⌘K for "cycle time" still finds it.
  Keep that table SMALL and keep it honest: an entry must forward to a page
  that really exists and must NOT itself be in the registry, and
  `tests/ui/hubs.test.mjs` fails the build on either. Our own links point at
  the real id — forwarding is for links we do not control.
- ❌ Deleting a page and leaving its saved views pointing at it. `savedViews`
  outlive the page they name: after T-0152 a view saved on the task table
  would have opened Not Found, which reads as a bug rather than as "that page
  is gone". `AppShell` filters the menu with `isKnownView(v.view)`. The
  documents are **not** rewritten — deleting somebody's saved view because we
  removed a page is not ours to do.
- ❌ Bringing bulk editing back without its guards. The bulk bar was deleted in
  T-0152 along with the Table. If it ever returns, the rules it was built on
  still apply and are worth re-reading in git history: one vocabulary shared by
  the picker and the writer, an **inverse patch captured from each task before
  the write** (an Undo derived from the action alone cannot know what the tasks
  were), commits in 400s **in series** (`Promise.all` over batches cannot say
  how far it got — the error carries `committed`), and no client-side
  permission check, because `firestore.rules` rejects a mixed batch whole and a
  partial bulk edit driven by a guess is worse. `services/writeBatches.js` is
  what survived: `duplicateProject` batches through it.
- ❌ Leaving a density decision in place after the thing got denser. The board
  card hid its plan dates on purpose — a comment said so — from before it gained
  assignees, custom fields, counters and a subtask bar, and all it kept was a bare
  "Overdue" badge: true of a task one day late and one due last quarter alike, and
  silent about the one due tomorrow. `dueChip(task, today)` in the pure
  `services/dueChip.js` is the one rule ("Due today", "Due Fri" inside a week,
  "Due Oct 12" beyond it, "3d late" when it has passed, and nothing at all on a
  done card, where early-or-late is the fact that matters). Dates print
  month-first, matching `fmtDay` — two date orders across two surfaces reads as
  two different dates.
- ❌ Naming a button's target only in its `title`. A touch device has no hover, so
  the Dashboard's "Log time" told nobody which task it had chosen until the modal
  was already open — and when nothing was overdue it fell through to `filtered[0]`,
  logging hours against whichever task happened to sort first. `logTimeTarget()` in
  the pure `services/logTime.js` picks only when there is a reason to (late, due
  today, in progress) and returns `null` otherwise, which is the signal to ASK;
  `logTimeLabel()` puts the title on the button face. A button that says "Log time"
  must also open a form: it used to open `TaskActivitiesModal`, a read-only table.
- ❌ Opening a second modal over a half-filled form to change one of its fields.
  It unmounts the form and takes the entry with it, and it stacks a second focus
  trap and a second Escape handler. `ActivityLogger`'s "Change task" is an inline
  `select` that replaces the task name in place, so the hours already typed
  survive both the change and the cancel. `LogActivityPicker` stays a modal
  because there it is the ENTRY point — there is no form behind it yet.
- ❌ An icon-only button (`✕ ✎ ▶ ↑ ↓ ⎘`) with no `aria-label`. It means nothing to a screen reader, and nothing on a touch device where there is no hover to reveal a `title`. Make the two match.
- ❌ A confirm button that says "OK". Say what will happen — Delete, Remove, Revoke — and pass `danger: true` when it destroys something.
- ❌ Showing a repo filename, a config key or "check the console" to a user. Error copy goes through `friendlyError(err, '<plain sentence>')` in `services/access.js`; `tests/ui/copy.test.mjs` fails the build otherwise.
- ❌ Drag-and-drop: if a card click triggers a drag, wrap inner buttons with `onPointerDown={(e) => e.stopPropagation()}` and `onClick={(e) => e.stopPropagation()}` so dnd-kit doesn't capture the gesture
- ❌ Editing an activity's hoursSpent or attachments with `updateActivity` directly — that won't sync the parent task's denormalized counters. Use `editActivity(oldActivity, updates)` instead.
- ❌ Swim-lanes when projectFilter is "all" — phase IDs differ across projects so the toggle is hidden in that case. The page header chip only shows when a single project is selected.
- ❌ Calling the Anthropic API directly from a component — go through `askAI`
- ❌ Gating an AI surface on `getEffectiveApiKey()` — CLI users have no key
- ❌ Reading `company.anthropicApiKey` in the client. It is not there any more — check `company.hasApiKey`.
- ❌ Gating an AI surface on `profile.companyId` — a user with no company still has AI when the bridge is up. Use `useAiStatus().available`.
- ❌ Treating `bridge-api` as `claude-code` — it cannot browse or ground, and it is billed per token
- ❌ Returning a mock or API fallback without setting `degraded` + `reason`
- ❌ Omitting `--tools ""` when spawning the CLI (that leaves every built-in tool live)
- ❌ Firing `task.updated` for a counter the app bumped. `taskEventsFor` ignores `updatedAt`, `lastActivityAt`, `activityCount`, `totalHoursLogged` and `attachmentCount` — otherwise every activity write doubles an integration's traffic.
- ❌ Asking anyone for a Firebase UID. Invite by email (`inviteToWorkspaceByEmail`); show `memberLabel(uid, memberProfiles)`, never the uid. The Account ID box is superadmin-only and behind an Advanced toggle.
- ❌ Adding an invite field without its flat twin. `pendingInvites` is an array of maps: rules cannot search it, so `pendingInviteEmails` (array-contains) and `pendingInviteRoles` (role lookup) must be written in the same update. `inviteFields()` / `revokeInviteFields()` do all three.
- ❌ Persisting due-alert snooze/skip on the task document — tasks are shared across workspace members; one person's snooze must not silence a teammate. Keep it in per-device localStorage via `dueAlerts.js`.
- ❌ Gating the due-alert prompt block on an API key — use `useAiStatus().available`; CLI users have no key. When AI is unavailable the block falls back to `buildFallbackPrompt` and labels it as a template.
- ❌ Keeping a second list of the app's pages. `services/views.js` is the registry the rail, the tab strips, the bottom bar, the page title, the not-found check and the ⌘K palette all read. This has now drifted three times from three different copies: `NAV_TARGETS` (Workload, Trash and Artifacts unreachable from search — Trash above all, which is where somebody goes the moment they delete something by accident), `VIEW_NAMES` (a crash on Task table reported as a crash on `""`), and `BOTTOM_TABS` (five destinations on a phone against a sidebar of twenty-two, with Messages on neither). `tests/ui/commandPalette.test.mjs` and `tests/ui/hubs.test.mjs` fail the build if a registry entry is unreachable from the palette, or owned by no hub or by two.
- ❌ Drawing the Board hub's toolbar inside a page, or reading its filter
  without `scopeTasks`. It is one strip above eight tabs: `AppShell` renders it
  once for the whole hub, and every page runs its list through
  `services/boardScope.js`. A page that draws its own copy, or that quietly
  ignores the filter, shows a different number from its neighbours and gives
  the reader no way of telling which one is wrong — the same failure as
  `NAV_TARGETS`, `VIEW_NAMES` and `BOTTOM_TABS`. `tests/ui/boardHub.test.mjs`
  fails the build on either.
- ❌ Giving a grid column `1fr` when something inside it scrolls. The Board
  hub's eight-tab strip has `overflow-x: auto`, but a `1fr` track's floor is
  its own min-content, so the strip widened the entire app shell and put a
  horizontal scrollbar on every page at phone width. The shell's content column
  is `minmax(0, 1fr)`, and so are `.board` and `.tiles`.
- ❌ Hand-rolling a circle with somebody's initial in it. There is one
  `Avatar`, and its colour comes from `avatarColor(id)` — derive it, never
  store it, or the same person is a different colour on every device and you
  own a migration. Guarded by `tests/ui/boardHub.test.mjs`.
- ❌ Reusing `.tone-red` / `.tone-amber` for coloured TEXT. Those classes carry
  a **fill** as well, so every workload figure came out wearing a pill. The
  text-only set is `.tone-ink-*`.
- ❌ Measuring "time in stage" or an age from `createdAt`. That is when somebody typed the title; it says nothing about whether the work is stuck. `FlowView` measures from `actual.startDate` for work in progress and from the plan's start otherwise, and a task with neither is left out rather than shown as nought days old.
- ❌ Printing a rate off an empty denominator. "100% on-time" from nobody finishing anything, and "+4000% over" against an estimate of zero, are the two most misleading numbers a report can carry. `PeopleView` shows `—` when no dated task was finished, and `services/effort.js` refuses a percentage against a zero estimate; `VarianceView` excludes unestimated tasks and says how many it excluded.
- ❌ Writing a page's title inside the page. The chrome draws it (see **Navigation**); a view that also renders `.page-header` / `.page-title` puts the same name on screen twice, and `tests/ui/hubs.test.mjs` fails the build on either class. Use `<PageSubtitle>` for the count line and `<PageActions>` for the buttons — and import them, because an undefined `<PageActions>` is a ReferenceError that only shows up when the page is *mounted*: `npx vite build` will not catch it.
- ❌ Passing a filter prop the receiving view never declares. `App.jsx` handed `initialTagFilter` to four views; three of them declared nothing, so a saved view filtered to `#client` showed everything while the sidebar tooltip still advertised the tag — and nothing fails when a prop is merely unused. Filtering goes through `services/tagFilter.js` and the shared `TagFilterBar`; `tests/ui/tagFilterViews.test.mjs` reads `App.jsx` and fails the build if a view is handed the prop without declaring it. Note that an **activity has no tags of its own** — it borrows its task's, so the Activity Log passes `{ taskById }`.
- ❌ Declaring a `useQuickCreate` listener that ignores its argument. The palette shows the name in its hint — *New project · “Website revamp”* — so a zero-argument `useCallback(() => setEditing('new'), [])` makes that hint a lie and the user retypes what they just typed. Take the text, wrap it with `newSeed()` and apply it with `useSeededField()` (both in `hooks/useQuickCreate.js`); seed only a NEW one, never an existing one being edited, and clear the seed on close. `tests/ui/quickCreateSeed.test.mjs` fails the build on a zero-argument listener.
- ❌ Putting a caught error's own message on the screen — `setError(err.message)`, or `{error.message}` in JSX. An AI error is written for whoever has to fix it ("Start it with `npm run bridge`", "AI API error 429: {…raw body…}"), and inline error rendering is copy just as much as a toast is; the toast guard only ever inspected toasts, so nine surfaces were showing SDK text. Every AI failure goes through `describeAiFailure(err, fallback, { isOperator })` in `services/errorMessages.js`: one plain sentence on screen, the operator's version to `console.error`, and the real thing shown only to an operator (`useIsOperator()`). `tests/ui/copy.test.mjs` fails the build on either pattern.
- ❌ Writing the operator test out by hand. `profile.role === 'superadmin' && profile.status === 'approved'` lived in two components and was about to appear in a third — use `isOperatorProfile()` / `useIsOperator()` from `hooks/useUserProfile.js`. Guarded by `tests/ui/copy.test.mjs`.
- ❌ Offering a field in the import wizard and not writing it. The mapping step, the preview and the write all read from `IMPORT_KINDS` — but the write used to be a hand-built object in `ImportWizard.jsx`, so Status was mapped, guessed from the heading, shown in the preview and then silently dropped, and every imported task landed in To Do. The payload is built by `importedTaskPayload()` in `services/csv.js`, **beside the field list**, and `tests/ui/importStatus.test.mjs` fails the build if a field is added to `IMPORT_KINDS.tasks` without a home in it.
- ❌ Adding a status without the runner's copy of the list. The automations
  editor imports `functions/src/automations.js` directly so the form and the
  runner share one vocabulary — but that file is deployed as a **Cloud
  Function**. Adding `review` to it in the repo is not enough:
  `npm run deploy:functions` has to follow, or a rule authored in the browser
  is rejected by a runner that has never heard of the status.
- ❌ Hardcoding a field in `addTask` and overwriting what the caller handed it. It is the single create path for nine call sites (quick-add, the editor's subtask promotion, templates, the gallery, the AI generator, minutes, the CSV importer, the import wizard, the recurrence spawn), and it used to force `status: 'todo'`, `progress: 0` and empty actual dates **in silence** — a caller that asked for anything else got no error and no effect. `status`, `progress` and `actual` are all optional now: whatever the caller states wins, `statusStamps()` fills only the gaps, an unknown status is coerced to `'todo'` and a percentage is clamped to 0–100 rather than rejected. Note `clampProgress` returns `null` for "no statement" so an explicit `0` is not mistaken for silence.
- ❌ Deriving progress and the actual dates from a status by hand. `statusStamps()` in the pure `services/taskStatus.js` is the one rule, used by `addTask` and `setTaskStatus` alike — otherwise a task reaches "done" with different stamps depending on how it got there. `addTask` takes an optional `status` that defaults to `'todo'`, so quick-add and the recurrence spawn are unaffected.
- ❌ Requiring both plan dates to draw a Gantt bar. The row filter admits a task with **any** one of its four dates, and the app's dominant create path — quick-add, and the natural-language parser behind it — writes only an end date, so the commonest task in the app used to get a row with a title and a blank track that dragging could not fix. `effectivePlan()` in `services/ganttGeometry.js` makes a one-date plan a **one-day milestone** on that date; `dragOrigin()` gives it a real origin, so dragging its left edge is how it gains the `plan.startDate` it never had. Geometry and drag arithmetic live in that pure module — not inline in the component, where they were untestable.
- ❌ Measuring a node with `useRef` + `useEffect(…, [])` on a component that
  returns early while it loads. On mount the Gantt is still a spinner, so the
  ruler does not exist, the ref is null, the observer is never attached and
  the measured width stays 0 — which made `dayWidth` 0 and skipped **every
  bar**, drawing a chart of empty rows with nothing in the console. A
  callback ref fires when the node arrives, whenever that is.
- ❌ Giving the Gantt a fixed pixels-per-day again. The chart fits its card:
  the track column is measured with a `ResizeObserver` and every coordinate —
  bars, the Today line, the dependency arrows, the drag's days-per-pixel —
  is derived from `dayWidth = trackW / range.total`. A zoom preset would
  bring back the horizontal scroll the Explorer does not have. Note the
  corollary: one day can be two pixels on a six-month window, so a bar's
  floor is `min-width` in CSS (12px for a one-day milestone), in one place,
  not a `Math.max` at the call site.
- ❌ Gantt drag persistence: pointer events have to be on `window` for `pointermove`/`pointerup` (not just the bar element) — otherwise releases outside the bar leave the drag state stuck. But the effect that installs them must be keyed on the drag's **mode**, not on the drag: `onMove` replaces the drag state on every pointermove, so an effect depending on it tore both listeners down and put them back dozens of times a second, on the one interaction that has to hold 60fps — and the write at pointerup came from whichever closure was installed at that instant, over a possibly stale `task`. The live geometry and the task are read from refs (`dragRef`, `taskRef`); `setBothDrag` writes the ref and the state together so they cannot drift. `tests/ui/ganttDragListeners.test.mjs` spies on `window.addEventListener` and fails the build if a 40-move drag installs more than once (it used to install 41 times).
- ❌ Writing one AI message for two audiences. An `askAI` result carries `reason` (shown to anybody — plain, no CLI name, no provider id, no bridge URL) and `operatorHint` (the commands and the Settings section), and `<AiOperatorHint hint={…} />` renders the second only where `useIsOperator()` is true. `mockReply`'s body used to print `npm i -g @anthropic-ai/claude-code` straight into the answer for every user. `tests/ui/aiOperatorCopy.test.mjs` fails the build if a component outside an operator gate writes an npm command, and checks that the gates it exempts are still there.
- ❌ Showing a shell command, a bridge URL or a CLI name to anyone but the operator. `KnowledgeSection` takes `isOperator` (approved superadmin only); the wording for both audiences comes from `knowledgeCopy(status, { isOperator })` in `services/knowledgeCopy.js`, tested by `knowledgeCopy.test.mjs` and `tests/ui/KnowledgeSection.test.mjs`.
- ❌ Spawning `notebooklm` anywhere but `bridge/notebooklm.mjs` — same rule as `claude` in `bridge/ai.mjs`. A component, a hook and `src/services/*` all reach it through `/knowledge/*`.
- ❌ Putting a long body in argv. `source add --type text` takes the text as a positional argument, so anything past ~256 KB fails with E2BIG. `sourceAddPlan()` switches to a temp file and `--type file` above `STDIN_THRESHOLD`; `askNotebook` already hands long questions over on stdin.
- ❌ Passing `ask --new`. It **deletes** the notebook's server-side conversation and the turns are not recoverable. Continue with `-c <conversationId>` instead.
- ❌ Using `payload.error` as an error message. In this CLI `error` is a **boolean** flag — read `payload.message`, or the user is told the problem is "true". Covered by `bridge/notebooklm.test.mjs`.
- ❌ Letting a picker or a validator call the CLI. `NotebookPicker` and `validateNotebookChoice` read `cachedNotebooks()` only; a `null` cache means "don't know", never "it's gone" — a saved `notebookId` is kept with a warning, never cleared.
- ❌ Writing a second copy of the automation vocabulary in the UI. `AutomationsSection` imports `TRIGGERS` / `CONDITION_FIELDS` / `OPERATORS` / `ACTIONS` / `describeRule` / `validateRule` from `functions/src/automations.js` — the module the runner uses. A parallel list in a component is how a form comes to offer a rule the runner will never run.
- ❌ Showing an id in an automation. Every value in a rule is a project, a person, a phase or a connection: render it through the section's `nameFor`, and pick it from a dropdown. Nobody types an id.
- ❌ Taking a control off the chrome without re-homing it. "Simpler" and
  "unreachable" look identical in a screenshot. Every one of the eight things
  removed from the top bar in T-0146 has a row in the chrome table above
  saying where it went, and `tests/ui/chrome.test.mjs` fails the build if one
  of those homes disappears — the inbox above all, because `mentions.js` goes
  on writing notices whether or not anything renders them.
- ❌ An action with nowhere to land. "Tell someone" writes a `notifications` doc — if nothing renders those, the action is dead UI. Settings → Automations shows the signed-in person's unread notices.
- ❌ Relying on the on-completion path alone for a recurring task. It dies at the first missed occurrence, which is the opposite of what a schedule is for. `useRecurrenceCatchUp` is the second path; both key on `recurrenceParentId` + the due date, which is what makes them safe to run at the same time.
- ❌ Creating a recurring occurrence early. `HORIZON_DAYS = 0`: it appears on the day it is due. A horizon of a week puts next week's copy on the board beside this week's.
- ❌ Putting the shared page behind the auth gate. `#/shared/<token>` renders in App.jsx **before** the `!ready` check — asking a client to sign in is the one thing it must never do. It imports `SharedSnapshot` and `getSharedView` and nothing else from the app.
- ❌ Making a share link a window instead of a snapshot. `sharedViews/{token}` holds the rows it shows, so a leaked token leaks one project's headline state and never grows into more; opening `tasks` to an unauthenticated reader would have been a hole the size of the workspace. What may leave is the written-down list in `SHARED_TASK_FIELDS` — no people, no hours, no comments, no attachments.
- ❌ Enforcing a link's expiry in the page. `allow list: if false` plus `shareIsLive()` in `firestore.rules` is what makes a revoked or expired link stop working; a UI check would be bypassed by the SDK in a console.
- ❌ Inserting a short @handle from a picker. `preferredHandle()` picks the shortest handle **nobody else answers to** — offering "@mia" when there are two Mias would notify the first one whatever you clicked. `mentionedUids` resolves by first claim, so the picker has to hand back something unambiguous.
- ❌ Navigating to a task by hand. `goToTask(task, navigate)` in `services/openTask.js` does the two steps (filter the Board to its project, then fire `OPEN_TASK_EVENT`); search results and the inbox both use it, so they behave identically.
- ❌ Writing a notice by hand. `mentions.js` builds the whole sentence (`buildNotice`) so an old notice still reads correctly after the wording changes, and the rules only accept `kind` in mention/comment/assignment from a browser — `automation` is the function's, written with admin credentials. Raise them with `raiseNotices`, **after** the message itself is written: a notice that fails must never cost somebody their comment.
- ❌ Storing an upload under the uploader. `users/{uid}/…` made the uploader the only person who could ever delete the file, so an admin who deleted somebody else's activity left the bytes behind for ever. Every upload goes through `uploadFile({ workspaceId, … })`.
- ❌ Deleting an activity without its files. `deleteActivity` / `bulkDeleteActivities` call `deleteUploads(attachmentPaths(...))` and `editActivity` calls `deleteUploads(orphanedPaths(...))` — **after** the batch commits, so a file the bucket refuses to drop can never block the record from going.
- ❌ Letting a variable-width element share a row with a `flex: 1` track. The
  Workload's "N assumed" chip appears on some rows and not others; because the
  bar is `flex: 1`, the rows that had one got a narrower track and the **cap
  notch landed in a different place on every row** — and a cap you cannot
  compare against is the one job that chart has. The chip lives in a
  fixed-width `.wl-assumed-slot` that is always rendered, empty or not.
- ❌ Truncating the one fact that stops a chart being believed. The mockup's
  Workload name column is 104px and ellipsises; "3 assumed" ended up as "3…",
  which is precisely the number that keeps a full-looking bar honest. Copy the
  mockup's geometry, then put the honesty signal somewhere it cannot be cut.
- ❌ Leaving a harness twin on the old markup after a port. `dev/shell.jsx`
  draws a static copy of each panel; if the component moves to new classes and
  the twin does not, the harness is verifying a design that no longer ships —
  which is worse than having no harness, because it looks like a check.
  `tests/ui/boardExplorer.test.mjs` asserts the twin moved too.
- ❌ Sweeping "dead" CSS with a plain grep. Half of `.pe-*` is addressed
  **dynamically** — `pe-tone-${g.tone}` in ActivityTimeline, `pe-pill-${health.tone}`
  and `pe-kpi pe-tone-${k.tone}` in ProjectsView — so a static search for the
  literal class name reports `pe-pill-amber`, `pe-pill-red`, `pe-tone-muted` and
  friends as orphans when every one of them is live. T-0160's sweep would have
  deleted five such rules. Grep for the **prefix with a `${`** before deleting
  anything, and remember `.pe-*` is shared three ways: the task editor, the
  project editor and ActivityTimeline. Only `.pe-child*`, `.pe-children*` and
  `.pe-kind-task` were genuinely orphaned by that port, and only those went.
- ❌ Porting a mockup and leaving the old markup behind. Two designs shipping
  at once looks fine in a screenshot of either one. T-0148 replaced the
  Kanban, so `.board`, `.column*`, `.task-card` (bar `-actions`), `.tc-rail`,
  `.tc-prog`, `.swim-lane*`, `.board-segment*`, `.droppable`, `.kchip*`,
  `.kflag*` and `.tag-filter-bar*` were deleted **in the same pass** — and
  `TutorialGuide`'s step selectors pointed at `.task-card`, so the tour would
  have highlighted nothing on three of its steps. `grep` the old class names
  across `src/`, `dev/` **and** `tests/` before calling a port done;
  `tests/ui/boardExplorer.test.mjs` fails the build if one returns.
- ❌ Revealing a card's controls on hover alone. `.task-card-actions` was
  `opacity: 0` until `:hover`, which on a touch device is an **invisible but
  still tappable** row — worse than hidden, because the target is there and
  nobody can see it. It is quiet by default, lifts on hover, and
  `@media (hover: none)` gives it full strength.
- ❌ Hiding a control and calling the feature removed. The board's quick-add
  strip no longer stands open, but the toolbar's "+ New item" and ⌘K → New
  task are the only ways a task gets created from the Board — so the form is
  rendered on request rather than deleted, and the tour now starts at the
  button instead of pointing at a form that is not on screen.
- ❌ Telling somebody who IS the admin to "ask an admin". The Automations page
  offers its write buttons only when `workspace.acl[uid]` is owner or admin,
  and `firestore.rules` tests the very same fact — so a refusal there means the
  page and the server have come apart, and the commonest reason is deployed
  rules lagging the repo. `friendlyError`'s generic sentence sent the admin
  looking for a person who does not exist; `deniedDespiteRole(err, {
  believedAllowed })` in `services/access.js` says the true thing instead and
  hands the operator the one command that fixes it, on the console rather than
  the screen. Whenever a control is gated on a role, the denial copy has to
  know that the gate said yes.
- ❌ Reordering a hub's tabs and moving its home by accident. `hubLanding`
  returns `tabs[0]` unless the hub says otherwise, so putting Kanban third
  would have made the rail's Board icon open the Calendar — invisible in a
  screenshot, noticed only by whoever clicks the rail. A hub whose strip order
  and home differ states `landing`, and `tests/ui/hubs.test.mjs` checks it
  names one of that hub's own tabs.
- ❌ Expressing a three-valued default with a two-valued map. Once the first
  Kanban band opens by default, "nobody has said" and "shut" stop being the
  same thing: `{}` no longer means collapsed, it means *apply the default*. Any
  "collapse everything" button must therefore write explicit falses. The rule
  is `services/boardBands.js`; the bug it prevents is a button that silently
  does nothing to the one band the user was looking at.
- ❌ Assuming `firestore.indexes.json` is DEPLOYED. It is a file, not a state:
  the live project had only two legacy indexes and **none** of the twelve in
  the file, so `subscribeToAllActivities` — the listener behind the Activity
  log, Work performed, Timesheet, Review and the Dashboard — answered
  `failed-precondition` on every load and every one of those pages was empty
  (BUG-033). That is a *different* bug from the workspace-clearing one below
  and it was the proximate cause. `failed-precondition` on a listener means
  **missing index**, every time; `npm run deploy:indexes` is the fix, and
  adding an entry to the file without running it changes nothing. Check with
  `npx firebase firestore:indexes --project task-monitor-cbaf2`, which prints
  what is really there.
- ❌ Writing a query on a different axis from the rule that guards it. **Rules
  are not filters**: Firestore evaluates the read rule against every document
  a query could return and refuses the WHOLE query if one fails, so a query
  that omits the clause the rule tests does not return less — it returns
  nothing, for ever. Three of them shipped at once (BUG-033):
  `savedViews` was queried `where('workspaceId','==',ws)` under a rule of
  `isOwner(resource)` — a comment even explained that it avoided a composite
  index, which it did, by asking a question that can never be answered; and
  `subscribeTo{Tasks,Activities}ByProjects` asked `where('projectId','in',[…])`
  with nothing the rule could use. All three were `permission-denied` in the
  console and silently empty on screen. The by-project pair was **deleted** —
  every caller had already scoped the ids to the active workspace, which the
  workspace-wide listeners cover in full. Note the emulator does **not**
  enforce production's per-query document-access budget, so a query like that
  passes `npm run test:rules` and fails in the browser; the guard in
  `tests/rules/consoleErrors.rules.test.mjs` says so rather than pretending.
- ❌ Requiring membership to READ the workspace that is inviting you. The
  invitee is by definition not in `members` yet — that is what claiming is
  for — so `allow read: if uid in resource.data.members` made
  `claimPendingWorkspaceInvites`'s `array-contains` query permission-denied and
  **invite-by-email could never complete for anybody**. `pendingInviteEmails`
  is the flat array that exists precisely so a rule can check it, and the read
  rule simply never did. `isInvitedToWorkspace()` grants read on that one
  workspace while the invitation is outstanding, and claiming consumes the
  email so the branch closes behind them.
- ❌ Treating an empty snapshot as proof. `listenerError` in firebase.js answers
  ANY listener failure with `callback([])` — a token refresh losing a race with
  a rules evaluation, a network blip — so "I could not read your workspaces"
  and "you are in no workspaces" arrive as the same value. `useWorkspaces` used
  to act on that: `if (!data.some(w => w.id === active)) setActiveWorkspaceId(data[0]?.id || null)`
  cleared the active workspace on an empty snapshot **and cleared the
  localStorage key with it**, so the damage outlived the reload. Every
  `useActiveWorkspaceId()` then returned null, every workspace-scoped listener
  took its `if (!workspaceId)` branch and set its list to `[]`, and the two
  pages that are nothing but a list — **Activity log** and **Work performed** —
  rendered an empty table with no error and no spinner. That is what "the data
  always disappears" was. The rule is `nextActiveWorkspaceId` in
  `services/activeWorkspace.js` and nowhere else: an empty snapshot changes
  nothing, and the active workspace is re-pointed only when there is something
  real to re-point it at.
- ❌ Letting "still resolving" render as "there is nothing". Signed in with no
  workspace yet is a LOADING state — the query has not been asked, so its
  answer cannot be "none". Nine hooks in `useTasks.js` said
  `setLoading(workspaceId ? true : false)`, which showed an empty Activity log
  instead of a spinner; they ask `isResolvingWorkspace()` now. Same family as
  "no rate off an empty denominator": say you do not know, rather than
  answering zero.
- ❌ Swallowing `permission-denied` in a listener. It was logged for every code
  except that one — the single most likely code for a transient failure — so
  the page went blank with nothing in the console to say why, and there was no
  thread to pull. Every code is warned now.
- ❌ Printing a shortcut, a status or a path the app does not have, because the
  mockup drew one. A how-to page is read as a promise: the Dashboard
  Explorer's Shortcuts card lists **N**, **L**, **G then B**, **G then R** and
  **?**, and this app handles none of them — press one, nothing happens, and
  the reader stops believing the other three panels too. `SHORTCUTS` in
  `HowToUseView.jsx` is the app's own key handling with the file that
  implements each one beside it, and `tests/ui/howToUse.test.mjs` reads
  `AppShell.jsx` and `DueTaskAlertModal.jsx` to check each key is really
  handled — and fails the build if one of the mockup's five comes back. Same
  rule as "never invent a number", one step further: never invent a
  *capability*.
- ❌ Drawing a made-up row in a panel whose whole claim is "this is your
  data". The How-to-use data model nests WORKSPACE › PROJECT › ITEM ›
  ACTIVITY, and it draws the reader's **own newest activity** — the fastest
  way to believe the shape is to see your row in it. When there is nothing to
  draw it still draws the shape, and the panel head says which it is (`your
  most recent entry` against `nothing logged yet — the activity row is an
  example`). A fabrication passed off as a reading is the failure; a labelled
  example is not.
- ❌ Deleting a page's content because the mockup that replaced its LOOK had
  no room for it. T-0156 ported four panels over a ten-section playbook; the
  decision guide, the concepts, the scenarios, the rhythms, the page list, the
  principles, the anti-patterns and the glossary were **re-homed** into the
  mockup's own card idiom as `<details>` folds, shut by default, not dropped.
  `tests/ui/howToUse.test.mjs` fails the build if one of those eight constants
  is defined and never rendered — which is how content dies quietly.
- ❌ Rendering a failed grounding as a clean answer. Propagate `degraded` + `reason` and show the "not grounded" badge; `grounding` is `null` when the lookup failed.
