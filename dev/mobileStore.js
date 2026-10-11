// dev/mobileStore.js — the in-memory workspace behind dev/mobile.html.
//
// dev/mobile.vite.config.js routes every Firestore-touching module the phone
// app imports to `h` below: hooks read the store, writes change it, and every
// write is logged to the console so a flow can be checked end to end. The
// write semantics that matter are the real ones — statusStamps for a status,
// counters bumped with an activity — imported from the pure services.

import { useSyncExternalStore } from 'react';
import { todayLocal, addDaysISO } from '../src/services/recurrence.js';
import { statusStamps } from '../src/services/taskStatus.js';
import { scopeWorkspaceIds, mergedMemberProfiles, viewWorkspace } from '../src/services/activeWorkspace.js';

const T = todayLocal();
const at = (n) => addDaysISO(T, n);
const secsAgo = (mins) => ({ seconds: Math.floor(Date.now() / 1000) - mins * 60 });
let seq = 100;
const nid = (p) => `${p}-${(seq += 1)}`;

const ME = 'u-ace';
const PROFILES = {
  'u-ace': { displayName: 'Ace Jorango', email: 'ace@example.test' },
  'u-mia': { displayName: 'Mia Santos', email: 'mia@example.test' },
  'u-raf': { displayName: 'Rafael Cruz', email: 'raf@example.test' },
  'u-jen': { displayName: 'Jen Uy', email: 'jen@example.test' },
};

const task = (o) => ({
  workspaceId: 'ws-1', userId: ME, status: 'todo', priority: 'medium', description: '',
  plan: {}, actual: {}, subtasks: [], dependsOn: [], tags: [], assignedTo: [ME],
  totalHoursLogged: 0, estimateHours: null, activityCount: 0, deleted: false, archived: false, ...o,
});

