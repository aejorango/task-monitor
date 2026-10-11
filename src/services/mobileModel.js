// src/services/mobileModel.js — what the mobile app (Mobile App v7) shows,
// computed from the app's real tasks, activities, projects and goals.
//
// Pure: no Firebase, no React. The mobile screens render what these return,
// so the buckets, the counts and the percentages can be tested with node
// --test and cannot drift between the Home triage, the Tasks list and the
// Week strip — the same failure the desktop's one-definition rule exists for.
//
// The mockup's own words are kept ("Working", "To do", "Overdue", "This week")
// but every number is a reading of real data. Where the mockup drew a
// capability the app does not have, the screen says what is really there.

import { displayStatus } from './boardScope.js';
import { estimateOf } from './effort.js';
import { goalProgress, deliverableProjectIds } from './goalProgress.js';

// ── dates ───────────────────────────────────────────────────────────────────

export function addDays(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function dateOf(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Today", or month-first like every other date in the app: "Jul 21". */
export function shortDate(ymd, today) {
  if (!ymd) return '';
  if (ymd === today) return 'Today';
  if (today && ymd === addDays(today, -1)) return 'Yesterday';
  return dateOf(ymd).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/** "Mon, Jul 20" — the Home header. */
export function longDate(ymd) {
  return dateOf(ymd).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Whole days from a to b. */
export function daysBetween(a, b) {
  return Math.round((dateOf(b) - dateOf(a)) / 86400000);
}

// ── status ──────────────────────────────────────────────────────────────────

/**
 * The mobile app's status words — the mockup's, with In review added because
 * it is a real status here (T-0147) and a task in review must be showable.
 * `fill` / `ink` / `rail` are CSS token names, so dark mode follows.
 */
export const M_STATUS = {
  todo:   { label: 'To do',     glyph: '○', tone: 'grey'  },
  doing:  { label: 'Working',   glyph: '◐', tone: 'amber' },
  review: { label: 'In review', glyph: '◑', tone: 'blue'  },
  stuck:  { label: 'Stuck',     glyph: '!', tone: 'red'   },
  done:   { label: 'Done',      glyph: '✓', tone: 'green' },
};

/** What the status sheet offers, in the mockup's order. */
export const STATUS_SHEET_ORDER = ['todo', 'doing', 'stuck', 'review', 'done'];

/**
 * The status a task is SHOWN as. One rule with the desktop: a logged
 * bottleneck, or open and past its own plan date, reads Stuck — see
 * `displayStatus` in boardScope.js.
 */
export function mobileStatus(task, blockedIds, today) {
  const s = displayStatus(task, blockedIds, today);
  return M_STATUS[s.id] ? s.id : 'todo';
}

// ── buckets: Overdue · Today · This week · Later · Done ────────────────────

export const BUCKETS = {
  over:  { label: 'Overdue',   icon: '!', tone: 'red'   },
  today: { label: 'Today',     icon: '◷', tone: 'amber' },
  week:  { label: 'This week', icon: '▦', tone: 'blue'  },
  later: { label: 'Later',     icon: '→', tone: 'grey'  },
  done:  { label: 'Done',      icon: '✓', tone: 'green' },
};
export const BUCKET_ORDER = ['over', 'today', 'week', 'later', 'done'];

/**
 * Which bucket a task falls in. "This week" is the next six days after today,
 * as the mockup draws it; a task with no due date is Later — nobody has said
 * when, which is not the same as "soon".
 */
export function bucketOf(task, today) {
  if (task.status === 'done') return 'done';
  const due = task.plan?.endDate;
  if (!due) return 'later';
  if (due < today) return 'over';
  if (due === today) return 'today';
  if (due <= addDays(today, 6)) return 'week';
  return 'later';
}

/** Stuck first, then the soonest due, then the title. */
export function byUrgency(blockedIds, today) {
  return (a, b) => {
    const sa = mobileStatus(a, blockedIds, today) === 'stuck';
    const sb = mobileStatus(b, blockedIds, today) === 'stuck';
    if (sa !== sb) return sa ? -1 : 1;
    const da = a.plan?.endDate || '9999-99-99';
    const db = b.plan?.endDate || '9999-99-99';
    return da.localeCompare(db) || String(a.title || '').localeCompare(String(b.title || ''));
  };
}

const live = (t) => t && !t.deleted && !t.archived;

/** The four Home tiles: Overdue · Today · Stuck · Week. */
export function triageCounts(tasks = [], { blockedIds, today } = {}) {
  const all = tasks.filter(live);
  const count = (k) => all.filter((t) => bucketOf(t, today) === k).length;
  return {
    over: count('over'),
    today: count('today'),
    stuck: all.filter((t) => t.status !== 'done' && mobileStatus(t, blockedIds, today) === 'stuck').length,
    week: count('week'),
  };
}

/**
 * The Priority card: the one open task that most needs somebody — stuck
 * first, then due today, then the soonest. Null when nothing is open.
 */
export function priorityTask(tasks = [], { blockedIds, today } = {}) {
  const open = tasks.filter((t) => live(t) && t.status !== 'done');
  if (!open.length) return null;
  const rank = (t) => (mobileStatus(t, blockedIds, today) === 'stuck' ? 0
    : t.plan?.endDate === today ? 1 : 2);
  return [...open].sort((a, b) => rank(a) - rank(b) || byUrgency(blockedIds, today)(a, b))[0];
}

/** "Needs you": everything overdue or due today, minus the Priority card. */
export function needsYou(tasks = [], { blockedIds, today, exclude = null } = {}) {
  return tasks
    .filter((t) => live(t) && t.id !== exclude)
    .filter((t) => ['over', 'today'].includes(bucketOf(t, today)))
    .sort(byUrgency(blockedIds, today));
}

/** How late, in the card's words: "2 days late", "Due today", "Due Jul 24". */
export function lateLabel(task, today) {
  const due = task?.plan?.endDate;
  if (!due) return 'No due date';
  if (task.status !== 'done' && due < today) {
    const n = daysBetween(due, today);
    return `${n} day${n === 1 ? '' : 's'} late`;
  }
  if (due === today) return 'Due today';
  return `Due ${shortDate(due, today)}`;
}

// ── the task list ───────────────────────────────────────────────────────────

/** Owner of a task as the mobile app shows one person: the first assignee. */
export function ownerOf(task) {
  const uid = (task?.assignedTo || [])[0] || null;
  if (uid) return { uid, name: null };
  const ext = (task?.assignedToExternal || [])[0] || null;
  return ext ? { uid: null, name: ext } : null;
}

/** Hours left on a task: estimate minus logged, never below zero. Null = nobody estimated it. */
export function hoursLeft(task) {
  const est = estimateOf(task);
  if (est == null) return null;
  return Math.max(0, est - (Number(task.totalHoursLogged) || 0));
}

/** "8.5/12h", or "8.5h" when there is no estimate — not "/0h". */
export function hoursLabel(task) {
  const logged = Math.round((Number(task?.totalHoursLogged) || 0) * 10) / 10;
  const est = estimateOf(task);
  return est == null ? `${logged}h` : `${logged}/${est}h`;
}

/**
 * Apply the Tasks filters. Every list is optional and empty means "all".
 * `status` matches the SHOWN status, so filtering by Stuck finds the late
 * ones the board also calls Stuck.
 */
export function filterTasks(tasks = [], {
  projects = [], people = [], statuses = [], q = '', blockedIds, today,
} = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return tasks.filter(live).filter((t) => {
    if (projects.length && !projects.includes(t.projectId)) return false;
    if (people.length && !(t.assignedTo || []).some((u) => people.includes(u))) return false;
    if (statuses.length && !statuses.includes(mobileStatus(t, blockedIds, today))) return false;
    if (needle && !`${t.title || ''} ${t.description || ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/**
 * The List view's groups. `by` is due | project | owner, as the mockup's
 * Due ▸ Project ▸ Owner button cycles. Done is always its own group at the
 * foot, collapsed by default with Later.
 */
export function groupTasks(tasks = [], {
  by = 'due', projects = [], members = [], blockedIds, today,
} = {}) {
  const cmp = byUrgency(blockedIds, today);
  const done = { key: 'done', kind: 'bucket', bucket: 'done', items: tasks.filter((t) => t.status === 'done') };
  let defs;
  if (by === 'project') {
    defs = projects.map((p) => ({
      key: `p_${p.id}`, kind: 'project', project: p,
      items: tasks.filter((t) => t.projectId === p.id && t.status !== 'done'),
    }));
    defs.push({ key: 'p_none', kind: 'project', project: null,
      items: tasks.filter((t) => !projects.some((p) => p.id === t.projectId) && t.status !== 'done') });
    defs.push(done);
  } else if (by === 'owner') {
    defs = members.map((uid) => ({
      key: `w_${uid}`, kind: 'owner', uid,
      items: tasks.filter((t) => ownerOf(t)?.uid === uid && t.status !== 'done'),
    }));
    defs.push({ key: 'w_none', kind: 'owner', uid: null,
      items: tasks.filter((t) => !members.includes(ownerOf(t)?.uid) && t.status !== 'done') });
    defs.push(done);
  } else {
    defs = BUCKET_ORDER.map((k) => ({ key: k, kind: 'bucket', bucket: k, items: tasks.filter((t) => bucketOf(t, today) === k) }));
  }
  return defs
    .filter((g) => g.items.length)
    .map((g) => {
      const items = [...g.items].sort(cmp);
      const isDone = g.key === 'done';
      const hours = items.reduce((n, t) => n + (isDone ? (Number(t.totalHoursLogged) || 0) : (hoursLeft(t) || 0)), 0);
      return {
        ...g,
        items,
        // Every group starts folded: the heads are the overview (a count and
        // the hours in each), and a tap opens the one you want.
        defaultOpen: false,
        hoursLabel: `${Math.round(hours * 10) / 10}h${isDone ? '' : ' left'}`,
      };
    });
}

export const GROUP_CYCLE = { due: 'project', project: 'owner', owner: 'due' };
export const GROUP_LABEL = { due: 'Due', project: 'Project', owner: 'Owner' };

// ── the Week view ───────────────────────────────────────────────────────────

/**
 * The Week strip: `before` days back and `after` days on from today, each with
 * how many open tasks are due on it. The strip scrolls sideways, so it is a
 * run of weeks rather than one; 0 / 6 is the original seven days.
 */
export function weekStrip(tasks = [], today, { before = 0, after = 6 } = {}) {
  const due = {};
  tasks.forEach((t) => {
    if (live(t) && t.status !== 'done' && t.plan?.endDate) due[t.plan.endDate] = (due[t.plan.endDate] || 0) + 1;
  });
  return Array.from({ length: before + after + 1 }, (_, i) => {
    const ymd = addDays(today, i - before);
    const d = dateOf(ymd);
    return {
      ymd,
      dow: d.toLocaleDateString('en', { weekday: 'short' }).toUpperCase(),
      n: d.getDate(),
      // The month, on the 1st and on the strip's first day, so a scroll that
      // crosses into another month says so.
      month: d.getDate() === 1 || i === 0 ? d.toLocaleDateString('en', { month: 'short' }).toUpperCase() : null,
      count: due[ymd] || 0,
    };
  });
}

export function weekDayLabel(ymd, today) {
  const long = dateOf(ymd).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  return ymd === today ? `TODAY · ${long}` : long;
}

// ── the Team view ───────────────────────────────────────────────────────────

export const WEEKLY_CAPACITY = 35;

/**
 * Remaining hours per person against a 35h week, as the mockup draws it. A
 * task nobody estimated adds nothing and is COUNTED, so a short bar can say
 * "2 not estimated" rather than pass for a light week.
 */
export function workloadRows(tasks = [], members = []) {
  return members.map((uid) => {
    const mine = tasks.filter((t) => live(t) && t.status !== 'done' && (t.assignedTo || []).includes(uid));
    const unestimated = mine.filter((t) => hoursLeft(t) == null).length;
    const hours = Math.round(mine.reduce((n, t) => n + (hoursLeft(t) || 0), 0) * 10) / 10;
    const pct = Math.round((hours / WEEKLY_CAPACITY) * 100);
    return {
      uid, open: mine.length, hours, pct, unestimated,
      tone: pct > 100 ? 'red' : pct > 85 ? 'amber' : 'green',
    };
  });
}

// ── This week (Home) ────────────────────────────────────────────────────────

/** Hours logged since `since` (inclusive), per person and for one person. */
export function hoursSince(activities = [], since) {
  const byUser = {};
  activities.forEach((a) => {
    if (a.deleted || !a.date || a.date < since) return;
    byUser[a.userId] = (byUser[a.userId] || 0) + (Number(a.hoursSpent) || 0);
  });
  return byUser;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export const PERIOD_DAYS = { Week: 7, Month: 30, Quarter: 90 };

/** The report for the last 7 / 30 / 90 days. */
export function reportFor(period, { activities = [], tasks = [], projects = [], blockedIds, today } = {}) {
  const since = addDays(today, -(PERIOD_DAYS[period] || 7) + 1);
  const acts = activities.filter((a) => !a.deleted && a.date && a.date >= since && a.date <= today);
  const total = acts.reduce((n, a) => n + (Number(a.hoursSpent) || 0), 0);
  const done = tasks.filter((t) => live(t) && t.status === 'done'
    && t.actual?.endDate && t.actual.endDate >= since && t.actual.endDate <= today).length;
  const stuck = tasks.filter((t) => live(t) && t.status !== 'done'
    && mobileStatus(t, blockedIds, today) === 'stuck').length;
  const byProject = {};
  acts.forEach((a) => { byProject[a.projectId || ''] = (byProject[a.projectId || ''] || 0) + (Number(a.hoursSpent) || 0); });
  const rows = Object.entries(byProject)
    .map(([pid, h]) => ({ project: projects.find((p) => p.id === pid) || null, hours: Math.round(h * 10) / 10 }))
    .filter((r) => r.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  return { since, total: Math.round(total * 10) / 10, done, stuck, rows, entries: acts.length };
}

/** The Work log tab: entries grouped by day, newest first. */
export function workLogDays(activities = [], { since, today } = {}) {
  const byDay = {};
  activities.forEach((a) => {
    if (a.deleted || !a.date || (since && a.date < since)) return;
    (byDay[a.date] = byDay[a.date] || []).push(a);
  });
  return Object.keys(byDay).sort().reverse().map((d) => ({
    date: d,
    label: shortDate(d, today),
    total: Math.round(byDay[d].reduce((n, a) => n + (Number(a.hoursSpent) || 0), 0) * 10) / 10,
    items: byDay[d],
  }));
}

/** The Artifacts tab, and a task's Files tab: every attachment on the activities given. */
export function attachmentsOf(activities = []) {
  return activities.flatMap((a) => (a.attachments || []).map((f, i) => ({
    key: `${a.id}:${i}`,
    name: f.name || f.url || 'File',
    url: f.url || null,
    size: f.size || null,
    type: fileType(f),
    activity: a,
  })));
}

// Extensions worth printing as a file's type. Anything else a link ends in
// ("…/docs.google.com", "…/v2") is a LINK, not a "COM" or a "V2".
const FILE_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md', 'rtf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'zip', 'mp4', 'mov', 'mp3', 'json', 'html']);

export function fileType(f) {
  if (f?.type === 'drive') return 'DRIVE';
  const name = String(f?.name || f?.url || '');
  const ext = name.includes('.') ? name.split('.').pop().split('?')[0].toLowerCase() : '';
  if (FILE_EXTS.has(ext)) return ext.toUpperCase();
  if (f?.type === 'external' || /^https?:/i.test(f?.url || name)) return 'LINK';
  return ext && ext.length <= 4 ? ext.toUpperCase() : 'FILE';
}

/**
 * A pasted link as an activity attachment — the desktop ActivityLogger's
 * shape exactly: { name, url, type: 'drive' | 'external' }. A missing scheme
 * gets https://; anything that is not a web address is refused (null), so a
 * typo never becomes a link nobody can open. With no name, the file name in
 * the path is used when there is one ("retry-policy.pdf"), else the site —
 * never a path word like "edit".
 */
export function linkAttachment(rawUrl, rawName = '') {
  let url = String(rawUrl || '').trim();
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  const seg = u.pathname.split('/').filter(Boolean).pop();
  const decode = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const fromPath = seg ? decode(seg) : '';
  const looksLikeFile = FILE_EXTS.has(fromPath.split('.').pop().toLowerCase()) && fromPath.includes('.');
  const name = String(rawName || '').trim() || (looksLikeFile ? fromPath : u.hostname.replace(/^www\./, ''));
  return { name, url: u.href, type: u.href.includes('drive.google') ? 'drive' : 'external' };
}

export function fileSize(bytes) {
  const n = Number(bytes);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Goals: what each project contributes ────────────────────────────────────

/**
 * The goal card's "How it's calculated", worked out from `goalProgress` so
 * the sum of the rows IS the goal's percentage. A goal averages its measured
 * deliverables; a deliverable averages its projects — so a project's weight
 * is the sum over the deliverables that point at it of 1/measured × 1/links.
 */
export function goalBreakdown(goal, projectStats = {}) {
  const g = goalProgress(goal, projectStats);
  const measured = g.deliverables.filter((d) => d.pct != null);
  const weights = {};
  measured.forEach((d) => {
    const ids = deliverableProjectIds(d).filter((id) => projectStats[id]);
    ids.forEach((id) => { weights[id] = (weights[id] || 0) + 1 / measured.length / ids.length; });
  });
  const rows = Object.entries(weights).map(([id, w]) => {
    const p = projectStats[id];
    return { id, name: p.name, color: p.color, pct: p.pct || 0, weight: w, contrib: (p.pct || 0) * w };
  });
  return { ...g, rows };
}

/** "1/2" for a weight of a half; otherwise a percentage. */
export function weightLabel(w) {
  const inv = 1 / w;
  if (Math.abs(inv - Math.round(inv)) < 1e-6) return `1/${Math.round(inv)}`;
  return `${Math.round(w * 100)}%`;
}

// ── misc ────────────────────────────────────────────────────────────────────

/** The same code the desktop task editor prints. */
export function taskCode(task) {
  return `TASK ${String(task?.id || '').slice(0, 6).toUpperCase()}`;
}

/** The RAG words the Projects screen uses. */
export const RAG_WORD = { RED: 'At risk', AMBER: 'Watch', GREEN: 'On track', IDLE: 'No tasks yet' };

/** Greeting by the hour. */
export function greetingFor(hour) {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The due-date picker's choices: Today, Tomorrow and the next five days. */
export function dueChoices(today) {
  return Array.from({ length: 7 }, (_, i) => {
    const ymd = addDays(today, i);
    return { ymd, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dateOf(ymd).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) };
  });
}

/** Shift a plan by whole days, keeping its length. A task with no due date is left alone. */
export function shiftPlan(task, days) {
  const end = task?.plan?.endDate;
  if (!end) return null;
  const start = task.plan?.startDate;
  return {
    'plan.endDate': addDays(end, days),
    ...(start ? { 'plan.startDate': addDays(start, days) } : {}),
  };
}

// ── Minutes ─────────────────────────────────────────────────────────────────

/** "Ace Jorango, Mia" → ['Ace Jorango', 'Mia']. Minutes keep people as typed names. */
export function splitNames(text) {
  return String(text || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

/** The inverse, de-duplicated without regard to case. */
export function joinNames(names = []) {
  const seen = new Set();
  return names.map((n) => String(n || '').trim()).filter((n) => {
    const k = n.toLowerCase();
    if (!n || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(', ');
}

/** A meeting date: today and the six days before it — minutes are written after. */
export function pastChoices(today) {
  return Array.from({ length: 7 }, (_, i) => {
    const ymd = addDays(today, -i);
    return { ymd, label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : dateOf(ymd).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) };
  });
}

/**
 * The editor's working copy of a minute — the same shape the desktop
 * MinuteEditor holds, so either can save what the other opened. A new one
 * starts with one empty action item, as the desktop's does.
 */
export function minuteDraft(minute, { today, projectId = '', newId }) {
  const item = (it = {}) => ({ id: it.id || newId(), text: it.text || '', owner: it.owner || '', due: it.due || '', done: !!it.done, taskId: it.taskId || null });
  const line = (x = {}) => ({ id: x.id || newId(), text: x.text || '' });
  if (!minute) {
    return {
      title: '', date: today, attendees: '', location: '', projectId: projectId || '', notes: '', decisions: '',
      actionItems: [item()], bossName: '', bossMentions: [], bossPushbacks: [],
    };
  }
  return {
    title: minute.title || '',
    date: minute.date || today,
    attendees: minute.attendees || '',
    location: minute.location || '',
    projectId: minute.projectId || '',
    notes: minute.notes || '',
    decisions: minute.decisions || '',
    actionItems: (minute.actionItems || []).map(item),
    bossName: minute.bossName || '',
    bossMentions: (minute.bossMentions || []).map(line),
    bossPushbacks: (minute.bossPushbacks || []).map(line),
  };
}

/**
 * What is written. The desktop's rules exactly: a blank action item is
 * dropped unless it is linked to a task (dropping that would orphan the
 * task's link), blank priority lines are dropped, no project is null.
 */
export function minutePayload(form) {
  return {
    ...form,
    title: String(form.title || '').trim(),
    location: String(form.location || '').trim(),
    projectId: form.projectId || null,
    actionItems: (form.actionItems || []).filter((it) => it.text.trim() || it.owner.trim() || it.due || it.taskId)
      .map((it) => ({ ...it, text: it.text.trim(), owner: it.owner.trim() })),
    bossName: String(form.bossName || '').trim(),
    bossMentions: (form.bossMentions || []).filter((x) => x.text.trim()),
    bossPushbacks: (form.bossPushbacks || []).filter((x) => x.text.trim()),
  };
}

/** Has the form moved from where it started? Decides whether Back asks first. */
export function minuteChanged(a, b) {
  return JSON.stringify(minutePayload(a)) !== JSON.stringify(minutePayload(b));
}

// ── Projects: segments, sort, search ───────────────────────────────────────

export const NO_SEGMENT = 'Uncategorized';

/**
 * The segments to divide the list by: the workspace's own, plus any a project
 * still carries from before it was defined, Uncategorized last — the order
 * the desktop Portfolio uses.
 */
export function segmentNames(workspace, projects = []) {
  const set = new Set((workspace?.segments || []).map((s) => s.name).filter(Boolean));
  projects.forEach((p) => set.add(p.segment || NO_SEGMENT));
  return [...set].sort((a, b) => (a === NO_SEGMENT) - (b === NO_SEGMENT) || a.localeCompare(b));
}

/** How the Projects list can be sorted. Health is the desktop's own ranking. */
export const PROJECT_SORTS = {
  health: 'Health — worst first',
  name: 'Name',
  progress: 'Progress — least first',
  due: 'Finish date — soonest first',
};

/** Sort rated rows (from rateProjects, already in health order). */
export function sortProjects(rows = [], by = 'health') {
  const name = (r) => String(r.project?.name || '');
  const out = [...rows];
  if (by === 'name') out.sort((a, b) => name(a).localeCompare(name(b)));
  else if (by === 'progress') out.sort((a, b) => a.pct - b.pct || name(a).localeCompare(name(b)));
  // A project with no finish date has said nothing about when: last, not first.
  else if (by === 'due') out.sort((a, b) => String(a.end || '9999').localeCompare(String(b.end || '9999')) || name(a).localeCompare(name(b)));
  return out;
}

export function searchProjects(rows = [], q = '') {
  const n = String(q || '').trim().toLowerCase();
  if (!n) return rows;
  return rows.filter((r) => `${r.project?.name || ''} ${r.project?.description || ''} ${r.project?.segment || ''}`.toLowerCase().includes(n));
}

/** Rows divided into segments, in segment order; empty segments are left out. */
export function bySegment(rows = [], segments = []) {
  const order = segments.length ? segments : [NO_SEGMENT];
  return order
    .map((seg) => ({ segment: seg, rows: rows.filter((r) => (r.project?.segment || NO_SEGMENT) === seg) }))
    .filter((g) => g.rows.length);
}

/** The colours a new project can take — the desktop editor's own swatches. */
export const PROJECT_SWATCHES = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#3b82f6'];
