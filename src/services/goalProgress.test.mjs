// T-0154 — what a goal card is allowed to claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  atRiskCount, deliverableProgress, deliverableProjectIds, goalProgress, toneOf,
} from './goalProgress.js';

const STATS = {
  p1: { id: 'p1', name: 'SBLAF onboarding', color: '#0051BA', pct: 80 },
  p2: { id: 'p2', name: 'Partner API', color: '#e2892e', pct: 40 },
  p3: { id: 'p3', name: 'Marketplace', color: '#7B2D8F', pct: 100 },
};

test('the tone thresholds are the mockup’s own data', () => {
  assert.equal(toneOf(83), 'green');
  assert.equal(toneOf(64), 'amber');
  assert.equal(toneOf(42), 'red');
  assert.equal(toneOf(80), 'green', 'the boundary belongs to the better tone');
  assert.equal(toneOf(50), 'amber');
});

test('nothing measured is never green', () => {
  assert.equal(toneOf(null), 'navy');
});

test('a deliverable nobody linked has NO percentage, not zero', () => {
  const d = deliverableProgress({ text: 'Unwired', projectIds: [] }, STATS);
  assert.equal(d.pct, null, '0% means "started, got nowhere" — this is "nobody said"');
  assert.deepEqual(d.projects, []);
});

test('a deliverable pointing at a project that is gone is also unmeasured', () => {
  assert.equal(deliverableProgress({ projectIds: ['vanished'] }, STATS).pct, null);
});

test('a deliverable averages the projects it is linked to', () => {
  assert.equal(deliverableProgress({ projectIds: ['p1', 'p2'] }, STATS).pct, 60);
});

test('the legacy single projectId still resolves', () => {
  assert.deepEqual(deliverableProjectIds({ projectId: 'p1' }), ['p1']);
  assert.deepEqual(deliverableProjectIds({ projectIds: ['p1', null, 'p2'] }), ['p1', 'p2']);
  assert.deepEqual(deliverableProjectIds(undefined), []);
});

test('the ring averages only what IS measured', () => {
  const g = goalProgress({
    deliverables: [
      { text: 'a', projectIds: ['p1'] },   // 80
      { text: 'b', projectIds: ['p2'] },   // 40
      { text: 'c', projectIds: [] },       // unmeasured
    ],
  }, STATS);
  assert.equal(g.pct, 60, 'an unwired deliverable must not drag the ring to 40');
  assert.equal(g.measured, 2);
  assert.equal(g.unmeasured, 1);
});

test('a goal with nothing measured has no ring percentage at all', () => {
  const g = goalProgress({ deliverables: [{ text: 'a' }] }, STATS);
  assert.equal(g.pct, null);
  assert.equal(g.tone, 'navy');
});

test('an empty goal does not crash, and claims nothing', () => {
  const g = goalProgress({}, STATS);
  assert.equal(g.pct, null);
  assert.deepEqual(g.projects, []);
  assert.equal(g.due, null);
  assert.equal(g.total, 0);
});

test('every linked project appears once, in the order first seen', () => {
  const g = goalProgress({
    deliverables: [{ projectIds: ['p1', 'p2'] }, { projectIds: ['p2', 'p3'] }],
  }, STATS);
  assert.deepEqual(g.projects.map((p) => p.id), ['p1', 'p2', 'p3']);
});

test('the goal’s date is the LAST thing it is due by', () => {
  const g = goalProgress({
    deliverables: [{ targetDate: '2026-08-31' }, { targetDate: '2026-09-30' }, { targetDate: '' }],
  }, STATS);
  assert.equal(g.due, '2026-09-30');
});

test('"N at risk" counts the red ones, and an unmeasured goal is not one', () => {
  const goals = [
    { deliverables: [{ projectIds: ['p2'] }] },  // 40 → red
    { deliverables: [{ projectIds: ['p3'] }] },  // 100 → green
    { deliverables: [{ text: 'unwired' }] },     // null → navy, NOT at risk
  ];
  assert.equal(atRiskCount(goals, STATS), 1);
});

test('done counts deliverables that are actually finished', () => {
  const g = goalProgress({
    deliverables: [{ projectIds: ['p3'] }, { projectIds: ['p1'] }],
  }, STATS);
  assert.equal(g.done, 1);
  assert.equal(g.total, 2);
});
