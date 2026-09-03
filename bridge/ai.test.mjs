// bridge/ai.test.mjs — run with `npm test` (node --test, no dependencies).
// Only pure functions are tested; the CLI is never spawned.

import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeCliArgs, parseCliResult, extractJson, WEB_TOOLS } from './ai.mjs';

const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('claudeCliArgs invokes the CLI hermetically', () => {
  const args = claudeCliArgs('ROLE', 'TASK', {});
  assert.ok(args.includes('--safe-mode'), 'must drop CLAUDE.md, skills, plugins, hooks');
  assert.ok(args.includes('--strict-mcp-config'), 'must ignore ambient MCP servers');
  assert.equal(valueAfter(args, '--output-format'), 'json');
});

test('the role lands in --system-prompt and the task in -p', () => {
  const args = claudeCliArgs('ROLE', 'TASK', {});
  assert.equal(valueAfter(args, '--system-prompt'), 'ROLE');
  assert.equal(valueAfter(args, '-p'), 'TASK');
  // The role must REPLACE the agent prompt, not be prefixed to the user prompt.
  assert.ok(!valueAfter(args, '-p').includes('ROLE'));
  assert.ok(!args.includes('--append-system-prompt'));
});

test('web: false disables every tool and pre-approves nothing', () => {
  const args = claudeCliArgs('ROLE', 'TASK', { web: false });
  assert.equal(valueAfter(args, '--tools'), '');
  assert.ok(!args.includes('--allowedTools'));
});

test('web: true offers and pre-approves both web tools', () => {
  const args = claudeCliArgs('ROLE', 'TASK', { web: true });
  const tools = valueAfter(args, '--tools');
  for (const t of WEB_TOOLS) assert.ok(tools.includes(t), `${t} must be available`);
  assert.ok(args.includes('--allowedTools'), 'must pre-approve, or the session denies them');
  for (const t of WEB_TOOLS) assert.ok(args.includes(t));
});

test('REGRESSION: a denied tool throws instead of returning the refusal', () => {
  const out = JSON.stringify({
    is_error: false,
    result: "I can't search the web because I don't have access to that tool.",
    permission_denials: [{ tool_name: 'WebSearch' }],
  });
  assert.throws(() => parseCliResult(out), /denied these tools: WebSearch/);
});

test('repeated denials of the same tool are de-duplicated', () => {
  const out = JSON.stringify({
    is_error: false,
    result: 'nope',
    permission_denials: [
      { tool_name: 'WebSearch' }, { tool_name: 'WebSearch' }, { tool_name: 'WebFetch' },
    ],
  });
  assert.throws(() => parseCliResult(out), (e) => {
    assert.equal(e.message.match(/WebSearch/g).length, 1);
    assert.ok(e.message.includes('WebFetch'));
    return true;
  });
});

test('is_error: true throws with the result as the message', () => {
  const out = JSON.stringify({ is_error: true, result: 'credit balance too low' });
  assert.throws(() => parseCliResult(out), /credit balance too low/);
});

test('a clean result parses, trims, and reports $0 (subscription-billed)', () => {
  const out = JSON.stringify({
    is_error: false,
    result: '  hello  ',
    usage: { input_tokens: 273, output_tokens: 41 },
    total_cost_usd: 0.23,
  });
  const parsed = parseCliResult(out);
  assert.equal(parsed.text, 'hello');
  assert.equal(parsed.usage.inputTokens, 273);
  assert.equal(parsed.usage.outputTokens, 41);
  assert.equal(parsed.usage.costUsd, 0);
});

test('non-JSON stdout is returned as plain text, not a crash', () => {
  const parsed = parseCliResult('  just some text  ');
  assert.equal(parsed.text, 'just some text');
  assert.equal(parsed.usage, null);
});

test('extractJson handles fenced, prefixed and trailing-prose responses', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go:\n[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(extractJson('{"a":[1,2]}\n\nHope that helps!'), { a: [1, 2] });
  assert.deepEqual(extractJson('  [{"t":"x"}]  '), [{ t: 'x' }]);
  assert.throws(() => extractJson('no json at all'), /No JSON found/);
});
