// bridge/settings.test.mjs — T-0007 / IMP-002.
//
// The bridge spawns a local executable. Anything a web page can put into that
// spawn is a local-code-execution primitive on the operator's Mac, so the HTTP
// settings endpoint must be a narrow, validated allowlist — not a pass-through
// onto the config object.
//
// Nothing here spawns anything: the config file is redirected to a temp dir.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-bridge-test-'));
process.env.TM_BRIDGE_CONFIG_DIR = tmpHome;

const {
  aiSettings, setAiSettings, resetAiSettings,
  HTTP_SETTABLE_KEYS, ALLOWED_CLI_MODELS, isAllowedModel,
  bridgeToken, requiresToken, tokenMatches,
} = await import('./ai.mjs');

before(() => { resetAiSettings(); });
after(() => { fs.rmSync(tmpHome, { recursive: true, force: true }); });
beforeEach(() => { resetAiSettings(); });

test('cliPath is not settable over HTTP', () => {
  assert.ok(!HTTP_SETTABLE_KEYS.includes('cliPath'),
    'a page must never choose which binary the bridge spawns');
  const before = aiSettings().cliPath;
  const after = setAiSettings({ cliPath: '/usr/bin/say' }, { source: 'http' });
  assert.equal(after.cliPath, before, 'cliPath must be unchanged');
  assert.notEqual(after.cliPath, '/usr/bin/say');
});

test('cliPath is still settable from the environment', () => {
  process.env.TM_BRIDGE_CLI_PATH = '/opt/homebrew/bin/claude';
  resetAiSettings();
  assert.equal(aiSettings().cliPath, '/opt/homebrew/bin/claude');
  delete process.env.TM_BRIDGE_CLI_PATH;
  resetAiSettings();
});

test('an unknown cliModel is rejected, a known one is kept', () => {
  assert.equal(isAllowedModel('rm -rf /'), false);
  assert.equal(isAllowedModel('--dangerously-skip-permissions'), false);
  assert.equal(isAllowedModel(ALLOWED_CLI_MODELS[1]), true);
  assert.equal(isAllowedModel(''), true, 'empty means "whatever the CLI is set to"');

  const before = aiSettings().cliModel;
  const after = setAiSettings({ cliModel: '; touch /tmp/pwned' }, { source: 'http' });
  assert.equal(after.cliModel, before);

  const ok = setAiSettings({ cliModel: 'sonnet' }, { source: 'http' });
  assert.equal(ok.cliModel, 'sonnet');
});

test('an unknown apiModel is rejected too', () => {
  const before = aiSettings().apiModel;
  assert.equal(setAiSettings({ apiModel: 'http://evil/' }, { source: 'http' }).apiModel, before);
});

test('the settable keys still work end to end', () => {
  const next = setAiSettings(
    { provider: 'mock', maxTokens: 4096, cliModel: 'haiku' },
    { source: 'http' },
  );
  assert.equal(next.provider, 'mock');
  assert.equal(next.maxTokens, 4096);
  assert.equal(next.cliModel, 'haiku');
});

test('maxTokens is clamped and a nonsense provider falls back to auto', () => {
  assert.equal(setAiSettings({ maxTokens: 999999 }, { source: 'http' }).maxTokens, 8192);
  assert.equal(setAiSettings({ maxTokens: 1 }, { source: 'http' }).maxTokens, 256);
  assert.equal(setAiSettings({ provider: 'evil' }, { source: 'http' }).provider, 'auto');
});

test('unknown keys are dropped, not merged', () => {
  const next = setAiSettings({ somethingNew: 'x', __proto__: { polluted: true } }, { source: 'http' });
  assert.equal('somethingNew' in next, false);
  assert.equal({}.polluted, undefined);
});

test('a local caller (config file / env) may still set cliPath', () => {
  const next = setAiSettings({ cliPath: '/usr/local/bin/claude' }, { source: 'local' });
  assert.equal(next.cliPath, '/usr/local/bin/claude');
});

// ─── per-session admin token ────────────────────────────────────────────────

test('the bridge mints a per-session token', () => {
  const t = bridgeToken();
  assert.match(t, /^[0-9a-f]{32}$/);
  assert.equal(bridgeToken(), t, 'stable for the life of the process');
});

test('settings-changing routes need the token; reads and questions do not', () => {
  assert.equal(requiresToken('POST /ai/settings'), true);
  // Re-check only re-probes which provider is live — nothing to protect, and
  // gating it would break the Re-check button for every non-operator.
  assert.equal(requiresToken('POST /ai/recheck'), false);
  assert.equal(requiresToken('GET /health'), false);
  assert.equal(requiresToken('GET /ai/settings'), false);
  assert.equal(requiresToken('POST /ai/complete'), false);
});

test('token comparison rejects a wrong or missing token', () => {
  const t = bridgeToken();
  assert.equal(tokenMatches(t), true);
  assert.equal(tokenMatches(''), false);
  assert.equal(tokenMatches(null), false);
  assert.equal(tokenMatches(t.slice(0, -1) + '0'), false);
  assert.equal(tokenMatches(t + 'extra'), false);
});

test('the settings a web page can see never include the local CLI path', async () => {
  const { publicAiSettings } = await import('./ai.mjs');
  setAiSettings({ cliPath: '/Users/someone/bin/claude' }, { source: 'local' });
  assert.equal('cliPath' in publicAiSettings(), false);
  assert.equal(aiSettings().cliPath, '/Users/someone/bin/claude', 'still used internally');
});
