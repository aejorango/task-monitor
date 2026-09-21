import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCrash, detailOf } from './errorMessages.js';

const noJargon = (s) => {
  assert.doesNotMatch(s, /stack|undefined is not|TypeError|null\b|console|chunk/i,
    `user-facing text leaked jargon: ${s}`);
};

test('a view crash keeps the user oriented and offers Try again', () => {
  const d = describeCrash(new TypeError("Cannot read properties of undefined (reading 'map')"), {
    scope: 'view', viewName: 'Gantt',
  });
  assert.match(d.title, /Gantt/);
  assert.equal(d.primaryAction, 'retry');
  assert.match(d.body, /rest of the app still works/);
  noJargon(d.title); noJargon(d.body);
});

test('an app-level crash offers Reload instead', () => {
  const d = describeCrash(new Error('boom'), { scope: 'app' });
  assert.equal(d.primaryAction, 'reload');
  noJargon(d.body);
});

test('a stale-deploy chunk failure is named for what it is', () => {
  const d = describeCrash(
    new TypeError('Failed to fetch dynamically imported module: /assets/GanttView-abc.js'),
    { scope: 'view', viewName: 'Gantt' },
  );
  assert.match(d.title, /new version/i);
  assert.equal(d.primaryAction, 'reload');
});

test('a dropped connection is named for what it is', () => {
  const d = describeCrash(new TypeError('NetworkError when attempting to fetch resource.'), {
    scope: 'view', viewName: 'Board',
  });
  assert.match(d.title, /No connection/);
  assert.equal(d.primaryAction, 'retry');
});

test('the technical detail is one bounded line, never a stack', () => {
  const err = new Error('x'.repeat(2000));
  err.stack = 'at Foo (bundle.js:1:1)\n'.repeat(50);
  const d = detailOf(err);
  assert.ok(d.length <= 500);
  assert.doesNotMatch(d, /bundle\.js/);
  assert.equal(detailOf(null), 'Unknown error (nothing was thrown).');
});

test('every crash says the user has not lost work', () => {
  for (const scope of ['app', 'view']) {
    assert.match(describeCrash(new Error('boom'), { scope }).body, /nothing you saved is lost/i);
  }
});

// ─── T-0094 / BUG-020: an AI failure is one plain sentence ──────────────────
//
//   1. Given the AI provider is unreachable
//   2. When the user asks for something
//   3. Then the message on screen is one plain sentence with no shell command,
//      URL, status code or provider internals

import { describeAiFailure, isPlainUserMessage, AI_FALLBACK_MESSAGE } from './errorMessages.js';

/** The error ai.js throws now: a plain sentence, with the operator's version
 *  on `detail`. Before BUG-020 the operator's version WAS the message, and it
 *  went straight onto the Dashboard. */
const bridgeDown = Object.assign(
  new Error('The AI is not connected right now. Try again in a moment — if it keeps happening, ask whoever set this up.'),
  {
    code: 'bridge-unreachable',
    detail: 'Claude Code bridge unreachable at http://127.0.0.1:4319 (Failed to fetch). '
          + 'Start it with `npm run bridge`, or switch the provider in Settings → AI brain.',
  },
);

/** What the old message looked like — nothing may put this on a screen again. */
const OLD_BRIDGE_MESSAGE = 'The Claude Code bridge is not reachable (Failed to fetch). '
  + 'Start it with `npm run bridge`, or switch the provider in Settings → AI brain.';

test('the bridge-unreachable message never reaches the screen', () => {
  const { message } = describeAiFailure(bridgeDown);
  assert.doesNotMatch(message, /`/, 'no command in backticks');
  assert.doesNotMatch(message, /npm/, 'no shell command');
  assert.doesNotMatch(message, /http/i, 'no URL');
  assert.doesNotMatch(message, /Claude Code|bridge/i, 'no provider internals');
  assert.ok(isPlainUserMessage(message));
});

test('the operator detail survives, for the console', () => {
  const { detail } = describeAiFailure(bridgeDown);
  assert.match(detail, /4319/, 'whoever has to fix it still gets the address');
  assert.match(detail, /npm run bridge/, 'and the command');
});

test('the old message would be caught even if something threw it again', () => {
  assert.equal(isPlainUserMessage(OLD_BRIDGE_MESSAGE), false);
  const { message } = describeAiFailure(new Error(OLD_BRIDGE_MESSAGE));
  assert.ok(isPlainUserMessage(message));
  assert.doesNotMatch(message, /npm|`|http/);
});

test('a raw upstream body is never shown', () => {
  const err = Object.assign(new Error('AI API error 429: {"type":"error","error":{"message":"rate_limit_error"}}'), { code: 'http-429' });
  const { message } = describeAiFailure(err);
  assert.equal(message, 'The AI is busy right now. Wait a few seconds and try again.');
  assert.ok(isPlainUserMessage(message));
});