let state = {
  workspaceId: 'ws-1',
  workspaces: [
    {
      id: 'ws-1', name: 'BRIDGED Q3', color: '#0051BA', members: Object.keys(PROFILES), memberProfiles: PROFILES,
      acl: { 'u-ace': 'owner', 'u-mia': 'admin', 'u-raf': 'editor', 'u-jen': 'viewer' },
      segments: [{ id: 'sg-1', name: 'Lending' }, { id: 'sg-2', name: 'Growth' }],
    },
    { id: 'ws-2', name: 'Personal', color: '#137a36', members: [ME], memberProfiles: { [ME]: PROFILES[ME] }, acl: { [ME]: 'owner' } },
  ],
  projects: [
    { id: 'p-sblaf', workspaceId: 'ws-1', name: 'SBLAF onboarding', segment: 'Lending', color: '#0051BA', userId: ME, members: ['u-mia', 'u-raf'],
      phases: [{ id: 'ph-1', name: 'Discovery', order: 0 }, { id: 'ph-2', name: 'Build', order: 1 }, { id: 'ph-3', name: 'Launch', order: 2 }] },
    { id: 'p-api', workspaceId: 'ws-1', name: 'Partner API', segment: 'Lending', color: '#e2892e', userId: 'u-mia', members: [ME, 'u-raf'], phases: [] },
    { id: 'p-mkt', workspaceId: 'ws-1', name: 'Marketplace', segment: 'Growth', color: '#7B2D8F', userId: ME, members: ['u-jen'], phases: [] },
    { id: 'p-home', workspaceId: 'ws-2', name: 'Home admin', color: '#137a36', userId: ME, members: [], phases: [] },
    { id: 'p-comp', workspaceId: 'ws-1', name: 'Compliance', color: '#137a36', userId: 'u-raf', members: [ME], phases: [] },
  ],
  tasks: [
    task({ id: 't-1', title: 'Migrate legacy loan records', projectId: 'p-sblaf', phaseId: 'ph-2', status: 'doing', priority: 'high',
      plan: { startDate: at(-12), endDate: at(-3) }, estimateHours: 12, totalHoursLogged: 8.5,
      description: 'Move the 2019–2023 loan book into the new schema. Borrower IDs must survive the move.',
      subtasks: [{ id: 's1', text: 'Export the 2019 book', done: true }, { id: 's2', text: 'Map borrower IDs', done: false }, { id: 's3', text: 'Dry run on staging', done: false }] }),
    task({ id: 't-2', title: 'KYC vendor MSA sign-off', projectId: 'p-sblaf', phaseId: 'ph-1', assignedTo: ['u-mia'], plan: { endDate: at(-1) }, estimateHours: 3 }),
    task({ id: 't-3', title: 'De-dup borrower records', projectId: 'p-sblaf', phaseId: 'ph-2', status: 'doing', plan: { startDate: at(-2), endDate: at(0) }, estimateHours: 6, totalHoursLogged: 2, dependsOn: ['t-1'] }),
    task({ id: 't-4', title: 'Rate-limit the partner sandbox', projectId: 'p-api', assignedTo: ['u-raf'], plan: { endDate: at(0) }, estimateHours: 4 }),
    task({ id: 't-5', title: 'Webhook retry policy doc', projectId: 'p-api', status: 'doing', plan: { startDate: at(-1), endDate: at(2) }, estimateHours: 5, totalHoursLogged: 1.5 }),
    task({ id: 't-6', title: 'Partner onboarding checklist', projectId: 'p-api', status: 'review', assignedTo: ['u-mia'], plan: { startDate: at(-4), endDate: at(3) }, estimateHours: 8, totalHoursLogged: 7 }),
    task({ id: 't-7', title: 'Listing page copy review', projectId: 'p-mkt', assignedTo: ['u-jen'], plan: { endDate: at(4) } }),
    task({ id: 't-8', title: 'Seller fee table', projectId: 'p-mkt', plan: { endDate: at(5) }, estimateHours: 3 }),
    task({ id: 't-9', title: 'AML policy refresh', projectId: 'p-comp', assignedTo: ['u-raf'], status: 'doing', plan: { startDate: at(-3), endDate: at(9) }, estimateHours: 14, totalHoursLogged: 4 }),
    task({ id: 't-10', title: 'Quarterly audit pack', projectId: 'p-comp', plan: { endDate: at(20) }, estimateHours: 10 }),
    task({ id: 't-11', title: 'Someday: marketplace analytics', projectId: 'p-mkt', plan: {} }),
    task({ id: 't-12', title: 'Kick-off deck', projectId: 'p-sblaf', phaseId: 'ph-1', status: 'done', plan: { endDate: at(-6) }, actual: { startDate: at(-8), endDate: at(-5) }, estimateHours: 4, totalHoursLogged: 3.5 }),
    task({ id: 't-13', title: 'API key rotation', projectId: 'p-api', status: 'done', assignedTo: ['u-raf'], plan: { endDate: at(-2) }, actual: { startDate: at(-3), endDate: at(-2) } }),
    // ── Personal (ws-2): what "All workspaces" adds to the same days ──
    task({ id: 'h-1', workspaceId: 'ws-2', projectId: 'p-home', title: 'Renew car registration', priority: 'high', plan: { endDate: at(0) }, estimateHours: 1 }),
    task({ id: 'h-2', workspaceId: 'ws-2', projectId: 'p-home', title: 'Book the dentist', plan: { endDate: at(2) } }),
    task({ id: 'h-3', workspaceId: 'ws-2', projectId: 'p-home', title: 'File the tax return', status: 'doing', plan: { startDate: at(-3), endDate: at(4) }, estimateHours: 3, totalHoursLogged: 1 }),
    task({ id: 't-14', title: 'Borrower portal SSO', projectId: 'p-sblaf', phaseId: 'ph-3', status: 'doing', assignedTo: ['u-mia'], plan: { startDate: at(-5), endDate: at(1) }, estimateHours: 9, totalHoursLogged: 6 }),
  ],
  activities: [
    { id: 'a-1', taskId: 't-1', userId: ME, projectId: 'p-sblaf', taskTitle: 'Migrate legacy loan records', date: at(0), hoursSpent: 2.5, comment: 'Mapped 2019 borrower IDs; 40 collide with 2021.', bottleneckRemarks: 'Waiting on the KYC vendor for the ID map', completionStatus: 'blocked',
      attachments: [{ name: 'id-collisions.xlsx', url: 'https://example.test/id-collisions.xlsx', type: 'application/vnd.ms-excel', size: 48213 }] },
    { id: 'a-2', taskId: 't-1', userId: ME, projectId: 'p-sblaf', taskTitle: 'Migrate legacy loan records', date: at(-1), hoursSpent: 3, comment: 'Exported the 2019 book.', attachments: [] },
    { id: 'a-3', taskId: 't-3', userId: ME, projectId: 'p-sblaf', taskTitle: 'De-dup borrower records', date: at(-1), hoursSpent: 2, comment: 'First pass of the matching rules.', attachments: [] },
    { id: 'a-4', taskId: 't-5', userId: ME, projectId: 'p-api', taskTitle: 'Webhook retry policy doc', date: at(0), hoursSpent: 1.5, comment: 'Drafted the 0/30/300s backoff section.', attachments: [{ name: 'retry-policy.pdf', url: 'https://example.test/retry-policy.pdf', size: 210000 }] },
    { id: 'a-5', taskId: 't-6', userId: 'u-mia', projectId: 'p-api', taskTitle: 'Partner onboarding checklist', date: at(-2), hoursSpent: 4, comment: 'Checklist ready for review.', attachments: [] },
    { id: 'a-6', taskId: 't-9', userId: 'u-raf', projectId: 'p-comp', taskTitle: 'AML policy refresh', date: at(-3), hoursSpent: 4, comment: 'Read through the 2024 circular.', attachments: [] },
    { id: 'a-7', taskId: 't-14', userId: 'u-mia', projectId: 'p-sblaf', taskTitle: 'Borrower portal SSO', date: at(-4), hoursSpent: 6, comment: 'SAML handshake works on staging.', attachments: [] },
  ],
  comments: [
    { id: 'c-1', taskId: 't-1', userId: 'u-mia', body: '@Ace the vendor says Thursday for the ID map.', createdAt: secsAgo(95) },
    { id: 'c-2', taskId: 't-1', userId: ME, body: 'Thanks — I will park the collisions until then.', createdAt: secsAgo(40) },
  ],
  minutes: [
    { id: 'm-1', title: 'SBLAF weekly', projectId: 'p-sblaf', date: at(-1), location: 'Room 4', attendees: 'Ace Jorango, Mia Santos, Rafael Cruz',
      notes: 'Migration is two days behind on the borrower ID collisions; vendor answer due Thursday.',
      decisions: '• Freeze the schema until the ID map lands\n• Mia owns the vendor follow-up',
      bossName: 'Mia', bossMentions: [{ id: 'b1', text: 'Get the loan book across before launch' }], bossPushbacks: [{ id: 'b2', text: 'No new SSO providers this quarter' }],
      actionItems: [{ id: 'x1', text: 'Chase the KYC vendor', done: true, owner: 'Mia Santos' }, { id: 'x2', text: 'Publish the collision list', done: false, owner: 'Ace Jorango', due: at(-1) }] },
    { id: 'm-2', title: 'Partner API sync', projectId: 'p-api', date: at(-6), attendees: 'Ace Jorango, Rafael Cruz', notes: 'Sandbox limits agreed.', decisions: '', actionItems: [{ id: 'x3', text: 'Rate-limit the sandbox', done: false, owner: 'Rafael Cruz' }] },
    { id: 'm-3', title: 'Leadership huddle', date: at(-2), attendees: 'Ace Jorango, Mr. Reyes', notes: 'Hiring plan for Q4.', decisions: '', actionItems: [] },
  ],
  goals: [
    { id: 'g-1', title: 'Faster time-to-decision', kpi: '≤ 48h decisions', deliverables: [{ id: 'd1', title: 'Loan book live', projectIds: ['p-sblaf'] }, { id: 'd2', title: 'Partner intake', projectIds: ['p-api', 'p-sblaf'] }] },
    { id: 'g-2', title: 'Zero-defect onboarding', kpi: '< 1% data errors', deliverables: [{ id: 'd3', title: 'Audit pack', projectIds: ['p-comp'] }] },
    { id: 'g-3', title: 'Marketplace open', kpi: '3 partners', deliverables: [{ id: 'd4', title: 'Unwired', projectIds: [] }] },
  ],
  notices: [
    { id: 'n-1', kind: 'mention', text: 'Mia mentioned you on “Migrate legacy loan records”', taskId: 't-1', read: false, at: secsAgo(95) },
    { id: 'n-2', kind: 'assignment', text: 'Rafael assigned you “Webhook retry policy doc”', taskId: 't-5', read: false, at: secsAgo(300) },
    { id: 'n-3', kind: 'automation', text: '“Overdue → tell owner” moved “KYC vendor MSA sign-off”', taskId: 't-2', read: true, at: secsAgo(60 * 26) },
  ],
};

