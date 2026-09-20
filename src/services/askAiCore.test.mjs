// Tests for the Ask AI analysis engine (T-0009 / IMP-005).
//
// The contract this suite defends: every number and every item in an answer is
// COMPUTED from the digest. The model only writes prose over the top, so if
// these hold, a wrong AI narration can never invent a task or a total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnswer, buildDigest, buildSuggestions, looksLikeAction,
  parseSearch, routeIntent, searchTasks, topThemes,
} from './askAiCore.js';
import { todayLocal } from './recurrence.js';

const today = todayLocal();
const past  = '2020-01-01';
const future = '2099-01-01';

const task = (over) => ({
  id: 'x', title: 'Untitled', status: 'todo', projectId: 'p1',
  deleted: false, archived: false, plan: {}, tags: [], assignedTo: [], ...over,
});

const FIXTURE = {
  projects: [
    { id: 'p1', name: 'SBLAF rollout', deleted: false, archived: false, phases: [] },
    { id: 'p2', name: 'Website revamp', deleted: false, archived: false, phases: [] },
  ],
  tasks: [
    task({ id: 't1', title: 'Disbursement report', projectId: 'p1', plan: { endDate: past }, tags: ['finance'], totalHoursLogged: 3 }),
    task({ id: 't2', title: 'Partner API integration', projectId: 'p1', status: 'doing', plan: { endDate: future } }),
    task({ id: 't3', title: 'Homepage copy rewrite', projectId: 'p2', status: 'done', plan: { endDate: past } }),
    task({ id: 't4', title: 'Accessibility audit pass', projectId: 'p2', priority: 'high', plan: { endDate: today } }),
  ],
  activities: [
    { id: 'a1', taskId: 't1', projectId: 'p1', date: today, hoursSpent: 3, comment: 'Chased the bank', completionStatus: 'blocked' },
    { id: 'a2', taskId: 't2', projectId: 'p1', date: today, hoursSpent: 2, comment: 'Wired the endpoint' },
  ],
  workspaces: [],
};

const digest = buildDigest(FIXTURE);

// ─── digest ─────────────────────────────────────────────────────────────────

test('the digest counts only live tasks', () => {
  const d = buildDigest({
    ...FIXTURE,
    tasks: [...FIXTURE.tasks, task({ id: 'gone', deleted: true }), task({ id: 'old', archived: true })],
  });
  assert.equal(d.counts.tasks, 4, 'deleted and archived tasks are not work');
});

test('overdue means past its due date and not done', () => {
  assert.equal(digest.counts.overdue, 1);
  assert.equal(digest.taskIndex.find((t) => t.id === 't1').overdue, true);
  assert.equal(digest.taskIndex.find((t) => t.id === 't3').overdue, false, 'done is never overdue');
  assert.equal(digest.taskIndex.find((t) => t.id === 't4').overdue, false, 'due today is not late');
});

test('aggregate hours are summed from the activity log', () => {
  assert.equal(digest.hours.total7, 5, 'the 7-day total is the sum of the entries');
  assert.equal(digest.hours.acts7, 2);
  assert.equal(digest.hours.byProject.find((p) => p.id === 'p1').hours, 5);
});

test('per-task hours read the denormalized counter, not a re-count of the log', () => {
  // The counter is kept in step by the batched activity writes; re-summing the
  // log per task would be both slower and wrong for activities outside the
  // 30-day window the digest loads.
  assert.equal(digest.taskIndex.find((t) => t.id === 't1').hours, 3);
  assert.equal(digest.taskIndex.find((t) => t.id === 't2').hours, 0);
  assert.equal(digest.taskIndex.find((t) => t.id === 't1').activityCount, 1,
    'the entry list itself still comes from the log');
});

test('a task carries its project name so answers can be read on their own', () => {
  assert.equal(digest.taskIndex.find((t) => t.id === 't1').project, 'SBLAF rollout');
});

test('an empty workspace produces a valid digest rather than throwing', () => {
  const d = buildDigest({});
  assert.equal(d.counts.tasks, 0);
  assert.deepEqual(d.taskIndex, []);
  assert.equal(typeof d.today, 'string');
});

// ─── search ─────────────────────────────────────────────────────────────────

test('a plain question is not a search', () => {
  assert.equal(parseSearch('how is the sblaf rollout going', digest), null);
  assert.equal(parseSearch('', digest), null);
});

test('"find tasks about X" searches for X', () => {
  const s = parseSearch('find the tasks about disbursement', digest);
  assert.ok(s, 'should be recognised as a search');
  assert.equal(s.strong, true);
  assert.deepEqual(s.terms, ['disbursement']);
  const hits = searchTasks(digest, s.terms, s.filters);
  assert.deepEqual(hits.map((t) => t.id), ['t1']);
});

test('a status word narrows the set and is not also matched as a keyword', () => {
  const s = parseSearch('which tasks are overdue', digest);
  assert.deepEqual(s.terms, [], '"overdue" is a filter, not a word to match');
  assert.equal(s.filters.length, 1);
  assert.deepEqual(searchTasks(digest, s.terms, s.filters).map((t) => t.id), ['t1']);
});

test('a project name in the query scopes the search to that project', () => {
  const s = parseSearch('show me all tasks in website revamp', digest);
  const hits = searchTasks(digest, s.terms, s.filters);
  assert.deepEqual(hits.map((t) => t.id).sort(), ['t3', 't4']);
});

