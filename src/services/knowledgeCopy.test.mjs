// T-0026 / POL-003 — shell commands are for the operator, never for everyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE_STATES, knowledgeCopy, knowledgeState } from './knowledgeCopy.js';

const READY = { probed: true, bridgeOk: true, cliFound: true, authenticated: true, notebooks: [{ id: 'n1' }] };

test('each condition maps to exactly one state', () => {
  assert.equal(knowledgeState({ bridgeOff: true }), 'bridge-off');
  assert.equal(knowledgeState({ probed: false }), 'checking');
  assert.equal(knowledgeState({ probed: true, bridgeOk: false }), 'bridge-down');
  assert.equal(knowledgeState({ probed: true, bridgeOk: true, cliFound: false }), 'cli-missing');
  assert.equal(knowledgeState({ probed: true, bridgeOk: true, cliFound: true, authenticated: false }), 'signed-out');
  assert.equal(knowledgeState({ ...READY, notebooks: [] }), 'empty');
  assert.equal(knowledgeState(READY), 'ready');
});

test('bridge-off wins over everything — we are not even looking', () => {
  assert.equal(knowledgeState({ ...READY, bridgeOff: true }), 'bridge-off');
});

test('a regular user is never shown a shell command, in any state', () => {
  for (const state of KNOWLEDGE_STATES) {
    const status = {
      'checking': {},
      'bridge-off': { bridgeOff: true },
      'bridge-down': { probed: true },
      'cli-missing': { probed: true, bridgeOk: true },
      'signed-out': { probed: true, bridgeOk: true, cliFound: true },
      'empty': { ...READY, notebooks: [] },
      'ready': READY,
    }[state];

    const copy = knowledgeCopy(status, { isOperator: false });
    assert.equal(copy.state, state);
    assert.deepEqual(copy.commands, [], `${state} handed a command to a user`);
    const shown = `${copy.title} ${copy.message}`;
    assert.doesNotMatch(shown, /npm |pipx|brew |notebooklm login|127\.0\.0\.1|localhost|http:\/\//,
      `${state}: "${shown}"`);
  }
});

test('a regular user is told who fixes it, not how', () => {
  const copy = knowledgeCopy({ probed: true, bridgeOk: false }, { isOperator: false });
  assert.match(copy.message, /admin/);
  assert.doesNotMatch(copy.message, /bridge|CLI/i);
});

test('every unavailable state reads the same to a user — the reason is not theirs', () => {
  const messages = new Set();
  for (const status of [
    { bridgeOff: true },
    { probed: true, bridgeOk: false },
    { probed: true, bridgeOk: true, cliFound: false },
    { probed: true, bridgeOk: true, cliFound: true, authenticated: false },
    { ...READY, notebooks: [] },
  ]) {
    messages.add(knowledgeCopy(status, { isOperator: false }).message);
  }
  assert.equal(messages.size, 1, 'do not leak the internal reason through five wordings');
});

test('a user on a working knowledge base is told it works', () => {
  const copy = knowledgeCopy(READY, { isOperator: false });
  assert.equal(copy.state, 'ready');
  assert.match(copy.message, /own documents/);
  assert.equal(copy.showDetail, true);
});

test('the operator gets the one command that moves each state forward', () => {
  assert.deepEqual(
    knowledgeCopy({ probed: true, bridgeOk: false }, { isOperator: true }).commands,
    ['npm run bridge'],
  );
  assert.deepEqual(
    knowledgeCopy({ probed: true, bridgeOk: true, cliFound: true, authenticated: false }, { isOperator: true }).commands,
    ['notebooklm login'],
  );
  const install = knowledgeCopy({ probed: true, bridgeOk: true, cliFound: false }, { isOperator: true });
  assert.equal(install.commands.length, 3);
  assert.match(install.commands.join(' '), /pipx install/);
});

test('a working knowledge base needs no command from anyone', () => {
  assert.deepEqual(knowledgeCopy(READY, { isOperator: true }).commands, []);
});

test('an unknown status does not throw and does not claim to be ready', () => {
  for (const arg of [undefined, null, {}, { notebooks: null }]) {
    const copy = knowledgeCopy(arg, { isOperator: true });
    assert.ok(copy.title);
    assert.notEqual(copy.state, 'ready');
  }
});