// Activities carry their workspace, as the real documents do.
state.activities = state.activities.map((a) => ({ workspaceId: state.tasks.find((t) => t.id === a.taskId)?.workspaceId || 'ws-1', ...a }));
state.all = false;

let version = 0;
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function set(fn) {
  state = fn(state);
  version += 1;
  listeners.forEach((l) => l());
}
const log = (name, args) => console.info(`[harness] ${name}`, ...args);

// Dotted-path updates, as Firestore's updateDoc takes them.
function patch(obj, updates) {
  const out = structuredClone(obj);
  for (const [k, v] of Object.entries(updates)) {
    const parts = k.split('.');
    let cur = out;
    while (parts.length > 1) { const p = parts.shift(); cur[p] = { ...(cur[p] || {}) }; cur = cur[p]; }
    cur[parts[0]] = v;
  }
  return out;
}
const live = (t) => !t.deleted && !t.archived;
const wsOf = (x) => x.workspaceId || 'ws-1';
// The workspaces in view — the real rule, from services/activeWorkspace.js.
const scope = () => scopeWorkspaceIds({ all: state.all, activeId: state.workspaceId, workspaces: state.workspaces });
const inWs = (x) => scope().includes(wsOf(x));

const HOOKS = {
  useAuth: () => ({ userId: ME, ready: true }),
  useTasks: () => {
    const tasks = state.tasks.filter((t) => inWs(t) && !t.deleted);
    return { tasks, loading: false, userId: ME, todo: [], doing: [], done: [], overdue: [] };
  },
  useProjects: () => {
    const projects = state.projects.filter(inWs);
    return { projects, byId: Object.fromEntries(projects.map((p) => [p.id, p])), loading: false, userId: ME };
  },
  useAllActivities: () => ({ activities: state.activities.filter((a) => {
    const t = state.tasks.find((x) => x.id === a.taskId); return !t || inWs(t);
  }), loading: false }),
  useActivities: (taskId) => ({ activities: state.activities.filter((a) => a.taskId === taskId), loading: false }),
  useTaskComments: (_ws, taskId) => ({ comments: state.comments.filter((c) => c.taskId === taskId), loading: false }),
  useMinutes: () => ({
    minutes: state.minutes.filter((x) => !x.deleted && inWs(x)).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    loading: false,
  }),
  useGoals: () => ({ goals: state.goals.filter(inWs), loading: false }),
  useAllWorkspaceProjects: () => ({ projects: state.projects, loading: false }),
  useAllWorkspaceTasks: () => ({ tasks: state.tasks.filter(live), loading: false }),
  useWebhooks: () => ({ hooks: [{ id: 'w1', url: 'https://hooks.example.test/tm' }], loading: false, userId: ME, workspaceId: state.workspaceId }),
  useSavedViews: () => ({ views: [], loading: false }),
  useTemplates: () => ({ templates: [], loading: false }),
  useMyTasksAcrossWorkspaces: () => ({ tasks: [], loading: false }),
  useRecentActivities: () => ({ activities: [], byDay: {}, totalHours: 0, loading: false }),
  useActiveWorkspaceId: () => state.workspaceId,
  useAllWorkspaces: () => state.all,
  useMemberProfiles: () => mergedMemberProfiles(state.workspaces),
  useViewWorkspace: () => viewWorkspace({ all: state.all, activeId: state.workspaceId, workspaces: state.workspaces }),
  useScopeWorkspaceIds: () => ({ ids: scope(), all: state.all, activeId: state.workspaceId, pending: false }),
  useWorkspaces: () => ({ workspaces: state.workspaces, loading: false }),
  useSyncMyMemberProfile: () => undefined,
  useInbox: () => ({
    notices: state.notices,
    unread: state.notices.filter((n) => !n.read).length,
    markRead: (n) => set((s) => ({ ...s, notices: s.notices.map((x) => (x.id === n.id ? { ...x, read: true } : x)) })),
    markAllRead: () => set((s) => ({ ...s, notices: s.notices.map((x) => ({ ...x, read: true })) })),
  }),
  useAiStatus: () => ({ provider: 'none', known: true, available: false, allowed: true, recheck: () => {} }),
};

