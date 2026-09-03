// src/services/anthropic.js — the app's AI features.
//
// Every function here goes through the provider layer in services/ai.js, so
// the actual brain is whichever provider is live:
//
//   claude-code → the local bridge shells out to the Claude Code CLI
//                 (the operator's subscription, no API key, no per-token cost)
//   api         → direct Anthropic Messages API with the company key
//   mock        → placeholder text, always visibly degraded
//
// Nothing in this file talks to a model directly any more. The credential
// helpers below are re-exported unchanged so existing callers keep working.

import { askAI, askAIJson, isAiAvailable } from './ai';
import {
  getApiKey, setApiKey, getModel, setModel,
  setCurrentUserRole, setCurrentCompanyContext, clearCurrentCompanyContext,
  getCurrentCompanyMeta, isUsingCompanyKey,
  getEffectiveApiKey, getEffectiveModel,
} from './aiCredentials';

export {
  getApiKey, setApiKey, getModel, setModel,
  setCurrentUserRole, setCurrentCompanyContext, clearCurrentCompanyContext,
  getCurrentCompanyMeta, isUsingCompanyKey,
  getEffectiveApiKey, getEffectiveModel,
  // The gate every AI surface should use: true when ANY brain is live, not
  // just when an API key exists.
  isAiAvailable,
};

// Free-text completion. Same signature as before; returns the model's text.
// The `degraded` reason (if any) is logged so a fallback never passes as a
// clean success silently.
export async function callClaude({ system, user, maxTokens = 2048, web = false, meta = {} }) {
  const out = await askAI(system, user, { maxTokens, web, meta });
  if (out.degraded) console.warn(`[ai] degraded (${out.provider}): ${out.reason}`);
  return out.text;
}

// Structured completion with one strict retry. Returns the parsed value.
export async function callClaudeJson({ system, user, maxTokens = 2048, web = false, meta = {} }) {
  const out = await askAIJson(system, user, { maxTokens, web, meta });
  if (out.degraded) console.warn(`[ai] degraded (${out.provider}): ${out.reason}`);
  return out.data;
}

// Generate a draft list of tasks from a project name + description.
// Returns array of { title, description, priority, estimatedDays } (where
// `priority` is low|medium|high and `estimatedDays` is a small positive int).
// Throws if the model output cannot be parsed.
export async function generateTaskDrafts({ projectName, projectDescription, phaseNames, count = 8 }) {
  const phaseHint = phaseNames?.length
    ? `\n\nThe project has these phases: ${phaseNames.join(', ')}. Distribute tasks across phases as appropriate.`
    : '';
  const system = `You are a project-management assistant. You break a project down into concrete, actionable tasks.
Respond ONLY with a JSON array of task objects. Each task has these fields:
- title (string, 6-90 chars, imperative tense, specific)
- description (string, 1-3 sentences explaining what to do)
- priority ("low" | "medium" | "high")
- estimatedDays (integer, 1-30, realistic duration in working days)
- phase (string, optional — must match one of the project's phase names if provided)

Do NOT include any prose, markdown, or explanations outside the JSON array. The response must start with [ and end with ].`;

  const user = `Project: ${projectName}

Description:
${projectDescription || '(no description provided)'}
${phaseHint}

Generate ${count} tasks that, together, would deliver this project. Order them logically (earliest/foundational first).`;

  // askAIJson strips fences, tolerates trailing prose and retries once strictly.
  const parsed = await callClaudeJson({ system, user, maxTokens: 2048, meta: { kind: 'task-drafts' } });
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array.');

  // Normalize & clamp
  return parsed.map((t, i) => ({
    id: `draft-${i}`,
    title: String(t.title || '').slice(0, 200).trim() || `Task ${i + 1}`,
    description: String(t.description || '').slice(0, 500).trim(),
    priority: ['low', 'medium', 'high'].includes(String(t.priority).toLowerCase()) ? String(t.priority).toLowerCase() : 'medium',
    estimatedDays: Math.max(1, Math.min(30, Math.round(Number(t.estimatedDays) || 3))),
    phase: t.phase ? String(t.phase).trim() : '',
  }));
}

