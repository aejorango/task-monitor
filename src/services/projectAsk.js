// src/services/projectAsk.js — asking about ONE project, where you are looking
// at it (T-0140 / NEW-024).
//
// Ask AI is workspace-wide and lives on its own page, and the NotebookLM
// grounding that makes its answers trustworthy is reachable only from there.
// The question people actually have is project-shaped — "what is holding up the
// Riverside job?" — and they have it while looking at the project.
//
// Pure: it scopes the digest and works out which notebook applies. The answer
// itself still goes through `narrate` → `askAI`, the one chokepoint. No new
// provider path, no direct model call.

import { buildDigest } from './askAiCore';

/**
 * Which notebook grounds a question about this project.
 *
 * A project carries its own; `null` on the project means "inherit the
 * workspace's", which is the documented meaning of that field — not "no
 * notebook". Where it came from travels too, because "grounded in the
 * workspace's notebook" and "grounded in this project's" are different claims
 * to make to a reader.
 *
 * @returns {{ notebookId, notebookTitle, from: 'project'|'workspace'|null }}
 */
export function notebookForProject(project, workspace) {
  const own = project?.knowledge;
  if (own?.notebookId) {
    return { notebookId: own.notebookId, notebookTitle: own.notebookTitle || null, from: 'project' };
  }
  const ws = workspace?.knowledge;
  if (ws?.notebookId) {
    return { notebookId: ws.notebookId, notebookTitle: ws.notebookTitle || null, from: 'workspace' };
  }
  return { notebookId: null, notebookTitle: null, from: null };
}

/** The `ground` argument for askAI, or null when there is nothing to ground on. */
export function groundFor(project, workspace) {
  const nb = notebookForProject(project, workspace);
  if (!nb.notebookId) return null;
  return { notebookId: nb.notebookId, workspaceId: project?.workspaceId || workspace?.id || null, projectId: project?.id || null };
}

/**
 * A digest of ONE project: its tasks, its activities, its own health.
 *
 * The workspace-wide digest would answer "how is everything", which is the
 * question the Ask AI page already answers. Narrowing it here is what makes the
 * reply about the project the user is looking at.
 */
export function projectDigest({ project, tasks = [], activities = [], memberProfiles = {}, workspace = null } = {}) {
  if (!project) return buildDigest({});
  const own = tasks.filter((t) => t && t.projectId === project.id && !t.deleted && !t.archived);
  const ids = new Set(own.map((t) => t.id));
  const ownActivities = activities.filter((a) => a
    && !a.deleted
    && (a.projectId === project.id || ids.has(a.taskId)));

  return buildDigest({
    tasks: own,
    projects: [project],
    activities: ownActivities,
    workspaces: workspace ? [workspace] : [],
    memberProfiles,
    activeWorkspaceId: project.workspaceId || workspace?.id || null,
  });
}

/**
 * Questions worth offering before anybody types.
 *
 * Built from what this project actually has, so a project with nothing overdue
 * is not offered "what is overdue" — a starter question with an empty answer
 * teaches people the feature does not work.
 */
export function askSuggestions(digest) {
  const out = [];
  const counts = digest?.counts || {};
  if (counts.overdue > 0) out.push('What is holding this project up?');
  if ((digest?.blockers || []).length > 0) out.push('What has been raised as a blocker?');
  if (counts.open > 0) out.push('What should we do next?');
  if (counts.done > 0) out.push('Summarise what has been done so far.');
  out.push('Write a short status update for the client.');
  return out.slice(0, 4);
}

/**
 * How an answer's grounding should read.
 *
 * Three states, and they are not interchangeable: grounded (here is what it was
 * read from), asked-for-but-failed (still answered, and said so), and never
 * asked. Rendering the second as the third is how a fallback gets shown as a
 * clean result.
 *
 * @returns {{ state: 'grounded'|'degraded'|'none', label, title, citations }}
 */
export function groundingState(answer, nb) {
  const citations = answer?.grounding?.citations || [];
  if (answer?.grounding) {
    const where = nb?.from === 'workspace' ? 'the workspace notebook' : 'this project’s notebook';
    return {
      state: 'grounded',
      label: `Grounded · ${citations.length} source${citations.length === 1 ? '' : 's'}`,
      title: `Read from ${nb?.notebookTitle || where} before answering`,
      citations,
    };
  }
  if (answer?.groundDegraded) {
    return {
      state: 'degraded',
      label: 'Not grounded',
      // The reason is the app's own sentence, already written for a reader.
      title: answer.groundDegraded,
      citations: [],
    };
  }
  return { state: 'none', label: '', title: '', citations: [] };
}