const VALUES = {
  db: null,
  auth: { currentUser: { uid: ME, isAnonymous: false, displayName: 'Ace Jorango', email: 'ace@example.test', providerData: [] } }, storage: null, SUPERADMIN_EMAILS: [], ACTIVITY_PAGE_SIZE: 200, CAN_DELETE_FOREVER: false, FUNCTIONS_REGION: 'asia-southeast1' };

const CALLS = {
  getActiveWorkspaceId: () => state.workspaceId,
  getAllWorkspaces: () => state.all,
  setAllWorkspaces: (on) => set((s) => ({ ...s, all: !!on })),
  setActiveWorkspaceId: (id) => set((s) => ({ ...s, workspaceId: id })),
  peekAuthState: () => ({ userId: ME, ready: true }),
  uid: () => nid('id'),
  async addTask(_u, payload) {
    const id = nid('t');
    const stamps = statusStamps(payload.status || 'todo', { today: T });
    set((s) => ({ ...s, tasks: [...s.tasks, task({ ...payload, id, progress: stamps.progress, actual: { startDate: stamps.actualStartDate, endDate: stamps.actualEndDate } })] }));
    return { id };
  },
  async updateTask(id, updates) { set((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? patch(t, updates) : t)) })); },
  async setTaskStatus(t, next) {
    const cur = state.tasks.find((x) => x.id === t.id) || t;
    const st = statusStamps(next, { today: T, current: { ...cur.actual, progress: cur.progress } });
    set((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, status: next, progress: st.progress, actual: { startDate: st.actualStartDate, endDate: st.actualEndDate } } : x)) }));
  },
  async addActivity(userId, t, a) {
    const act = { id: nid('a'), taskId: t.id, userId, projectId: t.projectId, taskTitle: t.title, attachments: [], ...a };
    set((s) => ({
      ...s,
      activities: [act, ...s.activities],
      tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, totalHoursLogged: (Number(x.totalHoursLogged) || 0) + (Number(a.hoursSpent) || 0), activityCount: (x.activityCount || 0) + 1 } : x)),
    }));
  },
  async uploadFile({ file }) { return { name: file.name, url: URL.createObjectURL(file), type: file.type, size: file.size }; },
  async addTaskComment(userId, t, body) { set((s) => ({ ...s, comments: [...s.comments, { id: nid('c'), taskId: t.id, userId, body, createdAt: secsAgo(0) }] })); },
  async addProject(userId, project) {
    const id = nid('p');
    set((s) => ({ ...s, projects: [...s.projects, { ...project, id, userId, members: [userId], acl: { [userId]: 'admin' }, archived: false, deleted: false }] }));
    return { id };
  },
  async updateProject(id, updates) { set((s) => ({ ...s, projects: s.projects.map((x) => (x.id === id ? { ...x, ...updates } : x)) })); },
  async addSegmentToWorkspace(wsId, name) {
    set((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, segments: [...(w.segments || []), { id: nid('sg'), name }] } : w)) }));
  },
  async addMinute(userId, minute) {
    const id = nid('m');
    set((s) => ({ ...s, minutes: [{ ...minute, id, userId, deleted: false }, ...s.minutes] }));
    return { id };
  },
  async softDeleteMinute(id) { set((s) => ({ ...s, minutes: s.minutes.map((x) => (x.id === id ? { ...x, deleted: true } : x)) })); },
  async restoreDeleted(kind, id) {
    const key = { minute: 'minutes', task: 'tasks', project: 'projects', goal: 'goals' }[kind];
    set((s) => ({ ...s, [key]: s[key].map((x) => (x.id === id ? { ...x, deleted: false } : x)) }));
  },
  async updateMinute(id, updates) { set((s) => ({ ...s, minutes: s.minutes.map((m) => (m.id === id ? { ...m, ...updates } : m)) })); },
  async addWorkspace(userId, { name }) {
    const w = { id: nid('ws'), name, color: '#e2892e', members: [userId], memberProfiles: { [userId]: PROFILES[userId] }, acl: { [userId]: 'owner' } };
    set((s) => ({ ...s, workspaces: [...s.workspaces, w] }));
    return w;
  },
  async updateWorkspaceMemberRole(ws, uid, role) {
    set((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === ws.id ? { ...w, acl: { ...w.acl, [uid]: role } } : w)) }));
  },
  async inviteToWorkspaceByEmail() {},
  async notifyAssignment() {},
  async signOutUser() {},
};

