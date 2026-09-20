// T-0070 / NEW-002 — automation rules, in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, CONDITION_FIELDS, OPERATORS, TRIGGERS, conditionHolds, describeRule,
  fieldValue, planAction, ruleMatches, rulesFor, validateRule, wouldLoop,
} from './automations.js';

const TASK = {
  id: 't1', workspaceId: 'ws1', title: 'Disbursement report', projectId: 'p1',
  phaseId: 'ph1', priority: 'high', status: 'doing', tags: ['finance'],
  assignedTo: ['u1'], assignedToExternal: [],
};

const rule = (over) => ({
  id: 'r1', name: 'My rule', enabled: true, deleted: false,
  trigger: 'task.created', conditions: [], action: 'notify', actionValue: 'u2', ...over,
});

test('every vocabulary reads as plain language, never as a field name', () => {
  for (const list of [TRIGGERS, CONDITION_FIELDS, OPERATORS, ACTIONS]) {
    for (const item of list) {
      assert.ok(item.value && item.label, JSON.stringify(item));
      assert.doesNotMatch(item.label, /[._]|[A-Z]{2,}/, item.label);
    }
  }
  assert.equal(TRIGGERS[0].label, 'A task is created');
  assert.equal(ACTIONS[0].label, 'Tell someone');
});

// ─── conditions ─────────────────────────────────────────────────────────────

test('a field reads its value off the task', () => {
  assert.equal(fieldValue('priority', TASK), 'high');
  assert.equal(fieldValue('project', TASK), 'p1');
  assert.equal(fieldValue('title', TASK), 'Disbursement report');
  assert.equal(fieldValue('tag', TASK), 'finance');
  assert.equal(fieldValue('assignee', TASK), 'u1');
  assert.equal(fieldValue('nothing', TASK), '');
});

test('every operator behaves as its label promises', () => {
  const c = (over) => ({ field: 'priority', operator: 'is', value: 'high', ...over });
  assert.equal(conditionHolds(c(), TASK), true);
  assert.equal(conditionHolds(c({ value: 'HIGH' }), TASK), true, 'case must not matter');
  assert.equal(conditionHolds(c({ value: 'low' }), TASK), false);
  assert.equal(conditionHolds(c({ operator: 'is_not', value: 'low' }), TASK), true);
  assert.equal(conditionHolds(c({ field: 'title', operator: 'contains', value: 'disburse' }), TASK), true);
  assert.equal(conditionHolds(c({ field: 'title', operator: 'contains', value: 'nope' }), TASK), false);
  assert.equal(conditionHolds(c({ field: 'assignee', operator: 'is_set' }), TASK), true);
  assert.equal(conditionHolds(c({ field: 'assignee', operator: 'is_empty' }), { ...TASK, assignedTo: [] }), true);
});

test('"contains" with nothing to look for never matches everything', () => {
  assert.equal(conditionHolds({ field: 'title', operator: 'contains', value: '' }, TASK), false);
});

test('an operator this app does not know never fires', () => {
  assert.equal(conditionHolds({ field: 'priority', operator: 'regex', value: '.*' }, TASK), false);
  assert.equal(conditionHolds({}, TASK), false);
});

// ─── matching ───────────────────────────────────────────────────────────────

test('a rule runs only for its own trigger', () => {
  assert.equal(ruleMatches(rule(), 'task.created', TASK), true);
  assert.equal(ruleMatches(rule(), 'task.completed', TASK), false);
});

test('a switched-off or deleted rule never runs', () => {
  assert.equal(ruleMatches(rule({ enabled: false }), 'task.created', TASK), false);
  assert.equal(ruleMatches(rule({ deleted: true }), 'task.created', TASK), false);
  assert.equal(ruleMatches(null, 'task.created', TASK), false);
});

test('conditions are ANDed, as the form says', () => {
  const r = rule({ conditions: [
    { field: 'priority', operator: 'is', value: 'high' },
    { field: 'project', operator: 'is', value: 'p1' },
  ] });
  assert.equal(ruleMatches(r, 'task.created', TASK), true);
  assert.equal(ruleMatches(r, 'task.created', { ...TASK, projectId: 'p2' }), false);
});

test('only the matching rules come back', () => {
  const rules = [
    rule({ id: 'a' }),
    rule({ id: 'b', trigger: 'task.completed' }),
    rule({ id: 'c', conditions: [{ field: 'priority', operator: 'is', value: 'low' }] }),
  ];
  assert.deepEqual(rulesFor(rules, 'task.created', TASK).map((r) => r.id), ['a']);
  assert.deepEqual(rulesFor([], 'task.created', TASK), []);
});

// ─── actions ────────────────────────────────────────────────────────────────