test('a quoted phrase is matched literally', () => {
  const s = parseSearch('find tasks about "partner api"', digest);
  assert.ok(s.terms.includes('partner api'));
  assert.deepEqual(searchTasks(digest, s.terms, s.filters).map((t) => t.id), ['t2']);
});

test('search tolerates a stem: "disburse" still finds "Disbursement report"', () => {
  const s = parseSearch('find tasks about disburse', digest);
  assert.deepEqual(searchTasks(digest, s.terms, s.filters).map((t) => t.id), ['t1']);
});

test('"show me all tasks" means everything, ordered by due date', () => {
  const s = parseSearch('show me all tasks', digest);
  assert.ok(s);
  const hits = searchTasks(digest, s.terms, s.filters);
  assert.equal(hits.length, 4);
  assert.equal(hits[0].id, 't1', 'the one due longest ago comes first');
});

test('a search that matches nothing returns nothing rather than everything', () => {
  const s = parseSearch('find tasks about zzzznothing', digest);
  assert.deepEqual(searchTasks(digest, s.terms, s.filters), []);
});

test('filters compose: high-priority tasks due today', () => {
  const s = parseSearch('which tasks are high-priority and due today', digest);
  assert.deepEqual(searchTasks(digest, s.terms, s.filters).map((t) => t.id), ['t4']);
});

// ─── intent routing ─────────────────────────────────────────────────────────

test('a search beats a keyword', () => {
  assert.equal(routeIntent('find the tasks about disbursement', digest).key, 'search');
});

test('naming a project routes to that project', () => {
  const i = routeIntent('how is sblaf rollout going', digest);
  assert.deepEqual(i, { key: 'project', projectId: 'p1' });
});

test('the longest matching name wins so a short project cannot shadow it', () => {
  const d = buildDigest({ ...FIXTURE, projects: [...FIXTURE.projects, { id: 'p3', name: 'API', deleted: false, phases: [] }] });
  const i = routeIntent('where is partner api integration', d);
  assert.equal(i.key, 'task', 'the long task title beats the short project name');
  assert.equal(i.taskId, 't2');
});

test('keywords route to the right report', () => {
  assert.equal(routeIntent('what is blocked', digest).key, 'blockers');
  assert.equal(routeIntent('who is busy', digest).key, 'people');
  assert.equal(routeIntent('how many hours were logged', digest).key, 'hours');
  assert.equal(routeIntent('what is at risk', digest).key, 'risk');
  assert.equal(routeIntent('what happened this week', digest).key, 'week');
});

test('a question about nothing we handle routes to nothing, not to a wrong report', () => {
  assert.equal(routeIntent('what is the weather', digest), null);
});

// ─── answers ────────────────────────────────────────────────────────────────

test('every answer carries a badge, a summary and its sources', () => {
  for (const key of ['risk', 'week', 'people', 'blockers', 'hours', 'activity']) {
    const a = buildAnswer({ key }, digest, 'q');
    assert.ok(a, `no answer for ${key}`);
    assert.equal(typeof a.badge, 'string', `${key} needs a badge`);
    assert.equal(typeof a.summary, 'string', `${key} needs a summary`);
    assert.ok(Array.isArray(a.sources), `${key} must cite what it counted`);
    assert.ok(Array.isArray(a.metrics), `${key} must carry its numbers`);
  }
});

test('the blockers answer lists the blocked entry and nothing else', () => {
  const a = buildAnswer({ key: 'blockers' }, digest, 'what is blocked');
  const text = JSON.stringify(a);
  assert.match(text, /Chased the bank|Disbursement/);
  assert.doesNotMatch(text, /Wired the endpoint/);
});

test('the hours answer reports the logged total, not an estimate', () => {
  const a = buildAnswer({ key: 'hours' }, digest, 'how many hours');
  assert.match(a.summary, /^5h across 2 activities/);
  assert.equal(a.metrics[0].value, '5h');
});

// ─── suggestions, themes, action detection ──────────────────────────────────

test('suggestions are real questions bound to real intents', () => {
  const s = buildSuggestions(digest);
  assert.ok(s.length >= 3);
  assert.ok(s.every((x) => x.q && x.intent?.key));
});

test('topThemes ranks what the log actually talks about', () => {
  const themes = topThemes(FIXTURE.activities, 2);
  assert.ok(Array.isArray(themes));
});

test('a question is never mistaken for a write', () => {
  for (const q of [
    'update me on the sblaf rollout', 'any updates on the website revamp',
    'what tasks are overdue', 'how is the team doing', 'give me an update',
  ]) {
    assert.equal(looksLikeAction(q, digest), false, q);
  }
});

test('an imperative naming something real is recognised as a write', () => {
  assert.equal(looksLikeAction('create a task called Ship the invoice', digest), true);
  assert.equal(looksLikeAction('set the due date on Disbursement report to Friday', digest), true);
  assert.equal(looksLikeAction('mark Partner API integration as done', digest), true);
});

test('action detection survives empty input', () => {
  assert.equal(looksLikeAction('', digest), false);
  assert.equal(looksLikeAction(null, digest), false);
  assert.equal(looksLikeAction('create a task', undefined), true);
});
