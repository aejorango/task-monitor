// functions/webhooks.js — actually delivering the webhooks.
//
// Settings → Webhooks let people configure integrations that never fired: the
// documents were stored and nothing ever POSTed. A static frontend cannot
// watch Firestore, so this is where delivery lives.
//
// Every delivery is signed (HMAC-SHA256 over the exact body, with the webhook's
// own secret) and written to `webhookDeliveries` so the admin can see what
// happened instead of guessing.
//
// Deploy: npm run deploy:functions  (Blaze plan — these make outbound calls.)

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  MAX_ATTEMPTS, RETRY_DELAYS_S, buildPayload, describeDelivery,
  isDeliverableUrl, matchingWebhooks, shouldRetry, signBody, taskEventsFor,
} from './src/webhookEvents.js';

const REGION = 'asia-southeast1';
const REQUEST_TIMEOUT_MS = 10_000;
const DELIVERY_RETENTION_DAYS = 30;

const db = () => getFirestore();

async function loadWorkspaceWebhooks(workspaceId) {
  if (!workspaceId) return [];
  const snap = await db().collection('webhooks')
    .where('workspaceId', '==', workspaceId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadNamed(collection, id) {
  if (!id) return null;
  const snap = await db().doc(`${collection}/${id}`).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** POST once. Never throws: the outcome is data, not an exception. */
async function attemptDelivery(hook, body, signature) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'TaskMonitor-Webhook/1',
        ...(signature ? { 'x-taskmonitor-signature': signature } : {}),
      },
      body,
    });
    return { ok: res.ok, status: res.status, error: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === 'AbortError' ? 'timed out after 10 seconds' : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Deliver to one webhook, retrying transient failures, and log the result. */
async function deliver(hook, event, payload) {
  const body = JSON.stringify(payload);
  const signature = signBody(body, hook.secret);

  let outcome = { ok: false, status: 0, error: 'not attempted' };
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    if (RETRY_DELAYS_S[i] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_S[i] * 1000));
    }
    attempts += 1;
    outcome = await attemptDelivery(hook, body, signature);
    if (outcome.ok) break;
    if (outcome.status && !shouldRetry(outcome.status)) break;   // our mistake; stop
  }

  await db().collection('webhookDeliveries').add({
    webhookId: hook.id,
    workspaceId: hook.workspaceId,
    webhookName: hook.name || '',
    url: hook.url,
    event,
    ok: outcome.ok,
    status: outcome.status,
    attempts,
    // A sentence, not a stack trace — this is shown in Settings.
    message: describeDelivery(outcome),
    at: FieldValue.serverTimestamp(),
    // Kept for 30 days; a Firestore TTL policy on this field does the deleting.
    expiresAt: new Date(Date.now() + DELIVERY_RETENTION_DAYS * 86400_000),
  }).catch((err) => console.error('[webhooks] could not log delivery', err));

  return outcome;
}

async function fanOut(events, workspaceId, context) {
  if (!events.length || !workspaceId) return;
  const all = await loadWorkspaceWebhooks(workspaceId);
  const [workspace, project] = await Promise.all([
    loadNamed('workspaces', workspaceId),
    loadNamed('projects', context.task?.projectId || context.activity?.projectId),
  ]);

  for (const event of events) {
    const hooks = matchingWebhooks(all, event, workspaceId)
      .filter((h) => isDeliverableUrl(h.url));
    if (!hooks.length) continue;
    const payload = buildPayload(event, { ...context, workspace, project });
    // Sequential on purpose: a workspace has a handful of webhooks, and a
    // burst of parallel outbound calls is what gets a function rate-limited.
    for (const hook of hooks) {
      try { await deliver(hook, event, payload); }
      catch (err) { console.error('[webhooks] delivery crashed', hook.id, err); }
    }
  }
}

export const onTaskWritten = onDocumentWritten(
  { document: 'tasks/{taskId}', region: REGION, timeoutSeconds: 540, memory: '256MiB' },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    const events = taskEventsFor(before, after);
    if (!events.length) return;

    const task = { id: event.params.taskId, ...(after || before) };
    await fanOut(events, task.workspaceId, { task });
  },
);

export const onActivityWritten = onDocumentWritten(
  { document: 'activities/{activityId}', region: REGION, timeoutSeconds: 540, memory: '256MiB' },
  async (event) => {
    // Only creation: an edited activity is not a new piece of work.
    if (event.data?.before?.exists || !event.data?.after?.exists) return;
    const activity = { id: event.params.activityId, ...event.data.after.data() };
    if (activity.deleted) return;
    await fanOut(['activity.logged'], activity.workspaceId, { activity });
  },
);
