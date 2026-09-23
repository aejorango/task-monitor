// src/services/tutorialProgress.js — which lessons you have finished.
//
// The Dashboard Explorer's Tutorial tab draws a rail of six lessons with a
// "2/6" pill, a progress bar and a per-lesson state: done ✓, active ▸, or not
// started. Before this module the app had no such fact, and a hard-coded "2/6"
// would be the first lie on a page whose whole job is to be trusted.
//
// So completion is RECORDED. A lesson counts as done when somebody presses
// **Done** on the tour's last step — not when they open it, and not when they
// press "Skip tour", because neither of those means they were walked through
// it. `TutorialGuide.goNext` is the one place that can tell.
//
// Storage is per-device localStorage, keyed by uid, for the same reason the
// due-alert snooze is: tutorials are a personal fact about one reader, and
// writing them to a shared document would tell a teammate they had finished a
// lesson they have never seen. Nothing here is worth a Firestore write.
//
// The arithmetic is pure and the storage is injected, so `node --test` can put
// every case through without a DOM.

/**
 * A lesson was FINISHED — "Done" on the last step of the tour, nothing else.
 *
 * The tour is mounted in the shell and the Tutorial page is a sibling, so the
 * page cannot see a run end. It could re-read storage on every render instead,
 * but then finishing a tour would not tick the rail until something unrelated
 * caused a re-render. One event, one listener. It lives here rather than in
 * TutorialGuide.jsx so the page imports the event and the arithmetic from the
 * same place.
 */
export const TUTORIAL_DONE_EVENT = 'task-monitor:tutorial-done';

const KEY_PREFIX = 'task-monitor.tutorials.done.v1';

/** The storage key for one reader. Signed out shares one anonymous bucket. */
export function progressKey(uid) {
  return `${KEY_PREFIX}.${uid || 'anon'}`;
}

/**
 * The set of finished lesson ids.
 *
 * Every read is guarded: a private window, cleared site data or a blocked
 * origin makes `localStorage` throw rather than return null, and a page that
 * cannot render without it is a page that breaks in incognito.
 */
export function readDone(uid, storage = safeStorage()) {
  try {
    const raw = storage?.getItem(progressKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Record a lesson as finished. Returns the new set, so callers can setState. */
export function writeDone(uid, ids, storage = safeStorage()) {
  const next = new Set(ids);
  try { storage?.setItem(progressKey(uid), JSON.stringify([...next])); }
  catch { /* private window — the page still works, it just forgets */ }
  return next;
}

export function markDone(uid, id, storage = safeStorage()) {
  const next = readDone(uid, storage);
  next.add(id);
  return writeDone(uid, next, storage);
}

export function markUndone(uid, id, storage = safeStorage()) {
  const next = readDone(uid, storage);
  next.delete(id);
  return writeDone(uid, next, storage);
}

function safeStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

// ─── the pure arithmetic the rail draws ────────────────────────────────────

/**
 * What the rail shows against one lesson.
 *
 * `active` is the lesson the reader is LOOKING at, which is a different claim
 * from having finished it — the mockup draws them as different states and so
 * must this. Done wins over active: a finished lesson you are re-reading is
 * still finished.
 */
export function lessonState(id, done, activeId) {
  if (done?.has?.(id)) return 'done';
  if (id === activeId) return 'active';
  return 'todo';
}

export const STATE_LABEL = { done: 'Completed', active: 'In progress', todo: 'Not started' };
export const STATE_MARK  = { done: '✓', active: '▸', todo: '' };

/**
 * How far through the list somebody is.
 *
 * `pct` is for the bar's width. It is 0 when there are no lessons at all
 * rather than NaN — dividing by an empty list is the same mistake as printing
 * a rate off an empty denominator.
 */
export function progressOf(tutorials = [], done = new Set()) {
  const total = tutorials.length;
  const finished = tutorials.filter((t) => done?.has?.(t.id)).length;
  return { done: finished, total, pct: total === 0 ? 0 : Math.round((finished / total) * 100) };
}

/**
 * A lesson's number in the rail, as the mockup prints it: 01, 02 … 10.
 * Two digits so the mono column does not jitter at ten.
 */
export function lessonNumber(index) {
  return String(index + 1).padStart(2, '0');
}

/**
 * The size of a lesson, in the only unit this app actually knows.
 *
 * The mockup prints "3 min". Nothing here measures how long a tour takes and
 * a guess would be the same kind of invention as a fake shortcut — so the rail
 * prints the STEP COUNT, which is real, and which tells the reader the thing
 * they wanted to know anyway: how long is this.
 */
export function lessonSize(tutorial) {
  const n = tutorial?.steps?.length || 0;
  return `${n} step${n === 1 ? '' : 's'}`;
}

/**
 * The pages a tour walks you through, in order, without repeats.
 *
 * `labelFor` turns a view id into the name the rail and tab strip use, so the
 * chip beside a step says "Portfolio" rather than "projects".
 */
export function lessonPages(tutorial, labelFor = (v) => v) {
  const out = [];
  for (const s of tutorial?.steps || []) {
    if (!s?.view) continue;
    const label = labelFor(s.view);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}