// ── Firebase's own subscribe* calls, answered live ─────────────────────────
// With HARNESS=desktop only firebase.js is stubbed, so the REAL hooks run and
// call these. Each answer is recomputed and re-sent whenever the store changes.
const inOne = (ws) => (x) => wsOf(x) === ws;
const SUBS = {
  onAuthChange: () => ({ uid: ME, isAnonymous: false, displayName: 'Ace Jorango', email: 'ace@example.test', photoURL: null, providerData: [] }),
  subscribeToUserProfile: () => ({ uid: ME, role: 'superadmin', status: 'approved', displayName: 'Ace Jorango', email: 'ace@example.test' }),
  subscribeToWorkspaces: () => state.workspaces,
  subscribeToTasks: (ws) => state.tasks.filter((t) => inOne(ws)(t) && !t.deleted),
  subscribeToProjects: (ws) => state.projects.filter((p) => inOne(ws)(p) && !p.deleted),
  subscribeToSharedProjects: () => [],
  subscribeToAllActivities: (ws) => state.activities.filter(inOne(ws)),
  subscribeToRecentActivities: (ws, since) => state.activities.filter((a) => inOne(ws)(a) && a.date >= since),
  subscribeToActivities: (ws, taskId) => state.activities.filter((a) => inOne(ws)(a) && a.taskId === taskId),
  subscribeToGoals: (ws) => state.goals.filter(inOne(ws)),
  subscribeToMinutes: (ws) => state.minutes.filter((x) => inOne(ws)(x) && !x.deleted),
  subscribeToTemplates: () => [],
  subscribeToTaskComments: (_ws, taskId) => state.comments.filter((c) => c.taskId === taskId),
  subscribeToTasksAcrossWorkspaces: (ids) => state.tasks.filter((t) => ids.includes(wsOf(t)) && !t.deleted),
  subscribeToProjectsAcrossWorkspaces: (ids) => state.projects.filter((p) => ids.includes(wsOf(p))),
  subscribeToMyTasksAcrossWorkspaces: (ids, uid) => state.tasks.filter((t) => ids.includes(wsOf(t)) && (t.assignedTo || []).includes(uid)),
  subscribeToActivitiesAcrossWorkspaces: (ids, since) => state.activities.filter((a) => ids.includes(wsOf(a)) && (!since || a.date >= since)),
  subscribeToMyNotifications: () => state.notices,
};

