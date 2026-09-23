// src/components/TaskEditor.jsx — full-bleed task editor.
//
// Layout mirrors the project editor: a navy hero carrying the workspace →
// project → phase → task breadcrumb, a scrolling detail column on the left,
// this task's activity log pinned on the right, and a sticky action footer.
// Everything is theme tokens, so it follows light/dark automatically.

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  addTask,
  updateTask,
  softDeleteTask,
  duplicateTask,
  restoreDeleted,
  uid,
  addTemplate,
  taskAsTemplatePayload,
  todayLocal,
  auth,
  emitTaskDone,
  maybeSpawnRecurrence,
  addActivity,
} from '../services/firebase';
import { useTasks, useAuth, useTaskComments, useActivities } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import AssigneePicker from './AssigneePicker';
import { MarkdownEditor } from './Markdown';
import Markdown from './Markdown';
import {
  addTaskComment,
  updateTaskComment,
  softDeleteTaskComment,
  notifyAssignment,
} from '../services/firebase';
import { memberLabel } from '../services/invites';
import TaskAiPanel from './TaskAiPanel';
import ActivityEditor from './ActivityEditor';
import ExportButton from './ExportButton';
import { buildActivityLogDocument } from '../services/activityExport';
import { usePresence } from '../hooks/usePresence';
import ActivityTimeline, { fmtDay } from './ActivityTimeline';
import { formatHours, formatVariance, normalizeEstimate, variance } from '../services/effort';
import { CHILD_OF, PARENT_OF, explainRollup, rollup } from '../services/taskTree';
import { requestOpenTask } from '../services/openTask';
import { useToast } from './Toast';
import AddToNotebookButton from './AddToNotebookButton';
import { friendlyError } from '../services/access';
import { useDialog } from './Dialog';
import { useModalDialog } from '../hooks/useModalDialog';
import { activateProps } from '../hooks/useActivate';
import { displayStatus, STATUS_TEXT } from '../services/boardScope';
import { TASK_STATUSES } from '../services/taskStatus';

