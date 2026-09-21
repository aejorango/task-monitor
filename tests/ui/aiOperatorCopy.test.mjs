// T-0112 / BUG-028 — a shell command is for the operator, not for everyone.
//
//   1. Given a non-superadmin user whose AI provider is unreachable
//   2. When any AI feature fails
//   3. Then the message contains no shell command, no CLI name and no bridge
//      URL — and a superadmin still sees the runbook
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isPlainUserMessage } from '../../src/services/errorMessages.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const ai = read('src', 'services', 'ai.js');

/** Everything the mock body can contain, without running the provider layer. */
const mockBody = () => {
  const start = ai.indexOf('function mockReply(');
  const body = ai.slice(start, ai.indexOf('\n}', start));
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]).join(' ');
};

test('the placeholder answer names no command, package or CLI', () => {
  const body = mockBody();
  assert.doesNotMatch(body, /npm|npx|yarn/, 'this was rendered verbatim into the answer');
  assert.doesNotMatch(body, /@anthropic-ai|claude-code|Claude Code/);
  assert.doesNotMatch(body, /`/, 'no command in backticks');
  assert.match(body, /Ask an administrator/, 'it still says what to do about it');
});

test('the runbook still exists, for whoever can run it', () => {
  assert.match(ai, /export const MOCK_OPERATOR_HINT =/);
  const hint = ai.slice(ai.indexOf('export const MOCK_OPERATOR_HINT ='), ai.indexOf(';', ai.indexOf('export const MOCK_OPERATOR_HINT =')));
  assert.match(hint, /npm i -g @anthropic-ai\/claude-code/);
  assert.match(hint, /npm run bridge/);
  assert.match(hint, /Settings → AI brain/);
});

test('the hint travels on the result, beside the reason, not inside it', () => {
  assert.match(ai, /const finish = \(text, prov, usage, degraded, operatorHint\) => \{/);
  assert.match(ai, /\.\.\.\(operatorHint \? \{ operatorHint \} : \{\}\),/);
  // Both mock paths pass it.
  const mockCalls = [...ai.matchAll(/finish\(mockReply\(system, userPrompt\)[\s\S]{0,260}?\);/g)].map((m) => m[0]);
  assert.equal(mockCalls.length, 2, `expected both mock paths, saw ${mockCalls.length}`);
  for (const call of mockCalls) {
    assert.match(call, /MOCK_OPERATOR_HINT/, 'a mock answer with no hint leaves the operator guessing');
  }
});

test('the degraded sentences shown to everybody are plain', () => {
  const sentences = [
    ...[...ai.matchAll(/const GROUND_UNAVAILABLE =\s*\n?\s*'([^']*)'/g)].map((m) => m[1]),
    ...[...ai.matchAll(/'No AI is connected, so this is placeholder text rather than a real answer\.'/g)].map(() =>
      'No AI is connected, so this is placeholder text rather than a real answer.'),
  ];
  assert.ok(sentences.length >= 2, `expected the degraded sentences, saw ${sentences.length}`);
  for (const s of sentences) assert.ok(isPlainUserMessage(s), `"${s}" is not plain`);
});

test('the web-unavailable sentence names the AI in words, not a provider id', () => {
  assert.match(ai, /providerLabel\(provider\)\.split\(' —'\)\[0\]/,
    'a raw provider id like "bridge-api" means nothing to a user');
  assert.doesNotMatch(ai, /the "\$\{provider\}" provider cannot browse/);
});

test('no degraded sentence names the Claude Code bridge to everybody', () => {
  const start = ai.indexOf('const GROUND_UNAVAILABLE =');
  const block = ai.slice(start, ai.indexOf('const noBrain', start));
  assert.doesNotMatch(block, /Claude Code bridge/,
    'it is the operator’s word, and knowledgeCopy already made this split');
});

test('the hint is rendered only for an operator', () => {
  const src = read('src', 'components', 'AiOperatorHint.jsx');
  assert.match(src, /useIsOperator\(userId\)/);
  assert.match(src, /if \(!hint \|\| !isOperator\) return null;/);

  const modal = read('src', 'components', 'DueTaskAlertModal.jsx');
  assert.match(modal, /<AiOperatorHint hint=\{entry\?\.operatorHint\} \/>/);
  assert.match(modal, /<AiOperatorHint hint=\{answer\.operatorHint\} \/>/);
  assert.match(modal, /operatorHint: out\.operatorHint \|\| null,/,
    'the cached entry has to carry it or it is lost on the second view');
});

// Components whose whole audience IS the operator: KnowledgeSection takes
// `isOperator`, AiBrainSection renders only behind `{isSuperadmin && …}`, and
// SetupRequiredView is only reachable with no Firebase configuration at all.
const OPERATOR_ONLY = new Set(['KnowledgeSection.jsx', 'SetupRequiredView.jsx']);
const OPERATOR_ONLY_COMPONENTS = new Set(['AiBrainSection']);

/** Which top-level component a line belongs to. */
function componentAt(src, lineIndex) {
  const lines = src.split('\n');
  let name = null;
  for (let i = 0; i <= lineIndex; i++) {
    const m = lines[i].match(/^(?:export default |export )?function ([A-Za-z0-9_]+)\(/);
    if (m) name = m[1];
  }
  return name;
}

test('nothing outside operator-only copy writes an npm command', () => {
  const dir = path.join(root, 'src', 'components');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))) {
    if (OPERATOR_ONLY.has(name)) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    src.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      if (!/npm (run |i -g |install)/.test(line)) return;
      if (OPERATOR_ONLY_COMPONENTS.has(componentAt(src, i))) return;
      offenders.push(`${name}:${i + 1}: ${t}`);
    });
  }
  assert.deepEqual(offenders, [],
    'put it behind an operator gate, or move it to an operatorHint');
});

test('the components exempted above really are operator-gated', () => {
  const settings = read('src', 'components', 'SettingsView.jsx');
  assert.match(settings, /\{isSuperadmin && <AiBrainSection \/>\}/,
    'the exemption is only valid while the gate is there');
  const knowledge = read('src', 'components', 'KnowledgeSection.jsx');
  assert.match(knowledge, /if \(!isOperator\) \{/);
});
