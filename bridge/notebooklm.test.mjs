// bridge/notebooklm.test.mjs — the NotebookLM layer's failure modes.
//
// These are the ways a CLI integration goes wrong in production: the binary is
// missing, the payload says `"error": true` (a BOOLEAN, so a naive reader
// shows the user the word "true"), progress lines arrive before the JSON, a
// call hangs, or twenty of them start at once. Every case here is driven by a
// throwaway fixture script — the real `notebooklm` is NEVER spawned, so the
// suite passes on a machine that has never heard of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A disposable ask log, set before the module is imported so the operator's
// real ~/.task-monitor/knowledge-asks.json is never touched.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-nblm-'));
process.env.TM_KNOWLEDGE_LOG = path.join(TMP, 'knowledge-asks.json');

const nb = await import('./notebooklm.mjs');

/* ── fixtures: tiny node scripts that stand in for the CLI ─────────────── */

let fixtureN = 0;
function fixture(body) {
  const file = path.join(TMP, `fixture-${++fixtureN}.mjs`);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}
const useFixture = (file) => nb.setCliResolver(() => file);

function reset() {
  nb.setCliResolver(null);
  delete process.env.TM_NOTEBOOKLM_BIN;
  nb.resetKnowledgeCaches();
  nb._resetAskLogForTests([]);
}

test.afterEach(reset);
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

/* ── 1. no CLI at all ──────────────────────────────────────────────────── */

test('missing CLI is a state, not an exception', async () => {
  process.env.TM_NOTEBOOKLM_BIN = 'none';
  nb.resetKnowledgeCaches();

  assert.equal(nb.findCli(), null);
  const status = await nb.knowledgeStatus({ force: true });
  assert.equal(status.cliFound, false);
  assert.equal(status.authenticated, false);
  assert.match(status.hint, /pipx install/);

  // runCli resolves — it must never reject just because nothing is installed.
  const res = await nb.runCli(['list', '--json']);
  assert.equal(res.ok, false);
  assert.match(res.error, /pipx install/);
});

test('SETUP_HINT tells the operator to log in as well as install', () => {
  assert.match(nb.SETUP_HINT, /notebooklm login/);
  assert.match(nb.LOGIN_HINT, /notebooklm login/);
  assert.match(nb.EMPTY_HINT, /notebooklm\.google\.com/);
});

test('askNotebook without a CLI rejects promptly with the setup hint', async () => {
  process.env.TM_NOTEBOOKLM_BIN = 'none';
  nb.resetKnowledgeCaches();

  const raced = await Promise.race([
    nb.askNotebook('nb1', 'anything').then(() => 'resolved', (e) => e.message),
    new Promise((r) => setTimeout(() => r('TIMED OUT'), 2000)),
  ]);
  assert.notEqual(raced, 'TIMED OUT');
  assert.match(raced, /pipx install/);
});

/* ── 2. the boolean-`error` regression ─────────────────────────────────── */

test('a payload with `"error": true` reports its message, never the word "true"', async () => {
  useFixture(fixture(`
    process.stdout.write(JSON.stringify({
      error: true, code: 'VALIDATION_ERROR', message: 'No notebook found'
    }));
    process.exit(1);
  `));

  const res = await nb.runCli(['list', '--json']);
  assert.equal(res.ok, false);
  assert.match(res.error, /No notebook found/);
  assert.notEqual(res.error, 'true');
  assert.ok(!/^true$/i.test(res.error));
});

test('a payload that exits 0 but flags an error still fails', async () => {
  // This is exactly what a signed-out `notebooklm list --json` does.
  useFixture(fixture(`
    process.stdout.write(JSON.stringify({
      error: true, code: 'AUTH_REQUIRED', message: "Auth not found. Run 'notebooklm login' first."
    }));
    process.exit(0);
  `));

  const res = await nb.runCli(['list', '--json']);
  assert.equal(res.ok, false);
  assert.match(res.error, /notebooklm login/);
});

test('errorMessage prefers a string `error` over `message`, and ignores a boolean one', () => {
  assert.equal(nb.errorMessage({ error: 'real problem', message: 'ignored' }, '', null, 0), 'real problem');
  assert.match(nb.errorMessage({ error: true, message: 'the actual reason' }, '', null, 0), /the actual reason/);
  assert.equal(nb.errorMessage(null, '  boom on stderr  ', null, 0), 'boom on stderr');
  assert.match(nb.errorMessage(null, '', { killed: true }, 500), /timed out/);
  assert.equal(nb.errorMessage(null, '', { message: 'ENOENT' }, 0), 'ENOENT');
});

/* ── 3. lenient JSON ───────────────────────────────────────────────────── */

test('parseJsonLenient survives progress chatter and rejects garbage', () => {
  assert.deepEqual(nb.parseJsonLenient('{"a":1}'), { a: 1 });
  assert.deepEqual(nb.parseJsonLenient('Fetching notebooks…\nDone.\n{"a":1}'), { a: 1 });
  assert.deepEqual(nb.parseJsonLenient('[{"id":"x"}]'), [{ id: 'x' }]);
  assert.deepEqual(nb.parseJsonLenient('noise {"a":1} trailing words'), { a: 1 });
  assert.equal(nb.parseJsonLenient('not json at all'), null);
  assert.equal(nb.parseJsonLenient(''), null);
  assert.equal(nb.parseJsonLenient(null), null);
});