// ── Small formatters ────────────────────────────────────────────────────────
function daysBetween(fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return null;
  const a = new Date(`${fromYmd}T00:00:00`).getTime();
  const b = new Date(`${toYmd}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}
function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}
function fileKind(f) {
  const src = String(f?.name || f?.url || '');
  const ext = src.split('?')[0].split('.').pop();
  if (!ext || ext.length > 4 || ext === src) return 'FILE';
  return ext.toUpperCase();
}

const STATUS_META = {
  todo:  { label: 'To do',       tone: 'muted' },
  doing: { label: 'In progress', tone: 'amber' },
  done:  { label: 'Done',        tone: 'green' },
};
const PRIORITY_META = {
  low:    { label: 'Low priority',    tone: 'muted' },
  medium: { label: 'Medium priority', tone: 'amber' },
  high:   { label: 'High priority',   tone: 'red' },
};
const ACT_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'work',    label: 'Work logs' },
  { key: 'blocked', label: 'Blocked' },
];

/**
 * A task that does not exist yet.
 *
 * The editor opens on one of these when somebody presses "New task", so
 * creating a task and editing one are the same screen — there is no longer a
 * four-field dialog that can offer less than the editor does, and no second
 * step to reach dependencies, an estimate or an assignee. It carries no `id`,
 * which is the only thing that tells the editor apart.
 */
export function newTaskDraft({ workspaceId, projectId = '', phaseId = '', plan = {} } = {}) {
  return {
    workspaceId,
    projectId: projectId && projectId !== 'all' ? projectId : '',
    phaseId,
    status: 'todo',
    priority: 'medium',
    plan: { startDate: plan.startDate || null, endDate: plan.endDate || null },
  };
}

export default function TaskEditor({ task, projects, onClose }) {
  // No id means it has never been written: the same form, in create mode. The
  // things that need a document to exist — comments, the activity log, delete,
  // duplicate, presence — say so rather than being silently broken.
  const isNew = !task.id;
  // Same shape as the project editor: a hero breadcrumb, no heading element.
  const modal = useModalDialog({ onClose, title: isNew ? 'New task' : 'Task editor' });
  const ask = useDialog();
  const toast = useToast();
  const { tasks: allTasks } = useTasks();
  const { userId } = useAuth();
  const { activities } = useActivities(task.id);
  const activeWorkspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === (task.workspaceId || activeWorkspaceId));

  const [title, setTitle]             = useState(task.title || '');
  const [description, setDescription] = useState(task.description || '');
  const [projectId, setProjectId]     = useState(task.projectId || '');
  const [phaseId, setPhaseId]         = useState(task.phaseId || '');
  const [priority, setPriority]       = useState(task.priority || 'medium');
  const [status, setStatus]           = useState(task.status || 'todo');
  const [planStart, setPlanStart]     = useState(task.plan?.startDate || '');
  // '' means "nobody has estimated this" — distinct from an estimate of zero,
  // which is why it is stored as null rather than 0 (T-0137).
  const [estimate, setEstimate]       = useState(
    task.estimateHours === null || task.estimateHours === undefined ? '' : String(task.estimateHours),
  );
  const [planEnd, setPlanEnd]         = useState(task.plan?.endDate || '');
  const [actualStart, setActualStart] = useState(task.actual?.startDate || '');
  const [actualEnd, setActualEnd]     = useState(task.actual?.endDate || '');
  const [requestedBy, setRequestedBy] = useState(task.requestedBy || '');
  const [tags, setTags]               = useState(task.tags || []);
  const [customValues, setCustomValues] = useState(task.customValues || {});
  const [assignedTo, setAssignedTo] = useState(task.assignedTo || []);
  const [assignedToExternal, setAssignedToExternal] = useState(task.assignedToExternal || []);
  const [subtasks, setSubtasks]       = useState(task.subtasks || []);
  const [dependsOn, setDependsOn]     = useState(task.dependsOn || []);
  const [links, setLinks]             = useState(task.links || []);

  const [recurrence, setRecurrence]   = useState(task.recurrence || null);

  const [tagInput, setTagInput]       = useState('');
  const [subtaskInput, setSubtaskInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [actFilter, setActFilter] = useState('all');
  // Which right-hand tab is open. The mockup's own MTABS order.
  const [mtab, setMtab] = useState('details');
  const [assignOpen, setAssignOpen] = useState(false);
  // A dropdown closes when you click anywhere else, like every other one.
  const assignRef = useRef(null);
  useEffect(() => {
    if (!assignOpen) return undefined;
    const onDown = (e) => {
      if (assignRef.current && !assignRef.current.contains(e.target)) setAssignOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [assignOpen]);
  const [editingActivity, setEditingActivity] = useState(null);

  const selectedProject = projects.find((p) => p.id === projectId);
  const selectedPhase   = selectedProject?.phases?.find((ph) => ph.id === phaseId);
  const accent = selectedProject?.color || 'var(--c-accent)';

  // All existing tags from other tasks (for autocomplete)
  const knownTags = useMemo(() => {
    const set = new Set();
    allTasks.forEach((t) => (t.tags || []).forEach((tg) => set.add(tg)));
    return [...set].sort();
  }, [allTasks]);

  const tagSuggestions = tagInput
    ? knownTags.filter((t) => !tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase()))
    : [];

  // Candidates for dependencies = all tasks except this one + already-selected
  const dependsOnCandidates = allTasks
    .filter((t) => t.id !== task.id && !dependsOn.includes(t.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const dependsOnTasks = dependsOn
    .map((id) => allTasks.find((t) => t.id === id))
    .filter(Boolean);
  const blockedBy = dependsOnTasks.filter((d) => d.status !== 'done');
  // Tasks elsewhere that name this one as a dependency — the "blocks" side.
  const blocksTasks = allTasks.filter((t) => (t.dependsOn || []).includes(task.id));

  const doneSubtasks  = subtasks.filter((s) => s.done).length;

  // A promoted subtask is still part of this task (T-0141): the rollup counts
  // the checklist AND the tasks that were promoted out of it, so promoting one
  // does not silently move the parent's progress.
  const tree = rollup({ ...task, subtasks }, allTasks);
  const completionPct = tree.units === 0 ? null : tree.progress;

  // ── Derived health for the hero pills, KPI strip and tree bars ────────────
  const today = todayLocal();
  const overdueDays = (status !== 'done' && planEnd && planEnd < today)
    ? daysBetween(planEnd, today)
    : null;
  const daysLeft = (status !== 'done' && planEnd && planEnd >= today)
    ? daysBetween(today, planEnd)
    : null;
  const progressPct = status === 'done' ? 100 : (completionPct ?? task.progress ?? 0);

  const loggedHours = activities.reduce((s, a) => s + (a.hoursSpent || 0), 0);
  // The variance updates as the estimate is typed, and reads the hours from the
  // task's denormalised counter rather than from the activity list: the list
  // loads asynchronously, so summing it would show "−8h (−100%)" for a moment
  // on a task that has actually overrun.
  const effort = variance({
    estimateHours: normalizeEstimate(estimate),
    totalHoursLogged: task.totalHoursLogged ?? loggedHours,
  });
  const blockedCount = activities.filter(
    (a) => a.completionStatus === 'blocked' || a.bottleneckRemarks,
  ).length;

  const attachments = useMemo(() => activities.flatMap(
    (a) => (a.attachments || []).map((f) => ({ ...f, _date: a.date })),
  ), [activities]);

  const shownActivities = useMemo(() => {
    const sorted = [...activities].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (actFilter === 'work')    return sorted.filter((a) => (a.hoursSpent || 0) > 0);
    if (actFilter === 'blocked') return sorted.filter((a) => a.completionStatus === 'blocked' || a.bottleneckRemarks);
    return sorted;
  }, [activities, actFilter]);

  // Sibling counts for the hierarchy tree.
  const projectTasks = selectedProject ? allTasks.filter((t) => t.projectId === selectedProject.id) : [];
  const projectDone  = projectTasks.filter((t) => t.status === 'done').length;
  const phaseTasks   = selectedPhase ? projectTasks.filter((t) => t.phaseId === selectedPhase.id) : [];
  const phaseDone    = phaseTasks.filter((t) => t.status === 'done').length;
  const wsProjectCount = projects.length;

  const createdAt = tsToDate(task.createdAt);
  const updatedAt = tsToDate(task.updatedAt);

  const statusMeta   = STATUS_META[status] || STATUS_META.todo;
  const priorityMeta = PRIORITY_META[priority] || PRIORITY_META.medium;

  const kpis = [
    {
      label: 'Progress',
      value: `${progressPct}%`,
      delta: subtasks.length ? `${doneSubtasks}/${subtasks.length} subtasks` : 'no checklist',
      tone: progressPct >= 100 ? 'green' : progressPct > 0 ? 'amber' : 'muted',
    },
    {
      label: 'Logged',
      value: `${loggedHours.toFixed(1)}h`,
      delta: `${activities.length} session${activities.length === 1 ? '' : 's'}`,
      tone: 'navy',
    },
    {
      label: overdueDays !== null ? 'Overdue' : 'Days left',
      value: overdueDays !== null ? `${overdueDays}d`
        : daysLeft !== null ? `${daysLeft}d`
        : status === 'done' ? '✓' : '—',
      delta: planEnd ? `due ${fmtDay(planEnd)}` : 'no due date',
      tone: overdueDays !== null ? 'red' : status === 'done' ? 'green' : daysLeft !== null && daysLeft <= 2 ? 'amber' : 'navy',
    },
    {
      label: 'Blockers',
      value: String(blockedBy.length),
      delta: blockedBy.length
        ? `waiting on ${blockedBy.length} task${blockedBy.length === 1 ? '' : 's'}`
        : 'clear to start',
      tone: blockedBy.length ? 'red' : 'green',
    },
  ];

  const addTag = (t) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) return;
    setTags([...tags, trimmed]);
    setTagInput('');
  };
  const removeTag = (t) => setTags(tags.filter((x) => x !== t));

  const addSubtask = () => {
    const text = subtaskInput.trim();
    if (!text) return;
    setSubtasks([...subtasks, { id: uid(), text, done: false }]);
    setSubtaskInput('');
  };
  const toggleSubtask = (id) => setSubtasks(subtasks.map((s) => s.id === id ? { ...s, done: !s.done } : s));
  const removeSubtask = (id) => setSubtasks(subtasks.filter((s) => s.id !== id));
  const promoteSubtask = async (s) => {
    if (!await ask.confirm({
      title: `Promote “${s.text}” to a full task?`,
      message: 'It inherits this task\u2019s project and phase, moves off the checklist, and '
             + 'stays listed under this task — so it still counts towards this task\u2019s progress.',
      confirmLabel: 'Promote',
    })) return;
    try {
      await addTask(userId, {
        workspaceId: task.workspaceId,
        title: s.text,
        description: `Promoted from subtask of "${task.title}".`,
        category: selectedProject?.name || task.category,
        projectId: projectId || null,
        phaseId:   phaseId   || null,
        priority,
        requestedBy: requestedBy.trim(),
        tags: [...new Set([...(tags || []), 'promoted'])],
        // The link that keeps the hierarchy. It used to be 'related-to',
        // which lost the parent at exactly the moment it started mattering.
        links: [{ targetId: task.id, type: CHILD_OF }],
      });
      setSubtasks(subtasks.filter((x) => x.id !== s.id));
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not promote subtask. Please try again.'));
    }
  };
  const moveSubtask = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= subtasks.length) return;
    const next = [...subtasks];
    [next[idx], next[target]] = [next[target], next[idx]];
    setSubtasks(next);
  };

  const addDep = (depId) => setDependsOn([...dependsOn, depId]);
  const removeDep = (depId) => setDependsOn(dependsOn.filter((id) => id !== depId));

  const save = async () => {
    setSaving(true);
    try {
      // ── Create ────────────────────────────────────────────────────────
      // Everything the form holds, in one write. `addTask` fills the actual
      // dates and the progress from the status (`statusStamps`), so a task
      // created straight into "In progress" is stamped exactly as one dragged
      // there would be — the create path does not get its own arithmetic.
      if (isNew) {
        const workspaceId = selectedProject?.workspaceId || task.workspaceId || activeWorkspaceId;
        const ref = await addTask(userId, {
          workspaceId,
          title: title.trim(),
          description: description.trim(),
          category: selectedProject?.name || task.category || 'Personal',
          projectId: projectId || null,
          phaseId: phaseId || null,
          priority,
          status,
          requestedBy: requestedBy.trim(),
          tags,
          subtasks,
          dependsOn,
          links,
          recurrence,
          customValues,
          assignedTo,
          assignedToExternal,
          estimateHours: normalizeEstimate(estimate),
          plan:   { startDate: planStart   || null, endDate: planEnd   || null },
          actual: { startDate: actualStart || null, endDate: actualEnd || null },
        });
        // Whoever it was handed to hears about it — after the write, so a
        // notice that cannot be raised never costs somebody the task.
        await notifyAssignment({
          task: { id: ref?.id, workspaceId, projectId: projectId || null, title: title.trim() },
          before: [],
          after: assignedTo,
          byUserId: userId,
          byName: memberLabel(userId, workspace?.memberProfiles || {}),
        });
        toast.success(`Created “${title.trim()}”.`);
        onClose();
        return;
      }

      // ── Update ────────────────────────────────────────────────────────
      // Mirror the auto-stamping logic from setTaskStatus, but only when the
      // user didn't manually fill the corresponding actual date field. This
      // preserves explicit edits while still being helpful for the common
      // "move task to In progress" flow.
      let nextActualStart = actualStart;
      let nextActualEnd   = actualEnd;
      let nextProgress    = task.progress;
      if (status !== task.status) {
        if (status === 'doing' && !nextActualStart) nextActualStart = today;
        if (status === 'done') {
          if (!nextActualStart) nextActualStart = today;
          if (!nextActualEnd)   nextActualEnd   = today;
          nextProgress = 100;
        }
        if (status === 'todo') {
          // Revert: clear stamps unless the user has explicitly set them in
          // the same edit (rare; we trust the form values either way).
          if (nextActualStart === task.actual?.startDate) nextActualStart = null;
          if (nextActualEnd   === task.actual?.endDate)   nextActualEnd   = null;
          if (nextProgress === 100) nextProgress = 0;
        }
      }

      const updates = {
        title: title.trim(),
        description: description.trim(),
        projectId: projectId || null,
        phaseId: phaseId || null,
        priority,
        status,
        progress: nextProgress,
        requestedBy: requestedBy.trim(),
        category: selectedProject?.name || task.category,
        tags,
        subtasks,
        dependsOn,
        links,
        recurrence,
        customValues,
        assignedTo,
        assignedToExternal,
        estimateHours:      normalizeEstimate(estimate),
        'plan.startDate':   planStart        || null,
        'plan.endDate':     planEnd          || null,
        'actual.startDate': nextActualStart  || null,
        'actual.endDate':   nextActualEnd    || null,
      };
      // Only override progress from subtask completion if the user didn't
      // just transition status (which has its own progress logic).
      if (completionPct !== null && status === task.status) updates.progress = completionPct;
      await updateTask(task.id, updates);
      // Whoever was just put on this task hears about it. After the save, so a
      // notice that cannot be written never costs somebody their edit.
      await notifyAssignment({
        task: { ...task, title: title.trim() },
        before: task.assignedTo || [],
        after: assignedTo,
        byUserId: userId,
        byName: memberLabel(userId, workspace?.memberProfiles || {}),
      });
      if (status === 'done' && task.status !== 'done') emitTaskDone({ ...task, title: title.trim() });
      // Finishing a recurring task here must mean exactly what finishing it by
      // dragging the card into Done means. The task as it is AFTER this save,
      // so the next occurrence uses the dates and the rule just typed — not the
      // ones the modal was opened with.
      await maybeSpawnRecurrence(task, {
        ...task,
        title: title.trim(),
        description: description.trim(),
        projectId: projectId || null,
        phaseId: phaseId || null,
        priority,
        status,
        requestedBy: requestedBy.trim(),
        category: selectedProject?.name || task.category,
        tags,
        subtasks,
        links,
        recurrence,
        customValues,
        assignedTo,
        assignedToExternal,
        estimateHours: normalizeEstimate(estimate),
        plan:   { startDate: planStart       || null, endDate: planEnd        || null },
        actual: { startDate: nextActualStart || null, endDate: nextActualEnd  || null },
      });
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not save task. Please try again.'));
      setSaving(false);
    }
  };

  // Delete first, apologise later: a toast with Undo is faster than a
  // confirmation dialog and cannot be dismissed by muscle memory. Nothing is
  // actually destroyed — the task is in Trash either way.
  const remove = async () => {
    const title = task.title || 'Task';
    try {
      await softDeleteTask(task.id);
      onClose();
      toast.success(`“${title}” deleted.`, {
        undo: () => restoreDeleted('task', task.id),
      });
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not delete that task.'));
    }
  };

  const duplicate = async () => {

    setSaving(true);

    try {

      const newId = await duplicateTask(userId, task);

      toast.success(`Copied “${task.title}” — the activity log stays with the original.`, {

        // A copy nobody wanted is one click to take back.

        undo: async () => { await softDeleteTask(newId); toast.info('Copy removed.'); },

      });

      onClose();

    } catch (err) {

      console.error('[duplicate] task failed:', err);

      toast.error(friendlyError(err, 'Could not duplicate that task. Please try again.'));

      setSaving(false);

    }

  };


  const saveAsTemplate = async () => {
    const name = await ask.prompt({ title: 'Template name:', defaultValue: title.trim() || 'New template' });
    if (!name) return;
    try {
      const payload = taskAsTemplatePayload({
        title: title.trim(),
        description: description.trim(),
        priority,
        requestedBy: requestedBy.trim(),
        projectId: projectId || null,
        phaseId: phaseId || null,
        tags,
        subtasks,
        recurrence,
      });
      await addTemplate(userId, {
        workspaceId: task.workspaceId || activeWorkspaceId,
        name: name.trim(), kind: 'task', payload,
      });
      toast.success(`Saved template "${name.trim()}".`);
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not save template. Please try again.'));
    }
  };

  // The Activity tab's Export ▾. `build` runs only when a format is picked,
  // so opening the tab costs nothing — and the tab is the one place a single
  // task's log can be got out of the app since the WBS's read-only table was
  // deleted (T-0162).
  const activityExportProps = {
    build: () => buildActivityLogDocument(activities, {
      taskById: { [task.id]: task },
      projectById: selectedProject ? { [selectedProject.id]: selectedProject } : {},
      projectName: selectedProject?.name || null,
      title: `${title.trim() || task.title} — activity log`,
    }),
    baseName: `${title.trim() || task.title || 'task'}-activities`,
    kind: 'table',
    title: 'Save this task’s entries as a spreadsheet, a PDF or a CSV',
  };

  // ── The five right-hand tabs, straight from the mockup's MTABS ───────────
  const fileCount = attachments.length;
  const mtabs = [
    { key: 'details',  icon: '▤', label: 'Details' },
    { key: 'ai',       icon: '✦', label: 'AI' },
    { key: 'activity', icon: '⏱', label: 'Activity', count: activities.length ? String(activities.length) : '' },
    { key: 'subitems', icon: '✓', label: 'Subitems', count: subtasks.length ? `${doneSubtasks}/${subtasks.length}` : '' },
    { key: 'files',    icon: '◫', label: 'Files',    count: fileCount ? String(fileCount) : '' },
  ];

  // What the status FIELD prints. The same function the Kanban card, the WBS
  // and the Dashboard ask, so the editor cannot disagree with the board about
  // whether this task is stuck — and it is why the field can read "Stuck",
  // which is exactly what the mockup draws. The select underneath still writes
  // the real status; this is what to print, not what to write.
  const shown = displayStatus(
    { ...task, status, plan: { startDate: planStart || null, endDate: planEnd || null } },
    new Set(blockedBy.map((d) => d.id)),
    today,
  );

  // "4 of 13" — this task's place among its project's tasks. A real number:
  // the mockup's own count is of the board it was opened from, which the modal
  // does not know, so it counts the project instead and ↑↓ walk that list.
  const siblings = (selectedProject ? projectTasks : allTasks)
    .slice()
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  const myIndex = siblings.findIndex((t) => t.id === task.id);
  const goSibling = (step) => {
    const next = siblings[myIndex + step];
    if (!next) return;
    onClose();
    requestOpenTask(next.id);
  };

  const tabPanel = () => {
    if (mtab === 'ai') {
      return (
        <div className="te-ai-stack">
          <TaskAiPanel
            task={{ ...task, title, description, priority, tags, requestedBy }}
            project={selectedProject}
            subtasks={subtasks}
            onAddSubtasks={(newSubs) => setSubtasks([...subtasks, ...newSubs])}
          />
        </div>
      );
    }

    if (mtab === 'subitems') {
      const stop = { onPointerDown: (e) => e.stopPropagation(), onClick: (e) => e.stopPropagation() };
      return (
        <>
        <div className="te-card" style={{ padding: '15px 17px' }}>
          <div className="te-subs">
            {subtasks.length === 0 && (
              <p className="te-empty">No subitems yet. Break the work down so “done” is checkable.</p>
            )}
            {subtasks.map((s, i) => (
              <div
                key={s.id}
                className="te-item te-sub"
                {...activateProps(() => toggleSubtask(s.id), {
                  label: `${s.done ? 'Mark not done' : 'Mark done'}: ${s.text}`,
                })}
              >
                <span className={`te-box ${s.done ? 'is-done' : ''}`} aria-hidden="true">{s.done ? '✓' : ''}</span>
                <span className={`te-sub-title ${s.done ? 'is-done' : ''}`}>{s.text}</span>
                <button type="button" className="te-iconbtn te-sub-btn" {...stop} onClick={(e) => { e.stopPropagation(); moveSubtask(i, -1); }} disabled={i === 0} aria-label={`Move “${s.text}” up`}>↑</button>
                <button type="button" className="te-iconbtn te-sub-btn" {...stop} onClick={(e) => { e.stopPropagation(); moveSubtask(i, 1); }} disabled={i === subtasks.length - 1} aria-label={`Move “${s.text}” down`}>↓</button>
                {/* A promoted subtask is linked back to its parent, and a
                    task that has not been written has nothing to link to. */}
                {!isNew && (
                  <button type="button" className="te-iconbtn te-sub-btn" {...stop} onClick={(e) => { e.stopPropagation(); promoteSubtask(s); }} aria-label={`Promote “${s.text}” to a task`} title="Promote to a full task">↗</button>
                )}
                <button type="button" className="te-iconbtn te-sub-btn" {...stop} onClick={(e) => { e.stopPropagation(); removeSubtask(s.id); }} aria-label={`Remove “${s.text}”`}>✕</button>
              </div>
            ))}
            <form className="te-sub-add" onSubmit={(e) => { e.preventDefault(); addSubtask(); }}>
              <input
                className="te-fld"
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                placeholder="+ Add subitem"
                aria-label="New subitem"
              />
            </form>
          </div>
        </div>

        {/* A promoted subtask left the checklist but not the task (T-0141) —
            so it is listed here, under the same heading, and still counts
            towards the rollup above. */}
        {tree.hasChildren && (
          <div className="te-card" style={{ padding: '15px 17px', marginTop: 14 }}>
            <div className="te-children-head">
              <span className="te-lbl" style={{ margin: 0 }}>
                Inside this task · {tree.childrenDone}/{tree.childCount} done
              </span>
              <span className="te-fsize">
                {tree.hours.toFixed(1)}h logged across all of it
              </span>
            </div>
            <div className="te-subs">
              {tree.children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="te-item te-child"
                  // Close this editor and ask whatever is on screen to open the
                  // child — the same two steps search results and the inbox
                  // use, so all three behave identically.
                  onClick={() => { onClose(); requestOpenTask(c.id); }}
                  title={`Open “${c.title}”`}
                >
                  <span className="te-item-title">{c.title}</span>
                  <span className="te-state">{STATUS_META[c.status]?.label || c.status}</span>
                  <span className="te-fsize">{(c.hours || 0).toFixed(1)}h</span>
                </button>
              ))}
            </div>
          </div>
        )}
        </>
      );
    }

    if (mtab === 'files') {
      return (
        <div className="te-card" style={{ padding: '15px 17px' }}>
          <div className="te-subs">
            {attachments.length === 0 && (
              <p className="te-empty">Nothing attached. Files added to an activity entry show up here.</p>
            )}
            {attachments.map((f, i) => (
              <div key={`${f.url}-${i}`} className="te-item">
                <span className="te-ftype">{fileKind(f)}</span>
                <a className="te-item-title" href={f.url} target="_blank" rel="noreferrer">{f.name || f.url}</a>
                {f._date && <span className="te-fsize">{fmtDay(f._date)}</span>}
                <AddToNotebookButton url={f.url} project={selectedProject} workspace={workspace} />
              </div>
            ))}
            <p className="te-hint" style={{ marginTop: 4 }}>
              Attach files when you log an activity — that keeps every file next to the work it came from.
            </p>
          </div>
        </div>
      );
    }

    if (mtab === 'activity') {
      return (
        <div>
          <div className="te-log-head">
            <span className="te-log-icon" aria-hidden="true">⏱</span>
            <span className="te-log-title">Activity log</span>
            <span className="te-count" style={{ marginLeft: 'auto' }}>{activities.length}</span>
            {/* The WBS used to open a read-only table over this task with an
                Export ▾ on it; clicking a row opens THIS editor now, so the
                export came with it rather than being lost. `build` runs only
                when a format is picked, so the tab costs nothing to open. */}
            {activities.length > 0 && (
              <ExportButton {...activityExportProps} className="te-pill te-pill-ghost" />
            )}
          </div>

          <div className="te-filters">
            {ACT_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`te-chip${actFilter === f.key ? ' is-on' : ''}`}
                onClick={() => setActFilter(f.key)}
              >{f.label}</button>
            ))}
          </div>

          <div className="te-log-list">
            {shownActivities.length === 0 ? (
              <p className="te-empty">
                {activities.length === 0 ? 'Nothing logged yet.' : 'Nothing matches this filter.'}
              </p>
            ) : (
              <ActivityTimeline activities={shownActivities} onSelect={setEditingActivity} />
            )}
          </div>

          {isNew ? (
            <p className="te-hint">Hours are logged against a saved task — create this one first.</p>
          ) : (
            <LogComposer
              userId={userId}
              task={{ ...task, title: title.trim() || task.title, projectId: projectId || null, phaseId: phaseId || null, status }}
            />
          )}
        </div>
      );
    }

    // Details
    return (
      <>
        <div className="te-card" style={{ padding: '4px 18px' }}>
          <div className="te-row">
            <span className="te-lbl">Phase</span>
            <span className="te-row-val">
              <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)} aria-label="Phase">
                <option value="">— none —</option>
                {(selectedProject?.phases || []).map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
              </select>
            </span>
          </div>
          <div className="te-row">
            <span className="te-lbl">Priority</span>
            <span className="te-row-val">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
                {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </span>
          </div>
          <div className="te-row">
            <label className="te-lbl" htmlFor="te-estimate">Estimated hours</label>
            <span className="te-row-val is-strong">
              <input
                id="te-estimate"
                type="number" min="0" step="0.25" value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                placeholder="Leave blank if you have not estimated it"
              />
            </span>
          </div>
          <div className="te-row">
            <span className="te-lbl">Logged</span>
            <span className="te-row-val is-strong">{formatHours(loggedHours)}</span>
          </div>
          <div className="te-row">
            <span className="te-lbl">Remaining</span>
            <span className="te-row-val is-strong">
              {effort.state === 'none' ? '—' : formatVariance(effort)}
            </span>
          </div>
          <div className="te-row">
            <span className="te-lbl">Progress</span>
            <span className="te-row-val">
              {progressPct}%
              {/* Where the number came from. A percentage that moved for an
                  invisible reason is a percentage nobody trusts — and this one
                  counts the checklist AND anything promoted out of it. */}
              {explainRollup(tree) && <> · {explainRollup(tree)}</>}
            </span>
          </div>
          <div className="te-row">
            <span className="te-lbl">Requested by</span>
            <span className="te-row-val">
              <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="—" aria-label="Requested by" />
            </span>
          </div>
          <div className="te-row">
            <span className="te-lbl">Actual</span>
            <span className="te-row-val">
              <input type="date" value={actualStart} onChange={(e) => setActualStart(e.target.value)} aria-label="Actual start" />
              <input type="date" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} aria-label="Actual end" />
            </span>
          </div>
        </div>


        <div className="te-card" style={{ padding: '15px 18px', marginTop: 14 }}>
          <span className="te-lbl">Dependencies &amp; relations</span>
          <div className="te-subs">
            {dependsOnTasks.map((d) => (
              <div key={d.id} className="te-item">
                <span className="te-rel tone-red">Blocked by</span>
                <span className="te-item-title">{d.title}</span>
                <span className="te-state">{STATUS_TEXT[d.status] || d.status}</span>
                <button type="button" className="te-iconbtn te-sub-btn" onClick={() => removeDep(d.id)} aria-label={`Remove dependency ${d.title}`}>✕</button>
              </div>
            ))}
            {blocksTasks.map((b) => (
              <div key={b.id} className="te-item">
                <span className="te-rel tone-amber">Blocks</span>
                <span className="te-item-title">{b.title}</span>
                <span className="te-state">{STATUS_TEXT[b.status] || b.status}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <DepPicker candidates={dependsOnCandidates} onAdd={addDep} />
          </div>
          {blockedBy.length > 0 && (
            <p className="te-bottleneck" style={{ marginTop: 10 }}>
              <span aria-hidden="true">⚠</span>
              <span>Blocked by {blockedBy.length} unfinished {blockedBy.length === 1 ? 'task' : 'tasks'}.</span>
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            <LinksEditor
              links={links}
              onChange={setLinks}
              candidates={allTasks.filter((t) => t.id !== task.id)}
            />
          </div>
        </div>

        <div className="te-card" style={{ padding: '15px 18px', marginTop: 14 }}>
          <span className="te-lbl">Tags</span>
          <div className="te-tags">
            {tags.map((t) => (
              <button key={t} type="button" className="te-tag" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}>
                #{t} <span aria-hidden="true">✕</span>
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); addTag(tagInput); }}>
            <input
              className="te-fld" value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="+ Add tag" aria-label="New tag" list="te-tag-suggestions"
            />
            <datalist id="te-tag-suggestions">
              {tagSuggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </form>
        </div>

        <div className="te-card" style={{ padding: '15px 18px', marginTop: 14 }}>
          <span className="te-lbl">Repeats</span>
          <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
          {(selectedProject?.customFields || []).length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span className="te-lbl">{selectedProject.name} fields</span>
              <CustomFieldsForm
                fields={selectedProject?.customFields || []}
                values={customValues}
                onChange={setCustomValues}
              />
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <>
    <div className="te-backdrop" {...modal.backdropProps}>
      <div className="te-modal" {...modal.dialogProps}>

        {/* nav strip */}
        <div className="te-nav">
          <button type="button" className="te-back" onClick={onClose}>← Back to items</button>
          <span className="te-nav-sep" aria-hidden="true" />
          <span className="te-pos">
            {isNew ? 'Not saved yet'
              : myIndex >= 0 ? `${myIndex + 1} of ${siblings.length}`
              : `${siblings.length} items`}
          </span>
          <div className="te-nav-actions">
            {!isNew && <PresenceStack taskId={task.id} workspaceId={task.workspaceId} />}
            <button type="button" className="te-iconbtn" onClick={() => goSibling(-1)} disabled={myIndex <= 0} aria-label="Previous task">↑</button>
            <button type="button" className="te-iconbtn" onClick={() => goSibling(1)} disabled={myIndex < 0 || myIndex >= siblings.length - 1} aria-label="Next task">↓</button>
            <button type="button" className="te-iconbtn te-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* primary block */}
        <div className="te-primary">
          <div className="te-primary-top">
            <span className="te-kind" aria-hidden="true">✓</span>
            <span className="te-code">{isNew ? 'NEW TASK' : `TASK ${String(task.id).slice(0, 6).toUpperCase()}`}</span>
            <div className="te-primary-actions">
              {!isNew && (
                <button type="button" className="te-pill te-pill-ghost" onClick={duplicate} disabled={saving} title="Make a copy of this task — not its activity log">Duplicate</button>
              )}
              <button type="button" className="te-pill te-pill-primary" onClick={save} disabled={saving || !title.trim()}>
                {saving ? 'Saving…' : isNew ? 'Create task' : 'Save'}
              </button>
            </div>
          </div>

          <input
            className="te-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled task"
            aria-label="Task title"
          />

          <div className="te-meta">
            {/* Accountable opens the real picker on Details: this task can have
                several assignees, which a single select cannot say. */}
            {/* The Details tab no longer carries an Assignees card (removed on
                request), so the picker lives HERE — on the field that names the
                person. Taking the section away without re-homing it would have
                left the task editor unable to assign anybody. */}
            <div className="te-ef te-ef-pop" ref={assignRef}>
              <button
                type="button"
                className="te-ef-btn"
                onClick={() => setAssignOpen((o) => !o)}
                aria-expanded={assignOpen}
              >
                <span className="te-ef-col">
                  <span className="te-lbl">Accountable</span>
                  <span className="te-ev">
                    {assignedTo.length || assignedToExternal.length
                      ? memberLabel(assignedTo[0], workspace?.memberProfiles || {}) || assignedToExternal[0] || 'Assigned'
                      : 'Unassigned'}
                    {(assignedTo.length + assignedToExternal.length) > 1 && ` +${assignedTo.length + assignedToExternal.length - 1}`}
                    <span className="te-ec" aria-hidden="true">⌄</span>
                  </span>
                </span>
              </button>
              {assignOpen && (
                <div className="te-pop">
                  <TaskAssigneeSection
                    project={selectedProject}
                    assignedTo={assignedTo}
                    assignedToExternal={assignedToExternal}
                    onChange={({ assignedTo: a, assignedToExternal: e }) => {
                      setAssignedTo(a);
                      setAssignedToExternal(e);
                    }}
                  />
                </div>
              )}
            </div>

            <span className="te-meta-sep" aria-hidden="true" />

            <label className="te-ef">
              <span className="te-ef-col">
                <span className="te-lbl">Due from</span>
                <span className="te-ev">{planStart ? fmtDay(planStart) : '—'}<span className="te-ec" aria-hidden="true">⌄</span></span>
              </span>
              <input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} onClick={openDatePicker} aria-label="Planned start" />
            </label>
            <span className="te-arrow" aria-hidden="true">→</span>
            <label className="te-ef">
              <span className="te-ef-col">
                <span className="te-lbl">Due to</span>
                <span className="te-ev" style={overdueDays !== null ? { color: 'var(--c-danger-ink)' } : undefined}>
                  {planEnd ? fmtDay(planEnd) : '—'}
                  {overdueDays !== null && ` · ${overdueDays}d late`}
                  <span className="te-ec" aria-hidden="true">⌄</span>
                </span>
              </span>
              <input type="date" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} onClick={openDatePicker} aria-label="Planned end" />
            </label>

            <span className="te-meta-sep" aria-hidden="true" />

            <label className="te-ef">
              <span className="te-ef-col">
                <span className="te-lbl">Status</span>
                <span className={`te-ev tone-ink-${shown.tone}`}>{shown.label}<span className="te-ec" aria-hidden="true">⌄</span></span>
              </span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
              </select>
            </label>

            <span className="te-meta-sep" aria-hidden="true" />

            <label className="te-ef">
              <span className="te-ef-col">
                <span className="te-lbl">Project</span>
                <span className="te-ev">{selectedProject?.name || 'No project'}<span className="te-ec" aria-hidden="true">⌄</span></span>
              </span>
              <select
                value={projectId}
                onChange={(e) => { setProjectId(e.target.value); setPhaseId(''); }}
                aria-label="Project"
              >
                <option value="">— none —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* body */}
        <div className="te-body">
          <div className="te-left">
            <div className="te-desc-block te-quiet">
              <span className="te-lbl">Description</span>
              <MarkdownEditor
                bare
                value={description}
                onChange={setDescription}
                rows={4}
                placeholder="What is this task about?"
              />
            </div>

            <div className="te-comments te-quiet">
              <div className="te-comments-head">
                <span className="te-lbl" style={{ margin: 0 }}>Comments</span>
              </div>
              {/* A comment has to belong to something. Rather than a thread
                  that silently drops what you type, the panel says what to do
                  first. */}
              {isNew ? (
                <p className="te-empty">Create the task first — then you can talk about it here.</p>
              ) : (
                <CommentsThread
                  task={task}
                  userId={userId}
                  members={workspace?.members || []}
                  memberProfiles={workspace?.memberProfiles || {}}
                />
              )}
            </div>
          </div>

          <div className="te-right">
            <div className="te-tabs" role="tablist" aria-label="Task detail">
              {mtabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={mtab === t.key}
                  className={`te-tab${mtab === t.key ? ' is-on' : ''}`}
                  onClick={() => setMtab(t.key)}
                >
                  <span className="te-tab-icon" aria-hidden="true">{t.icon}</span>
                  <span>{t.label}</span>
                  {t.count && <span className="te-tab-count">{t.count}</span>}
                </button>
              ))}
            </div>
            <div className="te-panel">{tabPanel()}</div>
          </div>
        </div>

        {/* footer — the app's own actions; the mockup draws no slot for them */}
        <div className="te-foot">
          {/* Nothing to delete until it exists. "Save as template" still
              works — it writes the FORM, not the task. */}
          {!isNew && (
            <button type="button" className="te-pill te-pill-danger" onClick={remove} disabled={saving}>Delete task</button>
          )}
          <button type="button" className="te-pill te-pill-ghost" onClick={saveAsTemplate} disabled={saving || !title.trim()}>Save as template</button>
          <span className="te-foot-spacer" />
          <span className="te-foot-note">
            {isNew ? 'Not saved yet — press Create task'
              : updatedAt ? `Edited ${fmtDay(updatedAt.toISOString().slice(0, 10))}`
              : createdAt ? `Created ${fmtDay(createdAt.toISOString().slice(0, 10))}`
              : ''}
          </span>
        </div>
      </div>
    </div>

    {editingActivity && (
      <ActivityEditor activity={editingActivity} onClose={() => setEditingActivity(null)} />
    )}
    </>
  );
}

// The date input sits invisibly over its field (see `.te-ef > input`), and a
// click on a date input only focuses one of its day/month/year segments — the
// calendar opens from the icon at its right edge, which nobody can see here.
// So the field did nothing visible when clicked. Ask for the picker outright.
function openDatePicker(e) {
  try { e.currentTarget.showPicker?.(); } catch { /* not a user gesture, or unsupported: typing still works */ }
}

// Progress bar + percentage used by the hierarchy tree rows.
function TreeBar({ pct, color }) {
  return (
    <>
      <div className="pe-bar"><span style={{ width: `${pct}%`, background: color }} /></div>
      <span className="pe-pct">{pct}%</span>
    </>
  );
}

// Inline composer pinned above the activity timeline: comment + hours, one
// click to log. Goes through addActivity so the task's denormalized counters
// stay in sync in the same batch.
function LogComposer({ userId, task }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [hours, setHours]     = useState('');
  const [posting, setPosting] = useState(false);

  const log = async () => {
    const text = comment.trim();
    if (!text && !Number(hours)) return;
    setPosting(true);
    try {
      await addActivity(userId, task, {
        date: todayLocal(),
        comment: text,
        hoursSpent: Number(hours) || 0,
        completionStatus: task.status === 'done' ? 'completed' : 'in-progress',
      });
      setComment('');
      setHours('');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not log the activity. Please try again.'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="te-log">
      <input
        className="input input-sm te-log-note"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); log(); } }}
        placeholder="What did you do?"
        aria-label="Activity note"
      />
      <input
        className="input input-sm te-log-hours"
        type="number"
        min="0"
        step="0.25"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        placeholder="0.0h"
        aria-label="Hours spent"
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={log}
        disabled={posting || (!comment.trim() && !Number(hours))}
      >
        {posting ? '…' : 'Log'}
      </button>
    </div>
  );
}

// TaskAssigneeSection: thin wrapper over the shared AssigneePicker that
// pulls candidate UIDs from the project's ACL (preferred) or the active
// workspace's member list (when no project is selected), and resolves
// display names via the workspace's memberProfiles map.
function TaskAssigneeSection({ project, assignedTo, assignedToExternal, onChange }) {
  const activeWorkspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  const ws = workspaces.find((w) => w.id === activeWorkspaceId);
  const memberProfiles = ws?.memberProfiles || {};

  // Candidates: workspace members ∪ project members (deduped). Falling back
  // to project ACL keys if member arrays aren't populated.
  const candidates = useMemo(() => {
    const set = new Set();
    (ws?.members || []).forEach((u) => set.add(u));
    (project?.members || []).forEach((u) => set.add(u));
    Object.keys(project?.acl || {}).forEach((u) => set.add(u));
    // Always include any already-assigned UIDs (even if no longer members)
    (assignedTo || []).forEach((u) => set.add(u));
    return [...set];
  }, [ws, project, assignedTo]);

  // Fallback labels: self-name for the current auth user
  const me = auth.currentUser;
  const fallbackLabels = {};
  if (me?.uid) {
    fallbackLabels[me.uid] = me.displayName || me.email || `${me.uid.slice(0, 6)}…`;
  }

  return (
    <AssigneePicker
      candidates={candidates}
      memberProfiles={memberProfiles}
      assignedTo={assignedTo}
      assignedToExternal={assignedToExternal}
      onChange={onChange}
      fallbackLabels={fallbackLabels}
      helpText={candidates.length === 0
        ? 'No teammates yet. Add an external name below, or invite people via Settings → Workspaces.'
        : 'Click a teammate to assign them, or add a free-form name for someone not in the system yet.'}
    />
  );
}

function CustomFieldsForm({ fields, values, onChange }) {
  if (!fields?.length) return null;
  const setValue = (id, v) => onChange({ ...values, [id]: v });
  return (
    <div className="pe-block" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 14 }}>
      <span className="pe-lbl">Project custom fields</span>
      <div className="pe-grid3">
        {fields.map((f) => (
          <div key={f.id}>
            <label className="pe-lbl">{f.name}</label>
            {f.type === 'text' && (
              <input className="input pe-input" value={values[f.id] || ''} onChange={(e) => setValue(f.id, e.target.value)} />
            )}
            {f.type === 'number' && (
              <input type="number" className="input pe-input" value={values[f.id] ?? ''} onChange={(e) => setValue(f.id, e.target.value === '' ? '' : Number(e.target.value))} />
            )}
            {f.type === 'date' && (
              <input type="date" className="input pe-input" value={values[f.id] || ''} onChange={(e) => setValue(f.id, e.target.value)} />
            )}
            {f.type === 'select' && (
              <select className="select pe-input" value={values[f.id] || ''} onChange={(e) => setValue(f.id, e.target.value)}>
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PresenceStack({ taskId, workspaceId }) {
  const others = usePresence(taskId, workspaceId);
  if (!others.length) return null;
  return (
    <div className="presence-stack te-presence" title={`Also viewing: ${others.map((p) => p.displayName || p.userId).join(', ')}`}>
      {others.slice(0, 4).map((p, i) => (
        p.photoURL
          ? <img key={p.id} src={p.photoURL} alt="" className="presence-avatar" style={{ zIndex: 10 - i }} />
          : <div key={p.id} className="presence-avatar fallback" style={{ zIndex: 10 - i }}>
              {(p.displayName || p.userId)[0]?.toUpperCase() || '?'}
            </div>
      ))}
      {others.length > 4 && (
        <div className="presence-avatar fallback presence-more">+{others.length - 4}</div>
      )}
    </div>
  );
}

const LINK_TYPES = [
  { value: 'blocks',       label: 'blocks',       badge: 'danger',  icon: '⛔' },
  { value: 'related-to',   label: 'related to',   badge: 'info',    icon: '↔' },
  { value: 'duplicate-of', label: 'duplicate of', badge: 'muted',   icon: '⎘' },
  // A promoted subtask keeps its parent (T-0141). `child-of` is the one the
  // tree is read from; `parent-of` is the same statement from the other end,
  // offered so somebody can say it whichever way round they are thinking.
  { value: CHILD_OF,       label: 'is part of',   badge: 'accent',  icon: '↳' },
  { value: PARENT_OF,      label: 'contains',     badge: 'accent',  icon: '↴' },
];

function LinksEditor({ links, onChange, candidates }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('related-to');
  const [q, setQ]       = useState('');

  const candidateById = {};
  candidates.forEach((c) => { candidateById[c.id] = c; });

  const filtered = q
    ? candidates.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())
                            && !links.some((l) => l.targetId === t.id))
    : candidates.filter((l) => !links.some((x) => x.targetId === l.id));

  const remove = (idx) => onChange(links.filter((_, i) => i !== idx));
  const add = (targetId) => {
    onChange([...links, { targetId, type }]);
    setQ('');
    setOpen(false);
  };

  return (
    <div>
      <span className="pe-lbl">Related tasks</span>
      {links.length > 0 && (
        <div className="te-deps">
          {links.map((l, i) => {
            const target = candidateById[l.targetId];
            const def    = LINK_TYPES.find((t) => t.value === l.type) || LINK_TYPES[1];
            return (
              <div key={i} className="te-dep">
                <span className={`badge badge-soft-${def.badge}`}>{def.icon} {def.label}</span>
                <span className="te-dep-title">{target?.title || '(deleted task)'}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(i)} aria-label="Remove">✕</button>
              </div>
            );
          })}
        </div>
      )}

      {!open ? (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} style={{ marginTop: 6 }}>
          + Add relation
        </button>
      ) : (
        <div className="dep-picker" style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <span className="muted small">Type:</span>
            <select className="select select-sm" value={type} onChange={(e) => setType(e.target.value)}>
              {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <input
            className="input input-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a task to link to…"
            autoFocus
          />
          <ul className="dep-picker-list">
            {filtered.length === 0 && <li className="muted small" style={{ padding: 8 }}>No matching tasks.</li>}
            {filtered.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" className="dep-picker-item" onClick={() => add(t.id)}>
                  <span className={`badge badge-soft-${t.status === 'done' ? 'success' : 'muted'}`}>{t.status}</span>
                  <span>{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}

function CommentsThread({ task, userId, members = [], memberProfiles = {} }) {
  const toast = useToast();
  const ask = useDialog();
  const taskId = task.id;
  const { comments, loading } = useTaskComments(task.workspaceId, taskId);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState('');

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    try {
      // The audience is what is already on screen: who is in this workspace and
      // what they are called. addTaskComment turns an @name into a notice.
      await addTaskComment(userId, task, text, {
        members,
        memberProfiles,
        authorName: memberLabel(userId, memberProfiles),
      });
      setBody('');
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, 'Could not post comment. Please try again.'));
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (commentId) => {
    const text = editingBody.trim();
    if (!text) { setEditingId(null); return; }
    try { await updateTaskComment(commentId, text); }
    catch (err) { console.error(err); toast.error('Could not save edit.'); }
    setEditingId(null);
  };

  return (
    <div className="comments-thread">
      {loading ? (
        <p className="muted small">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="muted small">No comments yet. Add the first one below — leave breadcrumbs for your future self.</p>
      ) : (
        <ul className="comments-list">
          {comments.map((c) => {
            const isEditing = editingId === c.id;
            return (
              <li key={c.id} className="comment-item">
                <div className="comment-head">
                  <strong className="comment-who">{memberLabel(c.userId, memberProfiles) || 'Someone'}</strong>
                  <span className="mono small muted">
                    {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleString() : 'pending'}
                  </span>
                  {c.editedAt && <span className="muted small">(edited)</span>}
                  <div style={{ flex: 1 }} />
                  {!isEditing && (
                    <>
                      <button className="btn btn-sm btn-ghost" aria-label="Edit comment" title="Edit comment" onClick={() => { setEditingId(c.id); setEditingBody(c.body); }}>✎</button>
                      <button className="btn btn-sm btn-ghost link-danger" aria-label="Delete comment" title="Delete comment"
                        onClick={async () => { if (await ask.confirm({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) softDeleteTaskComment(c.id); }}>✕</button>
                    </>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <MarkdownEditor bare value={editingBody} onChange={setEditingBody} rows={2} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={() => saveEdit(c.id)}>Save</button>
                    </div>
                  </>
                ) : (
                  <Markdown src={c.body} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="comment-composer">
        <MarkdownEditor
          bare
          value={body}
          onChange={setBody}
          rows={3}
          placeholder="Leave a note… type @ to tell somebody about it."
          mentions={{ members, memberProfiles, exclude: [userId] }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn btn-primary" onClick={post} disabled={posting || !body.trim()}>
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Exported so a test can read the note the way a user does — rendered — rather
// than only as a string in this file (T-0124).
export function RecurrenceEditor({ value, onChange }) {
  const enabled = !!value;
  const rule    = value?.rule || 'weekly';
  const interval = value?.interval || 1;
  const dayOfWeek = value?.dayOfWeek ?? 0;
  const dayOfMonth = value?.dayOfMonth ?? 1;
  const until = value?.until || '';

  const toggle = (on) => {
    if (!on) { onChange(null); return; }
    onChange({ rule: 'weekly', interval: 1, dayOfWeek: new Date().getDay(), until: '' });
  };
  const patch = (delta) => onChange({ rule, interval, dayOfWeek, dayOfMonth, until, ...delta });

  return (
    <div>
      <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} style={{ accentColor: 'var(--c-accent)' }} />
        <span>Recurring task</span>
      </label>
      {enabled && (
        <div className="recurrence-grid">
          <select className="select select-sm" value={rule} onChange={(e) => patch({ rule: e.target.value })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <span className="muted small">every</span>
          <input
            type="number" min="1" max="99"
            className="input input-sm"
            value={interval}
            onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })}
            style={{ width: 60 }}
          />
          <span className="muted small">
            {rule === 'daily' ? 'day(s)' : rule === 'weekly' ? 'week(s)' : 'month(s)'}
          </span>
          {rule === 'weekly' && (
            <>
              <span className="muted small" style={{ marginLeft: 8 }}>on</span>
              <select className="select select-sm" value={dayOfWeek} onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}>
                <option value={0}>Sun</option>
                <option value={1}>Mon</option>
                <option value={2}>Tue</option>
                <option value={3}>Wed</option>
                <option value={4}>Thu</option>
                <option value={5}>Fri</option>
                <option value={6}>Sat</option>
              </select>
            </>
          )}
          {rule === 'monthly' && (
            <>
              <span className="muted small" style={{ marginLeft: 8 }}>on day</span>
              <input
                type="number" min="1" max="31"
                className="input input-sm"
                value={dayOfMonth}
                onChange={(e) => patch({ dayOfMonth: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })}
                style={{ width: 60 }}
              />
            </>
          )}
          <span className="muted small" style={{ marginLeft: 8 }}>until</span>
          <input
            type="date"
            className="input input-sm"
            value={until}
            onChange={(e) => patch({ until: e.target.value || null })}
            style={{ width: 140 }}
          />
        </div>
      )}
      {enabled && (
        // Both paths, and the honest limit on the second. The old sentence
        // named only the on-completion path, which told a reader that a weekly
        // ritual nobody ticks off simply stops — the opposite of what a
        // schedule is for, and exactly the note somebody reads when deciding
        // whether to trust recurrence at all (T-0124 / POL-014). The catch-up
        // runs in the app, not in the cloud, so "the next time somebody opens
        // it" is the real behaviour and is better said than discovered.
        <p className="muted small" style={{ marginTop: 6 }}>
          The next one is created when you mark this done — and if it is missed,
          it appears on the day it is next due, the next time somebody opens the app.
        </p>
      )}
    </div>
  );
}

function DepPicker({ candidates, onAdd }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = q
    ? candidates.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()))
    : candidates;
  return (
    <div style={{ marginTop: 8 }}>
      {!open ? (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>+ Add dependency</button>
      ) : (
        <div className="dep-picker">
          <input
            className="input input-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a task…"
            autoFocus
          />
          <ul className="dep-picker-list">
            {filtered.length === 0 && <li className="muted small" style={{ padding: 8 }}>No matching tasks.</li>}
            {filtered.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" className="dep-picker-item" onClick={() => { onAdd(t.id); setQ(''); setOpen(false); }}>
                  <span className={`badge badge-soft-${t.status === 'done' ? 'success' : 'muted'}`}>{t.status}</span>
                  <span>{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
