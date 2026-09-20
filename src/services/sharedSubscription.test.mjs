// T-0033 / BUG-010 — many subscribers, one listener.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSharedSubscription } from './sharedSubscription.js';

let opened, closed, emitters;
function makeCache(opts) {
  opened = []; closed = []; emitters = new Map();
  const cache = createSharedSubscription((key, emit) => {
    opened.push(key);
    emitters.set(key, emit);
    return () => { closed.push(key); emitters.delete(key); };
  }, opts);
  return cache;
}
beforeEach(() => { opened = []; closed = []; });

test('a hundred subscribers open exactly one listener', () => {
  const cache = makeCache();
  const unsubs = [];
  for (let i = 0; i < 100; i++) unsubs.push(cache.subscribe('ws-1', () => {}));
  assert.deepEqual(opened, ['ws-1']);
  assert.equal(cache.listenerCount(), 1);
  unsubs.forEach((u) => u());
  assert.deepEqual(closed, ['ws-1']);
});

test('every subscriber receives every value', () => {
  const cache = makeCache();
  const seen = [[], [], []];
  seen.forEach((bucket, i) => cache.subscribe('k', (v) => seen[i].push(v)));
  emitters.get('k')(1);
  emitters.get('k')(2);
  assert.deepEqual(seen, [[1, 2], [1, 2], [1, 2]]);
});

test('a late subscriber gets the current value immediately', () => {
  const cache = makeCache();
  cache.subscribe('k', () => {});
  emitters.get('k')({ n: 7 });
  const late = [];
  cache.subscribe('k', (v) => late.push(v));
  assert.deepEqual(late, [{ n: 7 }], 'no blank frame for a card that mounts later');
});

test('the listener closes only when the last subscriber leaves', () => {
  const cache = makeCache();
  const a = cache.subscribe('k', () => {});
  const b = cache.subscribe('k', () => {});
  a();
  assert.deepEqual(closed, [], 'one card unmounting must not blind the others');
  b();
  assert.deepEqual(closed, ['k']);
});

test('unsubscribing twice does not close a listener others are using', () => {
  const cache = makeCache();
  const a = cache.subscribe('k', () => {});
  cache.subscribe('k', () => {});
  a(); a(); a();
  assert.deepEqual(closed, []);
  assert.equal(cache.listenerCount(), 1);
});

test('different keys are different listeners', () => {
  const cache = makeCache();
  cache.subscribe('ws-1', () => {});
  cache.subscribe('ws-2', () => {});
  assert.deepEqual(opened.sort(), ['ws-1', 'ws-2']);
  assert.equal(cache.listenerCount(), 2);
});

test('re-subscribing after everyone left opens a fresh listener', () => {
  const cache = makeCache();
  cache.subscribe('k', () => {})();
  assert.deepEqual(closed, ['k']);
  cache.subscribe('k', () => {});
  assert.deepEqual(opened, ['k', 'k']);
});

test('an empty key yields the empty value and opens nothing', () => {
  const cache = makeCache({ empty: [] });
  const seen = [];
  const unsub = cache.subscribe(null, (v) => seen.push(v));
  assert.deepEqual(seen, [[]]);
  assert.deepEqual(opened, []);
  unsub();
});

test('one subscriber throwing does not stop the others', () => {
  const cache = makeCache();
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a);
  const seen = [];
  cache.subscribe('k', () => { throw new Error('bad card'); });
  cache.subscribe('k', (v) => seen.push(v));
  emitters.get('k')(42);
  console.error = realError;
  assert.deepEqual(seen, [42]);
  assert.equal(errors.length, 1);
});

test('a subscriber that unsubscribes inside its own callback is safe', () => {
  const cache = makeCache();
  const seen = [];
  let unsub;
  unsub = cache.subscribe('k', (v) => { seen.push(v); unsub(); });
  cache.subscribe('k', () => {});
  emitters.get('k')(1);
  emitters.get('k')(2);
  assert.deepEqual(seen, [1], 'it left after the first value');
});

test('peek reports the current value without subscribing', () => {
  const cache = makeCache({ empty: 'none' });
  assert.equal(cache.peek('k'), 'none');
  cache.subscribe('k', () => {});
  emitters.get('k')('v');
  assert.equal(cache.peek('k'), 'v');
  assert.equal(cache.peek('other'), 'none');
});

test('reset closes everything — used when the signed-in user changes', () => {
  const cache = makeCache();
  cache.subscribe('a', () => {});
  cache.subscribe('b', () => {});
  cache.reset();
  assert.deepEqual(closed.sort(), ['a', 'b']);
  assert.equal(cache.listenerCount(), 0);
});
