// T-0043 / MISS-002 — which webhooks fire, for what, and with what body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RETRY_DELAYS_S, buildPayload, describeDelivery, isDeliverableUrl,
  matchingWebhooks, shouldRetry, taskEventsFor,
} from './webhookEvents.js';

const task = (over = {}) => ({
  title: 'Ship it', status: 'todo', deleted: false, priority: 'medium',
  plan: { endDate: '2026-09-30' }, tags: [], assignedTo: [], ...over,
});

// ─── which events ───────────────────────────────────────────────────────────

test('a new task is a creation', () => {
  assert.deepEqual(taskEventsFor(null, task()), ['task.created']);
});

test('moving to done is a completion, not also an update', () => {
  assert.deepEqual(taskEventsFor(task(), task({ status: 'done' })), ['task.completed']);
});

test('completing again does not fire twice', () => {
  assert.deepEqual(taskEventsFor(task({ status: 'done' }), task({ status: 'done', progress: 100 })), ['task.updated']);
});

test('a soft delete is a deletion, and only once', () => {
  assert.deepEqual(taskEventsFor(task(), task({ deleted: true })), ['task.deleted']);
  assert.deepEqual(taskEventsFor(task({ deleted: true }), task({ deleted: true, title: 'x' })), []);
});

test('restoring a deleted task reads as a creation', () => {
  assert.deepEqual(taskEventsFor(task({ deleted: true }), task({ deleted: false })), ['task.created']);
});

test('a real edit is an update', () => {
  assert.deepEqual(taskEventsFor(task(), task({ title: 'Ship it properly' })), ['task.updated']);
  assert.deepEqual(taskEventsFor(task(), task({ plan: { endDate: '2026-10-31' } })), ['task.updated']);
});

test('a counter the app bumped is NOT an update', () => {
  // Logging an activity writes these. Firing "task.updated" for each one would
  // double every integration's traffic for no information.
  for (const field of ['updatedAt', 'lastActivityAt', 'activityCount', 'totalHoursLogged', 'attachmentCount']) {
    assert.deepEqual(
      taskEventsFor(task(), task({ [field]: 99 })), [],
      `${field} must not fire task.updated`,
    );
  }
});

test('an unchanged write fires nothing', () => {
  assert.deepEqual(taskEventsFor(task(), task()), []);
});

// ─── which webhooks ─────────────────────────────────────────────────────────

const hook = (over = {}) => ({
  url: 'https://hooks.example.com/x', enabled: true, deleted: false,
  workspaceId: 'ws-1', events: ['task.created'], ...over,
});

test('only enabled, undeleted hooks in the right workspace, wanting that event', () => {
  const hooks = [
    hook({ id: 'a' }),
    hook({ id: 'b', enabled: false }),
    hook({ id: 'c', deleted: true }),
    hook({ id: 'd', workspaceId: 'ws-2' }),
    hook({ id: 'e', events: ['task.deleted'] }),
  ];
  assert.deepEqual(matchingWebhooks(hooks, 'task.created', 'ws-1').map((h) => h.id), ['a']);
});

test('a plain-http hook never receives a signed secret', () => {
  const hooks = [hook({ id: 'a', url: 'http://hooks.example.com/x' })];
  assert.deepEqual(matchingWebhooks(hooks, 'task.created', 'ws-1'), []);
});

test('no hooks at all is not an error', () => {
  assert.deepEqual(matchingWebhooks(undefined, 'task.created', 'ws-1'), []);
  assert.deepEqual(matchingWebhooks([], 'task.created', 'ws-1'), []);
});

// ─── where we are willing to POST ───────────────────────────────────────────

test('ordinary https addresses are deliverable', () => {
  for (const url of [
    'https://hooks.slack.com/services/x', 'https://hook.eu1.make.com/abc',
    'https://example.com:8443/webhook',
  ]) assert.equal(isDeliverableUrl(url), true, url);
});

test('the server will not be talked into calling itself or the private network', () => {
  for (const url of [
    'http://example.com/x', 'https://localhost/x', 'https://127.0.0.1/x',
    'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://172.16.0.1/x',
    'https://169.254.169.254/latest/meta-data', 'https://metadata.google.internal/x',
    'not a url', '', null,
  ]) assert.equal(isDeliverableUrl(url), false, String(url));
});

// ─── the body ───────────────────────────────────────────────────────────────

test('a task payload carries what an integration needs and nothing else', () => {
  const body = buildPayload('task.completed', {
    task: { id: 't1', ...task({ status: 'done' }), secretInternalField: 'nope' },
    workspace: { id: 'ws-1', name: 'Acme', members: ['u1'] },
    project: { id: 'p1', name: 'Rollout', acl: { u1: 'admin' } },
  });
  assert.equal(body.event, 'task.completed');
  assert.match(body.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.task.title, 'Ship it');
  assert.equal(body.task.dueDate, '2026-09-30');
  assert.equal('secretInternalField' in body.task, false, 'never ship the whole document');
  assert.deepEqual(Object.keys(body.workspace), ['id', 'name'], 'no member list leaves the building');
  assert.deepEqual(Object.keys(body.project), ['id', 'name']);
});

test('an activity payload describes the activity', () => {
  const body = buildPayload('activity.logged', {
    activity: { id: 'a1', taskId: 't1', taskTitle: 'Ship it', date: '2026-09-20', hoursSpent: 2, comment: 'Did it' },
    workspace: { id: 'ws-1', name: 'Acme' },
  });
  assert.equal(body.activity.hoursSpent, 2);
  assert.equal(body.task, undefined);
});

test('a payload survives missing context', () => {
  const body = buildPayload('task.created', {});
  assert.equal(body.task, null);
  assert.equal(body.workspace, null);
});

// ─── retries and reporting ──────────────────────────────────────────────────

test('server errors and rate limits are retried; our own mistakes are not', () => {
  for (const s of [500, 502, 503, 504, 429, 408]) assert.equal(shouldRetry(s), true, String(s));
  for (const s of [200, 201, 400, 401, 403, 404, 410, 422]) assert.equal(shouldRetry(s), false, String(s));
});

test('there are three attempts, starting immediately', () => {
  assert.equal(RETRY_DELAYS_S[0], 0);
  assert.equal(RETRY_DELAYS_S.length, 3);
  assert.ok(RETRY_DELAYS_S.every((d, i, a) => i === 0 || d > a[i - 1]), 'backoff must increase');
});

test('every outcome reads as a sentence an admin can act on', () => {
  assert.match(describeDelivery({ ok: true, status: 200 }), /^Delivered \(200\)\.$/);
  assert.match(describeDelivery({ ok: false, status: 401 }), /check the secret/);
  assert.match(describeDelivery({ ok: false, status: 404 }), /check the address/);
  assert.match(describeDelivery({ ok: false, status: 410 }), /Remove or update/);
  assert.match(describeDelivery({ ok: false, status: 503 }), /other service errored/);
  assert.match(describeDelivery({ ok: false, error: 'ENOTFOUND hooks.example.com' }), /Could not reach the address/);
  for (const d of [
    { ok: false, status: 400 }, { ok: false, status: 500 }, { ok: false, error: 'x' },
  ]) {
    assert.match(describeDelivery(d), /[.!]$/, JSON.stringify(d));
  }
});
