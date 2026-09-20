// src/services/askAi.js — the side-effecting half of the Ask AI engine.
//
// The analysis itself (buildDigest, intent routing, search, answer builders,
// suggestions) lives in ./askAiCore.js with no Firebase or network imports, so
// it can be unit-tested. This file adds the three things that cannot be pure:
//   narrate()     — hands the computed facts to Claude for the prose.
//   parseAction() — turns a request into ONE validated write proposal.
//   applyAction() — performs that write, only after the user confirms.
//
// Everything in askAiCore is re-exported here, so callers keep importing from
// './askAi' exactly as before.

import { callClaudeJson, callClaudeJsonFull } from './anthropic';
import { parseQuickAdd } from './nlpQuickAdd';
import { isAiAvailable as aiBrainAvailable } from './ai';
import {
  addProject, updateProject, softDeleteProject,
  addTask, updateTask, softDeleteTask,
  addActivity, editActivity, deleteActivity,
} from './firebase';
import { fmtHours } from './askAiCore';

export * from './askAiCore';

// Whether an AI brain is reachable at all. It lives here rather than in the
// pure core because answering it means asking the provider layer.
export function isAiAvailable() {
  return aiBrainAvailable();
}

/* ── AI narration — prose only, never numbers ────────────── */

// Serializes the computed facts so the model reasons over real data.
function factsText(answer, digest, scope) {
  const lines = [];
  lines.push(`Today: ${digest.today}`);
  lines.push(`Scope requested: ${scope}`);
  lines.push(`Totals: ${digest.counts.workspaces} workspaces, ${digest.counts.projects} projects, ${digest.counts.tasks} tasks (${digest.counts.open} open, ${digest.counts.overdue} overdue, ${digest.counts.blocked} blocked), ${digest.counts.activities30} activities in 30 days, ${digest.counts.unassigned} unassigned tasks.`);
  if (answer.metrics?.length) lines.push(`Metrics: ${answer.metrics.map((m) => `${m.label}=${m.value} (${m.delta})`).join('; ')}`);
  if (answer.items?.length) {
    lines.push(`${answer.itemsTitle}:`);
    answer.items.forEach((it) => lines.push(`  - ${it.title} [${it.tag}] — ${it.meta}`));
  }
  lines.push(`Project health: ${digest.projects.map((p) => `${p.name} ${p.donePct}% done${p.elapsedPct != null ? `/${p.elapsedPct}% elapsed` : ''}, ${p.overdue} overdue`).join(' | ') || '(none)'}`);
  // The raw activity log, so answers can quote a specific entry rather than
  // only aggregates. Newest first, capped so the prompt stays small.
  const log = digest.activityLog || [];
  if (log.length) {
    lines.push(`Activity log (newest first, ${Math.min(log.length, 25)} of ${log.length} entries in 30 days):`);
    log.slice(0, 25).forEach((e) => lines.push(
      `  - ${e.date} · ${e.project} · ${e.title} · ${e.hours}h · ${e.status}${e.who ? ` · ${e.who}` : ''}${e.bottleneck ? ` · BLOCKER: ${e.bottleneck.slice(0, 110)}` : e.note ? ` · note: ${e.note.slice(0, 110)}` : ''}`,
    ));
  }
  if (answer.searchLabel !== undefined) {
    lines.push(`Search performed: ${answer.searchLabel || '(no terms)'} — matched ${answer.matchCount} task(s). The list above is the COMPLETE result set.`);
  }
  // The real task inventory, so the model can never claim a task does not
  // exist when it does — it only ever narrates what is actually here.
  const idx = digest.taskIndex || [];
  if (idx.length) {
    lines.push(`Task inventory (${Math.min(idx.length, 40)} of ${idx.length}): ${idx.slice(0, 40).map((t) => `${t.title} [${t.status}${t.overdue ? ', overdue' : ''}]`).join(' | ')}`);
  }
  if (digest.blockers.tasks.length) lines.push(`Blocked tasks: ${digest.blockers.tasks.slice(0, 5).map((b) => `${b.task.title} (${b.days}d${b.why ? `: ${b.why.slice(0, 80)}` : ''})`).join(' | ')}`);
  if (digest.people.length) lines.push(`Workload: ${digest.people.map((p) => `${p.label} ${p.open} open/${p.doing} doing/${p.overdue} overdue`).join(' | ')}`);
  return lines.join('\n');
}