// One answer per hook per store version, so a re-render that changed nothing
// hands back the same arrays — as a Firestore listener does.
const cache = new Map();
export const h = {
  use(name, args) {
    const v = useSyncExternalStore(subscribe, () => version);
    const key = `${name}:${JSON.stringify(args)}`;
    const hit = cache.get(key);
    if (hit && hit.v === v) return hit.value;
    const fn = HOOKS[name];
    const value = fn ? fn(...args) : {};
    cache.set(key, { v, value });
    return value;
  },
  call(name, args) {
    log(name, args);
    if (CALLS[name]) return CALLS[name](...args);
    if (name.startsWith('subscribe') || name === 'onAuthChange') {
      const cb = [...args].reverse().find((x) => typeof x === 'function');
      const rest = args.filter((x) => typeof x !== 'function');
      const answer = SUBS[name] ? () => SUBS[name](...rest) : () => [];
      // A listener answers asynchronously, as Firestore's does.
      let alive = true;
      queueMicrotask(() => { if (alive) cb?.(answer()); });
      const off = SUBS[name] ? subscribe(() => { if (alive) cb?.(answer()); }) : () => {};
      return () => { alive = false; off(); };
    }
    return Promise.resolve(undefined);
  },
  value(name) { return VALUES[name]; },
};

export const HARNESS_USER = ME;
export const HARNESS_PROFILE = { displayName: 'Ace Jorango', role: 'member', status: 'approved' };