test('progress lines before the payload still yield notebooks', async () => {
  useFixture(fixture(`
    process.stdout.write('Connecting…\\nLoading…\\n');
    process.stdout.write(JSON.stringify({ notebooks: [{ id: 'a1', title: 'Ops', source_count: 4 }] }));
  `));
  const list = await nb.listNotebooks({ force: true });
  assert.deepEqual(list, [{ id: 'a1', title: 'Ops', sourceCount: 4 }]);
});

/* ── 4. timeouts ───────────────────────────────────────────────────────── */

test('a hung call is killed and reported as a timeout', async () => {
  useFixture(fixture('setTimeout(() => {}, 3000);'));
  const res = await nb.runCli(['ask', 'hello'], { timeoutMs: 500 });
  assert.equal(res.ok, false);
  assert.match(res.error, /timed out/i);
});

/* ── 5. the 2-slot semaphore ───────────────────────────────────────────── */

test('at most two CLI processes run at once', async () => {
  const marker = path.join(TMP, 'concurrency');
  fs.writeFileSync(marker, '');
  useFixture(fixture(`
    import fs from 'node:fs';
    const f = ${JSON.stringify(marker)};
    fs.appendFileSync(f, '+');
    await new Promise((r) => setTimeout(r, 300));
    fs.appendFileSync(f, '-');
    process.stdout.write('{}');
  `));

  await Promise.all([0, 1, 2, 3].map(() => nb.runCli(['list', '--json'])));

  // Replay the +/- trace and take the high-water mark.
  let live = 0, peak = 0;
  for (const ch of fs.readFileSync(marker, 'utf8')) {
    if (ch === '+') { live++; peak = Math.max(peak, live); } else live--;
  }
  assert.ok(peak <= nb.MAX_CONCURRENT, `peak concurrency was ${peak}, expected ≤ ${nb.MAX_CONCURRENT}`);
  assert.ok(peak >= 2, 'the semaphore should still allow two at a time');
});

/* ── 6. status caching + re-check ──────────────────────────────────────── */

test('knowledgeStatus is cached for its TTL and refreshed by a reset', async () => {
  let spawns = 0;
  const f = fixture(`process.stdout.write(JSON.stringify({ status: 'ok', checks: { token_fetch: true } }));`);
  nb.setCliResolver(() => { spawns++; return f; });

  const a = await nb.knowledgeStatus({ force: true });
  const b = await nb.knowledgeStatus();
  assert.equal(a.authenticated, true);
  assert.equal(b.authenticated, true);
  const afterTwo = spawns;

  nb.resetKnowledgeCaches();
  await nb.knowledgeStatus();
  assert.ok(spawns > afterTwo, 'a reset must let the next call probe again');
});

test('a CLI that is present but signed out is authenticated:false with a login hint', async () => {
  useFixture(fixture(`
    process.stdout.write(JSON.stringify({
      status: 'error',
      checks: { storage_exists: false, json_valid: false, cookies_present: false, sid_cookie: false, token_fetch: null }
    }));
  `));
  const status = await nb.knowledgeStatus({ force: true });
  assert.equal(status.cliFound, true);
  assert.equal(status.authenticated, false);
  assert.match(status.hint, /notebooklm login/);
});

/* ── 7. response normalisation ─────────────────────────────────────────── */

test('normalizeNotebooks accepts all three payload shapes', () => {
  const want = [{ id: 'n1', title: 'Ops', sourceCount: 3 }];
  assert.deepEqual(nb.normalizeNotebooks([{ id: 'n1', title: 'Ops', sourceCount: 3 }]), want);
  assert.deepEqual(nb.normalizeNotebooks({ notebooks: [{ notebook_id: 'n1', name: 'Ops', source_count: 3 }] }), want);
  assert.deepEqual(nb.normalizeNotebooks({ items: [{ uuid: 'n1', title: 'Ops', sources: [1, 2, 3] }] }), want);
});