test('every status gets a sentence someone can act on', () => {
  const cases = {
    401: /do not have access/, 403: /do not have access/,
    402: /not set up/, 429: /busy/, 500: /having trouble/, 503: /having trouble/,
    504: /took too long/, 400: /could not answer that one/,
  };
  for (const [status, shape] of Object.entries(cases)) {
    const { message } = describeAiFailure(Object.assign(new Error(`AI API error ${status}: …`), { code: `http-${status}` }));
    assert.match(message, shape, `status ${status}`);
    assert.ok(isPlainUserMessage(message), `status ${status} leaked something`);
  }
});

test('a timeout and an offline browser say different, useful things', () => {
  assert.match(describeAiFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })).message, /took too long/);
  assert.match(describeAiFailure(new TypeError('Failed to fetch')).message, /offline/);
});

test('an unrecognised failure falls back rather than showing itself', () => {
  const { message, code } = describeAiFailure(new Error('ReferenceError: x is not defined at foo.js:12'));
  assert.equal(code, null);
  assert.equal(message, AI_FALLBACK_MESSAGE);
  assert.ok(isPlainUserMessage(message));
});

test('the caller may choose its own fallback sentence', () => {
  const { message } = describeAiFailure(new Error('¯\\_(ツ)_/¯'), 'Could not get suggestions just now.');
  assert.equal(message, 'Could not get suggestions just now.');
});

test('nothing thrown at all still gets a sentence', () => {
  assert.equal(describeAiFailure(null).message, AI_FALLBACK_MESSAGE);
  assert.equal(describeAiFailure(undefined).message, AI_FALLBACK_MESSAGE);
  assert.ok(describeAiFailure(null).detail.length > 0, 'the console still learns something');
});

test('every sentence the module can produce passes its own guard', () => {
  const codes = ['bridge-unreachable', 'ai-not-configured', 'ai-denied', 'ai-busy',
    'ai-timeout', 'ai-offline', 'ai-unavailable', 'ai-refused'];
  for (const code of codes) {
    const { message } = describeAiFailure({ code, message: 'internal' });
    assert.ok(isPlainUserMessage(message), `${code}: ${message}`);
    assert.ok(/[.!]$/.test(message), `${code} must be a sentence`);
  }
  assert.ok(isPlainUserMessage(AI_FALLBACK_MESSAGE));
});

test('the guard catches exactly the things the bug put on screen', () => {
  assert.equal(isPlainUserMessage('Start it with `npm run bridge`.'), false);
  assert.equal(isPlainUserMessage('Could not reach http://127.0.0.1:4319.'), false);
  assert.equal(isPlainUserMessage('AI API error 429.'), false);
  assert.equal(isPlainUserMessage('TypeError: Failed to fetch'), false);
  assert.equal(isPlainUserMessage('Set ANTHROPIC_API_KEY in your environment.'), false);
  assert.equal(isPlainUserMessage(''), false);
  assert.equal(isPlainUserMessage('The AI is busy right now. Wait a few seconds and try again.'), true);
});

test('a thrown word is not mistaken for a written sentence', () => {
  assert.match(describeAiFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })).message,
    /took too long/, 'one lowercase word is not copy');
  assert.equal(describeAiFailure(new Error('internal')).message, AI_FALLBACK_MESSAGE);
});

test('a sentence we wrote ourselves is preferred to anything generic', () => {
  // noKeyMessage()'s company variant: more useful than "ask an administrator".
  const err = Object.assign(
    new Error('AI features are turned off for "Blue Innovation". Contact your company admin to enable them.'),
    { code: 'no-api-key' },
  );
  assert.match(describeAiFailure(err).message, /Blue Innovation/);
});

test('but not when we wrote it for an operator', () => {
  // noKeyMessage()'s superadmin variant names the command.
  const err = Object.assign(
    new Error('No AI brain available. Start the Claude Code bridge (npm run bridge), give your company an API key in Settings → Companies.'),
    { code: 'no-api-key' },
  );
  const { message } = describeAiFailure(err);
  assert.ok(isPlainUserMessage(message), message);
  assert.match(message, /not set up for this account/);
});

test('an operator is shown the thing they can act on', () => {
  const { message, isOperatorMessage } = describeAiFailure(bridgeDown, undefined, { isOperator: true });
  assert.equal(isOperatorMessage, true);
  assert.match(message, /npm run bridge/, 'hiding this from the person who can fix it helps nobody');

  const forEveryoneElse = describeAiFailure(bridgeDown);
  assert.equal(forEveryoneElse.isOperatorMessage, false);
  assert.ok(isPlainUserMessage(forEveryoneElse.message));
});

test('an operator with nothing extra to say gets the ordinary sentence', () => {
  const { message, isOperatorMessage } = describeAiFailure(new Error('internal'), undefined, { isOperator: true });
  assert.equal(isOperatorMessage, false);
  assert.equal(message, AI_FALLBACK_MESSAGE);
});