// Generate subtask suggestions for a single task. Returns array of {id, text}.
export async function generateSubtasks({ task, projectName, count = 6 }) {
  const system = `You are a project-management assistant. You decompose a task into 4-10 concrete subtasks (checklist items).
Respond ONLY with a JSON array of strings. Each string is one subtask, 4-80 characters, written in imperative voice (verb-first).
No markdown, no commentary, no numbering. The response must start with [ and end with ].`;

  const user = `Project: ${projectName || '(none)'}
Task title: ${task.title}
Task description: ${task.description || '(none)'}
Priority: ${task.priority || 'medium'}
${task.requestedBy ? `Requested by: ${task.requestedBy}` : ''}
${task.tags?.length ? `Tags: ${task.tags.join(', ')}` : ''}

Suggest ${count} subtasks that, completed in order, would deliver this task.`;

  const arr = await callClaudeJson({ system, user, maxTokens: 800, meta: { kind: 'subtasks' } });
  if (!Array.isArray(arr)) throw new Error('Model did not return an array.');
  // Use a simple stable-enough id so React keys are unique.
  return arr.map((s, i) => ({
    id: `${Date.now()}-${i}`,
    text: String(s).slice(0, 200).trim(),
    done: false,
  })).filter((s) => s.text);
}

// Generate a Claude-ready prompt that the user can paste into a fresh Claude
// chat (or claude.ai project) to actually produce the deliverable for this
// task. Returns plain text — NOT JSON — so the user can copy it directly.
export async function generateClaudePrompt({ task, projectName, projectDescription, subtasks = [] }) {
  const system = `You write prompts for someone else to give to Claude. Your job is to produce a single, well-structured prompt that, when pasted into Claude, will produce the actual deliverable described.

Output ONLY the prompt itself (no preamble like "Here is the prompt:" and no markdown code fences). The prompt should:
- Start with a one-sentence role assignment for Claude ("You are…")
- State the deliverable clearly with concrete output requirements (format, length, sections)
- Include all the context Claude needs from the task metadata
- End with a brief checklist Claude can use to self-verify

Keep the prompt under 400 words. Use plain text with light Markdown headings (## only). Do not include any wrapper or commentary outside the prompt.`;

  const subtaskBlock = subtasks.length
    ? `\nKnown subtasks (the steps to deliver this):\n${subtasks.map((s, i) => `${i + 1}. ${s.text}${s.done ? ' (done)' : ''}`).join('\n')}`
    : '';

  const user = `I need a prompt that I can paste into Claude to get the deliverable for this task.

Task: ${task.title}
${task.description ? `Description: ${task.description}` : ''}
Project: ${projectName || '(no project)'}
${projectDescription ? `Project context: ${projectDescription}` : ''}
${task.requestedBy ? `Requested by: ${task.requestedBy}` : ''}
${task.tags?.length ? `Tags: ${task.tags.join(', ')}` : ''}
${task.plan?.endDate ? `Due: ${task.plan.endDate}` : ''}
${subtaskBlock}

Now write the prompt I'll paste into Claude. The prompt should make it unambiguous what deliverable Claude must produce.`;

  const text = await callClaude({ system, user, maxTokens: 1024, meta: { kind: 'claude-prompt' } });
  return text.trim();
}

// "Summarize my week" — given a list of activities, produce a Markdown summary.
export async function summarizeWeek({ activities, tasks, projects }) {
  const projectByName = {};
  projects.forEach((p) => { projectByName[p.id] = p.name; });
  const lines = activities.map((a) => {
    const proj = projectByName[a.projectId] || a.taskCategory || '—';
    return `- ${a.date} · ${proj} · ${a.taskTitle || ''}${a.comment ? `: ${a.comment.slice(0, 120)}` : ''}${a.hoursSpent ? ` (${a.hoursSpent}h)` : ''}${a.bottleneckRemarks ? ` [⚠ ${a.bottleneckRemarks.slice(0, 60)}]` : ''}`;
  });

  const system = `You write concise, accurate weekly summaries for a single operator. You are NOT a hype-machine — you describe what happened and what the next focus should be.

Respond in Markdown with these sections in this order:
## Highlights
3-6 bullets — the most consequential things that moved.
## Hours by project
A short bullet list (project: total hours).
## Blockers & risks
Pull from bottleneck remarks. If none, say "None recorded."
## Next focus
2-4 bullets — what deserves attention next week, with reasoning.

Stay under 350 words. No emojis. No celebratory framing.`;

  const user = `Activities this period (${activities.length} entries):\n${lines.join('\n')}\n\nWrite the summary.`;
  const text = await callClaude({ system, user, maxTokens: 1200, meta: { kind: 'weekly-summary' } });
  return text.trim();
}