const NARRATE_SYSTEM = `You are the analyst inside "Task Monitor", a project-management app. You are shown FACTS computed from the user's live database. Those facts are correct and complete — never invent, adjust or contradict a number, name or date, and never mention data you were not given.

Write for a busy operator: direct, concrete, no filler, no praise, no "it looks like". Refer to projects, tasks and people by their real names from the facts. Never say something does not exist unless the facts say so — when a search result is given, it is the complete answer, so report it as found. When the activity log is included, quote or paraphrase specific entries (with their date) rather than only aggregates — the user wants updates down to the individual log entry.

Respond ONLY with a JSON object. Do not wrap the object itself in code fences:
{
  "summary": "the answer, as GitHub-flavoured Markdown (see below)",
  "actions": ["3 short, specific, imperative next steps"],
  "followUps": ["3 short follow-up questions the user might ask next, max 40 chars each"]
}

FORMATTING \`summary\`
Write it as Markdown, and use the structure the answer actually needs:
- Lead with 1-3 sentences of prose that answer the question directly.
- Use "## " / "### " headings only when the answer really has sections.
- Use "- " bullets or "1. " numbers for anything that is a list.
- Use **bold** for names, numbers and verdicts worth scanning for.
- Use a pipe table when you are comparing the same fields across several
  projects, people or weeks:
  | Project | Hours | Overdue |
  | --- | ---: | ---: |
  | SBLAF | 12.5 | 3 |
- Use \`inline code\` for ids, field names and literal values.
Never emit raw HTML, and never wrap the whole summary in a code fence.
Keep it tight — a busy operator should get the answer in the first two lines,
with the structure underneath for anyone who wants the detail.`;

// Upgrades a locally-built answer's prose with Claude. Returns the answer
// unchanged (plus `aiError`) when AI is unavailable or the call fails — the
// numbers, items and metrics are never touched either way.
export async function narrate({ question, answer, digest, scope = 'Everything', ground = null }) {
  if (!isAiAvailable()) return { ...answer, aiUsed: false };
  try {
    const user = `Question: ${question}

FACTS
${factsText(answer, digest, scope)}

Answer the question from these facts.`;
    const out = await callClaudeJsonFull({
      system: NARRATE_SYSTEM, user, maxTokens: 1400, ground,
      meta: { kind: 'ask-ai-narrate', scope },
    });
    const parsed = out.data;
    return {
      ...answer,
      // Grounded ≠ succeeded: the badge and the degraded reason both travel
      // with the answer so the view can never render a fallback as clean.
      grounding: out.grounding || null,
      groundDegraded: out.degraded ? (out.reason || 'The answer was degraded.') : null,
      summary: String(parsed.summary || answer.summary).trim() || answer.summary,
      actions: Array.isArray(parsed.actions) && parsed.actions.length
        ? parsed.actions.slice(0, 4).map((a) => String(a).trim()).filter(Boolean)
        : answer.actions,
      followUps: Array.isArray(parsed.followUps) && parsed.followUps.length
        ? parsed.followUps.slice(0, 3).map((f) => ({ label: String(f).trim(), q: String(f).trim() }))
        : answer.followUps,
      aiUsed: true,
    };
  } catch (err) {
    console.warn('[ask-ai] narration failed, falling back to local summary:', err);
    return { ...answer, aiUsed: false, aiError: err?.message || String(err) };
  }
}