test('each action becomes a plan, never a write', () => {
  assert.deepEqual(planAction(rule({ action: 'assign', actionValue: 'u9' }), TASK),
    { kind: 'update', taskId: 't1', patch: { assignedTo: ['u9'] } });
  assert.deepEqual(planAction(rule({ action: 'set_priority', actionValue: 'low' }), TASK),
    { kind: 'update', taskId: 't1', patch: { priority: 'low' } });
  assert.deepEqual(planAction(rule({ action: 'add_tag', actionValue: 'urgent' }), TASK).patch.tags,
    ['finance', 'urgent']);
});

test('adding a tag that is already there does not duplicate it', () => {
  assert.deepEqual(planAction(rule({ action: 'add_tag', actionValue: 'finance' }), TASK).patch.tags,
    ['finance']);
});

test('a nonsense value is refused with a reason, not written', () => {
  const plan = planAction(rule({ action: 'set_priority', actionValue: 'extremely' }), TASK);
  assert.equal(plan.kind, 'none');
  assert.match(plan.reason, /not a priority/);
  assert.equal(planAction(rule({ action: 'add_tag', actionValue: '  ' }), TASK).kind, 'none');
  assert.equal(planAction(rule({ action: 'nothing-like-this' }), TASK).kind, 'none');
});

test('a follow-up task inherits its parent’s place in the plan', () => {
  const plan = planAction(rule({ action: 'follow_up', actionValue: 'Chase the bank' }), TASK);
  assert.equal(plan.kind, 'create-task');
  assert.equal(plan.task.title, 'Chase the bank');
  assert.equal(plan.task.projectId, 'p1');
  assert.equal(plan.task.workspaceId, 'ws1');
});

test('a follow-up with no title still says what it is about', () => {
  const plan = planAction(rule({ action: 'follow_up', actionValue: '' }), TASK);
  assert.equal(plan.task.title, 'Follow up: Disbursement report');
});

test('a very long follow-up title is bounded', () => {
  const plan = planAction(rule({ action: 'follow_up', actionValue: 'x'.repeat(500) }), TASK);
  assert.equal(plan.task.title.length, 200);
});

// ─── loops ──────────────────────────────────────────────────────────────────

test('a rule that would set off its own trigger is caught', () => {
  const r = rule({ trigger: 'task.updated', action: 'add_tag', actionValue: 'seen' });
  assert.equal(wouldLoop(r, planAction(r, TASK)), true, 'this would fire forever');

  const safe = rule({ trigger: 'task.created', action: 'add_tag', actionValue: 'seen' });
  assert.equal(wouldLoop(safe, planAction(safe, TASK)), false);
  assert.equal(wouldLoop(rule({ trigger: 'task.updated', action: 'notify' }),
    { kind: 'notify' }), false, 'a notification changes no field');
});

// ─── describing and validating ──────────────────────────────────────────────

test('a rule reads back as one English sentence', () => {
  const r = rule({
    trigger: 'task.completed',
    conditions: [{ field: 'project', operator: 'is', value: 'p1' }],
    action: 'notify', actionValue: 'u2',
  });
  const nameFor = (id) => ({ p1: 'SBLAF rollout', u2: 'Ace' }[id]);
  assert.equal(describeRule(r, { nameFor }),
    'When a task is completed and its project is “SBLAF rollout”, tell someone (Ace).');
});

test('a rule with no conditions still reads correctly', () => {
  assert.equal(describeRule(rule({ action: 'add_tag', actionValue: 'new' })),
    'When a task is created, add a tag (new).');
});

test('a value-less operator does not print an empty quote', () => {
  const r = rule({ conditions: [{ field: 'assignee', operator: 'is_empty' }], action: 'notify', actionValue: 'u2' });
  assert.match(describeRule(r), /its assigned to is empty/);
  assert.doesNotMatch(describeRule(r), /“”/);
});

test('every refusal to save says what to do about it', () => {
  for (const [broken, expect] of [
    [{ name: '' }, /Give this rule a name/],
    [{ name: 'x' }, /Pick what should set this rule off/],
    [{ name: 'x', trigger: 'task.created' }, /Pick what this rule should do/],
    [{ name: 'x', trigger: 'task.created', action: 'notify', actionValue: '' }, /Say what/],
    [{ name: 'x', trigger: 'task.created', action: 'notify', actionValue: 'u1',
       conditions: [{ field: 'priority' }] }, /Finish the condition/],
    [{ name: 'x', trigger: 'task.created', action: 'notify', actionValue: 'u1',
       conditions: [{ field: 'priority', operator: 'is', value: '' }] }, /Say what priority should be/],
  ]) {
    const msg = validateRule(broken);
    assert.match(msg, expect, JSON.stringify(broken));
    assert.match(msg, /[.!]$/);
  }
});

test('a complete rule validates', () => {
  assert.equal(validateRule(rule()), null);
  assert.equal(validateRule(rule({
    conditions: [{ field: 'assignee', operator: 'is_empty' }],
  })), null, 'a value-less operator needs no value');
});