// Structured "what should I do next?" — returns the top N open tasks to tackle
// now, each tied to a real task id (or null for a proposed new action), so the
// caller can offer a "generate prompt" action per item.
export async function suggestTopTasks({ tasks, projects, today, count = 3 }) {
  const projById = {};
  projects.forEach((p) => { projById[p.id] = p; });
  const open = tasks.filter((t) => t.status !== 'done').slice(0, 60);
  const lines = open.map((t) => {
    const p = projById[t.projectId];
    return `- id:${t.id} | ${t.title} [${t.status}/${t.priority || 'medium'}]${p ? ` · ${p.name}` : ''}${t.plan?.endDate ? ` · due ${t.plan.endDate}` : ''}${t.dependsOn?.length ? ` · blocked by ${t.dependsOn.length} task(s)` : ''}`;
  });

  const system = `You help an operator who feels stuck decide what to do next. From their open tasks, choose the ${count} MOST important to tackle right now. Weigh: due dates (sooner = higher), priority, dependencies (a task blocked by incomplete work ranks lower; one that unblocks others ranks higher), and momentum.

Respond ONLY with a JSON array of exactly ${count} objects, highest priority first. Each object:
- "taskId": the id from the list (copy it exactly), or null if you propose a brand-new action not in the list
- "title": a short imperative action (<= 80 chars)
- "reason": one concise sentence on why to do it now

No prose, no markdown, no code fences. The response must start with [ and end with ].`;

  const user = `Today is ${today}.
Open tasks (${open.length}):
${lines.join('\n') || '(none yet — propose sensible first actions)'}

Return the top ${count} as a JSON array.`;

  const parsed = await callClaudeJson({ system, user, maxTokens: 700, meta: { kind: 'top-tasks' } });
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array.');
  const known = new Set(open.map((t) => t.id));
  return parsed.slice(0, count).map((s, i) => ({
    id: `sug-${i}`,
    taskId: s.taskId && known.has(s.taskId) ? s.taskId : null,
    title: String(s.title || '').slice(0, 160).trim() || `Suggestion ${i + 1}`,
    reason: String(s.reason || '').slice(0, 280).trim(),
  }));
}

// "What should I tackle today?"
export async function suggestNextTask({ tasks, projects, today }) {
  const projById = {};
  projects.forEach((p) => { projById[p.id] = p; });
  const open = tasks.filter((t) => t.status !== 'done').slice(0, 40);
  const lines = open.map((t) => {
    const p = projById[t.projectId];
    return `- ${t.title} [${t.status}/${t.priority || 'medium'}] ${p ? `· ${p.name}` : ''} ${t.plan?.endDate ? `· due ${t.plan.endDate}` : ''}${t.dependsOn?.length ? ` · blocked by ${t.dependsOn.length}` : ''}`;
  });

  const system = `You help an operator prioritize. Given a list of open tasks, recommend what to tackle TODAY in order. Consider: due dates, priority, dependencies (a task blocked by an incomplete dep should rank lower), and whether it unblocks others.

Respond in Markdown. Top of response: a "Today's focus" header listing 3 specific tasks in order with one-line rationale each. Below: "Stretch" with 1-2 secondary picks. Below: "Skip for now" with 1-2 picks and why. Be specific — quote the task title.

Under 200 words total. No emojis.`;

  const user = `Today is ${today}.\nOpen tasks:\n${lines.join('\n')}\n\nWhat should I tackle today?`;
  const text = await callClaude({ system, user, maxTokens: 800, meta: { kind: 'next-task' } });
  return text.trim();
}

// "Draft a status update from these activities"
export async function draftStatusUpdate({ activities, audience = 'a teammate' }) {
  const lines = activities.map((a) => `- ${a.date} · ${a.taskTitle || ''}${a.comment ? `: ${a.comment}` : ''}`);

  const system = `You draft brief, factual status updates. The audience is ${audience}.

Output Markdown with three sections:
## Progress
3-5 bullets, plain factual past-tense.
## Open items
What's in flight or awaiting input.
## Asks
Anything the recipient needs to act on. If none, say "Nothing right now."

Under 250 words. Plain professional voice. No emojis. No celebratory framing.`;

  const user = `Activities to summarize:\n${lines.join('\n')}\n\nWrite the status update.`;
  const text = await callClaude({ system, user, maxTokens: 800, meta: { kind: 'status-update' } });
  return text.trim();
}
