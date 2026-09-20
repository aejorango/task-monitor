// src/services/sharedSubscription.js — one Firestore listener per query, no
// matter how many components ask for it.
//
// Hooks are a convenient way to read data, which is how every Board card ended
// up calling useWorkspaces() — 200 cards meant 200 auth listeners, 200
// workspaces onSnapshot subscriptions, and 200 copies of the same sort on every
// snapshot. Each expanded card additionally subscribed to the workspace's whole
// activities collection and filtered it client-side.
//
// The fix is not "call the hook less"; it is to make the subscription shared.
// A cache keyed by query opens the underlying listener on the FIRST subscriber
// and closes it when the LAST one goes away, replaying the latest value to
// anyone who joins late. Components keep using hooks; Firestore sees one query.

/**
 * @param {(key: string, emit: (value: any) => void) => (() => void)} open
 *   Opens the real subscription for `key`. Called at most once per live key.
 * @param {{ name?: string, empty?: any }} opts
 *   `empty` is what a subscriber is handed before the first value arrives.
 * @returns {{
 *   subscribe(key: string, cb: (value:any)=>void): () => void,
 *   peek(key: string): any,
 *   activeKeys(): string[],
 *   listenerCount(): number,
 *   reset(): void,
 * }}
 */
export function createSharedSubscription(open, { name = 'shared', empty = null } = {}) {
  /** key → { listeners:Set, value, close, hasValue } */
  const entries = new Map();

  function subscribe(key, cb) {
    if (!key) { cb(empty); return () => {}; }

    let entry = entries.get(key);
    if (!entry) {
      entry = { listeners: new Set(), value: empty, hasValue: false, close: null };
      entries.set(key, entry);
      // Open AFTER the entry is in the map: `open` may emit synchronously.
      entry.close = open(key, (value) => {
        entry.value = value;
        entry.hasValue = true;
        // Copy the set: a listener may unsubscribe from inside its own callback.
        for (const listener of [...entry.listeners]) {
          try { listener(value); } catch (err) { console.error(`[${name}]`, err); }
        }
      });
    }

    entry.listeners.add(cb);
    // Late joiners get the current value immediately rather than a blank frame.
    if (entry.hasValue) {
      try { cb(entry.value); } catch (err) { console.error(`[${name}]`, err); }
    }

    let done = false;
    return () => {
      if (done) return;            // unsubscribing twice must not close early
      done = true;
      entry.listeners.delete(cb);
      if (entry.listeners.size === 0) {
        try { entry.close?.(); } catch (err) { console.error(`[${name}]`, err); }
        entries.delete(key);
      }
    };
  }

  return {
    subscribe,
    peek: (key) => (entries.get(key)?.hasValue ? entries.get(key).value : empty),
    activeKeys: () => [...entries.keys()],
    listenerCount: () => entries.size,
    reset() {
      for (const entry of entries.values()) {
        try { entry.close?.(); } catch { /* already gone */ }
      }
      entries.clear();
    },
  };
}
