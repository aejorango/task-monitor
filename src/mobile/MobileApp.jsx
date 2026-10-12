// src/mobile/MobileApp.jsx — the app on a phone (≤720px), built to
// "Mobile App v7.dc.html": five tabs (Home · Tasks · + · Ask AI · More), push
// screens over them, a task screen over those, and bottom sheets on top.
//
// It replaces the desktop shell on a phone rather than squeezing it: the
// mockup is a different app shape, not a narrower one. Everything on it is
// wired to the same data and the same write paths the desktop uses —
// addTask, setTaskStatus, addActivity, addTaskComment, updateMinute,
// updateWorkspaceMemberRole — so a task changed here is changed everywhere.
//
// State that has to survive moving between tabs (the Tasks filters, the Ask
// AI thread, the log form) lives here, not in the screen that draws it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import {
  useActiveWorkspaceId, useWorkspaces, useAllWorkspaces, useMemberProfiles, useViewWorkspace,
} from '../hooks/useWorkspace';
import {
  addTask, updateTask, setTaskStatus, addActivity, notifyAssignment, todayLocal,
  editActivity, deleteActivity, softDeleteTask, restoreDeleted,
} from '../services/firebase';
import { blockedTaskIds } from '../services/boardScope';
import { memberLabel } from '../services/invites';
import { friendlyError } from '../services/access';
import { OPEN_TASK_EVENT } from '../services/openTask';
import { shiftPlan, M_STATUS, shortDate, logDraftFrom, logUpdates } from '../services/mobileModel';
import { useDialog } from '../components/Dialog';
import { MobileCtx, Ico, ICON, useMobile } from './mobileUi';
import MobileHome from './MobileHome';
import MobileTasks from './MobileTasks';
import MobileAskAi from './MobileAskAi';
import MobileMore from './MobileMore';
import MobilePush from './MobilePush';
import MobileTaskDetail from './MobileTaskDetail';
import MobileSheets from './MobileSheets';

const TABS = [
  ['home', 'Home'], ['board', 'Tasks'], ['plus', 'New'], ['ai', 'Ask AI'], ['more', 'More'],
];

// `attachments` are LINKS ({ name, url, type }), as the desktop logger takes them.
// `date` is a picked date (over the day chips); `editing` is the entry being
// edited, when the sheet was opened on one (see logDraftFrom).
const EMPTY_LOG = { taskId: null, hours: 1, details: '', bott: 'None', bottText: '', day: 0, date: null, attachments: [], editing: null };