const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES   = ['todo', 'doing', 'done'];
const COMPLETIONS = ['not-started', 'in-progress', 'blocked', 'completed'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ACTION_SYSTEM = `You turn a project-management request into ONE structured write operation against the user's live data.

You are given the real projects, tasks and recent activity entries with their ids. You may ONLY reference ids from those lists — never invent one. If the request names something you cannot find, or is missing something required, or would mean more than one operation, return a "clarify" question instead.

Respond ONLY with a JSON object, no markdown, no code fences:
{
  "op": "create" | "update" | "delete",
  "entity": "project" | "task" | "activity",
  "targetId": "<id from the lists, required for update/delete, null for create>",
  "data": { ...fields to write, omit anything the user did not ask for... },
  "clarify": "<a question, ONLY when you cannot build a safe operation; otherwise null>"
}

Field shapes:
- project: name, description, color (#rrggbb)
- task: title, description, projectId, phaseId, priority (low|medium|high), status (todo|doing|done), plan {startDate, endDate} as YYYY-MM-DD, tags [string], requestedBy
- activity: taskId (required on create), date (YYYY-MM-DD), comment, hoursSpent (number), completionStatus (not-started|in-progress|blocked|completed), bottleneckRemarks

Resolve relative dates ("today", "Friday", "next week") against the given date. For an update, put ONLY the fields that change in "data".`;

// Request → validated proposal. Never writes. Returns { proposal } or { clarify }.
export async function parseAction({ question, digest, workspaceId, userId }) {
  let raw;
  if (isAiAvailable()) {
    const projects = digest.projects.map((p) => `  project id:${p.id} "${p.name}"`).join('\n');
    const phases = (digest.projectPhases || []).map((p) => `  phase id:${p.id} "${p.name}" in project ${p.projectId}`).join('\n');
    const tasks = (digest.taskIndex || []).slice(0, 80)
      .map((t) => `  task id:${t.id} "${t.title}" [${t.status}] project:${t.projectId || 'none'}${t.due ? ` due:${t.due}` : ''}`).join('\n');
    const acts = (digest.activityLog || []).slice(0, 25)
      .map((a) => `  activity id:${a.id} ${a.date} task:${a.taskId} "${a.title}" ${a.hours}h ${a.status}`).join('\n');
    const user = `Today is ${digest.today}.

PROJECTS
${projects || '  (none)'}
${phases ? `\nPHASES\n${phases}` : ''}

TASKS
${tasks || '  (none)'}

RECENT ACTIVITY ENTRIES
${acts || '  (none)'}

Request: ${question}`;
    raw = await callClaudeJson({ system: ACTION_SYSTEM, user, maxTokens: 700, meta: { kind: 'ask-ai-action' } });
  } else {
    raw = localParseAction(question, digest);
    if (!raw) {
      return { clarify: 'I need an AI brain connected to interpret that request — an admin can connect one in Settings. In the meantime you can add it directly from the Projects or Board views.' };
    }
  }

  if (raw?.clarify) return { clarify: String(raw.clarify) };
  return resolveAction(raw, digest, { workspaceId, userId });
}

// Offline fallback: handles the two unambiguous shapes without a model.
//   "add task <text>"  /  "create project <name>"
function localParseAction(question, digest) {
  const s = String(question || '').trim();
  const task = s.match(/^(?:add|create|new)\s+(?:a\s+)?task\s+(.+)$/i);
  if (task) {
    const parsed = parseQuickAdd(task[1]);
    if (!parsed.title) return null;
    return {
      op: 'create', entity: 'task', targetId: null,
      data: {
        title: parsed.title,
        priority: parsed.priority || undefined,
        tags: parsed.tags?.length ? parsed.tags : undefined,
        requestedBy: parsed.requestedBy || undefined,
        plan: parsed.plan?.endDate ? { endDate: parsed.plan.endDate } : undefined,
        projectId: digest.projects.find((p) => s.toLowerCase().includes(p.name.toLowerCase()))?.id,
      },
    };
  }
  const project = s.match(/^(?:add|create|new)\s+(?:a\s+)?project\s+(.+)$/i);
  if (project) {
    return { op: 'create', entity: 'project', targetId: null, data: { name: project[1].replace(/^["']|["']$/g, '').trim() } };
  }
  return null;
}

// Validates the model's output against live data and shapes it for the
// confirmation bubble. Anything unresolvable becomes a clarify question.
function resolveAction(raw, digest, { workspaceId }) {
  const op = String(raw?.op || '').toLowerCase();
  const entity = String(raw?.entity || '').toLowerCase();
  if (!['create', 'update', 'delete'].includes(op)) return { clarify: 'I could not tell whether you want to add, edit or delete something. Try "add a task…", "change …" or "delete …".' };
  if (!['project', 'task', 'activity'].includes(entity)) return { clarify: 'I can add, edit or delete a project, a task or an activity log entry. Which one did you mean?' };

  const data = raw?.data && typeof raw.data === 'object' ? raw.data : {};
  const fields = [];
  const warnings = [];
  const add = (label, value) => { if (value !== undefined && value !== null && value !== '') fields.push({ label, value: String(value) }); };

  const project = (id) => digest.projects.find((p) => p.id === id);
  const task    = (id) => (digest.taskIndex || []).find((t) => t.id === id);
  const act     = (id) => (digest.activityLog || []).find((a) => a.id === id);

  if (op !== 'create' && !raw?.targetId) return { clarify: `Which ${entity} did you mean? Name it and I will show you the change before anything is written.` };

  /* ── project ── */
  if (entity === 'project') {
    if (op === 'create') {
      const name = String(data.name || '').trim();
      if (!name) return { clarify: 'What should the project be called?' };
      add('Name', name);
      add('Description', data.description);
      add('Workspace', digest.workspaces.find((w) => w.id === workspaceId)?.name || 'active workspace');
      return { proposal: {
        op, entity, targetId: null, targetLabel: null,
        title: 'Create project', fields, warnings,
        payload: { workspaceId, name, description: data.description || '', color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : undefined },
      } };
    }
    const p = project(raw.targetId);
    if (!p) return { clarify: 'I could not find that project in this workspace.' };
    if (op === 'delete') {
      add('Project', p.name);
      add('Holds', `${p.total} tasks · ${fmtHours(p.hours)} logged in 30 days`);
      warnings.push('The project is soft-deleted (hidden everywhere, recoverable in Firestore). Its tasks are NOT deleted.');
      return { proposal: { op, entity, targetId: p.id, targetLabel: p.name, title: 'Delete project', fields, warnings, payload: {} } };
    }
    const updates = {};
    add('Project', p.name);
    if (data.name)        { updates.name = String(data.name).trim(); add('Name', `${p.name} → ${updates.name}`); }
    if (data.description !== undefined) { updates.description = String(data.description); add('Description', updates.description || '(cleared)'); }
    if (/^#[0-9a-f]{6}$/i.test(data.color || '')) { updates.color = data.color; add('Color', data.color); }
    if (!Object.keys(updates).length) return { clarify: `What should change on ${p.name}?` };
    return { proposal: { op, entity, targetId: p.id, targetLabel: p.name, title: 'Edit project', fields, warnings, payload: updates } };
  }

  /* ── task ── */
  if (entity === 'task') {
    const clean = {};
    if (data.priority && PRIORITIES.includes(String(data.priority).toLowerCase())) clean.priority = String(data.priority).toLowerCase();
    if (data.status   && STATUSES.includes(String(data.status).toLowerCase()))     clean.status   = String(data.status).toLowerCase();
    const plan = {};
    if (ISO_DATE.test(data.plan?.startDate || '')) plan.startDate = data.plan.startDate;
    if (ISO_DATE.test(data.plan?.endDate   || '')) plan.endDate   = data.plan.endDate;
    if (data.plan && !Object.keys(plan).length) warnings.push('I could not read a valid date out of that, so no date is being set.');
    const proj = data.projectId ? project(data.projectId) : null;
    if (data.projectId && !proj) return { clarify: 'I could not find that project. Which project should this task sit in?' };
    const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : null;

    if (op === 'create') {
      const title = String(data.title || '').trim();
      if (!title) return { clarify: 'What should the task be called?' };
      add('Title', title);
      add('Project', proj ? proj.name : 'none (unfiled)');
      add('Description', data.description);
      add('Priority', clean.priority || 'medium');
      add('Due', plan.endDate);
      add('Starts', plan.startDate);
      add('Tags', tags?.join(', '));
      add('Requested by', data.requestedBy);
      if (!proj) warnings.push('No project matched, so the task will be created unfiled. Name a project to place it.');
      const phase = (digest.projectPhases || []).find((ph) => ph.id === data.phaseId && ph.projectId === proj?.id);
      add('Phase', phase?.name);
      return { proposal: {
        op, entity, targetId: null, targetLabel: null,
        title: 'Create task', fields, warnings,
        payload: {
          workspaceId, title,
          description: data.description || '',
          projectId: proj?.id || null,
          phaseId: phase?.id || null,
          priority: clean.priority || 'medium',
          plan,
          tags: tags || [],
          requestedBy: data.requestedBy || '',
        },
      } };
    }

    const t = task(raw.targetId);
    if (!t) return { clarify: 'I could not find that task. Which one did you mean?' };
    if (op === 'delete') {
      add('Task', t.title);
      add('In', t.project);
      add('Has', `${t.activityCount} activity entries · ${fmtHours(t.hours)} logged`);
      warnings.push('The task is soft-deleted, never hard-deleted — its activity entries stay intact.');
      return { proposal: { op, entity, targetId: t.id, targetLabel: t.title, title: 'Delete task', fields, warnings, payload: { projectId: t.projectId } } };
    }
    const updates = {};
    add('Task', t.title);
    add('In project', t.project);
    if (data.title)       { updates.title = String(data.title).trim(); add('Title', `${t.title} → ${updates.title}`); }
    if (data.description !== undefined) { updates.description = String(data.description); add('Description', updates.description || '(cleared)'); }
    if (clean.priority)   { updates.priority = clean.priority; add('Priority', clean.priority); }
    if (clean.status)     { updates.status = clean.status; add('Status', `${t.status} → ${clean.status}`); }
    if (proj)             { updates.projectId = proj.id; add('Project', `${t.project} → ${proj.name}`); }
    if (Object.keys(plan).length) {
      updates.plan = { ...(t.task.plan || {}), ...plan };
      add('Due', plan.endDate ? `${t.due || 'none'} → ${plan.endDate}` : undefined);
      add('Starts', plan.startDate);
    }
    if (tags)             { updates.tags = tags; add('Tags', tags.join(', ') || '(cleared)'); }
    if (!Object.keys(updates).length) return { clarify: `What should change on "${t.title}"?` };
    return { proposal: { op, entity, targetId: t.id, targetLabel: t.title, title: 'Edit task', fields, warnings, payload: { updates, projectId: t.projectId } } };
  }

  /* ── activity ── */
  const hours = data.hoursSpent === undefined ? undefined : Number(data.hoursSpent);
  if (hours !== undefined && (!Number.isFinite(hours) || hours < 0 || hours > 24)) {
    return { clarify: 'How many hours should I log? It has to be a number between 0 and 24.' };
  }
  const completion = COMPLETIONS.includes(String(data.completionStatus || '').toLowerCase())
    ? String(data.completionStatus).toLowerCase() : undefined;
  const date = ISO_DATE.test(data.date || '') ? data.date : undefined;

  if (op === 'create') {
    const t = task(data.taskId);
    if (!t) return { clarify: 'Which task should this activity be logged against?' };
    add('Task', t.title);
    add('Project', t.project);
    add('Date', date || digest.today);
    add('Hours', hours ?? 0);
    add('Comment', data.comment);
    add('Completion', completion || 'in-progress');
    add('Bottleneck', data.bottleneckRemarks);
    return { proposal: {
      op, entity, targetId: null, targetLabel: t.title,
      title: 'Log activity', fields, warnings,
      payload: {
        taskId: t.id, projectId: t.projectId,
        activity: {
          date: date || digest.today,
          comment: data.comment || '',
          hoursSpent: hours ?? 0,
          completionStatus: completion || 'in-progress',
          bottleneckRemarks: data.bottleneckRemarks || '',
        },
      },
    } };
  }

  const a = act(raw.targetId);
  if (!a) return { clarify: 'I could not find that activity entry in the last 30 days. Which one did you mean?' };
  if (op === 'delete') {
    add('Entry', `${a.date} · ${a.title}`);
    add('Hours', a.hours);
    warnings.push("Activity entries are removed for good, and the task's logged-hours counter is adjusted down.");
    return { proposal: { op, entity, targetId: a.id, targetLabel: `${a.date} · ${a.title}`, title: 'Delete activity entry', fields, warnings, payload: { projectId: a.projectId } } };
  }
  const updates = {};
  add('Entry', `${a.date} · ${a.title}`);
  add('In project', a.project);
  if (date)                 { updates.date = date; add('Date', `${a.date} → ${date}`); }
  if (hours !== undefined)  { updates.hoursSpent = hours; add('Hours', `${a.hours} → ${hours}`); }
  if (data.comment !== undefined)           { updates.comment = String(data.comment); add('Comment', updates.comment || '(cleared)'); }
  if (completion)           { updates.completionStatus = completion; add('Completion', `${a.status} → ${completion}`); }
  if (data.bottleneckRemarks !== undefined) { updates.bottleneckRemarks = String(data.bottleneckRemarks); add('Bottleneck', updates.bottleneckRemarks || '(cleared)'); }
  if (!Object.keys(updates).length) return { clarify: 'What should change on that entry?' };
  return { proposal: { op, entity, targetId: a.id, targetLabel: `${a.date} · ${a.title}`, title: 'Edit activity entry', fields, warnings, payload: { updates, projectId: a.projectId } } };
}

/* ── apply (runs only after Confirm) ─────────────────────── */

function appUrl(hash) {
  if (typeof window === 'undefined') return hash;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${hash}`;
}

// Writes the proposal. Returns { url, hash, label, taskId? } for the receipt.
export async function applyAction(proposal, { userId, digest }) {
  const { op, entity, targetId, payload } = proposal;

  if (entity === 'project') {
    if (op === 'create') {
      const ref = await addProject(userId, payload);
      return { label: payload.name, hash: '#/projects', url: appUrl('#/projects'), id: ref?.id };
    }
    if (op === 'update') {
      await updateProject(targetId, payload);
      return { label: proposal.targetLabel, hash: '#/projects', url: appUrl('#/projects'), id: targetId };
    }
    await softDeleteProject(targetId);
    return { label: proposal.targetLabel, hash: '#/projects', url: appUrl('#/projects'), id: targetId, deleted: true };
  }

  if (entity === 'task') {
    if (op === 'create') {
      const ref = await addTask(userId, payload);
      const hash = `#/board/${payload.projectId || 'all'}`;
      return { label: payload.title, hash, url: appUrl(hash), id: ref?.id, taskId: ref?.id };
    }
    if (op === 'update') {
      await updateTask(targetId, payload.updates);
      const hash = `#/board/${payload.projectId || 'all'}`;
      return { label: proposal.targetLabel, hash, url: appUrl(hash), id: targetId, taskId: targetId };
    }
    await softDeleteTask(targetId);
    const hash = `#/board/${payload.projectId || 'all'}`;
    return { label: proposal.targetLabel, hash, url: appUrl(hash), id: targetId, deleted: true };
  }

  // activity
  if (op === 'create') {
    const t = (digest.taskIndex || []).find((x) => x.id === payload.taskId);
    if (!t) throw new Error('That task no longer exists.');
    await addActivity(userId, t.task, payload.activity);
    const hash = `#/table/${payload.projectId || 'all'}`;
    return { label: `${payload.activity.date} · ${t.title}`, hash, url: appUrl(hash), taskId: t.id };
  }
  const existing = (digest.activityLog || []).find((a) => a.id === targetId);
  // editActivity/deleteActivity only read attachments.length to compute the
  // task's attachmentCount delta, and the digest carries that count (not the
  // array), so stand in an array of the right length. An empty one here would
  // silently leave attachmentCount too high after a delete.
  const raw = existing
    ? {
        id: existing.id,
        taskId: existing.taskId,
        hoursSpent: existing.hours,
        attachments: new Array(existing.attachments || 0).fill(null),
      }
    : null;
  if (!raw) throw new Error('That activity entry no longer exists.');
  if (op === 'update') {
    await editActivity(raw, payload.updates);
    const hash = `#/table/${payload.projectId || 'all'}`;
    return { label: proposal.targetLabel, hash, url: appUrl(hash), taskId: raw.taskId };
  }
  await deleteActivity(raw);
  const hash = `#/table/${payload.projectId || 'all'}`;
  return { label: proposal.targetLabel, hash, url: appUrl(hash), deleted: true };
}
