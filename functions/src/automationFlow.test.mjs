// T-0072 / NEW-002 — the acceptance path, end to end through the pure chain.
//
//   1. Given a rule "when a task is done → create a follow-up"
//   2. When a task is completed
//   3. Then the follow-up exists
//
// Everything between the write that completes the task and the write that
// creates the follow-up is decided here: taskEventsFor() works out what
// happened, rulesFor() picks the rules that care, planAction() says what to do.
// The runner (functions/automations.js) performs the plan and nothing else —
// the last test in this file holds it to that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planAction, rulesFor, wouldLoop } from './automations.js';
import { taskEventsFor } from './webhookEvents.js';

const WS = 'ws-1';

const followUpRule = (extra = {}) => ({
  id: 'r1', userId: 'u1', workspaceId: WS,
  name: 'Follow up on finished work',
  trigger: 'task.completed',
  conditions: [],
  action: 'follow_up',
  actionValue: 'Write the handover note',
  enabled: true, deleted: false,
  ...extra,
});

const doing = {
  workspaceId: WS, title: 'Disbursement report', status: 'doing',
  projectId: 'p1', phaseId: 'ph1', priority: 'high', tags: ['finance'],
};
const done = { ...doing, status: 'done' };

/** What the runner would do for one write, as data. */
function whatHappens(before, after, rules, taskId = 't1') {
  const task = { id: taskId, ...after };
  const out = [];
  for (const event of taskEventsFor(before, after)) {
    for (const rule of rulesFor(rules, event, task)) {
      const plan = planAction(rule, task);
      out.push({ event, rule, plan, skipped: wouldLoop(rule, plan) });
    }
  }
  return out;
}

// ─── the acceptance path ────────────────────────────────────────────────────

test('completing a task produces exactly one follow-up, with the title that was asked for', () => {
  const ran = whatHappens(doing, done, [followUpRule()]);
  assert.equal(ran.length, 1, 'one rule, one run');
  assert.equal(ran[0].event, 'task.completed');
  assert.equal(ran[0].skipped, false);
  assert.equal(ran[0].plan.kind, 'create-task');
  assert.equal(ran[0].plan.task.title, 'Write the handover note');
});

test('the follow-up lands in the same workspace, project and phase as its parent', () => {
  const [{ plan }] = whatHappens(doing, done, [followUpRule()]);
  assert.equal(plan.task.workspaceId, WS);
  assert.equal(plan.task.projectId, 'p1');
  assert.equal(plan.task.phaseId, 'ph1');
  assert.equal(plan.task.priority, 'high');
});

test('a follow-up with no title of its own is named after the task it follows', () => {
  const [{ plan }] = whatHappens(doing, done, [followUpRule({ actionValue: '' })]);
  assert.equal(plan.task.title, 'Follow up: Disbursement report');
});

test('nothing happens while the task is still being worked on', () => {
  const edited = { ...doing, title: 'Disbursement report v2' };
  const ran = whatHappens(doing, edited, [followUpRule()]);
  assert.deepEqual(ran, [], 'the rule waits for "done", not for any change');
});

test('completing it twice — an edit after it is done — does not make a second follow-up', () => {
  const ran = whatHappens(done, { ...done, progress: 100 }, [followUpRule()]);
  assert.deepEqual(ran.map((r) => r.event), [],
    'task.completed fires on the change to done, not on every write afterwards');
});

test('a rule that is switched off does nothing at all', () => {
  assert.deepEqual(whatHappens(doing, done, [followUpRule({ enabled: false })]), []);
});

test('a condition that does not hold keeps the rule out of it', () => {
  const rules = [followUpRule({ conditions: [{ field: 'project', operator: 'is', value: 'p2' }] })];
  assert.deepEqual(whatHappens(doing, done, rules), []);
});

test('a condition that holds lets it through', () => {
  const rules = [followUpRule({ conditions: [{ field: 'project', operator: 'is', value: 'p1' }] })];
  assert.equal(whatHappens(doing, done, rules).length, 1);
});

test('two rules on the same event both run, in the order they were given', () => {
  const rules = [
    followUpRule(),
    followUpRule({ id: 'r2', name: 'Tell Ace', action: 'notify', actionValue: 'u2' }),
  ];
  const ran = whatHappens(doing, done, rules);
  assert.deepEqual(ran.map((r) => r.plan.kind), ['create-task', 'notify']);
});

// ─── the guards that keep it from running away ──────────────────────────────

test('a rule that would set itself off again is caught before it writes', () => {
  const selfTriggering = followUpRule({
    trigger: 'task.updated', action: 'add_tag', actionValue: 'seen',
  });
  const ran = whatHappens(doing, { ...doing, title: 'Changed' }, [selfTriggering]);
  assert.equal(ran.length, 1);
  assert.equal(ran[0].skipped, true, 'add a tag on every change is an endless loop');
});

test('a counter the app bumped is not a change worth running a rule for', () => {
  // Logging work bumps activityCount and lastActivityAt on the task.
  const busier = { ...doing, activityCount: 3, lastActivityAt: 'later', updatedAt: 'later' };
  const rules = [followUpRule({ trigger: 'task.updated', action: 'notify', actionValue: 'u2' })];
  assert.deepEqual(whatHappens(doing, busier, rules), []);
});

// ─── and the runner performs that plan, rather than deciding for itself ─────

const runner = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'automations.js'), 'utf8',
);

test('the runner asks the pure module and performs what it is told', () => {
  assert.match(runner, /const events = taskEventsFor\(before, after\)/);
  assert.match(runner, /rulesFor\(rules, name, task\)/);
  assert.match(runner, /const plan = planAction\(rule, task\)/);
  assert.match(runner, /if \(wouldLoop\(rule, plan\)\)/);
});

test('a create-task plan really does add a task', () => {
  const block = runner.slice(runner.indexOf("case 'create-task'"), runner.indexOf("case 'notify'"));
  assert.match(block, /collection\('tasks'\)\.add\(/);
  assert.match(block, /\.\.\.plan\.task/);
  assert.match(block, /status: 'todo'/, 'a follow-up starts as something to do');
  assert.match(block, /deleted: false/);
});

test("the runner marks its own writes, so a rule cannot answer itself", () => {
  assert.match(runner, /const BY_AUTOMATION = 'lastAutomationRunId'/);
  assert.match(runner, /if \(after\[BY_AUTOMATION\] && after\[BY_AUTOMATION\] !== before\?\.\[BY_AUTOMATION\]\) return;/);
});

test('every run is written down, whether it worked or not', () => {
  assert.match(runner, /collection\('automationRuns'\)\.add\(/);
  assert.match(runner, /outcome: outcome\.ok \? 'done' : 'skipped'/);
  assert.match(runner, /message: outcome\.message/);
});

test('a rule that throws is logged, not swallowed, and does not stop the next one', () => {
  assert.match(runner, /catch \(err\) \{[\s\S]*?logRun\(rule, task, \{ ok: false/);
});