export default function MobileApp({ userId, profile, route }) {
  const ask = useDialog();
  const { tasks: allTasks } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities } = useAllActivities();
  const { workspaces } = useWorkspaces();
  const workspaceId = useActiveWorkspaceId();
  // `workspace` stays the REAL active one: Settings manages it and new items
  // land in it. What the screens SHOW — names, faces, the team — comes from
  // the workspaces in view, which in "All workspaces" is every one.
  const workspace = workspaces.find((w) => w.id === workspaceId) || null;
  const allWorkspaces = useAllWorkspaces();
  const viewWs = useViewWorkspace();
  const profiles = useMemberProfiles();
  const members = useMemo(() => {
    const ids = viewWs?.members || [];
    // You first — your own face is the one you look for.
    return [...ids].sort((a, b) => (a === userId ? -1 : b === userId ? 1 : 0));
  }, [viewWs, userId]);
  const today = todayLocal();
  const tasks = useMemo(() => allTasks.filter((t) => !t.deleted && !t.archived), [allTasks]);
  const blockedIds = useMemo(() => blockedTaskIds(activities), [activities]);
  const sortedProjects = useMemo(
    () => [...projects].filter((p) => !p.archived && !p.deleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [projects],
  );

  // ── navigation ────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('home');
  const [push, setPush] = useState(null);           // { kind, projectId?, section? }
  const [taskId, setTaskId] = useState(null);
  const [dtab, setDtab] = useState('act');
  const [sheet, setSheet] = useState(null);         // status | log | plus | new | pick | filter
  const [picker, setPicker] = useState(null);       // { title, options, onPick }
  const [celebrate, setCelebrate] = useState(null);
  const [toast, setToast] = useState(null);         // { text, tone, undo }
  const toastTimer = useRef(null);

  // ── Tasks screen state (kept here so Home can deep-link into it) ─────────
  const [tv, setTv] = useState(() => ({
    view: 'List', groupBy: 'due', open: {}, more: {}, searchOpen: false, q: '',
    fProj: route?.projectFilter && route.projectFilter !== 'all' ? [route.projectFilter] : [],
    fWho: [], fSt: [], selecting: false, sel: [], projMenu: false, wday: today,
  }));
  const patchTv = useCallback((p) => setTv((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })), []);

  // ── forms ─────────────────────────────────────────────────────────────────
  const [log, setLog] = useState(EMPTY_LOG);
  const [nt, setNt] = useState(null);
  const [chat, setChat] = useState([]);

  const flash = useCallback((text, opts = {}) => {
    clearTimeout(toastTimer.current);
    setToast({ text, tone: opts.tone || 'ok', undo: opts.undo || null });
    toastTimer.current = setTimeout(() => setToast(null), opts.undo ? 5000 : 1800);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const fail = useCallback((err, sentence) => {
    console.error(err);
    flash(friendlyError(err, sentence), { tone: 'err' });
  }, [flash]);

  // ── people ────────────────────────────────────────────────────────────────
  const nameOf = useCallback((uid) => memberLabel(uid, profiles, { selfUid: userId }), [profiles, userId]);
  const firstOf = useCallback((uid) => String(nameOf(uid) || '').split(/[\s@]/)[0], [nameOf]);
  const photoOf = useCallback((uid) => profiles[uid]?.photoURL
    || (uid === userId ? profile?.photoURL || null : null), [profiles, userId, profile]);

  // ── opening things ────────────────────────────────────────────────────────
  const openTask = useCallback((id, tabKey = 'act') => { setTaskId(id); setDtab(tabKey); setSheet(null); }, []);

  // A task can be asked for from outside the mobile shell: the due-task alert,
  // an inbox notice, a browser notification's deep link (#…?task=<id>).
  useEffect(() => {
    const onOpen = (e) => { if (e.detail?.taskId) openTask(e.detail.taskId); };
    window.addEventListener(OPEN_TASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TASK_EVENT, onOpen);
  }, [openTask]);
  // …and a #…?task=<id> link: adopted when it changes, during render rather
  // than in an effect, so the task screen opens in the same frame.
  const [routeTask, setRouteTask] = useState(null);
  if ((route?.openTaskId || null) !== routeTask) {
    setRouteTask(route?.openTaskId || null);
    if (route?.openTaskId) { setTaskId(route.openTaskId); setDtab('act'); setSheet(null); }
  }

  const task = taskId ? tasks.find((t) => t.id === taskId) || null : null;

  // ── writes ────────────────────────────────────────────────────────────────
  const setStatus = useCallback(async (t, k) => {
    setSheet(null);
    // Stuck is not a column: here, as on the desktop, it means somebody wrote
    // the blocker down. So it opens the log with "Blocked" chosen.
    if (k === 'stuck') {
      setLog({ ...EMPTY_LOG, taskId: t.id, hours: 0, bott: 'Blocked' });
      setSheet('log');
      flash('Log what is blocking it');
      return;
    }
    try {
      await setTaskStatus(t, k);
      if (k === 'done') setCelebrate(t.title || 'Task');
      else flash(M_STATUS[k]?.label || 'Updated');
    } catch (err) { fail(err, 'Could not change the status.'); }
  }, [flash, fail]);

  const quickDone = useCallback(async (t) => {
    const done = t.status !== 'done';
    try {
      await setTaskStatus(t, done ? 'done' : 'todo');
      flash(done ? 'Done' : 'Reopened');
    } catch (err) { fail(err, 'Could not change the status.'); }
  }, [flash, fail]);

  const openLogFor = useCallback((id) => {
    const open = tasks.filter((t) => t.status !== 'done');
    setLog({ ...EMPTY_LOG, taskId: id || open[0]?.id || null });
    setSheet('log');
  }, [tasks]);

  const saveLog = useCallback(async () => {
    const t = tasks.find((x) => x.id === log.taskId);
    if (!t) { flash('Pick a task first', { tone: 'err' }); return; }
    const updates = logUpdates(log, t, today);
    try {
      if (log.editing) {
        // editActivity, not a raw update: it moves the task's hours and
        // attachment counters by the difference, in the same batch.
        await editActivity(log.editing, updates);
        setSheet(null);
        setLog(EMPTY_LOG);
        flash('Log updated');
        return;
      }
      if (!updates.hoursSpent && !updates.bottleneckRemarks && !updates.comment && !updates.attachments.length) return;
      await addActivity(userId, t, updates);
      setSheet(null);
      setLog(EMPTY_LOG);
      flash(updates.hoursSpent ? `Logged ${updates.hoursSpent}h` : updates.attachments.length ? 'Link added' : 'Logged');
    } catch (err) { fail(err, log.editing ? 'Could not save that change.' : 'Could not log that time.'); }
  }, [tasks, log, userId, today, flash, fail]);

  // An existing entry opens the same sheet, filled in.
  const editLog = useCallback((activity) => {
    setLog({ ...EMPTY_LOG, ...logDraftFrom(activity, today) });
    setSheet('log');
  }, [today]);

  // A log entry is deleted for good — it has no Trash — so this asks first,
  // as the desktop's does. Its counters and its files go with it.
  const deleteLog = useCallback(async () => {
    const a = log.editing;
    if (!a) return;
    const ok = await ask.confirm({
      title: 'Delete this log entry?',
      // Named as it is SAVED, not as the half-edited form says.
      message: `${Number(a.hoursSpent) || 0}h on ${shortDate(a.date, today)}. Log entries do not go to Trash, so this cannot be undone.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      await deleteActivity(a);
      setSheet(null);
      setLog(EMPTY_LOG);
      flash('Log entry deleted');
    } catch (err) { fail(err, 'Could not delete that entry.'); }
  }, [log, today, ask, flash, fail]);

  // A task goes to Trash, so this is the desktop editor's way: delete now,
  // offer Undo, no dialog in between.
  const deleteTask = useCallback(async (t) => {
    try {
      await softDeleteTask(t.id);
      setTaskId(null);
      flash(`“${t.title || 'Task'}” deleted`, {
        undo: () => restoreDeleted('task', t.id).then(() => flash('Restored')).catch((err) => fail(err, 'Could not bring it back.')),
      });
    } catch (err) { fail(err, 'Could not delete that task.'); }
  }, [flash, fail]);

  const setTaskField = useCallback(async (t, field, value) => {
    try {
      if (field === 'owner') {
        const after = value ? [value] : [];
        await updateTask(t.id, { assignedTo: after, assignedToExternal: [] });
        await notifyAssignment({ task: t, before: t.assignedTo || [], after, byUserId: userId, byName: nameOf(userId) });
      } else if (field === 'project') {
        const p = projectById[value];
        await updateTask(t.id, { projectId: value || null, phaseId: null, category: p?.name || t.category || null });
      } else if (field === 'from') {
        await updateTask(t.id, { 'plan.startDate': value || null });
      } else if (field === 'due') {
        await updateTask(t.id, { 'plan.endDate': value || null });
      }
      flash('Updated');
    } catch (err) { fail(err, 'Could not save that change.'); }
  }, [projectById, userId, nameOf, flash, fail]);

  const createTask = useCallback(async () => {
    if (!nt?.title.trim()) { flash('Add a title', { tone: 'err' }); return; }
    const p = projectById[nt.projectId];
    try {
      // The project's workspace, as the desktop's create paths do — in All
      // workspaces the project may belong to any of them.
      const target = p?.workspaceId || workspaceId;
      const ref = await addTask(userId, {
        workspaceId: target,
        title: nt.title.trim(),
        description: '',
        projectId: nt.projectId || null,
        phaseId: null,
        category: p?.name || 'Personal',
        priority: 'medium',
        status: nt.status === 'stuck' ? 'doing' : nt.status,
        assignedTo: nt.owner ? [nt.owner] : [],
        plan: { startDate: nt.from || null, endDate: nt.due || null },
      });
      if (nt.owner && nt.owner !== userId) {
        await notifyAssignment({
          task: { id: ref?.id, workspaceId: target, projectId: nt.projectId || null, title: nt.title.trim() },
          before: [], after: [nt.owner], byUserId: userId, byName: nameOf(userId),
        });
      }
      setSheet(null);
      setTab('board');
      setNt(null);
      flash('Task created');
    } catch (err) { fail(err, 'Could not create that task.'); }
  }, [nt, projectById, userId, workspaceId, nameOf, flash, fail]);

  // Bulk: one task at a time, in series, with the before-state captured for
  // Undo — the rules the deleted bulk bar was built on (CLAUDE.md).
  const bulk = useCallback(async (kind) => {
    const ids = tv.sel;
    if (!ids.length) { flash('Pick tasks first', { tone: 'err' }); return; }
    const chosen = tasks.filter((t) => ids.includes(t.id));
    const undo = [];
    let skipped = 0;
    try {
      for (const t of chosen) {
        if (kind === 'done') {
          if (t.status === 'done') continue;
          undo.push(() => setTaskStatus({ ...t, status: 'done' }, t.status));
          await setTaskStatus(t, 'done');
        } else if (kind === 'me') {
          undo.push(() => updateTask(t.id, { assignedTo: t.assignedTo || [], assignedToExternal: t.assignedToExternal || [] }));
          await updateTask(t.id, { assignedTo: [userId], assignedToExternal: [] });
        } else if (kind === 'day') {
          const patch = shiftPlan(t, 1);
          if (!patch) { skipped += 1; continue; }
          undo.push(() => updateTask(t.id, shiftPlan({ ...t, plan: { startDate: patch['plan.startDate'] || null, endDate: patch['plan.endDate'] } }, -1)));
          await updateTask(t.id, patch);
        }
      }
      patchTv({ sel: [], selecting: false });
      const n = chosen.length - skipped;
      const msg = { done: `${n} done`, me: `${n} assigned to you`, day: `${n} pushed a day` }[kind]
        + (skipped ? ` · ${skipped} had no due date` : '');
      flash(msg, { undo: undo.length ? async () => { for (const u of undo) await u(); flash('Undone'); } : null });
    } catch (err) { fail(err, 'Some of those changes did not save.'); }
  }, [tv.sel, tasks, userId, patchTv, flash, fail]);

  const ctx = {
    userId, profile, workspace, workspaceId, workspaces, allWorkspaces, members, profiles, projects: sortedProjects, projectById,
    tasks, activities, blockedIds, today,
    nameOf, firstOf, photoOf,
    tab, setTab, push, setPush, task, openTask, closeTask: () => setTaskId(null), dtab, setDtab,
    sheet, setSheet, picker, setPicker, flash, fail,
    tv, patchTv, log, setLog, nt, setNt, chat, setChat,
    setStatus, quickDone, openLogFor, saveLog, editLog, deleteLog, deleteTask, setTaskField, createTask, bulk,
    setCelebrate,
  };

  const selecting = tv.selecting && tab === 'board' && !task && !push;

  return (
    <MobileCtx.Provider value={ctx}>
      <div className="m-app">
        <div className="m-scroll">
          {tab === 'home' && <MobileHome />}
          {tab === 'board' && <MobileTasks />}
          {tab === 'ai' && <MobileAskAi />}
          {tab === 'more' && <MobileMore />}
        </div>

        {/* The tab bar. The centre button is "+", which opens Create. */}
        <nav className="m-tabbar" aria-label="Sections">
          {TABS.map(([k, label]) => {
            const center = k === 'plus';
            const on = tab === k;
            return (
              <button
                key={k}
                type="button"
                className={`m-tab${on ? ' is-on' : ''}${center ? ' is-center' : ''}`}
                aria-label={label}
                aria-current={on ? 'page' : undefined}
                onClick={() => (center ? setSheet('plus') : (setTab(k), setPush(null)))}
              >
                <span className="m-tab-icon"><Ico d={ICON[k]} size={22} /></span>
                {!center && <span className="m-tab-label">{label}</span>}
              </button>
            );
          })}
        </nav>

        {selecting && <BulkBar />}
        {push && <MobilePush />}
        {task && <MobileTaskDetail />}
        <MobileSheets />

        {celebrate && (
          <div className="m-celebrate" onClick={() => setCelebrate(null)} role="dialog" aria-label="Task complete">
            <img src="/mobile/celebrate.jpg" alt="" className="m-celebrate-img" />
            <div className="m-celebrate-foot">
              <span className="m-celebrate-chip">Done</span>
              <div className="m-celebrate-title">Task<br />complete.</div>
              <div className="m-celebrate-sub">{celebrate}</div>
              <button type="button" className="m-celebrate-btn" onClick={() => setCelebrate(null)}>Continue</button>
            </div>
          </div>
        )}

        {toast && (
          <div className={`m-toast${toast.tone === 'err' ? ' is-err' : ''}`} role="status">
            {toast.tone === 'err' ? '!' : '✓'} {toast.text}
            {toast.undo && (
              <button type="button" className="m-toast-undo" onClick={() => { const u = toast.undo; setToast(null); u(); }}>Undo</button>
            )}
          </div>
        )}
      </div>
    </MobileCtx.Provider>
  );
}

function BulkBar() {
  const m = useMobile();
  const n = m.tv.sel.length;
  const items = [
    { k: 'done', icon: '✓', label: 'Done', cls: n ? ' is-go' : '' },
    { k: 'me', icon: '◉', label: 'To me' },
    { k: 'day', icon: '→', label: '+1 day' },
  ];
  return (
    <div className="m-bulk">
      <span className="m-bulk-label">{n ? `${n} selected` : 'Tap tasks'}</span>
      {items.map((b) => (
        <button key={b.k} type="button" className={`m-bulk-btn${b.cls || ''}${n ? '' : ' is-idle'}`}
          aria-label={b.label} onClick={() => m.bulk(b.k)}>
          <span className="m-bulk-icon">{b.icon}</span><span className="m-bulk-text">{b.label}</span>
        </button>
      ))}
      <button type="button" className="m-bulk-btn is-close" aria-label="Close"
        onClick={() => m.patchTv({ selecting: false, sel: [] })}>
        <span className="m-bulk-icon">✕</span><span className="m-bulk-text">Close</span>
      </button>
    </div>
  );
}
