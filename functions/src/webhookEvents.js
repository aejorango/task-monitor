// functions/src/webhookEvents.js — which webhooks fire for a change, and what
// the body looks like.
//
// Pure, so the decision and the payload are tested without Firestore: getting
// this wrong means either silence (a webhook nobody notices is broken) or spam
// (an integration fired on every keystroke).

import crypto from 'node:crypto';

/**
 * `sha256=<hex>` — an HMAC over the exact bytes we send, so a receiver can
 * prove the request came from this workspace and was not altered. Prefixed with
 * the algorithm so it can change later without breaking every receiver.
 * @returns {string|null} null when the webhook has no secret configured
 */
export function signBody(body, secret) {
  if (!secret) return null;
  return `sha256=${crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

export const WEBHOOK_EVENTS = [
  'task.created', 'task.updated', 'task.completed', 'task.deleted',
  'activity.logged',
];

/**
 * What happened to a task document.
 * @param {object|null} before  the document before the write (null = created)
 * @param {object|null} after   the document after (null = hard-deleted)
 * @returns {string[]} zero or more event names
 */
export function taskEventsFor(before, after) {
  // A hard delete, or a soft delete (the app never hard-deletes tasks).
  if (!after) return before ? ['task.deleted'] : [];
  if (after.deleted && !before?.deleted) return ['task.deleted'];
  if (after.deleted) return [];                 // already gone; stay quiet

  if (!before) return ['task.created'];
  if (before.deleted && !after.deleted) return ['task.created'];   // restored

  const events = [];
  if (after.status === 'done' && before.status !== 'done') events.push('task.completed');

  // "Updated" means something a person changed — not a counter the app bumped
  // while logging an activity, or a timestamp. Otherwise every activity write
  // would fire a second webhook.
  const IGNORED = new Set([
    'updatedAt', 'lastActivityAt', 'activityCount', 'totalHoursLogged',
    'attachmentCount', 'lastClaimInviteId',
  ]);
  const changed = Object.keys({ ...before, ...after })
    .filter((k) => !IGNORED.has(k))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

  if (changed.length && !events.includes('task.completed')) events.push('task.updated');
  return events;
}

/** Which of a workspace's webhooks want this event. */
export function matchingWebhooks(webhooks, event, workspaceId) {
  return (webhooks || []).filter((h) =>
    h
    && h.enabled !== false
    && !h.deleted
    && h.workspaceId === workspaceId
    && typeof h.url === 'string'
    && /^https:\/\//i.test(h.url)          // never post a secret over plain http
    && (h.events || []).includes(event));
}

/** A URL we are willing to POST to. Blocks loopback and private ranges. */
export function isDeliverableUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return false; }
  if (url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === 'metadata.google.internal') return false;
  // IPv4 literals in private / loopback / link-local space.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  if (host === '::1' || host.startsWith('[::1')) return false;
  return true;
}

/**
 * The body we POST. Deliberately small and stable: an id, what happened, when,
 * and the fields an integration actually needs. Never the whole document —
 * that would leak whatever gets added to it later.
 */
export function buildPayload(event, { task, activity, workspace, project }) {
  const base = {
    event,
    at: new Date().toISOString(),
    workspace: workspace ? { id: workspace.id, name: workspace.name || '' } : null,
    project: project ? { id: project.id, name: project.name || '' } : null,
  };

  if (activity) {
    return {
      ...base,
      activity: {
        id: activity.id,
        taskId: activity.taskId || null,
        taskTitle: activity.taskTitle || '',
        date: activity.date || null,
        hoursSpent: activity.hoursSpent ?? 0,
        comment: activity.comment || '',
        completionStatus: activity.completionStatus || null,
      },
    };
  }

  return {
    ...base,
    task: task ? {
      id: task.id,
      title: task.title || '',
      status: task.status || null,
      priority: task.priority || null,
      progress: task.progress ?? null,
      dueDate: task.plan?.endDate || null,
      startDate: task.plan?.startDate || null,
      tags: task.tags || [],
      assignedTo: task.assignedTo || [],
    } : null,
  };
}

/** Retry schedule, in seconds. Three tries, then the delivery is marked failed. */
export const RETRY_DELAYS_S = [0, 30, 300];
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length;

/** Is this response worth trying again? 4xx means we were wrong; 5xx means they were. */
export function shouldRetry(status) {
  if (status === 408 || status === 429) return true;
  return status >= 500 && status < 600;
}

/** One-line outcome for the delivery log, in words an admin can act on. */
export function describeDelivery({ ok, status, error }) {
  if (ok) return `Delivered (${status}).`;
  if (error) {
    const detail = String(error).slice(0, 120).replace(/[.\s]+$/, '');
    return `Could not reach the address: ${detail}.`;
  }
  if (status === 401 || status === 403) return `Rejected (${status}) — check the secret.`;
  if (status === 404) return `Not found (404) — check the address.`;
  if (status === 410) return 'The address says it is gone (410). Remove or update this webhook.';
  if (status >= 500) return `The other service errored (${status}). Retried and gave up.`;
  return `Rejected (${status}).`;
}
