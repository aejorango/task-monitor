// T-0140 / NEW-024 — asking about one project, with its own notebook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askSuggestions, groundFor, groundingState, notebookForProject, projectDigest,
} from './projectAsk.js';
import { todayLocal } from './recurrence.js';

const WS = { id: 'ws', name: 'Blue', knowledge: { notebookId: 'nb-ws', notebookTitle: 'Workspace notes' } };
const P = { id: 'p1', workspaceId: 'ws', name: 'Riverside', phases: [] };

/* ── which notebook ────────────────────────────────────────────────────── */

test('a project’s own notebook wins', () => {
  const nb = notebookForProject(
    { ...P, knowledge: { notebookId: 'nb-p', notebookTitle: 'Riverside notes' } }, WS);
  assert.equal(nb.notebookId, 'nb-p');
  assert.equal(nb.from, 'project');
});

// `null` on the project means "inherit the workspace's" — that is the
// documented meaning of the field, not "no notebook".
test('a project with none inherits the workspace’s', () => {
  const nb = notebookForProject({ ...P, knowledge: null }, WS);
  assert.equal(nb.notebookId, 'nb-ws');
  assert.equal(nb.from, 'workspace');
  assert.equal(notebookForProject(P, WS).from, 'workspace', 'an absent field inherits too');
});

test('with neither, there is nothing to ground on', () => {
  const nb = notebookForProject(P, { id: 'ws' });
  assert.equal(nb.notebookId, null);
  assert.equal(nb.from, null);
  assert.equal(groundFor(P, { id: 'ws' }), null, 'asking to ground on nothing is not a request');
});

test('the ground argument carries the ids askAI expects', () => {
  const g = groundFor({ ...P, knowledge: { notebookId: 'nb-p' } }, WS);
  assert.deepEqual(g, { notebookId: 'nb-p', workspaceId: 'ws', projectId: 'p1' });
});

test('nothing at all is safe', () => {
  assert.equal(notebookForProject(null, null).notebookId, null);
  assert.equal(groundFor(undefined, undefined), null);
});

/* ── the digest is about THIS project ──────────────────────────────────── */

const task = (over) => ({
  id: 't', title: 'A task', projectId: 'p1', status: 'todo',
  plan: { endDate: '2026-01-01' }, actual: {}, ...over,
});

test('only this project’s tasks are in it', () => {
  const d = projectDigest({
    project: P, workspace: WS,
    tasks: [
      task({ id: 'a' }),
      task({ id: 'b', projectId: 'p2', title: 'Somebody else’s' }),
    ],
  });
  assert.equal(d.counts.open, 1, 'the workspace-wide digest is what the Ask AI page already answers');
  assert.ok(!JSON.stringify(d.taskIndex).includes('Somebody else’s'));
});

test('deleted and archived tasks are not part of it', () => {
  const d = projectDigest({
    project: P, workspace: WS,
    tasks: [task({ id: 'a' }), task({ id: 'b', deleted: true }), task({ id: 'c', archived: true })],
  });
  assert.equal(d.counts.open, 1);
});

test('activities come in by project OR by one of its tasks', () => {
  // The digest's own window is the last 30 days, so these have to be recent to
  // be in it at all — that is buildDigest's rule, not this module's.
  const recent = todayLocal();
  const d = projectDigest({
    project: P, workspace: WS,
    tasks: [task({ id: 'a' })],
    activities: [
      { id: 'x', projectId: 'p1', taskId: 'zz', date: recent, hoursSpent: 1 },
      { id: 'y', projectId: null, taskId: 'a', date: recent, hoursSpent: 2 },
      { id: 'z', projectId: 'p2', taskId: 'other', date: recent, hoursSpent: 8 },
    ],
  });
  // An activity written before projectId was denormalised still belongs to the
  // project through its task.
  const ids = (d.taskIndex || []).flatMap((t) => (t.entries || []).map((e) => e.id));
  assert.ok(ids.includes('y'), 'an activity reaches its project through its task');
  assert.equal(d.hours.total7, 3, 'this project’s hours only — the other project’s 8 stay out');
});

test('an empty project still produces a digest, not a crash', () => {
  const d = projectDigest({ project: P, workspace: WS });
  assert.equal(d.counts.open, 0);
  assert.equal(projectDigest({}).counts.open, 0);
});

/* ── the starters ──────────────────────────────────────────────────────── */

// A starter question with an empty answer teaches people the feature does not
// work.
test('only questions this project can actually answer are offered', () => {
  const quiet = askSuggestions({ counts: { open: 0, done: 0, overdue: 0 }, blockers: [] });
  assert.ok(!quiet.some((q) => /holding this project up/.test(q)));
  assert.ok(!quiet.some((q) => /blocker/.test(q)));
  assert.ok(quiet.length >= 1, 'there is always something worth asking');

  const busy = askSuggestions({ counts: { open: 4, done: 2, overdue: 3 }, blockers: [{}] });
  assert.ok(busy.some((q) => /holding this project up/.test(q)));
  assert.ok(busy.some((q) => /blocker/.test(q)));
});

test('the list is short enough to read', () => {
  const many = askSuggestions({ counts: { open: 9, done: 9, overdue: 9 }, blockers: [{}] });
  assert.ok(many.length <= 4);
  assert.equal(new Set(many).size, many.length, 'no duplicates');
});

/* ── the three grounding states ────────────────────────────────────────── */

// The acceptance case, both halves.
test('a grounded answer says what it was read from, and how much', () => {
  const g = groundingState(
    { grounding: { citations: [{ title: 'Contract' }, { title: 'Site notes' }] } },
    { from: 'project', notebookTitle: 'Riverside notes' },
  );
  assert.equal(g.state, 'grounded');
  assert.equal(g.label, 'Grounded · 2 sources');
  assert.match(g.title, /Riverside notes/);
  assert.equal(g.citations.length, 2);
});

test('one source is not "1 sources"', () => {
  const g = groundingState({ grounding: { citations: [{ title: 'Contract' }] } }, { from: 'project' });
  assert.equal(g.label, 'Grounded · 1 source');
});

// Degraded ≠ success: the answer is still given, and it is marked.
test('a failed lookup still answers, and is marked with the reason', () => {
  const g = groundingState(
    { groundDegraded: 'The notebook could not be reached, so this answer is not grounded.' },
    { from: 'project' },
  );
  assert.equal(g.state, 'degraded');
  assert.equal(g.label, 'Not grounded');
  assert.match(g.title, /could not be reached/);
  assert.deepEqual(g.citations, []);
});

test('an answer nobody asked to ground is neither grounded nor degraded', () => {
  const g = groundingState({ summary: 'Fine' }, { from: null });
  assert.equal(g.state, 'none');
  assert.equal(g.label, '', 'a badge that says nothing is worse than no badge');
  assert.equal(groundingState(null, null).state, 'none');
});

test('the badge says WHOSE notebook it read', () => {
  // "Grounded in the workspace notebook" and "grounded in this project's" are
  // different claims to make to a reader.
  const project = groundingState({ grounding: { citations: [] } }, { from: 'project' });
  const workspace = groundingState({ grounding: { citations: [] } }, { from: 'workspace' });
  assert.match(project.title, /this project’s notebook/);
  assert.match(workspace.title, /the workspace notebook/);
});

test('a grounded answer with no citations is still grounded', () => {
  const g = groundingState({ grounding: { citations: [] } }, { from: 'project' });
  assert.equal(g.state, 'grounded');
  assert.equal(g.label, 'Grounded · 0 sources');
});
