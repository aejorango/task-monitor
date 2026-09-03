// src/components/TaskEditor.jsx — full-bleed task editor.
//
// Layout mirrors the project editor: a navy hero carrying the workspace →
// project → phase → task breadcrumb, a scrolling detail column on the left,
// this task's activity log pinned on the right, and a sticky action footer.
// Everything is theme tokens, so it follows light/dark automatically.

import { useState, useMemo } from 'react';
import {
  addTask,
  updateTask,
  softDeleteTask,
  uid,
  addTemplate,
  taskAsTemplatePayload,
  todayLocal,
  auth,
  emitTaskDone,
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
} from '../services/firebase';
import TaskAiPanel from './TaskAiPanel';
import ActivityEditor from './ActivityEditor';
import { usePresence } from '../hooks/usePresence';
import ActivityTimeline, { fmtDay } from './ActivityTimeline';

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

export default function TaskEditor({ task, projects, onClose }) {
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
  const completionPct = subtasks.length === 0 ? null :
    Math.round(doneSubtasks / subtasks.length * 100);

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
    if (!confirm(`Promote "${s.text}" to a full task?\n\nIt will inherit this task's project and phase. The subtask will be removed from this list.`)) return;
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
        links: [{ targetId: task.id, type: 'related-to' }],
      });
      setSubtasks(subtasks.filter((x) => x.id !== s.id));
    } catch (err) {
      console.error(err);
      alert('Could not promote subtask. Check console.');
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
        'plan.startDate':   planStart        || null,
        'plan.endDate':     planEnd          || null,
        'actual.startDate': nextActualStart  || null,
        'actual.endDate':   nextActualEnd    || null,
      };
      // Only override progress from subtask completion if the user didn't
      // just transition status (which has its own progress logic).
      if (completionPct !== null && status === task.status) updates.progress = completionPct;
      await updateTask(task.id, updates);
      if (status === 'done' && task.status !== 'done') emitTaskDone({ ...task, title: title.trim() });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save task. Check console.');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this task? This is a soft delete and can be restored.')) return;
    await softDeleteTask(task.id);
    onClose();
  };

  const saveAsTemplate = async () => {
    const name = prompt('Template name:', title.trim() || 'New template');
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
      await addTemplate(userId, { workspaceId: task.workspaceId, name: name.trim(), kind: 'task', payload });
      alert(`Saved template "${name.trim()}".`);
    } catch (err) {
      console.error(err);
      alert('Could not save template. Check console.');
    }
  };

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div className="pe-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Hero header ── */}
        <header className="pe-hero">
          <span className="pe-hero-glow" aria-hidden="true" />
          <div className="pe-hero-inner">
            <div className="pe-crumbs">
              <span className="pe-crumb">
                <span className="pe-crumb-dot" style={{ background: workspace?.color || 'var(--c-purple)' }} />
                {workspace?.name || 'Workspace'}
              </span>
              <span className="pe-crumb-sep">/</span>
              {selectedProject && (
                <>
                  <span className="pe-crumb">
                    <span className="pe-crumb-dot" style={{ background: selectedProject.color || 'var(--c-blue-deep)' }} />
                    {selectedProject.name}
                  </span>
                  <span className="pe-crumb-sep">/</span>
                </>
              )}
              {selectedPhase && (
                <>
                  <span className="pe-crumb">
                    <span className="pe-crumb-dot" style={{ background: 'var(--c-emerald)' }} />
                    {selectedPhase.name}
                  </span>
                  <span className="pe-crumb-sep">/</span>
                </>
              )}
              <span className="pe-crumb pe-crumb-accent">Task</span>
            </div>

            <div className="pe-hero-main">
              <div className="pe-hero-id">
                <div className="pe-mode">Edit task</div>
                <div className="pe-name-row">
                  <span className="pe-name-dot" style={{ background: accent, boxShadow: `0 0 0 3px ${accent}40` }} />
                  <input
                    className="pe-name-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Untitled task"
                    aria-label="Task title"
                  />
                </div>
                <div className="pe-pills">
                  <span className={`pe-pill pe-pill-${statusMeta.tone}`}>● {statusMeta.label}</span>
                  <span className={`pe-pill pe-pill-${priorityMeta.tone}`}>{priorityMeta.label}</span>
                  {overdueDays !== null && overdueDays > 0 && (
                    <span className="pe-pill pe-pill-red">⚠ {overdueDays} day{overdueDays === 1 ? '' : 's'} overdue</span>
                  )}
                  {blockedBy.length > 0 && (
                    <span className="pe-pill pe-pill-red">
                      ⛔ blocked by {blockedBy.length} task{blockedBy.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {recurrence && <span className="pe-pill pe-pill-ghost">🔁 {recurrence.rule}</span>}
                  <span className="pe-hero-meta">
                    {`TSK-${String(task.id).slice(-4).toUpperCase()}`}
                    {createdAt && ` · created ${createdAt.toLocaleDateString('en', { month: 'short', day: 'numeric' })}`}
                    {task.requestedBy && ` by ${task.requestedBy}`}
                  </span>
                </div>
              </div>
              <PresenceStack taskId={task.id} />
              <button type="button" className="pe-close" onClick={onClose} aria-label="Close">✕</button>
            </div>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="pe-body">

          {/* LEFT — the form */}
          <div className="pe-main">

            <div className="pe-kpis">
              {kpis.map((k) => (
                <div key={k.label} className={`pe-kpi pe-tone-${k.tone}`}>
                  <div className="pe-kpi-label">{k.label}</div>
                  <div className="pe-kpi-value">{k.value}</div>
                  <div className="pe-kpi-delta">{k.delta}</div>
                </div>
              ))}
            </div>

            {/* Where this task lives — workspace → project → phase → task */}
            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">⌗</span>Where this task lives</h4>

              <div className="pe-tree-row">
                <span className="pe-kind pe-kind-ws">WS</span>
                <div className="pe-tree-body">
                  <div className="pe-tree-name">{workspace?.name || 'Workspace'}</div>
                  <div className="pe-tree-meta">
                    {(workspace?.members || []).length} member{(workspace?.members || []).length === 1 ? '' : 's'} · {wsProjectCount} project{wsProjectCount === 1 ? '' : 's'}
                  </div>
                </div>
              </div>

              {selectedProject ? (
                <div className="pe-tree-row pe-tree-proj">
                  <span className="pe-kind pe-kind-proj">PROJ</span>
                  <div className="pe-tree-body">
                    <div className="pe-tree-name">{selectedProject.name}</div>
                    <div className="pe-tree-meta">
                      {projectTasks.length} task{projectTasks.length === 1 ? '' : 's'} · {projectDone} done
                    </div>
                  </div>
                  <TreeBar pct={projectTasks.length ? Math.round(projectDone / projectTasks.length * 100) : 0} color={selectedProject.color || 'var(--c-blue-deep)'} />
                </div>
              ) : (
                <div className="pe-tree-row pe-tree-proj">
                  <span className="pe-kind pe-kind-proj">PROJ</span>
                  <div className="pe-tree-body">
                    <div className="pe-tree-name">No project</div>
                    <div className="pe-tree-meta">Pick one below to file this task.</div>
                  </div>
                </div>
              )}

              {selectedPhase && (
                <div className="pe-tree-row pe-tree-phase">
                  <span className="pe-kind pe-kind-phase">PHASE</span>
                  <div className="pe-tree-body">
                    <div className="pe-tree-name">{selectedPhase.name}</div>
                    <div className="pe-tree-meta">
                      {phaseTasks.length} task{phaseTasks.length === 1 ? '' : 's'} · {phaseDone} done
                    </div>
                  </div>
                  <TreeBar pct={phaseTasks.length ? Math.round(phaseDone / phaseTasks.length * 100) : 0} color="var(--c-emerald)" />
                </div>
              )}

              <div className={`pe-tree-row pe-tree-current ${selectedPhase ? 'te-tree-task' : 'pe-tree-phase'}`}>
                <span className="pe-kind pe-kind-task">TASK</span>
                <div className="pe-tree-body">
                  <div className="pe-tree-name">{title.trim() || 'Untitled task'}</div>
                  <div className="pe-tree-meta">
                    this task · {loggedHours.toFixed(1)}h logged · {priorityMeta.label.toLowerCase()}
                  </div>
                </div>
                <TreeBar pct={progressPct} color="var(--c-accent)" />
              </div>
            </section>

            {/* Details */}
            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">◈</span>Details</h4>

              <div className="pe-grid3">
                <div>
                  <label className="pe-lbl" htmlFor="te-project">Project</label>
                  <select
                    id="te-project"
                    className="select pe-input"
                    value={projectId}
                    onChange={(e) => { setProjectId(e.target.value); setPhaseId(''); }}
                  >
                    <option value="">— None —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="pe-lbl" htmlFor="te-phase">Phase</label>
                  <select
                    id="te-phase"
                    className="select pe-input"
                    value={phaseId}
                    onChange={(e) => setPhaseId(e.target.value)}
                    disabled={!selectedProject}
                  >
                    <option value="">— None —</option>
                    {selectedProject?.phases?.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="pe-lbl" htmlFor="te-status">Status</label>
                  <select id="te-status" className="select pe-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="todo">To do</option>
                    <option value="doing">In progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="pe-lbl" htmlFor="te-priority">Priority</label>
                  <select id="te-priority" className="select pe-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="pe-lbl" htmlFor="te-requested">Requested by</label>
                  <input id="te-requested" className="input pe-input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="—" />
                </div>
                <div>
                  <span className="pe-lbl">Progress</span>
                  <div className="pe-fld pe-fld-strong">
                    {progressPct}%
                    {completionPct !== null && (
                      <span className="pe-fld-note">· from {doneSubtasks}/{subtasks.length} subtasks</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="pe-lbl" htmlFor="te-plan-start">Plan start</label>
                  <input id="te-plan-start" type="date" className="input pe-input" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
                </div>
                <div>
                  <label className="pe-lbl" htmlFor="te-plan-end">Plan end</label>
                  <input
                    id="te-plan-end"
                    type="date"
                    className={`input pe-input${overdueDays !== null && overdueDays > 0 ? ' te-input-danger' : ''}`}
                    value={planEnd}
                    onChange={(e) => setPlanEnd(e.target.value)}
                  />
                </div>
                <div>
                  <span className="pe-lbl">Logged hours</span>
                  <div className="pe-fld pe-fld-strong">
                    {loggedHours.toFixed(1)}h
                    <span className="pe-fld-note">· {activities.length} session{activities.length === 1 ? '' : 's'}</span>
                  </div>
                </div>

                <div>
                  <label className="pe-lbl" htmlFor="te-actual-start">Actual start</label>
                  <input id="te-actual-start" type="date" className="input pe-input" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />
                </div>
                <div>
                  <label className="pe-lbl" htmlFor="te-actual-end">Actual end</label>
                  <input id="te-actual-end" type="date" className="input pe-input" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
                </div>
                <div>
                  <span className="pe-lbl">Due</span>
                  <div className={`pe-fld${overdueDays !== null && overdueDays > 0 ? ' pe-fld-danger' : ''}`}>
                    {planEnd ? fmtDay(planEnd) : '— no due date'}
                    {overdueDays !== null && overdueDays > 0 && <span className="pe-fld-note">· overdue</span>}
                  </div>
                </div>
              </div>

              <div className="pe-block">
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

              <div className="pe-block">
                <span className="pe-lbl">Description</span>
                <MarkdownEditor value={description} onChange={setDescription} rows={4} placeholder="What is this task about?" />
              </div>

              <div className="pe-block">
                <span className="pe-lbl">Tags</span>
                <div className="tag-input-wrap">
                  {tags.map((t) => (
                    <span key={t} className="tag-pill">
                      #{t} <button type="button" onClick={() => removeTag(t)}>×</button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                      if (e.key === 'Backspace' && !tagInput && tags.length) {
                        e.preventDefault(); removeTag(tags[tags.length - 1]);
                      }
                    }}
                    placeholder={tags.length === 0 ? 'Type a tag and press Enter…' : ''}
                  />
                </div>
                {tagSuggestions.length > 0 && (
                  <div className="tag-suggestions">
                    {tagSuggestions.slice(0, 6).map((s) => (
                      <button key={s} type="button" className="tag-suggest-item" onClick={() => addTag(s)}>
                        #{s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Subtasks */}
            <section className="pe-card">
              <div className="te-sect-head">
                <h4 className="pe-sect"><span className="pe-sect-mark">☑</span>Subtasks</h4>
                <span className="pe-side-count">{doneSubtasks}/{subtasks.length}</span>
                <div className="pe-bar te-sub-bar">
                  <span style={{ width: `${completionPct ?? 0}%`, background: 'var(--c-accent)' }} />
                </div>
                <span className="te-sect-pct">{completionPct ?? 0}%</span>
              </div>

              <div className="te-subs">
                {subtasks.map((s, i) => (
                  <div
                    key={s.id}
                    className={`te-sub${s.done ? ' is-done' : ''}`}
                    onClick={() => toggleSubtask(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSubtask(s.id); } }}
                  >
                    <span className="te-sub-box" aria-hidden="true">{s.done ? '✓' : ''}</span>
                    <span className="te-sub-text">{s.text}</span>
                    <span className="te-sub-ctl" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-sm btn-ghost" title="Promote to its own task" onClick={() => promoteSubtask(s)}>↗</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveSubtask(i, -1)} disabled={i === 0}>↑</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveSubtask(i, 1)} disabled={i === subtasks.length - 1}>↓</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeSubtask(s.id)}>✕</button>
                    </span>
                  </div>
                ))}

                <div className="te-sub-add">
                  <span className="te-sub-add-mark" aria-hidden="true">+</span>
                  <input
                    className="te-sub-add-input"
                    value={subtaskInput}
                    onChange={(e) => setSubtaskInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                    placeholder="Add a subtask…"
                  />
                  <button type="button" className="btn btn-sm" onClick={addSubtask} disabled={!subtaskInput.trim()}>Add</button>
                </div>
              </div>
            </section>

            {/* Dependencies & relations */}
            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">🔗</span>Dependencies &amp; relations</h4>

              <div className="pe-card-row">
                <div>
                  <span className="pe-lbl">This task depends on</span>
                  {dependsOnTasks.length === 0 ? (
                    <p className="muted small">Nothing. This task can start anytime.</p>
                  ) : (
                    <div className="te-deps">
                      {dependsOnTasks.map((d) => (
                        <div key={d.id} className="te-dep">
                          <span className={`te-dep-tag${d.status === 'done' ? ' is-done' : ''}`}>
                            {d.status === 'done' ? 'DONE' : 'BLOCKED BY'}
                          </span>
                          <span className="te-dep-title">{d.title}</span>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeDep(d.id)}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <DepPicker candidates={dependsOnCandidates} onAdd={addDep} />
                  {blockedBy.length > 0 && (
                    <p className="te-warn">
                      ⚠ Blocked by {blockedBy.length} incomplete dependenc{blockedBy.length === 1 ? 'y' : 'ies'}.
                    </p>
                  )}
                </div>

                <div>
                  <span className="pe-lbl">This task blocks</span>
                  {blocksTasks.length === 0 ? (
                    <p className="muted small">Nothing downstream is waiting on this.</p>
                  ) : (
                    <div className="te-deps">
                      {blocksTasks.map((d) => (
                        <div key={d.id} className="te-dep">
                          <span className="te-dep-tag is-blocks">BLOCKS</span>
                          <span className="te-dep-title">{d.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="pe-block">
                <LinksEditor
                  links={links}
                  onChange={setLinks}
                  candidates={allTasks.filter((t) => t.id !== task.id)}
                />
              </div>
            </section>

            {/* Recurrence + project custom fields */}
            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">🔁</span>Recurrence &amp; custom fields</h4>
              <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
              <CustomFieldsForm
                fields={selectedProject?.customFields || []}
                values={customValues}
                onChange={setCustomValues}
              />
            </section>

            {/* Attachments — derived from this task's activity attachments */}
            <section className="pe-card">
              <h4 className="pe-sect">
                <span className="pe-sect-mark">📎</span>Attachments
                <span className="pe-side-count">{attachments.length}</span>
              </h4>
              {attachments.length === 0 ? (
                <p className="muted small">No files yet. Attach URLs when you log an activity and they surface here.</p>
              ) : (
                <div className="te-atts">
                  {attachments.map((f, i) => (
                    <a key={i} className="te-att" href={f.url} target="_blank" rel="noreferrer" title={f.name || f.url}>
                      <span className="te-att-ico">{fileKind(f)}</span>
                      <span className="te-att-body">
                        <span className="te-att-name">{f.name || f.url}</span>
                        <span className="te-att-meta">
                          {f.size ? `${Math.round(f.size / 1024)} KB · ` : ''}{fmtDay(f._date)}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </section>

            {/* Comments */}
            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">💬</span>Comments</h4>
              <CommentsThread task={task} userId={userId} />
            </section>

            {/* AI */}
            <section className="pe-card">
              <h4 className="pe-sect"><span className="pe-sect-mark">✨</span>AI assist</h4>
              <TaskAiPanel
                task={{ ...task, title, description, priority, tags, requestedBy }}
                project={selectedProject}
                subtasks={subtasks}
                onAddSubtasks={(newSubs) => setSubtasks([...subtasks, ...newSubs])}
              />
            </section>
          </div>

          {/* RIGHT — this task's activity log */}
          <aside className="pe-side">
            <div className="pe-side-head">
              <div className="pe-side-title">
                <span>Activity log</span>
                <span className="pe-side-count">{shownActivities.length} entries</span>
              </div>

              <div className="pe-side-stats">
                <div className="pe-sstat pe-tone-navy">
                  <div className="pe-kpi-label">Logged</div>
                  <div className="pe-sstat-value">{loggedHours.toFixed(1)}h</div>
                </div>
                <div className="pe-sstat pe-tone-amber">
                  <div className="pe-kpi-label">Sessions</div>
                  <div className="pe-sstat-value">{activities.length}</div>
                </div>
                <div className="pe-sstat pe-tone-red">
                  <div className="pe-kpi-label">Blocked</div>
                  <div className="pe-sstat-value">{blockedCount}</div>
                </div>
              </div>

              <div className="pe-side-filters">
                {ACT_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`pe-chip${actFilter === f.key ? ' is-on' : ''}`}
                    onClick={() => setActFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <LogComposer
              userId={userId}
              task={{ ...task, title: title.trim() || task.title, projectId: projectId || null, phaseId: phaseId || null, status }}
            />

            <div className="pe-side-scroll">
              {shownActivities.length === 0 ? (
                <div className="pe-side-empty">
                  <div className="pe-side-empty-icon">☰</div>
                  <p>{activities.length === 0 ? 'No activities logged yet.' : 'Nothing matches this filter.'}</p>
                  {activities.length === 0 && <p className="small">Log the first one above — it stamps hours onto this task.</p>}
                </div>
              ) : (
                <ActivityTimeline activities={shownActivities} onSelect={setEditingActivity} />
              )}
            </div>
          </aside>
        </div>

        {/* ── Footer ── */}
        <footer className="pe-foot">
          <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={saving}>Delete task</button>
          <button type="button" className="btn btn-sm" onClick={saveAsTemplate} disabled={saving || !title.trim()}>Save as template</button>
          {updatedAt && (
            <span className="pe-foot-note">Last edited {updatedAt.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          )}
          <div className="pe-foot-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>

    {editingActivity && (
      <ActivityEditor activity={editingActivity} onClose={() => setEditingActivity(null)} />
    )}
    </>
  );
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
      alert('Could not log the activity. Check console.');
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

function PresenceStack({ taskId }) {
  const others = usePresence(taskId);
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
      {links.length === 0 ? (
        <p className="muted small">No relations. Use these for "blocks", "related to", or "duplicate of" — distinct from a hard dependency.</p>
      ) : (
        <div className="te-deps">
          {links.map((l, i) => {
            const target = candidateById[l.targetId];
            const def    = LINK_TYPES.find((t) => t.value === l.type) || LINK_TYPES[1];
            return (
              <div key={i} className="te-dep">
                <span className={`badge badge-soft-${def.badge}`}>{def.icon} {def.label}</span>
                <span className="te-dep-title">{target?.title || '(deleted task)'}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(i)}>✕</button>
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

function CommentsThread({ task, userId }) {
  const taskId = task.id;
  const { comments, loading } = useTaskComments(taskId);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState('');

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    try {
      await addTaskComment(userId, task, text);
      setBody('');
    } catch (err) {
      console.error(err);
      alert('Could not post comment. Check console.');
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (commentId) => {
    const text = editingBody.trim();
    if (!text) { setEditingId(null); return; }
    try { await updateTaskComment(commentId, text); }
    catch (err) { console.error(err); alert('Could not save edit.'); }
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
                  <span className="mono small muted">
                    {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleString() : 'pending'}
                  </span>
                  {c.editedAt && <span className="muted small">(edited)</span>}
                  <div style={{ flex: 1 }} />
                  {!isEditing && (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setEditingId(c.id); setEditingBody(c.body); }}>✎</button>
                      <button className="btn btn-sm btn-ghost link-danger"
                        onClick={() => { if (confirm('Delete this comment?')) softDeleteTaskComment(c.id); }}>✕</button>
                    </>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <MarkdownEditor value={editingBody} onChange={setEditingBody} rows={2} />
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
        <MarkdownEditor value={body} onChange={setBody} rows={3} placeholder="Leave a note… Markdown supported." />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn btn-primary" onClick={post} disabled={posting || !body.trim()}>
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecurrenceEditor({ value, onChange }) {
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
        <p className="muted small" style={{ marginTop: 6 }}>
          The next instance is auto-created when this task is marked done.
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
