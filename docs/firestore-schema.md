# Task Monitor — Scalable Firestore Schema

This schema is designed so your task tracker can grow from 10 tasks to 10,000+ without hitting Firestore's structural blockers (1 MiB doc limit, expensive reads, slow queries, fragile updates).

---

## Design Principles Applied

1. **Subcollections → flat root collections** where queries cut across parents
2. **Denormalize counters** on parent docs so the UI never reads the whole child collection just to show a number
3. **Denormalize lightweight parent fields** onto children for fast list/journal views
4. **`userId` everywhere** — multi-user-ready and makes security rules trivial
5. **Soft delete (`deleted: false`)** — recover mistakes, preserve history
6. **Pre-shaped for the indexes you'll actually need**

---

## The Structure

```
📁 Firestore root
│
├── 📂 users
│   └── 📄 {userId}
│       ├── email
│       ├── displayName
│       ├── createdAt
│       └── preferences: {
│             defaultCategory: "BRIDGED",
│             weekStartsOn: "Monday"
│           }
│
├── 📂 tasks                                  ← LEAN parent docs
│   └── 📄 {taskId}
│       │
│       ├── userId                            ← owner ref
│       ├── title
│       ├── description
│       ├── category                          ← BRIDGED | AIM | Personal | custom
│       ├── priority                          ← low | medium | high
│       ├── status                            ← todo | doing | done
│       ├── progress                          ← 0–100
│       │
│       ├── plan: {
│       │     startDate: 2026-05-19,
│       │     endDate:   2026-05-25
│       │   }
│       ├── actual: {
│       │     startDate: 2026-05-19,
│       │     endDate:   null                 (null until done)
│       │   }
│       │
│       │── ─── Denormalized counters (atomic, fast) ───
│       ├── activityCount:     0              ← FieldValue.increment(1) on add
│       ├── totalHoursLogged:  0.0            ← FieldValue.increment(hrs)
│       ├── attachmentCount:   0
│       ├── lastActivityAt:    timestamp      ← for sorting "recently worked on"
│       │
│       │── ─── Lifecycle ───
│       ├── archived: false
│       ├── deleted:  false                   ← soft delete
│       ├── createdAt
│       └── updatedAt
│
├── 📂 activities                             ← ROOT collection, not subcollection
│   └── 📄 {activityId}
│       │
│       ├── taskId                            ← reference back to parent
│       ├── userId                            ← for security rules + per-user queries
│       │
│       │── ─── Denormalized from task (for journal/timeline views) ───
│       ├── taskTitle                         ← snapshot at log time
│       ├── taskCategory
│       │
│       │── ─── Activity payload ───
│       ├── date                              ← the day work happened (YYYY-MM-DD or timestamp)
│       ├── comment                           ← what you did
│       ├── hoursSpent: 2.5
│       ├── statusAtTime: "doing"             ← snapshot
│       │
│       │── ─── Attachments (inline, capped at ~20) ───
│       ├── attachments: [
│       │     {
│       │       name: "draft_v1.1.pdf",
│       │       url:  "https://drive.google.com/...",
│       │       type: "drive",                ← drive | firebase | external | image
│       │       size: 248000                  (bytes, optional)
│       │     },
│       │     ...
│       │   ]
│       │
│       └── loggedAt: timestamp               ← when entry was created
│
├── 📂 attachments                            ← ONLY if some activities exceed ~20 files
│   └── 📄 {attachmentId}
│       ├── activityId
│       ├── taskId
│       ├── userId
│       ├── name, url, type, size
│       └── uploadedAt
│
└── 📂 categories                             ← user-defined beyond the 3 defaults
    └── 📄 {categoryId}
        ├── userId
        ├── name:      "ISFC Project"
        ├── color:     "#2a9d8f"
        ├── icon:      (optional)
        ├── archived:  false
        └── createdAt
```

---

## Why Activities Live at the Root

The earlier draft had `tasks/{taskId}/activities/{activityId}` as a subcollection. That works, but a **flat root collection scales better** for the views you'll actually want:

| Query | Subcollection version | Flat version |
|---|---|---|
| All activities for one task | Easy | `where('taskId', '==', id)` |
| Today's log across all tasks | Needs `collectionGroup()` query | Simple `where('date', '==', today)` |
| Weekly hours per category | Collection group + extra read per activity | One query — `taskCategory` is denormalized |
| Sort all activities by recency | Per-task only | Across the whole tracker |

Both approaches hit the same indexes; flat is simpler and avoids collection-group quirks (different security rules, separate index management).

---

## Why Counters Live on the Task Document

Without denormalized counters, showing "23 activities · 47.5 hours" on a task card requires reading every activity in the collection. That's expensive and slow.

With `FieldValue.increment()` you update both atomically when an activity is added:

```js
// Adding an activity
const batch = writeBatch(db);
batch.set(doc(db, 'activities', newId), activityData);
batch.update(doc(db, 'tasks', taskId), {
  activityCount: increment(1),
  totalHoursLogged: increment(activityData.hoursSpent || 0),
  lastActivityAt: serverTimestamp(),
});
await batch.commit();
```

Now task cards render with one read each, no matter how many activities exist underneath.

---

## Stale Denormalized Data — Intentional

If you rename a task, the `taskTitle` on old activities stays as the original. **This is usually what you want** for an activity log — it captures what the work was called at the time. If you ever do need to propagate renames, a Cloud Function trigger on task updates can fan out, but for personal use it's not worth the complexity.

---

## Indexes You'll Need

Firestore will auto-prompt for these when queries fail, but pre-creating saves headaches. In the Firebase console under **Firestore → Indexes**:

| Collection | Fields | Used for |
|---|---|---|
| `tasks` | `userId ASC`, `status ASC`, `plan.endDate ASC` | Kanban board, overdue filter |
| `tasks` | `userId ASC`, `category ASC`, `status ASC` | Category-filtered view |
| `tasks` | `userId ASC`, `archived ASC`, `lastActivityAt DESC` | "Recently worked on" |
| `activities` | `userId ASC`, `date DESC` | Daily journal across all tasks |
| `activities` | `taskId ASC`, `date DESC` | Per-task activity timeline |
| `activities` | `userId ASC`, `taskCategory ASC`, `date DESC` | Weekly review by category |

---

## Limits You're Now Insulated From

| Firestore limit | How this schema avoids it |
|---|---|
| 1 MiB per document | Activities are siblings, not nested. Task doc stays under 5 KB even with 1000 activities. |
| 1 write/sec per doc (sustained) | Activity writes go to *different* docs. The task counter update is the only contention point — fine unless you're logging 60+ activities/minute on one task. |
| 20,000 fields per doc | N/A — we keep tasks lean. |
| Composite index 200 per DB | We use ~6, well under the cap. |
| Collection group caveats | Avoided by flattening. |

---

## Security Rules (Drop-in Starter)

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

    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
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

    match /attachments/{attachmentId} {
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

Pair this with **Anonymous Authentication** in Firebase Auth — one click, no UI needed, gives every browser session a stable `uid` so the rules work.

---

## Migration Path (Future-Proofing)

If you outgrow this and need:
- **Full-text search on comments** → mirror activities into Algolia or Typesense
- **Reports/analytics** → schedule a daily Cloud Function that aggregates to a `daily_summaries` collection
- **Multi-user teams** → add `teamId` field + adjust rules; the schema already supports it via `userId`
- **File uploads** → Firebase Storage for the bytes, only the URL goes into `attachments[]`

The schema doesn't have to change for any of these — only the read paths do.