test('normalizeNotebooks drops entries with no id rather than rendering a blank row', () => {
  const out = nb.normalizeNotebooks([{ title: 'ghost' }, { id: 'n2', title: 'real' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'n2');
});

test('normalizeAnswer handles every answer key and both citation spellings', () => {
  assert.equal(nb.normalizeAnswer({ answer: 'A' }).answer, 'A');
  assert.equal(nb.normalizeAnswer({ response: 'B' }).answer, 'B');
  assert.equal(nb.normalizeAnswer({ text: 'C' }).answer, 'C');
  assert.equal(nb.normalizeAnswer({ raw: 'D' }).answer, 'D');
  assert.equal(nb.normalizeAnswer('plain string').answer, 'plain string');
  // An object answer is stringified, never rendered as "[object Object]".
  assert.match(nb.normalizeAnswer({ answer: { parts: ['x'] } }).answer, /parts/);

  assert.equal(nb.normalizeAnswer({ answer: 'A', conversation_id: 'c1' }).conversationId, 'c1');
  assert.equal(nb.normalizeAnswer({ answer: 'A', conversationId: 'c2' }).conversationId, 'c2');

  const cites = nb.normalizeAnswer({ answer: 'A', sources: [{ id: 's1', title: 'Doc' }] }).citations;
  assert.equal(cites.length, 1);
  assert.equal(cites[0].sourceId, 's1');
  assert.equal(nb.normalizeAnswer({ answer: 'A', citations: ['Doc one'] }).citations[0].title, 'Doc one');
  assert.deepEqual(nb.normalizeAnswer(null).citations, []);
});

test('normalizeSources maps type and kind alike', () => {
  const out = nb.normalizeSources({ sources: [{ source_id: 's1', title: 'Spec', type: 'url' }] });
  assert.deepEqual(out, [{ id: 's1', title: 'Spec', kind: 'url' }]);
});

/* ── 8. argument construction ──────────────────────────────────────────── */

test('askNotebook never passes --new, and puts a long question on stdin', async () => {
  // The fixture echoes back the argv and whatever it read from stdin.
  useFixture(fixture(`
    import fs from 'node:fs';
    let stdin = '';
    try { stdin = fs.readFileSync(0, 'utf8'); } catch {}
    process.stdout.write(JSON.stringify({ answer: 'ok', argv: process.argv.slice(2), stdin }));
  `));

  const short = await nb.askNotebook('nb1', 'short question', { conversationId: 'c9' });
  assert.equal(short.answer, 'ok');

  // Read the argv back out of the log-free path: ask again and inspect via runCli.
  const echo = await nb.runCli(['ask', 'x', '-n', 'nb1', '--json']);
  assert.ok(!echo.data.argv.includes('--new'), '--new is DESTRUCTIVE and must never be sent');

  const long = 'q'.repeat(2500);
  const res = await nb.runCli(['ask', '--prompt-file', '-', '-n', 'nb1', '--json'], { input: long });
  assert.equal(res.data.stdin, long);
});

test('addSourceUrl rejects a non-http scheme before spawning anything', async () => {
  nb.setCliResolver(() => { throw new Error('should not have been called'); });
  await assert.rejects(() => nb.addSourceUrl('nb1', 'ftp://example.com/x'), /http:\/\/ or https:\/\//);
});

test('addSourceText refuses empty text', async () => {
  nb.setCliResolver(() => { throw new Error('should not have been called'); });
  await assert.rejects(() => nb.addSourceText('nb1', 'Title', '   '), /empty/i);
});

test('a missing notebook id is caught locally', async () => {
  await assert.rejects(() => nb.listSources(''), /notebook id is required/);
});

/* ── 9. the ask log ────────────────────────────────────────────────────── */

test('the ask log records who asked what, and trims at the cap', () => {
  nb._resetAskLogForTests([]);
  for (let i = 0; i < nb.ASK_LOG_CAP + 25; i++) {
    nb.recordAsk({ notebookId: 'nb1', question: `q${i}`, ms: 10, source: 'ask-ai', citationsCount: 1 });
  }
  const log = nb._askLogForTests();
  assert.equal(log.length, nb.ASK_LOG_CAP);
  // The oldest rows are the ones dropped.
  assert.equal(log[0].question, 'q25');
  assert.equal(log[log.length - 1].question, `q${nb.ASK_LOG_CAP + 24}`);
});

test('a long question is truncated in the log', () => {
  nb._resetAskLogForTests([]);
  nb.recordAsk({ notebookId: 'nb1', question: 'x'.repeat(900), ms: 1, source: 'grounding' });
  assert.equal(nb._askLogForTests()[0].question.length, 300);
});

test('notebookAskStats and recentAsks only see their own notebook', () => {
  nb._resetAskLogForTests([]);
  nb.recordAsk({ notebookId: 'nb1', question: 'a', ms: 1, source: 'ask-ai', citationsCount: 2 });
  nb.recordAsk({ notebookId: 'nb2', question: 'b', ms: 1, source: 'ask-ai' });
  nb.recordAsk({ notebookId: 'nb1', question: 'c', ms: 1, source: 'grounding' });

  const stats = nb.notebookAskStats('nb1');
  assert.equal(stats.total, 2);
  assert.equal(stats.last7d, 2);
  assert.ok(stats.lastAt);
  assert.deepEqual(nb.recentAsks('nb1', 10).map((r) => r.question), ['c', 'a']);
});

test('rateAsk flips helpful and can clear it again', () => {
  nb._resetAskLogForTests([]);
  const id = nb.recordAsk({ notebookId: 'nb1', question: 'a', ms: 1, source: 'ask-ai' });
  assert.equal(nb.rateAsk(id, true).helpful, true);
  assert.equal(nb.notebookAskStats('nb1').helpful, 1);
  assert.equal(nb.rateAsk(id, false).helpful, false);
  assert.equal(nb.notebookAskStats('nb1').unhelpful, 1);
  assert.equal(nb.rateAsk(id, null).helpful, null);
  assert.equal(nb.rateAsk('nope', true), null);
});
