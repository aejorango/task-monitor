// functions/automations.js — running the automation rules.
//
// The decisions are all in src/automations.js (pure, tested). This is the part
// that cannot be: reading the workspace's rules, performing the write, and
// recording what it did so somebody can see why their task changed by itself.
//
// Deploy: npm run deploy:functions

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { describeRule, planAction, rulesFor, wouldLoop } from './src/automations.js';
import { taskEventsFor } from './src/webhookEvents.js';

const REGION = 'asia-southeast1';
const db = () => getFirestore();

// A rule's own write must not set off another round. The marker rides on the
// document, and a write carrying it is ignored.
const BY_AUTOMATION = 'lastAutomationRunId';

async function loadRules(workspaceId) {
  if (!workspaceId) return [];
  const snap = await db().collection('automations')
    .where('workspaceId', '==', workspaceId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function logRun(rule, task, outcome) {
  await db().collection('automationRuns').add({
    ruleId: rule.id,
    ruleName: rule.name || '',
    workspaceId: rule.workspaceId,
    taskId: task?.id || null,
    taskTitle: task?.title || '',
    // The sentence the UI shows — the same one the rule editor previews.
    description: describeRule(rule),
    outcome: outcome.ok ? 'done' : 'skipped',
    message: outcome.message,
    at: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 30 * 86400_000),
  }).catch((err) => console.error('[automations] could not log run', err));
}

async function perform(plan, rule, task, runId) {
  switch (plan.kind) {
    case 'update':
      await db().doc(`tasks/${plan.taskId}`).update({
        ...plan.patch,
        [BY_AUTOMATION]: runId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, message: `Changed ${Object.keys(plan.patch).join(', ')}.` };

    case 'create-task': {
      await db().collection('tasks').add({
        ...plan.task,
        userId: rule.userId || task?.userId || null,
        status: 'todo',
        progress: 0,
        plan: { startDate: null, endDate: null },
        actual: { startDate: null, endDate: null },
        tags: [], subtasks: [], dependsOn: [], links: [],
        assignedTo: [], assignedToExternal: [], customValues: {},
        activityCount: 0, totalHoursLogged: 0, attachmentCount: 0, lastActivityAt: null,
        archived: false, deleted: false,
        [BY_AUTOMATION]: runId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, message: `Created “${plan.task.title}”.` };
    }

    case 'notify':
      // An in-app notice: the app has no push, and this app does not send email.
      await db().collection('notifications').add({
        userId: plan.userId,
        workspaceId: rule.workspaceId,
        // Same shape as the notices a person raises (src/services/mentions.js),
        // so one inbox shows both.
        kind: 'automation',
        source: 'automation',
        fromUserId: null,
        text: plan.text,
        taskId: task?.id || null,
        taskTitle: task?.title || '',
        read: false,
        at: FieldValue.serverTimestamp(),
      });
      return { ok: true, message: 'Told them.' };

    case 'webhook':
      // The webhook triggers already fire on the underlying change; a rule
      // pointing at one is a no-op rather than a second delivery.
      return { ok: true, message: 'The webhook fires on the change itself.' };

    default:
      return { ok: false, message: plan.reason || 'Nothing to do.' };
  }
}

export const onTaskAutomations = onDocumentWritten(
  { document: 'tasks/{taskId}', region: REGION, timeoutSeconds: 120, memory: '256MiB' },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!after) return;

    // Our own write. Stop here, or a rule that sets a field would run forever.
    if (after[BY_AUTOMATION] && after[BY_AUTOMATION] !== before?.[BY_AUTOMATION]) return;

    const events = taskEventsFor(before, after);
    if (!events.length) return;

    const task = { id: event.params.taskId, ...after };
    const rules = await loadRules(task.workspaceId);
    if (!rules.length) return;

    const runId = `${event.id}-${Date.now()}`;

    for (const name of events) {
      for (const rule of rulesFor(rules, name, task)) {
        const plan = planAction(rule, task);

        if (wouldLoop(rule, plan)) {
          await logRun(rule, task, {
            ok: false,
            message: 'Skipped: this rule would set itself off again.',
          });
          continue;
        }

        try {
          await logRun(rule, task, await perform(plan, rule, task, runId));
        } catch (err) {
          console.error('[automations] rule failed', rule.id, err);
          await logRun(rule, task, { ok: false, message: 'It could not be carried out.' });
        }
      }
    }
  },
);
